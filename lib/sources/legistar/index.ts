// @freshness-reads-here
import {
  MEETING_HELD_HORIZON_DAYS,
  MEETING_HELD_LOOKBACK_DAYS,
} from "../../meetings/constants.ts";
import {
  meetingBodiesFor,
  segmentAgenda,
  type AgendaItem,
  type MeetingBody,
} from "../../meetings/attribution.ts";
import { unplacedVenueGap } from "../../meetings/venue-cache.ts";
import { toZonedIso } from "../../time/zoned.ts";
import {
  accountedNormalize,
  type Accounted,
} from "../normalize-account.ts";
import type {
  Meeting,
  MeetingQuery,
  MeetingSource,
  MeetingStatus,
} from "../types.ts";

import { fetchEvents, fetchEventItems } from "./client.ts";
import {
  findVenue,
  isPlaceless,
  LEGISTAR_CLIENTS,
  resolveNativeBody,
  venuesWithinRadius,
  type LegistarClient,
} from "./client-registry.ts";
import type { LegistarOutcomeRecord } from "./outcomes.ts";
import type { LegistarEvent, LegistarEventItem } from "./types.ts";

export {
  classifyRollCall,
  collectEventOutcomes,
  dispositionGap,
  hasRecordedAction,
  isFailedExtraction,
  minutesPointerFor,
  readDisposition,
  receiptFor,
  rollCallGap,
  rollCallRecordFrom,
  toAgendaRecords,
  toOutcomeRecords,
} from "./outcomes.ts";
export type {
  EventOutcomes,
  LegistarAgendaRecord,
  LegistarMinutesPointer,
  LegistarOutcomeRecord,
  LegistarRecordedVote,
  LegistarRollCallRecord,
  OutcomeDisposition,
  RollCallState,
} from "./outcomes.ts";


const SOURCE_NAME = "legistar";

export function legistarMeetingId(slug: string, eventId: number): string {
  return `${SOURCE_NAME}:${slug}:${eventId}`;
}

export function legistarStartsAt(
  event: LegistarEvent,
  timeZone: string,
): string | null {
  const date = calendarDate(event.EventDate ?? "");
  const time = wallClock(event.EventTime ?? "");
  if (date === null || time === null) return null;
  return toZonedIso(date.year, date.month, date.day, time.hour, time.minute, timeZone);
}

/** The fetch window is the served window, derived from the serving constants so the two cannot drift. */
const WINDOW_FORWARD_DAYS = MEETING_HELD_HORIZON_DAYS;
const WINDOW_BACK_DAYS = MEETING_HELD_LOOKBACK_DAYS;

/** A raw event carries its client through the transform, since normalize() is pure. */
export interface LegistarEventWithClient {
  event: LegistarEvent;
  slug: string;
  collectedAt: string;
  items: LegistarEventItem[] | null;
  outcomes?: LegistarOutcomeRecord[] | null;
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function legistarReadWindow(now = new Date()): { from: string; to: string } {
  return { from: isoDate(new Date(now.getTime() - WINDOW_BACK_DAYS * 86_400_000)),
    to: isoDate(new Date(now.getTime() + WINDOW_FORWARD_DAYS * 86_400_000)) };
}

function calendarDate(
  raw: string,
): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw.trim());
  if (!match) return null;

  const [, year, month, day] = match;
  return { year: Number(year), month: Number(month), day: Number(day) };
}

/** `h:mm AM/PM`, the only format this API emits. */
function wallClock(raw: string): { hour: number; minute: number } | null {
  const match = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(raw.trim());
  if (!match) return null;

  const rawHour = Number(match[1]);
  const minute = Number(match[2]);
  if (rawHour < 1 || rawHour > 12 || minute > 59) return null;

  return {
    hour: (rawHour % 12) + (match[3].toUpperCase() === "PM" ? 12 : 0),
    minute,
  };
}

/** A Legistar `...UTC` stamp carries no zone designator; its name says UTC, so it is read as UTC. Null when absent or unreadable. */
function utcInstant(value: string | null | undefined): string | null {
  const text = typeof value === "string" ? value.trim() : "";
  if (text === "") return null;
  const at = Date.parse(/(?:Z|[+-]\d{2}:?\d{2})$/i.test(text) ? text : `${text}Z`);
  return Number.isFinite(at) ? new Date(at).toISOString() : null;
}

export function publisherPostedAt(event: LegistarEvent): string | null {
  const stamps = [utcInstant(event.EventAgendaLastPublishedUTC), utcInstant(event.EventMinutesLastPublishedUTC)]
    .filter((stamp): stamp is string => stamp !== null)
    .sort();
  return stamps.at(-1) ?? null;
}

