/**
 * @freshness-reads-here
 *
 * The clock stamps in this file are minted by the code path that performs the read: the freshness date
 * is taken at the moment of the fetch.
 */
import type { BodySourceWiring } from "../../registry/source-wiring.ts";
import {
  MEETING_HELD_HORIZON_DAYS,
  MEETING_HELD_LOOKBACK_DAYS,
} from "../../meetings/constants.ts";
import {
  isPlacelessLocation,
  resolveVenue,
  unplacedVenueGap,
} from "../../meetings/venue-cache.ts";
import {
  occurrenceId,
  occurrenceStampFromInstant,
  weakEventIdentity,
} from "../event-identity.ts";
import { politeGetText } from "../http.ts";
import { fetchFailureKind } from "../composite/failure-kind.ts";
import { dateOfDay, dayNumber, expandRuleDays, readRule } from "./recurrence.ts";
import type {
  Meeting,
  MeetingQuery,
  MeetingStatus,
  MeetingVenueGap,
  DuplicateIdentityCounts,
  NormalizeDropCounts,
  OnlineAccess,
  PartialScopeFailure,
  RecurrenceReport,
  ReportingMeetingSource,
} from "../types.ts";
import {
  accountedNormalize,
  type Accounted,
} from "../normalize-account.ts";

/**
 * An `.ics` feed is a calendar handed to us: a format, not a vendor. A town publishing through any
 * iCalendar-speaking calendar hands over start, end, title, venue string and often the board's own name
 * in `CATEGORIES`.
 *
 * The Events Calendar's `/events/?ical=1` returns only the current view; `/events/list/?ical=1` returns the
 * whole calendar. So the wiring row names the full feed URL explicitly, and the parsed count is reported
 * per row.
 *
 * What is dropped, and counted:
 * * An event with no parseable `DTSTART` → `unplaceableInTime`.
 * * An event whose `LOCATION` and row `venueMatch` resolve to no curated venue → counted `unknownVenue` and
 *   kept, with no pin and its venue gap named; never suppressed, never placed.
 * * An event whose `CATEGORIES` does not name a board this row serves → `notConfigured`.
 * * A second event on an id already produced → `duplicates`; the publisher's latest revision keeps the id.
 *
 * A recurring series is one record per sitting: `ical:<slug>:<UID>/<slot>` (see `occurrenceId` in
 * `lib/sources/event-identity.ts`). The master's `RRULE` is expanded into its in-window sittings when every
 * part of it is supported (`lib/sources/ical/recurrence.ts`); otherwise the refused part is named in
 * `recurrence.notExpanded` and the master stands for its own first sitting. An edited sitting belongs to its
 * series' body.
 *
 * Per-body isolation: one row is one feed. A host refusing us empties that row and nothing else, and the
 * refusal is reported as a refusal, never written into the data as an absence.
 */

const SOURCE_NAME = "ical";

const WINDOW_FORWARD_DAYS = MEETING_HELD_HORIZON_DAYS;
const WINDOW_BACK_DAYS = MEETING_HELD_LOOKBACK_DAYS;

/** The body itself says so, in its own summary (including the bare verb "CANCEL"). */
const CANCELED = /\bcancel(?:l?ed)?\b/i;

/**
 * A `LOCATION` that names no place a reader could go: blank, or a bare state code. Only then may a row's
 * standing `venueMatch` stand in for it; any other text is the town's own words for the place.
 */
export function namesNoPlace(rawLocation: string): boolean {
  const text = rawLocation.trim().replace(/[.,]+$/, "");
  return text === "" || US_STATE_CODES.has(text.toUpperCase()) || /^(?:New Hampshire|Arizona|New Jersey)$/i.test(text);
}

const US_STATE_CODES = new Set(
  ("AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR " +
    "PA RI SC SD TN TX UT VT VA WA WV WI WY PR").split(" "),
);

const MOVED = /\b(reschedul\w*|postpon\w*)\b/i;
/** A month/day a summary names, with the word that points at it, if any. */
const NAMED_DAY = /\b(from|to)?[\s-]*(\d{1,2})\/(\d{1,2})(?:\/(\d{4}|\d{2}))?(?![\d/])/gi;

/** A sitting's calendar day on the body's own wall clock. */
function localDayOf(iso: string, zone: string): number | null {
  const dtf = zoneFormatter(zone);
  const at = Date.parse(iso);
  if (!dtf || !Number.isFinite(at)) return null;
  const parts = Object.fromEntries(dtf.formatToParts(new Date(at)).map((p) => [p.type, p.value]));
  return dayNumber(Number(parts.year), Number(parts.month), Number(parts.day));
}

/** The real calendar day nearest `own` that a month/day (and optional year) names. */
function namedDay(own: number, month: number, day: number, year: string | undefined): number | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const ownYear = dateOfDay(own).y;
  const years = year ? [year.length === 2 ? 2000 + Number(year) : Number(year)] : [ownYear - 1, ownYear, ownYear + 1];
  let best: number | null = null;
  for (const y of years) {
    const candidate = dayNumber(y, month, day);
    const back = dateOfDay(candidate);
    if (back.m !== month || back.d !== day) continue;
    if (best === null || Math.abs(candidate - own) < Math.abs(best - own)) best = candidate;
  }
  return best;
}

/**
 * A sitting the body moved off its day was not held on it. A summary that says rescheduled or postponed
 * is read for the day it names:
 * - "to <day>", or a later bare day, names where the sitting went: not held here.
 * - "from <day>", an earlier bare day, or the sitting's own day names where it came from: this is the
 *   moved sitting on its new day, and it keeps the clock's status.
 * - A summary naming no day: only "postponed" counts, since "rescheduled" can describe either end.
 */
export function movedOffItsDay(title: string, startsAt: string, zone: string): boolean {
  const said = MOVED.exec(title);
  if (!said) return false;
  const own = localDayOf(startsAt, zone);
  if (own === null) return false;
  let went = false;
  let came = false;
  for (const [, word, month, day, year] of title.matchAll(NAMED_DAY)) {
    const named = namedDay(own, Number(month), Number(day), year);
    if (named === null) continue;
    const pointer = word?.toLowerCase();
    if (named === own || pointer === "from" || (pointer !== "to" && named < own)) came = true;
    else went = true;
  }
  if (went) return true;
  if (came) return false;
  return /^postpon/i.test(said[1]!);
}

export interface IcalRaw {
  wiring: BodySourceWiring;
  /** The feed body, or empty when the retrieval was refused. */
  ics: string;
  collectedAt: string;
  /** This ROW's retrieval was refused and `ics` is empty. */
  refused?: boolean;
  /** The refusal in its own words, when there was one to keep. */
  refusedReason?: string;
  /** Whose failure the refusal was: the publisher's wall, or our own job. */
  refusedKind?: "WALL" | "JOB";
  /** The furthest ladder rung the refused retrieval reached, when the client knew it. */
  refusedRung?: number;
  /**
   * The upcoming feed answered and the past feed did not: the row still produces its upcoming sittings, so
   * it is partial, not refused.
   */
  archiveRefused?: string;
  sourceUrl: string;
}

