import { haversineKm } from "../../geo/distance.ts";
import { toZonedIso } from "../../time/zoned.ts";
import type {
  Meeting,
  MeetingQuery,
  MeetingSource,
  MeetingStatus,
} from "../types.ts";

import { fetchEvents } from "./client.ts";
import {
  findClient,
  findVenue,
  isPlaceless,
  LEGISTAR_CLIENTS,
  type LegistarClient,
} from "./clients.ts";
import type { LegistarEvent, LegistarEventItem } from "./types.ts";

/**
 * Granicus Legistar meeting source. Tracker **D12**.
 *
 * The first real adapter. It reads the documented public Web API at
 * `webapi.legistar.com`, which returns only what a client has already marked
 * public on their own InSite portal — so this is the interface the vendor built
 * for the purpose, not a scrape. The terms review that cleared it is
 * `docs/vendor-review.md` (D14).
 *
 * Everything above `lib/meetings/registry.ts` is unchanged by this landing: the
 * cascade, the API route and the map all still see normalized `Meeting` records
 * and cannot tell this from the mock.
 */

const SOURCE_NAME = "legistar";

/** Matches the cascade's reach: 60 days forward, 30 back. */
const WINDOW_FORWARD_DAYS = 60;
const WINDOW_BACK_DAYS = 30;