export function publicVideoUrl(event: LegistarEvent): string | null {
  if (event.EventVideoStatus?.trim().toLowerCase() !== "public") return null;
  // Many Legistar clients publish only a clip id in `EventMedia` and no `EventVideoPath`; the sitting's own
  // Legistar page is then the publisher's record that carries the video.
  const raw = event.EventVideoPath?.trim() || (event.EventMedia?.trim() ? event.EventInSiteURL?.trim() : "");
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && !url.username && !url.password ? url.toString() : null;
  } catch {
    return null;
  }
}

function isCanceled(event: LegistarEvent): boolean {
  const fields = [event.EventComment ?? "", event.EventAgendaStatusName ?? ""];
  return fields.some((field) => /\bcancell?ed\b/i.test(field));
}

function statusOf(
  event: LegistarEvent,
  startsAt: string,
  now: Date,
  dateOnly = false,
): MeetingStatus {
  if (isCanceled(event)) return "CANCELED";
  return Date.parse(startsAt) + (dateOnly ? 24 * 60 * 60_000 : 0) < now.getTime() ? "CONCLUDED" : "SCHEDULED";
}

/** What a normalize() pass could not place, and why. Counted, never silent. */
export interface NormalizeDrops {
  /** Venue string names a real meeting with no physical place. */
  placeless: number;
  unknownVenue: number;
  /** No usable date or time. */
  unplaceableInTime: number;
  notConfigured: number;
}

export function normalizeWithDrops(
  raw: LegistarEventWithClient[],
  now: Date = new Date(),
  clients: readonly LegistarClient[] = LEGISTAR_CLIENTS,
): Accounted<{
  meetings: Meeting[];
  drops: NormalizeDrops;
  agendasRead: number;
}> {
  const meetings: Meeting[] = [];
  const drops: NormalizeDrops = {
    placeless: 0,
    unknownVenue: 0,
    unplaceableInTime: 0,
    // An event whose tenant is not wired is counted, never silently skipped.
    notConfigured: 0,
  };
  let agendasRead = 0;

  let keptButPlaceless = 0;

  for (const { event, slug, collectedAt, items } of raw) {
    const matches = clients.filter(candidate => candidate.slug === slug && candidate.eventBodyId === event.EventBodyId);
    const client = matches.length === 1 ? matches[0] : undefined;
    if (!client) {
      drops.notConfigured++;
      continue;
    }

    const date = calendarDate(event.EventDate ?? "");
    const time = event.EventTime ? wallClock(event.EventTime) : null;
    if (!date) {
      drops.unplaceableInTime++;
      continue;
    }

    const location = (event.EventLocation ?? "").trim();

    // A meeting held online is kept: no building means no pin, but it is a real public meeting. `label` is the
    // published string verbatim; no join link is published, so `joinUrl` is null.
    const online = location && isPlaceless(location) ? { label: location, joinUrl: null } : null;
    if (online) {
      drops.placeless++;
      // A-002: this TALLIES a meeting that is then PRODUCED below (D18), so it
      // is not a drop and must not be summed as one.
      keptButPlaceless += 1;
    }

    const venue = online || !location ? null : findVenue(client, location) ?? null;
    const venueGap = !online && !venue ? unplacedVenueGap(location, client.publishingOrg) : null;
    if (venueGap) {
      drops.unknownVenue++;
      keptButPlaceless += 1;
    }

    const startsAt = toZonedIso(
      date.year,
      date.month,
      date.day,
      time?.hour ?? 0,
      time?.minute ?? 0,
      client.timeZone,
    );

    const id = legistarMeetingId(slug, event.EventId);

    // Segmentation is pure (it reads only the agenda); naming the bodies it finds needs the registry and is
    // applied one layer up by `resolveMeetingBodies`, so every non-host segment carries `bodyId: null` here.
    let actingBodies: MeetingBody[] | undefined;
    if (items !== null) {
      agendasRead++;
      const segments = segmentAgenda(toAgendaItems(items), {
        bodyId: null,
        ocdId: client.ocdId,
        name: event.EventBodyName,
      });
      actingBodies = meetingBodiesFor(id, segments);
    }

    meetings.push({
      id,
      ocdId: client.ocdId,
      bodyId: client.bodyId,
      bodyName: event.EventBodyName,
      title: event.EventComment?.trim() || event.EventBodyName,
      startsAt,
      ...(time ? {} : { startPrecision: "DAY" as const }),
      timeZone: client.timeZone,
      location: venue
        ? {
            name: venue.name,
            address: venue.address,
            lat: venue.lat,
            lng: venue.lng,
          }
        : null,
      ...(online ? { online } : {}),
      ...(venueGap ? { venueGap } : {}),
      agendaUrl: event.EventAgendaFile,
      ...(publicVideoUrl(event) ? { videoUrl: publicVideoUrl(event)! } : {}),
      ...(publisherPostedAt(event) ? { postedAt: publisherPostedAt(event)! } : {}),
      ...(Object.hasOwn(event, "EventAgendaFile") && event.EventAgendaFile == null
        ? { agendaSlotObservedEmpty: true }
        : {}),
      jurisdiction: client.jurisdiction,
      status: statusOf(event, startsAt, now, !time),
      provenance: {
        // The InSite permalink — observed on the record, never constructed.
        sourceUrl: event.EventInSiteURL,
        // The public body, not Granicus.
        sourceOrg: client.publishingOrg,
        collectedAt,
        // Nothing human has confirmed this row against the portal.
        verifiedAt: null,
      },
      // Omitted, never `[]`, when this run did not read the agenda — see the
      // field's own note on why absent and empty are different facts.
      ...(actingBodies ? { actingBodies } : {}),
    });
  }

  return accountedNormalize("legistar", raw, { meetings, drops, agendasRead }, {
    logicalInput: raw.length,
    countedButProduced: keptButPlaceless,
  });
}