/** One event, as the feed wrote it. Nothing is inferred here. */
export interface IcalEvent {
  uid: string | null;
  summary: string | null;
  location: string | null;
  categories: string | null;
  /** The raw `DTSTART` value with its parameters, e.g. `TZID=…:20260819T180000`. */
  dtstart: string | null;
  status: string | null;
  url: string | null;
  /**
   * The raw `RECURRENCE-ID`, in the same `params:value` shape as `dtstart`:
   * this event overrides ONE sitting of the series its `UID` names, and this
   * is that sitting's original start. Null on anything that is not an override.
   */
  recurrenceId: string | null;
  /** The event carries an `RRULE` or `RDATE`: it is the master of a series. */
  recurs: boolean;
  /** `SEQUENCE`, the publisher's revision number for this event, when stated. */
  sequence: number | null;
  /** `LAST-MODIFIED`, as written, when stated. */
  lastModified: string | null;
  /** The `RRULE` value, when there is exactly one; see `rruleLines`. */
  rrule: string | null;
  /** How many `RRULE` lines the event carries. More than one is refused. */
  rruleLines: number;
  /** Each `EXDATE` value as `params:value`, one entry per listed date. */
  exdates: string[];
  /** Each `RDATE` value as `params:value`, one entry per listed date. */
  rdates: string[];
  /** The `RECURRENCE-ID` carries a `RANGE` parameter (this-and-future). */
  recurrenceRange: boolean;
  /**
   * Every property the feed published for this event, as served and in the
   * order served, less the publisher's own record-keeping — see
   * `publishedFieldsOf`. Absent on an event built by hand rather than parsed,
   * which is never merged with anything (`collapsePublisherRelistings`).
   */
  publishedFields?: string;
}

/**
 * The lines of an event that are the publisher's RECORD-KEEPING about its own
 * calendar entry, not anything it published about the sitting: the entry's id,
 * when the entry was stamped, created and last edited, and its revision number.
 */
const RECORD_KEEPING = new Set(["UID", "DTSTAMP", "CREATED", "LAST-MODIFIED", "SEQUENCE"]);

/**
 * What an event published, with its own id taken out: every unfolded property line in the order served,
 * less the `RECORD_KEEPING` lines. In a `URL`, a path segment or query value that is the `UID`'s own
 * number is written `{uid}` (only tokens carrying a digit). Two events whose strings are equal published
 * the same thing in every field a reader could see.
 */
