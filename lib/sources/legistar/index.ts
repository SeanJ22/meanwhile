/**
 * @freshness-reads-here
 *
 * RULING 107 — the clock stamps in this file are minted by the code path that
 * performs the read: the freshness date is taken at the moment of the fetch,
 * which is what the ruling asks for rather than what it forbids. Verified
 * 2026-08-23 by reading each stamp site against the retrieval it sits in.
 */
import {
  CONCLUDED_LOOKBACK_DAYS,
  UPCOMING_HORIZON_DAYS,
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
  venuesWithinRadius,
  type LegistarClient,
} from "./client-registry.ts";
import type { LegistarOutcomeRecord } from "./outcomes.ts";
import type { LegistarEvent, LegistarEventItem } from "./types.ts";

/**
 * The outcome half of this adapter, re-exported so a caller reaching for
 * "what did they decide" finds it at the same import as everything else — and
 * finds the record classes already separated when they get there.
 */
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

/**
 * **THE MEETING ID, MINTED IN ONE PLACE.**
 *
 * `<adapter>:<tenant>:<upstream id>` — `legistar:pima:1825`. It is the primary
 * key of `data/meetings-snapshot.json`, the `meetings` table's `id`, and the
 * join key the durable outcome store (`lib/outcomes/`) links an action and a
 * roll call back to a sitting on.
 *
 * It was an inline template literal here and nowhere else, which was safe for
 * exactly as long as nothing else needed to construct one. Two independent
 * spellings of a join key do not fail loudly — they produce a store whose rows
 * match nothing, and an outcome that exists and cannot be found reads to a
 * reader as an outcome that was never collected. So it is a function, and
 * `tests/legistar-outcome-store.test.ts` asserts what it returns is
 * byte-identical to the ids the committed meetings snapshot already carries.
 */
export function legistarMeetingId(slug: string, eventId: number): string {
  return `${SOURCE_NAME}:${slug}:${eventId}`;
}

/**
 * **The sitting's start as an ISO instant, from the event alone.**
 *
 * `normalize()` computes this for every meeting it emits, but only for meetings
 * that survive its drops and only inside its served window. The durable outcome
 * store walks a WIDER window than the served snapshot — four months of Pima
 * history against the snapshot's rolling horizon — so four of twenty backfilled
 * sittings had no snapshot row to read a start time off.
 *
 * They came out with `startsAt: null`, which is honest and is also unorderable,
 * and "the last meeting" is the single most common outcome question there is.
 * So the store derives the instant here instead, through the SAME `calendarDate`
 * / `wallClock` / `toZonedIso` path `normalize()` uses. A second implementation
 * of the zone reassembly would be a second chance to be wrong about a zone, and
 * this API's zonelessness — a date whose time half is always midnight and a
 * separate 12-hour wall clock — is exactly the shape that punishes that.
 *
 * Null when the publisher gives no usable time, which is a real state and not a
 * reason to invent midnight.
 */
export function legistarStartsAt(
  event: LegistarEvent,
  timeZone: string,
): string | null {
  const date = calendarDate(event.EventDate ?? "");
  const time = wallClock(event.EventTime ?? "");
  if (date === null || time === null) return null;
  return toZonedIso(date.year, date.month, date.day, time.hour, time.minute, timeZone);
}

/**
 * The fetch window IS the served window (M76, 2026-08-15).
 *
 * These were literal 60 and 30 with a comment claiming they matched the
 * cascade. The served lookback moved 30 -> 90 and the adapters did not, so
 * every source quietly dropped sixty days of published, retrievable history
 * at the fetch — invisible to every count check, because each adapter
 * honestly reported what it had asked for. Deriving them is what makes the
 * drift impossible rather than merely noticed.
 */
const WINDOW_FORWARD_DAYS = UPCOMING_HORIZON_DAYS;
const WINDOW_BACK_DAYS = CONCLUDED_LOOKBACK_DAYS;