export function detectSittingAs(items: LegistarEventItem[]): string[] {
  const marker = /\b(sitting|acting)\s+as\b/i;
  const found = new Set<string>();

  for (const item of items) {
    const text = (item.EventItemTitle ?? item.EventItemMatterName ?? "").trim();
    if (text && marker.test(text)) {
      found.add(text.replace(/\s+/g, " ").slice(0, 200));
    }
  }

  return [...found];
}

export function toAgendaItems(items: LegistarEventItem[]): AgendaItem[] {
  return items.map((item) => ({
    id: item.EventItemId,
    sequence: item.EventItemAgendaSequence,
    title: item.EventItemTitle ?? item.EventItemMatterName ?? "",
    matterFile: item.EventItemMatterFile,
  }));
}

export function makeLegistarSource(
  clients: readonly LegistarClient[] = LEGISTAR_CLIENTS,
  fetchImpl?: typeof fetch,
): MeetingSource<LegistarEventWithClient> {
  return {
    name: SOURCE_NAME,

    async fetch(query: MeetingQuery): Promise<LegistarEventWithClient[]> {
    const { from, to } = legistarReadWindow();

    const collected: LegistarEventWithClient[] = [];

    // Independent tenants have independent connection slots in client.ts.
    await Promise.all(clients.map(async client => {
      // Skip a client whose reviewed venues all lie outside the query radius before spending a request on it; a
      // client with none is read (see `venuesWithinRadius`).
      if (!venuesWithinRadius(client.venues, query)) return;

      const bodyId = await resolveNativeBody(client, { signal: query.signal, fetchImpl });
      const events = await fetchEvents<LegistarEvent>(client.slug, { from, to, bodyId }, {
        signal: query.signal,
        fetchImpl,
      });
      const collectedAt = new Date().toISOString();

      for (const event of events) {
        if (event.EventBodyId !== bodyId) continue;
        collected.push({
          event,
          slug: client.slug,
          collectedAt,
          items: await readAgendaItems(client.slug, event.EventId, query.signal, fetchImpl),
        });
      }
    }));

    return collected;
  },

    normalize(raw, now: Date = new Date()): Meeting[] {
      return normalizeWithDrops(raw, now, clients).meetings;
    },

    async upsert(meetings: Meeting[]) {
      return { inserted: 0, updated: meetings.length };
    },
  };
}

/** The default source; its membership is the installed meeting doors'. */
export const legistarSource: MeetingSource<LegistarEventWithClient> = makeLegistarSource();

async function readAgendaItems(
  slug: string,
  eventId: number,
  signal?: AbortSignal,
  fetchImpl?: typeof fetch,
): Promise<LegistarEventItem[] | null> {
  try {
    return await fetchEventItems<LegistarEventItem>(slug, eventId, { signal, fetchImpl });
  } catch (error) {
    console.warn(
      `  legistar: agenda items unavailable for ${slug}/${eventId} — ${error}; ` +
        "this meeting records NO acting-body reading rather than an empty one",
    );
    return null;
  }
}