export function publishedFieldsOf(body: string, uid: string | null): string {
  const idTokens = new Set((uid ?? "").split(/[^A-Za-z0-9]+/).filter((t) => t.length >= 3 && /\d/.test(t)));
  const kept: string[] = [];
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (!line) continue;
    const name = (/^([A-Za-z0-9-]+)/.exec(line)?.[1] ?? "").toUpperCase();
    if (RECORD_KEEPING.has(name)) continue;
    if (name === "URL" && idTokens.size > 0) {
      const colon = line.indexOf(":", name.length);
      const head = colon < 0 ? line : line.slice(0, colon + 1);
      const value = colon < 0 ? "" : line.slice(colon + 1);
      kept.push(head + value.replace(/([/=?&])([A-Za-z0-9]+)(?=$|[/?&#.])/g, (whole, sep: string, token: string) =>
        idTokens.has(token) ? `${sep}{uid}` : whole));
      continue;
    }
    kept.push(line);
  }
  return kept.join("\n");
}

/** `EXDATE;TZID=X:a,b` → [`;TZID=X:a`, `;TZID=X:b`]. */
function listedValues(body: string, name: string): string[] {
  return [...body.matchAll(new RegExp(`^${name}([^:\\r\\n]*):(.*)$`, "gim"))].flatMap((m) =>
    m[2]
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
      .map((value) => `${m[1]}:${value}`),
  );
}

/**
 * Unfold RFC 5545 line folding, then split into events. Without unfolding a long `LOCATION` is truncated at
 * a byte boundary and matches nothing.
 */
export function parseIcs(ics: string): IcalEvent[] {
  const unfolded = ics.replace(/\r\n[ \t]/g, "").replace(/\n[ \t]/g, "");
  const blocks = unfolded.split("BEGIN:VEVENT").slice(1);
  const events: IcalEvent[] = [];
  for (const block of blocks) {
    const body = block.split("END:VEVENT")[0];
    const prop = (name: string): string | null => {
      const m = new RegExp(`^${name}(;[^:\\r\\n]*)?:(.*)$`, "mi").exec(body);
      return m ? m[2].trim() : null;
    };
    const dtstartLine = /^DTSTART([^:\r\n]*):(.*)$/im.exec(body);
    const recurrenceIdLine = /^RECURRENCE-ID([^:\r\n]*):(.*)$/im.exec(body);
    const sequence = Number.parseInt(prop("SEQUENCE") ?? "", 10);
    const rrules = [...body.matchAll(/^RRULE:(.*)$/gim)].map((m) => m[1].trim());
    events.push({
      rrule: rrules.length === 1 ? rrules[0] : null,
      rruleLines: rrules.length,
      exdates: listedValues(body, "EXDATE"),
      rdates: listedValues(body, "RDATE"),
      recurrenceRange: recurrenceIdLine ? /;RANGE=/i.test(recurrenceIdLine[1]) : false,
      uid: prop("UID"),
      summary: unescapeText(prop("SUMMARY")),
      location: unescapeText(prop("LOCATION")),
      categories: unescapeText(prop("CATEGORIES")),
      dtstart: dtstartLine ? `${dtstartLine[1]}:${dtstartLine[2].trim()}` : null,
      status: prop("STATUS"),
      url: prop("URL"),
      recurrenceId: recurrenceIdLine
        ? `${recurrenceIdLine[1]}:${recurrenceIdLine[2].trim()}`
        : null,
      recurs: /^(?:RRULE|RDATE)[;:]/im.test(body),
      sequence: Number.isFinite(sequence) ? sequence : null,
      lastModified: prop("LAST-MODIFIED"),
      publishedFields: publishedFieldsOf(body, prop("UID")),
    });
  }
  return events;
}

/**
 * The recurrence SLOT a date or date-time names, as an occurrence stamp.
 *
 * A timed value resolves through its own `TZID` (or the row's zone) to a UTC
 * instant, so one instant spelled in two zones is one slot. An all-day value
 * is its calendar date as written: a day has no instant to resolve. Null when
 * the value cannot be placed in time, exactly as `parseDtStart` refuses it.
 */
export function slotStamp(raw: string, fallbackZone: string): string | null {
  const parsed = parseDtStart(raw, fallbackZone);
  if (!parsed) return null;
  if (parsed.dayOnly) {
    return /^\d{8}/.exec(splitOnce(raw, ":")[1].trim())?.[0] ?? null;
  }
  return occurrenceStampFromInstant(parsed.iso);
}

/** iCalendar escapes commas and semicolons; a venue string carries both. */
function unescapeText(value: string | null): string | null {
  if (value === null) return null;
  return value
    .replace(/\\n/gi, " ")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\")
    .trim();
}

/**
 * `DTSTART;TZID=America/New_York:20260819T180000` → an instant.
 *
 * The zone comes from the feed's own `TZID` where it has one, and from the
 * wiring row otherwise. A `Z` suffix is already UTC. A DATE-only value
 * (`VALUE=DATE:20260819`) has no time and is reported as such by the caller —
 * this returns the midnight instant and a precision flag, never an invented
 * hour.
 */
export function parseDtStart(
  raw: string,
  fallbackZone: string,
): { iso: string; dayOnly: boolean } | null {
  const [params, value] = splitOnce(raw, ":");
  if (!value) return null;
  const tzid = /TZID=([^;:]+)/i.exec(params)?.[1] ?? fallbackZone;
  const dayOnly = /VALUE=DATE\b/i.test(params) || /^\d{8}$/.test(value.trim());

  const v = value.trim();
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(v);
  if (!m) return null;
  const [, y, mo, d, hh = "00", mi = "00", ss = "00", z] = m;
  if (z) {
    return { iso: `${y}-${mo}-${d}T${hh}:${mi}:${ss}.000Z`, dayOnly };
  }
  // A wall-clock time in a named zone. Resolve it by asking what offset that
  // zone had at that instant, which is the only correct way across a DST
  // boundary — a fixed offset is right for half the year.
  const naive = Date.UTC(+y, +mo - 1, +d, +hh, +mi, +ss);
  const offset = wallClockOffsetMs(naive, tzid);
  // A zone we could not interpret produces no timestamp: the caller counts it as `unplaceableInTime`.
  // Defaulting to UTC would put a meeting hours (or a day) off.
  if (offset === null) return null;
  return { iso: new Date(naive - offset).toISOString(), dayOnly };
}

/**
 * The zone's UTC offset for a WALL-CLOCK time (given as if it were UTC), or
 * `null` when the zone cannot be read.
 *
 * Asking for the offset at the naive instant is right except within hours of
 * a daylight-saving change, where the naive instant and the real one fall on
 * opposite sides of it: 3am on 1 November 2026 in New York came out 7:00Z,
 * which is 2am EST. So both the offset before and the offset after are
 * tried, and the one that reproduces the wall clock wins, the earlier where
 * both do (a repeated hour's first occurrence) and the offset before the gap
 * where neither does (an hour that does not exist): RFC 5545 §3.3.5.
 */
function wallClockOffsetMs(naive: number, zone: string): number | null {
  const before = zoneOffsetMs(naive - 43_200_000, zone);
  const after = zoneOffsetMs(naive + 43_200_000, zone);
  if (before === null || after === null) return null;
  const valid = [before, after].filter((candidate) => zoneOffsetMs(naive - candidate, zone) === candidate);
  if (valid.length === 0) return before;
  // The earlier instant is the one with the larger offset.
  return Math.max(...valid);
}

function splitOnce(s: string, sep: string): [string, string] {
  const i = s.indexOf(sep);
  return i < 0 ? [s, ""] : [s.slice(0, i), s.slice(i + 1)];
}

/**
 * How far the named zone was from UTC at `utcMs`, in milliseconds, or `null` when the zone cannot be
 * interpreted. Never 0 as a fallback: zero is a claim that the meeting is in UTC.
 */
/**
 * One formatter per zone, because constructing one is the expensive part and
 * an expanded series asks for the same zone hundreds of times. A zone `Intl`
 * refuses is remembered as refused (`null`), never as UTC.
 */
const zoneFormatters = new Map<string, Intl.DateTimeFormat | null>();

function zoneFormatter(zone: string): Intl.DateTimeFormat | null {
  if (!zoneFormatters.has(zone)) {
    try {
      zoneFormatters.set(zone, new Intl.DateTimeFormat("en-US", {
        timeZone: zone,
        hour12: false,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }));
    } catch {
      zoneFormatters.set(zone, null);
    }
  }
  return zoneFormatters.get(zone) ?? null;
}

function zoneOffsetMs(utcMs: number, zone: string): number | null {
  try {
    const dtf = zoneFormatter(zone);
    // A-007: NOT `0`. A zone Intl refused is no offset at all.
    if (!dtf) return null;
    const parts = Object.fromEntries(
      dtf.formatToParts(new Date(utcMs)).map((p) => [p.type, p.value]),
    );
    const asUtc = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour) % 24,
      Number(parts.minute),
      Number(parts.second),
    );
    return asUtc - utcMs;
  } catch {
    // A-007: NOT `0`. See above — zero is UTC, and UTC is a claim.
    return null;
  }
}

function statusOf(startsAt: string, now: Date): MeetingStatus {
  return Date.parse(startsAt) < now.getTime() ? "CONCLUDED" : "SCHEDULED";
}

/** One event's claim on a meeting id, with the event that made it. */
export interface IdentityClaim {
  readonly meeting: Meeting;
  readonly event: IcalEvent;
}

/** `LAST-MODIFIED` (`20260420T133910Z`) as an instant, or null when absent or malformed. */
function lastModifiedAt(value: string | null): number | null {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?$/.exec(value ?? "");
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : null;
}

/**
 * The publisher's own `LAST-MODIFIED` as an ISO instant, or null when the event states none. `DTSTAMP` is
 * never used.
 */
export function publisherPostedAt(event: Pick<IcalEvent, "lastModified">): string | null {
  const at = lastModifiedAt(event.lastModified);
  return at === null ? null : new Date(at).toISOString();
}

/**
 * Which of two events on one id keeps it, decided by what they say: the publisher's latest revision (the
 * higher `SEQUENCE`, absent is 0, then the later `LAST-MODIFIED`); at the same revision the tie is broken
 * on content, so the answer never depends on feed order.
 */