/** A raw event carries its client through the transform, since normalize() is pure. */
export interface LegistarEventWithClient {
  event: LegistarEvent;
  slug: string;
  collectedAt: string;
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * `EventDate` arrives as `2026-08-11T00:00:00`. The time half is always
 * midnight and means nothing — the real time is in `EventTime`.
 */
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

/**
 * Legistar has **no cancellation field.** Clients that cancel a meeting
 * conventionally say so in the free-text comment, so an explicit word is the
 * only honest signal.
 *
 * Deliberately narrow. Nothing in Pima's data matches it — the observed comment
 * values are null, "Study Session", "Special Meeting" and "Joint Meeting" — so
 * this path is untested against a real positive and must not be widened into
 * guesswork. A meeting wrongly marked canceled keeps someone at home.
 */
function isCanceled(event: LegistarEvent): boolean {
  const comment = event.EventComment ?? "";
  return /\bcancell?ed\b/i.test(comment);
}

function statusOf(
  event: LegistarEvent,
  startsAt: string,
  now: Date,
): MeetingStatus {
  if (isCanceled(event)) return "CANCELED";
  return Date.parse(startsAt) < now.getTime() ? "CONCLUDED" : "SCHEDULED";
}

/** What a normalize() pass could not place, and why. Counted, never silent. */
export interface NormalizeDrops {
  /** Venue string names a real meeting with no physical place. */
  placeless: number;
  /** Venue string is not in the client's table — needs a curated entry. */
  unknownVenue: number;
  /** No usable date or time. */
  unplaceableInTime: number;
}

export function normalizeWithDrops(
  raw: LegistarEventWithClient[],
  now: Date = new Date(),
): { meetings: Meeting[]; drops: NormalizeDrops } {
  const meetings: Meeting[] = [];
  const drops: NormalizeDrops = {
    placeless: 0,
    unknownVenue: 0,
    unplaceableInTime: 0,
  };

  for (const { event, slug, collectedAt } of raw) {
    const client = findClient(slug);
    if (!client) continue;

    const date = calendarDate(event.EventDate ?? "");
    const time = event.EventTime ? wallClock(event.EventTime) : null;
    if (!date || !time) {
      drops.unplaceableInTime++;
      continue;
    }

    const location = (event.EventLocation ?? "").trim();
    if (!location) {
      drops.unknownVenue++;
      continue;
    }

    if (isPlaceless(location)) {
      drops.placeless++;
      continue;
    }

    const venue = findVenue(client, location);
    // No coordinates and no venue entry. Dropping is the contract: a meeting
    // that cannot be placed is not a pin, and an approximate pin sends someone
    // to the wrong building.
    if (!venue) {
      drops.unknownVenue++;
      continue;
    }

    const startsAt = toZonedIso(
      date.year,
      date.month,
      date.day,
      time.hour,
      time.minute,
      client.timeZone,
    );

    meetings.push({
      id: `${SOURCE_NAME}:${slug}:${event.EventId}`,
      ocdId: client.ocdId,
      bodyName: event.EventBodyName,
      // The comment is what distinguishes one sitting from another — "Study
      // Session" against a regular meeting. Where there is none, the body name
      // is the most specific true thing available.
      title: event.EventComment?.trim() || event.EventBodyName,
      startsAt,
      timeZone: client.timeZone,
      location: {
        name: venue.name,
        address: venue.address,
        lat: venue.lat,
        lng: venue.lng,
      },
      agendaUrl: event.EventAgendaFile,
      jurisdiction: client.jurisdiction,
      status: statusOf(event, startsAt, now),
      provenance: {
        // The InSite permalink — observed on the record, never constructed.
        sourceUrl: event.EventInSiteURL,
        // The public body, not Granicus. Pima County authored the agenda.
        sourceOrg: client.publishingOrg,
        collectedAt,
        // Nothing human has confirmed this row against the portal.
        verifiedAt: null,
      },
    });
  }

  return { meetings, drops };
}

/**
 * Does this agenda show the host body sitting as some other body?
 *
 * The 4.6.9 case, and it is not hypothetical: Pima County's Board of
 * Supervisors meeting of 2026-08-11 carries "BOARD OF SUPERVISORS SITTING AS
 * OTHER BOARDS" and "LIBRARY DISTRICT BOARD" as agenda headings. The county
 * board sat as the library district's board, which means a special district's
 * business is inside a county feed rather than behind a separate hunt.
 *
 * This **reports**; it does not attribute. Turning a heading into a body
 * requires reconciling the named district back to the registry, and until a
 * meeting-to-body join table exists there is nowhere to record the answer.
 * Tracker **D19**.
 */
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

export const legistarSource: MeetingSource<LegistarEventWithClient> = {
  name: SOURCE_NAME,

  async fetch(query: MeetingQuery): Promise<LegistarEventWithClient[]> {
    const now = new Date();
    const from = isoDate(new Date(now.getTime() - WINDOW_BACK_DAYS * 86_400_000));
    const to = isoDate(new Date(now.getTime() + WINDOW_FORWARD_DAYS * 86_400_000));

    const collected: LegistarEventWithClient[] = [];

    // Serialized across clients as well as within one. This loop is the whole
    // reason the adapter is polite: nothing here runs concurrently.
    for (const client of LEGISTAR_CLIENTS) {
      // Skip a client with no venue inside the query radius before spending a
      // request on it. Venue coordinates are the only geography the adapter
      // has, and they are known locally.
      if (!withinRadius(client, query)) continue;

      const events = await fetchEvents<LegistarEvent>(client.slug, { from, to });
      const collectedAt = new Date().toISOString();

      for (const event of events) {
        collected.push({ event, slug: client.slug, collectedAt });
      }
    }

    return collected;
  },

  normalize(raw, now: Date = new Date()): Meeting[] {
    return normalizeWithDrops(raw, now).meetings;
  },

  async upsert(meetings: Meeting[]) {
    // Still no tables — lib/db/schema.ts is `export {}`. Reporting these as
    // updated rather than inserted keeps the same honest lie the mock tells,
    // and persistence lands with the Phase 5 schema.
    return { inserted: 0, updated: meetings.length };
  },
};

/** Is any of this client's known venues inside the query radius? */
function withinRadius(client: LegistarClient, query: MeetingQuery): boolean {
  return client.venues.some(
    (venue) =>
      haversineKm(query.lat, query.lng, venue.lat, venue.lng) <= query.radiusKm,
  );
}