/** A raw event carries its client through the transform, since normalize() is pure. */
export interface LegistarEventWithClient {
  event: LegistarEvent;
  slug: string;
  collectedAt: string;
  /**
   * The event's agenda items, when this run fetched them (D19, g10).
   *
   * **`null` is not `[]`.** Null means nobody asked — the item fetch was
   * capped, or refused, or this is a fixture that predates the fetch. An
   * empty array means the agenda was read and had no items on it. The two
   * become the same fact the moment they share a value, and the one that
   * gets rendered would be a claim about a meeting nobody looked at.
   */
  items: LegistarEventItem[] | null;
  /**
   * What the body DID at this sitting, when a run collected it (2026-08-29).
   *
   * **Absent is not empty, for the third time in this file and for the same
   * reason.** Undefined means outcomes were never collected for this row;
   * `null` means collection was attempted and failed; `[]` means the sitting
   * genuinely recorded no actions, which happens — Pima events 1803 and 1869
   * each carry 36 and 16 agenda items and zero recorded actions.
   *
   * The default ingest does NOT populate this. Collecting it costs one extra
   * request per ACTED item — 525 across the twenty Pima Board sittings
   * measured — and wiring it into `fetch()` changes what a refresh writes to
   * `data/meetings-snapshot.json`, which is an integration decision and not
   * this adapter's to make unilaterally. `collectEventOutcomes` in
   * `./outcomes.ts` is the entry point when that decision is taken.
   */
  outcomes?: LegistarOutcomeRecord[] | null;
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
 *
 * Item 6b (2026-08-15, the author: "zero canceled at Tucson is
 * implausible"). Re-probed live against every field Legistar returns:
 * fourteen Pima events since 2026-06-01, and NOT ONE mentions "cancelled"
 * anywhere in the record — `EventAgendaStatusName` is "Final" on all
 * fourteen. So the zero is a real zero with its denominator, not a dropped
 * signal. What did change: the agenda-status field is now read as well as
 * the comment, because it is the other place a Legistar client could put
 * the word, and looking in one of two possible places is how a real
 * cancellation gets rendered as a meeting going ahead.
 */
/**
 * The recording the publisher's own record links for this sitting (BX-10): `EventVideoPath`, only while the
 * publisher marks the video "Public", and only as a plain https address without credentials. A pointer, never
 * fetched; null when the record carries none.
 */
export function publicVideoUrl(event: LegistarEvent): string | null {
  if (event.EventVideoStatus?.trim().toLowerCase() !== "public") return null;
  const raw = event.EventVideoPath?.trim();
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
): MeetingStatus {
  if (isCanceled(event)) return "CANCELED";
  return Date.parse(startsAt) < now.getTime() ? "CONCLUDED" : "SCHEDULED";
}

/** What a normalize() pass could not place, and why. Counted, never silent. */
export interface NormalizeDrops {
  /** Venue string names a real meeting with no physical place. */
  placeless: number;
  /**
   * Venue string is blank, or is not in the client's reviewed table — needs a
   * curated entry. **Counted and KEPT** (the venue-gap class, 2026-09-23): the
   * sitting is published with no place and its venue gap named, so this tallies
   * a produced meeting, never a drop.
   */
  unknownVenue: number;
  /** No usable date or time. */
  unplaceableInTime: number;
  /**
   * An event whose Legistar tenant is not in the client registry — A-002.
   *
   * This used to be a bare `continue`, so the record was neither produced nor
   * dropped and left no trace anywhere. It is exactly what `notConfigured`
   * means in `NormalizeDropCounts`, and this adapter was the only one of the
   * thirteen call sites missing the counter — which is why the composite's
   * wrapper had to invent a literal `notConfigured: 0` to satisfy the shared
   * shape, and why that literal would have silently discarded the real value
   * the moment one existed.
   */
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
    // A-002: an event whose tenant is not wired used to be a bare `continue`,
    // so it was neither produced nor dropped and left no trace. It is exactly
    // what `notConfigured` means everywhere else, and this adapter was the
    // only one of the twelve missing the counter.
    notConfigured: 0,
  };
  // How many of the meetings that survived had their agenda actually read.
  // Its denominator is `meetings.length`, and the ingest prints both — a run
  // where nothing was read must not look like a run where nothing was found.
  let agendasRead = 0;

  // A-002 · one raw row is one event, so the document layer and the logical
  // layer coincide here — which is why this adapter's gap was a skip rather
  // than an expansion.
  let keptButPlaceless = 0;

  for (const { event, slug, collectedAt, items } of raw) {
    const client = clients.find(candidate => candidate.slug === slug &&
      (candidate.eventBodyId === undefined || candidate.eventBodyId === event.EventBodyId));
    if (!client) {
      drops.notConfigured++;
      continue;
    }

    const date = calendarDate(event.EventDate ?? "");
    const time = event.EventTime ? wallClock(event.EventTime) : null;
    if (!date || !time) {
      drops.unplaceableInTime++;
      continue;
    }

    const location = (event.EventLocation ?? "").trim();

    /*
     * A meeting held online is KEPT (D18). It has no building, so it gets no
     * coordinates and no pin — but it is a real public meeting a reader could
     * attend, and dropping it was the map's constraint being applied to the
     * reader. `label` is the published string verbatim ("Virtual Meeting");
     * Legistar publishes no join link on the event, so `joinUrl` is null and
     * renders as the gap it is rather than as the InSite page dressed up as a
     * way in.
     */
    const online = location && isPlaceless(location) ? { label: location, joinUrl: null } : null;
    if (online) {
      drops.placeless++;
      // A-002: this TALLIES a meeting that is then PRODUCED below (D18), so it
      // is not a drop and must not be summed as one.
      keptButPlaceless += 1;
    }

    const venue = online || !location ? null : findVenue(client, location) ?? null;
    /*
     * **NO REVIEWED PLACE NEVER SUPPRESSES THE SITTING** (the venue-gap class,
     * 2026-09-23). No coordinates still means no pin — an approximate pin
     * sends someone to the wrong building — but the sitting is published, with
     * `location: null` and its gap named: the room exactly as the county wrote
     * it (`STATED_NOT_PLACED`), or, where `EventLocation` is blank, the
     * county's own silence (`NOT_STATED_BY_PUBLISHER`). It still counts as
     * `unknownVenue`, which is now a tally of a KEPT sitting (A-002's
     * countedButProduced), so the ingest report and the venue hunt keep seeing
     * the room that needs a reviewed row. This used to `continue`; and a
     * client whose reviewed venue scope was empty failed its whole partition
     * before a single sitting was read.
     */
    const venueGap = !online && !venue ? unplacedVenueGap(location, client.publishingOrg) : null;
    if (venueGap) {
      drops.unknownVenue++;
      keptButPlaceless += 1;
    }

    const startsAt = toZonedIso(
      date.year,
      date.month,
      date.day,
      time.hour,
      time.minute,
      client.timeZone,
    );

    const id = legistarMeetingId(slug, event.EventId);

    /*
     * D19's live path. The segmentation is PURE — it reads the agenda and
     * nothing else — so it belongs here, where the items are. Naming the
     * bodies it finds needs the registry, which lives on disk and is applied
     * one layer up by `resolveMeetingBodies`; until then every non-host
     * segment carries `bodyId: null`, which is the correct claim and not a
     * placeholder for one.
     */
    let actingBodies: MeetingBody[] | undefined;
    if (items !== null) {
      agendasRead++;
      const segments = segmentAgenda(toAgendaItems(items), {
        /* `bodyId: null` here is the AGENDA SEGMENTER's own parameter and
         * deliberately null — it asks which sub-body a segment belongs to, a
         * different question from which body held the sitting. */
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
      // The comment is what distinguishes one sitting from another — "Study
      // Session" against a regular meeting. Where there is none, the body name
      // is the most specific true thing available.
      title: event.EventComment?.trim() || event.EventBodyName,
      startsAt,
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
      /*
       * **THE API RECORD ITSELF IS THE OBSERVED SURFACE.** (ASK-18.)
       *
       * Legistar's Events resource returns an `EventAgendaFile` field on the
       * event object — the publisher's own first-party record of where this
       * exact sitting's agenda lives. The KEY BEING PRESENT and its value being
       * null is the structural observation the seam requires: the surface has a
       * place for the agenda and the place was empty when we read it.
       *
       * `Object.hasOwn` rather than a null test on the value, and the
       * distinction is the whole point. A response shape that OMITS the field —
       * a projection, an older API version, a different vendor's copy — tells us
       * nothing about what the body posted, and reading its absence as an empty
       * slot would manufacture exactly the claim this flag exists to prevent.
       */
      ...(Object.hasOwn(event, "EventAgendaFile") && event.EventAgendaFile == null
        ? { agendaSlotObservedEmpty: true }
        : {}),
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

/**
 * Does this agenda show the host body sitting as some other body?
 *
 * The 4.6.9 case, and it is not hypothetical: Pima County's Board of
 * Supervisors meeting of 2026-08-11 carries "BOARD OF SUPERVISORS SITTING AS
 * OTHER BOARDS" and "LIBRARY DISTRICT BOARD" as agenda headings. The county
 * board sat as the library district's board, which means a special district's
 * business is inside a county feed rather than behind a separate hunt.
 *
 * This **reports**; it does not attribute. It is kept as the cheap signal —
 * "does this agenda need segmenting at all" — while the attribution itself now
 * lives in `lib/meetings/attribution.ts`, which splits the agenda into the
 * bodies that actually acted and records the ones it cannot name rather than
 * defaulting them onto the host. Tracker **D19**.
 *
 * Run against the recorded Pima agenda it finds **two** special districts, not
 * the one this comment used to name: the Ajo Domestic Water Improvement
 * District as well as the Library District Board.
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

/**
 * Adapt Legistar's agenda items to the shape `attribution.ts` works in.
 *
 * A conversion rather than a re-export, so the attribution layer never has to
 * know a vendor's field names — the same reason `normalize()` exists at all.
 * `EventItemMatterFile` is the load-bearing field: it is present on business and
 * absent on headings, which is what lets the split work without depending on a
 * clerk's capitalisation habits.
 *
 * **THIS FUNCTION IS DELIBERATELY NOTICE-CLASS ONLY, and until 2026-08-29 that
 * was an accident rather than a decision.** The `eventitems` reply carries
 * `EventItemActionName`, `EventItemPassedFlagName`, `EventItemMover`,
 * `EventItemSeconder` and `EventItemActionText`, and this map dropped every one
 * of them on the line below — which is why the corpus could say what was on a
 * Pima agenda and could not say what the Board decided.
 *
 * The fix is NOT to widen `AgendaItem`. `AgendaItem` feeds `segmentAgenda`,
 * whose question is "which body was sitting", and an outcome on a notice-class
 * shape is exactly the substitution `lib/answerability/record-class.ts` exists
 * to refuse. The outcome fields are carried by `toOutcomeRecords` in
 * `./outcomes.ts`, onto a record of a different class with a disjoint field
 * set. Anything that needs a decision reads that; nothing reads it from here.
 */
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
    const now = new Date();
    const from = isoDate(new Date(now.getTime() - WINDOW_BACK_DAYS * 86_400_000));
    const to = isoDate(new Date(now.getTime() + WINDOW_FORWARD_DAYS * 86_400_000));

    const collected: LegistarEventWithClient[] = [];

    // Independent tenants have independent connection slots in client.ts.
    await Promise.all(clients.map(async client => {
      // Skip a client whose reviewed venues all lie outside the query radius
      // before spending a request on it. Venue coordinates are the only
      // geography the adapter has, and they are known locally; a client with
      // none is read (see `venuesWithinRadius`).
      if (!venuesWithinRadius(client.venues, query)) return;

      const events = await fetchEvents<LegistarEvent>(client.slug, { from, to }, {
        signal: query.signal,
        fetchImpl,
      });
      const collectedAt = new Date().toISOString();

      for (const event of events) {
        if (client.eventBodyId !== undefined && event.EventBodyId !== client.eventBodyId) continue;
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
    // Still no tables — lib/db/schema.ts is `export {}`. Reporting these as
    // updated rather than inserted keeps the same honest lie the mock tells,
    // and persistence lands with the Phase 5 schema.
      return { inserted: 0, updated: meetings.length };
    },
  };
}

/** Compatibility default; its membership is itself derived from SOURCE_WIRING. */
export const legistarSource: MeetingSource<LegistarEventWithClient> = makeLegistarSource();

/**
 * Read one event's agenda items, or say honestly that we did not (D19, g10).
 *
 * This is one extra request per event, which is why it was not in the live
 * path before. It is affordable because it runs at INGEST — once per refresh,
 * on the cron, serialized behind the same spacing as everything else — and
 * never per reader; the one wired Legistar client publishes around fourteen
 * events in the served window, so the fan-out is small and stays counted.
 *
 * A refusal returns `null`, NOT `[]`. The whole point of the field is that
 * "nobody read this agenda" and "this agenda named no other body" are
 * different facts about a meeting, and a catch that swallowed the difference
 * would put the second sentence in front of a reader on the strength of the
 * first.
 */
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