function preferredClaim(held: IdentityClaim, incoming: IdentityClaim): IdentityClaim {
  const sequence = (claim: IdentityClaim) => claim.event.sequence ?? 0;
  if (sequence(held) !== sequence(incoming)) {
    return sequence(incoming) > sequence(held) ? incoming : held;
  }
  const modified = (claim: IdentityClaim) =>
    lastModifiedAt(claim.event.lastModified) ?? Number.NEGATIVE_INFINITY;
  if (modified(held) !== modified(incoming)) {
    return modified(incoming) > modified(held) ? incoming : held;
  }
  const content = ({ meeting }: IdentityClaim) =>
    JSON.stringify([
      meeting.startsAt,
      meeting.title,
      meeting.status,
      meeting.location?.name ?? null,
      meeting.location?.address ?? null,
      meeting.provenance.sourceUrl,
    ]);
  return content(incoming) < content(held) ? incoming : held;
}

/** How a reader is told a sitting was listed more than once by its own publisher. */
export function relistedNote(listings: number): string {
  return `listed ${listings === 2 ? "twice" : `${listings} times`} in the publisher's own calendar`;
}

/**
 * One sitting the publisher's own calendar lists twice is one sitting. Within one wiring row, claims
 * merge only when their events published exactly the same thing (`IcalEvent.publishedFields`) and state
 * the same sitting instant; only the publisher's record-keeping may differ. Anything else that differs
 * keeps both listings, each with the listing-identity notice. The survivor is the lowest id and carries
 * every listing's id and page (`provenance.publisherListings`). An engineering correctness rule: remove the
 * one call in `normalizeWithDrops` and every pair returns as two listings.
 */
export function collapsePublisherRelistings(
  claims: readonly IdentityClaim[],
): { readonly survivor: IdentityClaim; readonly merged: readonly string[] }[] {
  const groups = new Map<string, IdentityClaim[]>();
  for (const claim of claims) {
    const fields = claim.event.publishedFields;
    // An event with no published record (built by hand, never parsed) states
    // nothing to compare, so it is never merged with anything.
    if (fields === undefined || !claim.event.uid) continue;
    const key = JSON.stringify([claim.meeting.bodyId ?? null, claim.meeting.startsAt, claim.meeting.startPrecision ?? "MINUTE", fields]);
    groups.set(key, [...(groups.get(key) ?? []), claim]);
  }
  const out: { survivor: IdentityClaim; merged: string[] }[] = [];
  for (const group of groups.values()) {
    if (new Set(group.map(({ meeting }) => meeting.id)).size < 2) continue;
    const ordered = [...group].sort((a, b) => (a.meeting.id < b.meeting.id ? -1 : a.meeting.id > b.meeting.id ? 1 : 0));
    const [keep, ...rest] = ordered;
    out.push({
      survivor: {
        event: keep.event,
        meeting: {
          ...keep.meeting,
          provenance: {
            ...keep.meeting.provenance,
            publisherListings: {
              note: relistedNote(ordered.length),
              sourceIds: ordered.map(({ meeting }) => meeting.id),
              sourceUrls: ordered.map(({ meeting }) => meeting.provenance.sourceUrl),
            },
          },
        },
      },
      merged: rest.map(({ meeting }) => meeting.id),
    });
  }
  return out;
}

/** One sitting a series states: its instant and its recurrence slot. */
interface Sitting {
  readonly iso: string;
  readonly dayOnly: boolean;
  readonly slot: string;
}

/** What a series event states inside the serving window. */
interface SeriesPlan {
  /** Sittings the series itself states, ascending, before overrides apply. */
  readonly sittings: readonly Sitting[];
  /** In-window sittings the publisher struck out with `EXDATE`. */
  readonly excluded: readonly { readonly slot: string; readonly statedBy: string }[];
  /** Null when the rule was expanded; otherwise the part that was refused. */
  readonly unsupported: string | null;
}

function isDateValue(raw: string): boolean {
  const [params, value] = splitOnce(raw, ":");
  return /VALUE=DATE(?!-)/i.test(params) || /^\d{8}$/.test(value.trim());
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/** The calendar day a `DTSTART` value names, on its own wall clock. */
function localDay(raw: string): number | null {
  const m = /^(\d{4})(\d{2})(\d{2})/.exec(splitOnce(raw, ":")[1].trim());
  return m ? dayNumber(+m[1], +m[2], +m[3]) : null;
}

/**
 * **THE SITTINGS ONE SERIES STATES, OR THE PART OF ITS RULE THAT WAS REFUSED.**
 *
 * An expanded series states every sitting its `RRULE` (and `RDATE`) produces
 * inside the serving window, less the ones its `EXDATE` strikes out; its
 * overrides are applied by the caller, which holds them. A series whose rule
 * is refused states its own first sitting only, exactly as it did before
 * expansion existed, and names the refused part: nothing is guessed.
 */
function planSeries(input: {
  readonly master: IcalEvent;
  readonly owners: readonly IcalEvent[];
  readonly overrides: readonly IcalEvent[];
  readonly zone: string;
  readonly fromMs: number;
  readonly toMs: number;
}): SeriesPlan | null {
  const { master, owners, overrides, zone, fromMs, toMs } = input;
  if (!master.dtstart) return null;
  const first = parseDtStart(master.dtstart, zone);
  const firstSlot = slotStamp(master.dtstart, zone);
  if (!first || !firstSlot) return null;
  const [params, value] = splitOnce(master.dtstart, ":");
  const inWindow = (iso: string) => {
    const at = Date.parse(iso);
    return at >= fromMs && at <= toMs;
  };

  const exclusions = new Map<string, string>();
  let exdateProblem: string | null = null;
  for (const raw of master.exdates) {
    if (isDateValue(raw) !== first.dayOnly) {
      exdateProblem = `EXDATE ${raw} of the wrong value type`;
      break;
    }
    const slot = slotStamp(raw, zone);
    if (!slot) {
      exdateProblem = `EXDATE ${raw} that cannot be placed in time`;
      break;
    }
    exclusions.set(slot, raw);
  }

  const firstOnly = (unsupported: string): SeriesPlan => {
    const struck = exdateProblem === null && exclusions.has(firstSlot);
    return {
      sittings: !struck && inWindow(first.iso) ? [{ iso: first.iso, dayOnly: first.dayOnly, slot: firstSlot }] : [],
      excluded: struck && inWindow(first.iso) ? [{ slot: firstSlot, statedBy: exclusions.get(firstSlot)! }] : [],
      unsupported,
    };
  };

  if (owners.length > 1) return firstOnly("more than one series event carrying this UID");
  if (overrides.some((event) => event.recurrenceRange)) return firstOnly("RECURRENCE-ID with RANGE");
  if (master.rruleLines > 1) return firstOnly("more than one RRULE");
  if (!first.dayOnly && !/TZID=/i.test(params)) return firstOnly("a DTSTART with no TZID");
  if (exdateProblem) return firstOnly(exdateProblem);

  const stated: Sitting[] = [];
  for (const raw of master.rdates) {
    if (/VALUE=PERIOD/i.test(raw) || splitOnce(raw, ":")[1].includes("/")) return firstOnly("RDATE as a period");
    if (isDateValue(raw) !== first.dayOnly) return firstOnly(`RDATE ${raw} of the wrong value type`);
    const parsed = parseDtStart(raw, zone);
    const slot = slotStamp(raw, zone);
    if (!parsed || !slot) return firstOnly(`RDATE ${raw} that cannot be placed in time`);
    stated.push({ iso: parsed.iso, dayOnly: parsed.dayOnly, slot });
  }

  if (!master.rrule) {
    stated.push({ iso: first.iso, dayOnly: first.dayOnly, slot: firstSlot });
  } else {
    const reading = readRule(master.rrule, first.dayOnly);
    if (!reading.ok) return firstOnly(reading.unsupported);
    const rule = reading.rule;
    const local = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2}))?$/.exec(value.trim());
    if (!local) return firstOnly(`DTSTART ${value}`);
    const clock = first.dayOnly ? "" : `T${local[4]}${local[5]}${local[6]}`;
    /** A day on the series' own wall clock, resolved in its own zone. */
    const on = (day: number): Sitting | null => {
      const { y, m, d } = dateOfDay(day);
      const stamp = `${y}${pad2(m)}${pad2(d)}`;
      const parsed = parseDtStart(`${params}:${stamp}${clock}`, zone);
      if (!parsed) return null;
      const slot = first.dayOnly ? stamp : occurrenceStampFromInstant(parsed.iso);
      return slot ? { iso: parsed.iso, dayOnly: first.dayOnly, slot } : null;
    };
    const expansion = expandRuleDays({
      rule,
      startDay: dayNumber(+local[1], +local[2], +local[3]),
      throughDay: Math.floor(toMs / 86_400_000) + 2,
      pastUntil: (day) => {
        if (!rule.until) return false;
        if (rule.until.kind === "DATE") return day > rule.until.day;
        const sitting = on(day);
        return sitting === null || Date.parse(sitting.iso) > rule.until.ms;
      },
    });
    if (!expansion.ok) return firstOnly(expansion.unsupported);
    for (const day of expansion.days) {
      const sitting = on(day);
      if (!sitting) return firstOnly("a sitting the zone cannot place in time");
      stated.push(sitting);
    }
  }

  const bySlot = new Map(stated.map((sitting) => [sitting.slot, sitting]));
  const sittings: Sitting[] = [];
  const excluded: { slot: string; statedBy: string }[] = [];
  for (const sitting of [...bySlot.values()].sort((a, b) => Date.parse(a.iso) - Date.parse(b.iso))) {
    if (!inWindow(sitting.iso)) continue;
    const struck = exclusions.get(sitting.slot);
    if (struck !== undefined) excluded.push({ slot: sitting.slot, statedBy: struck });
    else sittings.push(sitting);
  }
  return { sittings, excluded, unsupported: null };
}

/**
 * A feed that publishes every sitting as its own event while restating the series' `RRULE` on each.
 * Expanding those would publish each sitting many times and invent sittings past the series' end. The
 * evidence: two events with different `UID`s, the same title and rule, the later starting on a sitting of
 * the earlier one's rule. Then no rule is expanded and every event is one sitting. Returns the evidence,
 * or null.
 */
function ruleRestatedOnSittings(events: readonly IcalEvent[]): string | null {
  const groups = new Map<string, IcalEvent[]>();
  for (const event of events) {
    if (!event.uid || !event.rrule || event.recurrenceId || !event.dtstart) continue;
    const [params, value] = splitOnce(event.dtstart, ":");
    const key = JSON.stringify([event.rrule, (event.summary ?? "").trim().toLowerCase(), params, value.trim().slice(8)]);
    groups.set(key, [...(groups.get(key) ?? []), event]);
  }
  for (const group of groups.values()) {
    if (new Set(group.map((event) => event.uid)).size < 2) continue;
    const ordered = [...group].sort((a, b) => (localDay(a.dtstart!) ?? 0) - (localDay(b.dtstart!) ?? 0));
    const earliest = ordered[0];
    const startDay = localDay(earliest.dtstart!);
    const reading = readRule(earliest.rrule!, isDateValue(earliest.dtstart!));
    if (startDay === null || !reading.ok) continue;
    const lastDay = Math.max(...ordered.map((event) => localDay(event.dtstart!) ?? startDay));
    const expansion = expandRuleDays({ rule: reading.rule, startDay, throughDay: lastDay, pastUntil: () => false });
    if (!expansion.ok) continue;
    const days = new Set(expansion.days);
    const later = ordered.find((event) => event.uid !== earliest.uid && days.has(localDay(event.dtstart!) ?? -1));
    if (later) {
      return (
        `${earliest.uid} and ${later.uid} carry the same title and rule (${earliest.rrule}), ` +
        `and ${later.uid} starts on a sitting of ${earliest.uid}'s rule`
      );
    }
  }
  return null;
}

export function makeIcalSource(
  wiringRows: BodySourceWiring[],
  fetchImpl?: typeof fetch,
): ReportingMeetingSource<IcalRaw> {
  const normalizeWithDrops = (
    raw: IcalRaw[],
    now: Date = new Date(),
  ): Accounted<{
    meetings: Meeting[];
    drops: NormalizeDropCounts;
    unreachableOcdIds?: string[];
    partialScopes?: PartialScopeFailure[];
    duplicateIdentity?: DuplicateIdentityCounts;
    recurrence?: RecurrenceReport;
  }> => {
    /** What became of every series this pass met, by body. */
    const recurrence: RecurrenceReport = { expandedSeries: 0, exclusions: [], notExpanded: [] };
    const drops: NormalizeDropCounts = {
      placeless: 0,
      unknownVenue: 0,
      unplaceableInTime: 0,
      notConfigured: 0,
    };
    const unreachable: string[] = [];
    /**
     * Every id produced so far and the event that holds it. A second event on
     * an id held already is a duplicate, and which of the two keeps the id is
     * decided by `preferredClaim`, never by which came first in the feed.
     */
    const claims = new Map<string, IdentityClaim>();
    /** Events parsed and dated, then set aside as outside the served window. */
    let outOfWindow = 0;
    /** A-002 · every event this pass looked at, across every feed in hand. */
    let considered = 0;
    /** A-002 · events whose identity had already been produced. */
    let duplicates = 0;
    /**
     * Sittings tallied in `placeless` or `unknownVenue` that are then kept and produced (or counted as
     * duplicates), so the tally is not a drop.
     */
    let keptButPlaceless = 0;
    /** A-005 · the feed published the same UID twice. Its own doing. */
    let exactDuplicates = 0;
    /**
     * Two UID-less records this code judged to be the same sitting, counted apart from exact duplicates
     * because it is our judgement rather than the feed's statement.
     */
    let weakIdCollisions = 0;
    /**
     * Listings the publisher's calendar carried more than once under another id, every published field
     * identical, merged by `collapsePublisherRelistings`.
     */
    let publisherRelisted = 0;
    /** Divisions whose archive feed refused while their upcoming feed answered, collected per cause. */
    const archiveRefusals = new Map<string, (string | null)[]>();

    const from = new Date(now.getTime() - WINDOW_BACK_DAYS * 86_400_000);
    const to = new Date(now.getTime() + WINDOW_FORWARD_DAYS * 86_400_000);

    for (const { wiring, ics, collectedAt, refused, archiveRefused, sourceUrl } of raw) {
      if (archiveRefused) {
        const at = archiveRefusals.get(archiveRefused) ?? [];
        at.push(wiring.ocdId ?? null);
        archiveRefusals.set(archiveRefused, at);
      }
      if (refused) {
        // A refusal is reported as a refusal. It never becomes an empty
        // calendar for this body, and it never touches any other row.
        if (wiring.ocdId) unreachable.push(wiring.ocdId);
        continue;
      }

      // Which events on this calendar are this body's sittings; one of these is required:
      // - `categoryMatch`: the feed's own `CATEGORIES` names the board (the publisher's classification).
      // - `titleMatch`: comma-separated phrases, any of which in the `SUMMARY` makes the event this body's. A list
      //   because a body's name is spelled several ways on its own calendar; nothing is inferred from a
      //   near-miss.
      // - `feedScope: "category"`: the feed is the body's own calendar category, so every event is the body's.
      //   Only a reviewed row sets it, and `crosswalkRowIssue` admits it only on a category-scoped feed and never
      //   beside `titleMatch` or `categoryMatch`.
      // `titleExclude` removes what a phrase would over-catch.
      const feedScope = wiring.config.feedScope ?? "";
      const category = wiring.config.categoryMatch ?? "";
      const titleTerms = (wiring.config.titleMatch ?? "")
        .split(",")
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean);
      const excludeTerms = (wiring.config.titleExclude ?? "")
        .split(",")
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean);

      const events = parseIcs(ics);
      /*
       * THE SITTINGS AN OVERRIDE HAS REPLACED, read from the WHOLE feed
       * before any filter runs. An override replaces its sitting even when its
       * own title no longer names this body or its new date is outside the
       * window: a Planning Board sitting re-titled "Room reserved", or moved
       * out of range, is no longer a Planning Board sitting at its old time,
       * and the series master must not keep asserting that it is.
       */
      const overriddenSlots = new Set<string>();
      /** Each series' own event(s): the non-override events carrying its `UID`. */
      const seriesOwners = new Map<string, IcalEvent[]>();
      /** Each series' overrides. */
      const seriesOverrides = new Map<string, IcalEvent[]>();
      for (const event of events) {
        if (!event.uid) continue;
        if (!event.recurrenceId) {
          seriesOwners.set(event.uid, [...(seriesOwners.get(event.uid) ?? []), event]);
          continue;
        }
        seriesOverrides.set(event.uid, [...(seriesOverrides.get(event.uid) ?? []), event]);
        const slot = slotStamp(event.recurrenceId, wiring.timeZone);
        if (slot) overriddenSlots.add(`${event.uid} ${slot}`);
      }
      /*
       * A feed that publishes every sitting itself and restates the series'
       * rule on each one is read event by event: no rule in it is expanded,
       * and each event keeps the id a single event always had. See
       * `ruleRestatedOnSittings`.
       */
      let restatedSeriesEvents = 0;
      /** Every id THIS row produced, in the order first claimed: the scope `collapsePublisherRelistings` merges within. */
      const rowIds: string[] = [];
      /** Does this row's own rule name this event, read from its own fields? */
      const namesThisBody = (event: IcalEvent): boolean => {
        const cats = (event.categories ?? "")
          .split(",")
          .map((c) => c.trim().toLowerCase());
        const summary = (event.summary ?? "").toLowerCase();
        if (feedScope === "category") return !excludeTerms.some((t) => summary.includes(t));
        return category
          ? cats.includes(category.toLowerCase())
          : titleTerms.length > 0 &&
              titleTerms.some((t) => summary.includes(t)) &&
              !excludeTerms.some((t) => summary.includes(t));
      };
      // The evidence is read from this body's own series, not the whole feed, where unrelated series can
      // supply it by accident.
      const restated = ruleRestatedOnSittings(events.filter(namesThisBody));

      for (const event of events) {
        // A-002 · the logical record here is the EVENT, never the document.
        // One `.ics` file is one raw row and, at Newbury, 1,157 of these.
        considered += 1;
        // An edited sitting belongs to its series' body, not its own title: the series event decides the body,
        // the override's `DTSTART` says when the sitting now is, and its title is shown as written. An override
        // whose series event is not in the feed is read by its own fields.
        const owners = event.uid && event.recurrenceId ? seriesOwners.get(event.uid) : undefined;
        const matched = owners && owners.length > 0
          ? owners.some(namesThisBody)
          : namesThisBody(event);
        if (!matched) {
          drops.notConfigured++;
          continue;
        }

        if (!event.dtstart) {
          drops.unplaceableInTime++;
          continue;
        }
        const start = parseDtStart(event.dtstart, wiring.timeZone);
        if (!start) {
          drops.unplaceableInTime++;
          continue;
        }

        /*
         * **WHICH SITTINGS THIS EVENT STATES.** (2026-09-23.)
         *
         * A single event and an override state one sitting each: their own
         * start. A series event states every sitting of its rule inside the
         * window (`planSeries`), and each of those is a logical record of
         * its own, so the series event is replaced in the count by its
         * sittings. One with no sitting in the window counts once, as out
         * of window, which is where it counted before expansion existed.
         */
        const seriesEvent = Boolean(event.uid && event.recurs && !event.recurrenceId);
        if (seriesEvent && restated) restatedSeriesEvents += 1;
        let sittings: { iso: string; dayOnly: boolean; slot: string | null }[];
        if (seriesEvent && !restated) {
          const plan = planSeries({
            master: event,
            owners: seriesOwners.get(event.uid!) ?? [event],
            overrides: seriesOverrides.get(event.uid!) ?? [],
            zone: wiring.timeZone,
            fromMs: from.getTime(),
            toMs: to.getTime(),
          });
          if (!plan) {
            drops.unplaceableInTime++;
            continue;
          }
          const seriesId = `${SOURCE_NAME}:${wiring.config.slug}:${event.uid}`;
          if (plan.unsupported === null) recurrence.expandedSeries += 1;
          else {
            recurrence.notExpanded.push({
              bodyId: wiring.bodyId,
              seriesId,
              reason: "UNSUPPORTED_RULE",
              detail:
                `${plan.unsupported} is not supported, so this series' rule is not expanded: ` +
                "its own first sitting and its edited sittings are published, and no other sitting is inferred",
            });
          }
          for (const { slot, statedBy } of plan.excluded) {
            recurrence.exclusions.push({
              bodyId: wiring.bodyId,
              seriesId,
              slot,
              meetingId: occurrenceId(seriesId, slot),
              statedBy,
            });
          }
          if (plan.sittings.length === 0) {
            // COUNTED, because an uncounted exit path is how a zero-row
            // extraction passes for an accounted one. See `outOfWindow` in
            // lib/sources/normalize-account.ts.
            outOfWindow++;
            continue;
          }
          considered += plan.sittings.length - 1;
          // A sitting an override speaks for is the same sitting published
          // twice: the override is its own event and is produced as itself.
          sittings = [];
          for (const sitting of plan.sittings) {
            if (overriddenSlots.has(`${event.uid} ${sitting.slot}`)) {
              duplicates += 1;
              exactDuplicates += 1;
            } else {
              sittings.push(sitting);
            }
          }
          if (sittings.length === 0) continue;
        } else {
          const when = new Date(start.iso);
          if (when < from || when > to) {
            outOfWindow++;
            continue;
          }
          let slot: string | null = null;
          if (event.uid && event.recurrenceId) {
            slot = slotStamp(event.recurrenceId, wiring.timeZone);
            if (!slot) {
              // An override whose own slot cannot be placed in time has no
              // identity we could state: the A-007 disposition, counted.
              drops.unplaceableInTime++;
              continue;
            }
          }
          sittings = [{ iso: start.iso, dayOnly: start.dayOnly, slot }];
        }

        const rawLocation = (event.location ?? "").trim();
        // Venue resolution. An empty `LOCATION` is not a placeless meeting: `placeless` means the body published
        // a location string naming no building ("Virtual Meeting"). The feed's own location comes first; only a
        // blank one or a bare state code reaches the row's `venueMatch` (the body's own sourced standing
        // statement). A `LOCATION` naming another place is the town's own words and renders as its named gap.
        let venue = resolveVenue(SOURCE_NAME, wiring.ocdId, rawLocation);
        if (!venue && wiring.config.venueMatch && namesNoPlace(rawLocation)) {
          venue = resolveVenue(SOURCE_NAME, wiring.ocdId, wiring.config.venueMatch);
        }
        // Neither resolves: kept, never placed, never suppressed:
        // - a `LOCATION` naming no building is online, counted `placeless`;
        // - any other `LOCATION` is the town's own words, rendered as its named gap (`STATED_NOT_PLACED`);
        // - no `LOCATION` and no `venueMatch` is the publisher's own gap (`NOT_STATED_BY_PUBLISHER`);
        // - no `LOCATION` and a `venueMatch` with no reviewed row keeps our own place-not-recorded gap.
        // Each is counted (`unknownVenue` for the last three) and then produced, so the tally is
        // `keptButPlaceless`, never a drop.
        let online: OnlineAccess | null = null;
        let venueGap: MeetingVenueGap | null = null;
        if (!venue) {
          if (rawLocation && isPlacelessLocation(rawLocation)) {
            online = { label: rawLocation, joinUrl: null };
            drops.placeless += sittings.length;
          } else {
            if (rawLocation || !wiring.config.venueMatch) {
              venueGap = unplacedVenueGap(rawLocation, wiring.publishingOrg);
            }
            drops.unknownVenue += sittings.length;
          }
          keptButPlaceless += sittings.length;
        }

        const title = (event.summary ?? wiring.publishingOrg).trim();
        // Identity when the feed gives none. A `UID` is the identity whenever it exists; a UID-less event is
        // identified by everything the feed did publish (body slug, start, summary, location, description), so
        // two boards sitting at the same time stay two sittings.
        const fallbackIdentity = weakEventIdentity({
          slug: wiring.config.slug,
          startIso: start.iso,
          summary: event.summary,
          location: rawLocation,
          description: null,
        });
        const seriesId = `${SOURCE_NAME}:${wiring.config.slug}:${event.uid ?? fallbackIdentity}`;

        for (const sitting of sittings) {
          // One sitting of a recurring series is one record: the `UID` plus its recurrence slot (an override's
          // `RECURRENCE-ID`, or the instance the rule places). A single event keeps the id it always had. See
          // `occurrenceId` in lib/sources/event-identity.ts.
          const id = sitting.slot === null ? seriesId : occurrenceId(seriesId, sitting.slot);
          const meeting: Meeting = {
            id,
            ocdId: wiring.ocdId,
            /* NH-RC4: the body, from the wiring row that produced this meeting. */
            bodyId: wiring.bodyId,
            bodyName: wiring.config.bodyName ?? wiring.publishingOrg,
            title,
            startsAt: sitting.iso,
            startPrecision: sitting.dayOnly ? "DAY" : "MINUTE",
            timeZone: wiring.timeZone,
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
            agendaUrl: null,
            ...(publisherPostedAt(event) ? { postedAt: publisherPostedAt(event)! } : {}),
            jurisdiction: wiring.jurisdiction,
            status:
              CANCELED.test(title) || /^CANCELLED$/i.test(event.status ?? "") ||
                movedOffItsDay(title, sitting.iso, wiring.timeZone)
                ? "CANCELED"
                : statusOf(sitting.iso, now),
            provenance: {
              sourceUrl: event.url ?? sourceUrl,
              sourceOrg: wiring.publishingOrg,
              collectedAt,
              verifiedAt: null,
            },
          };

          const claim: IdentityClaim = { meeting, event };
          const held = claims.get(id);
          if (held) {
            // Counted, with exact duplicates (the feed repeating an identity) apart from weak-id collisions (our
            // judgement). Which one keeps the id is `preferredClaim`, not arrival order.
            duplicates += 1;
            if (event.uid) exactDuplicates += 1;
            else weakIdCollisions += 1;
            claims.set(id, preferredClaim(held, claim));
            continue;
          }
          claims.set(id, claim);
          rowIds.push(id);
        }
      }
      // One sitting the publisher's own calendar lists under two ids, every
      // published field identical, is one sitting (`collapsePublisherRelistings`).
      const relisted = collapsePublisherRelistings(rowIds.map((id) => claims.get(id)!));
      for (const { survivor, merged } of relisted) {
        claims.set(survivor.meeting.id, survivor);
        for (const id of merged) claims.delete(id);
        duplicates += merged.length;
        publisherRelisted += merged.length;
      }
      if (restated && restatedSeriesEvents > 0) {
        recurrence.notExpanded.push({
          bodyId: wiring.bodyId,
          seriesId: null,
          reason: "RULE_RESTATED_ON_PUBLISHED_SITTINGS",
          detail:
            `${restatedSeriesEvents} event(s) this body's rule selects carry a recurrence rule, and this feed ` +
            `publishes its sittings one by one with the series' rule restated on each (${restated}); ` +
            "each event is read as the one sitting it states, and no rule is expanded",
        });
      }
    }

    // Emitted in an order of their own, never the feed's: the same events
    // served in another order produce the same meetings in the same order.
    const meetings = [...claims.values()]
      .map(({ meeting }) => meeting)
      .sort(
        (left, right) =>
          Date.parse(left.startsAt) - Date.parse(right.startsAt) ||
          (left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
      );

    return accountedNormalize(
      SOURCE_NAME,
      raw,
      {
        meetings,
        drops,
        ...(unreachable.length > 0 ? { unreachableOcdIds: unreachable } : {}),
        // A-005 · reported always, including as zeroes. A counter that only
        // appears when it fires cannot be read as "we looked and it was none".
        duplicateIdentity: { exact: exactDuplicates, weakIdCollision: weakIdCollisions, publisherRelisted },
        // Reported always, like the duplicate counts: a series that was not
        // expanded is named here, never left for a short calendar to imply.
        recurrence,
        ...(archiveRefusals.size > 0
          ? {
              // A-004 · the third state, between `ok` and refused. The
              // upcoming feed answered; the archive did not; and the two must
              // not be reported as one.
              partialScopes: [...archiveRefusals].map(([cause, ocdIds]) => ({
                scope: "ARCHIVE" as const,
                ocdIds,
                cause,
              })),
            }
          : {}),
      },
      // A refused row carries no document. `unretrieved` is at the document layer and `logicalInput` at the event
      // layer, deliberately not added together: a refused feed contributes zero events to `considered`.
      {
        unretrieved: raw.filter((r) => r.refused).length,
        outOfWindow,
        logicalInput: considered,
        duplicates,
        countedButProduced: keptButPlaceless,
      },
    );
  };

  return {
    name: SOURCE_NAME,

    async fetch(query: MeetingQuery): Promise<IcalRaw[]> {
      const collected: IcalRaw[] = [];
      // One feed is fetched once per run, however many bodies it serves, so a town is never asked for the same
      // document once per wiring row. A refusal is shared by every row on that URL: one retrieval, one wall.
      const fetched = new Map<string, { ics: string; refused: boolean; refusedReason?: string; refusedKind?: "WALL" | "JOB"; refusedRung?: number }>();
      for (const wiring of wiringRows) {
        const url = wiring.config.feedUrl;
        if (!url) {
          collected.push({
            wiring,
            ics: "",
            collectedAt: new Date().toISOString(),
            refused: true,
            // Our wiring names no feed: our configuration, never the town's wall.
            refusedReason: "no calendar feed URL is wired for this body",
            refusedKind: "JOB",
            sourceUrl: "",
          });
          continue;
        }
        const cached = fetched.get(url);
        if (cached) {
          collected.push({
            wiring,
            ics: cached.ics,
            collectedAt: new Date().toISOString(),
            ...(cached.refused
              ? {
                  refused: true,
                  refusedReason: cached.refusedReason,
                  refusedKind: cached.refusedKind,
                  ...(typeof cached.refusedRung === "number" ? { refusedRung: cached.refusedRung } : {}),
                }
              : {}),
            sourceUrl: url,
          });
          continue;
        }
        try {
          const res = await politeGetText(url, {
            fetchImpl,
            accept: "text/calendar,text/plain;q=0.9,*/*;q=0.8",
            signal: query.signal,
            // A 200 with no VCALENDAR in it is a failed retrieval, not an empty calendar. See `expect` in
            // lib/sources/http.ts.
            expect: { label: "a calendar feed", marker: "BEGIN:VCALENDAR" },
          });
          // Ask for the past as well: the list view serves upcoming events only, so the row may name a past feed URL
          // (e.g. `tribe_event_display=past`). A past feed that refuses does not fail the row.
          let ics = res.text;
          let archiveRefused: string | undefined;
          if (wiring.config.pastFeedUrl) {
            try {
              const past = await politeGetText(wiring.config.pastFeedUrl, {
                fetchImpl,
                accept: "text/calendar,text/plain;q=0.9,*/*;q=0.8",
                signal: query.signal,
                expect: { label: "a calendar feed", marker: "BEGIN:VCALENDAR" },
              });
              ics += past.text;
            } catch (error) {
              // The archive refused: the row carries the cause, normalize turns it into a scoped partial, and
              // carry-forward preserves the concluded rows for this division only.
              archiveRefused = String((error as Error)?.message ?? error);
            }
          }
          // A calendar with no events in it is a failed retrieval, not an empty calendar: a well-formed
          // `BEGIN:VCALENDAR` envelope with no VEVENT passes every transport check. The row is refused, so the body
          // keeps its last known sittings (clipped to the serving window) instead of the whole source going red. A
          // calendar that genuinely empties is marked refused too, until its carried rows age out.
          if (!/BEGIN:VEVENT/i.test(ics)) {
            const refusedReason = `${url} answered a calendar envelope holding no events`;
            fetched.set(url, { ics: "", refused: true, refusedReason, refusedKind: "WALL" });
            collected.push({
              wiring,
              ics: "",
              collectedAt: new Date().toISOString(),
              refused: true,
              refusedReason,
              refusedKind: "WALL",
              sourceUrl: url,
            });
            continue;
          }
          fetched.set(url, { ics, refused: false });
          collected.push({
            wiring,
            ics,
            collectedAt: new Date().toISOString(),
            ...(archiveRefused ? { archiveRefused } : {}),
            sourceUrl: url,
          });
        } catch (error) {
          // One host's refusal empties this row and no other, carried forward as a refusal with its own words and
          // kind.
          const refusedReason = String((error as Error)?.message ?? error);
          const refusedKind = fetchFailureKind(error);
          const rung = (error as { rung?: unknown } | undefined)?.rung;
          const refusedRung = typeof rung === "number" ? { refusedRung: rung } : {};
          fetched.set(url, { ics: "", refused: true, refusedReason, refusedKind, ...refusedRung });
          collected.push({
            wiring,
            ics: "",
            collectedAt: new Date().toISOString(),
            refused: true,
            refusedReason,
            refusedKind,
            ...refusedRung,
            sourceUrl: url,
          });
        }
      }
      return collected;
    },

    normalize(raw, now: Date = new Date()): Meeting[] {
      return normalizeWithDrops(raw, now).meetings;
    },

    normalizeWithDrops,

    async upsert(meetings: Meeting[]) {
      return { inserted: 0, updated: meetings.length };
    },
  };
}
