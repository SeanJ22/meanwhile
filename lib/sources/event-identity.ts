import { createHash } from "node:crypto";

/**
 * Identity for an event the feed did not identify. Two events in one wiring row starting at the same
 * instant (common where one feed serves a whole town) must not collapse to one id.
 *
 * Identity is everything the feed did publish about the event: the body slug, the start instant, the
 * summary, the location and the description. Records agreeing on all five are the same sitting published
 * twice; records differing anywhere are two sittings. A hash of the fields, not the fields joined, so a
 * colon in a field cannot change how `lib/meetings/*` splits meeting ids on `:`. A weak-id collision (our
 * judgement) is counted separately from an exact duplicate (the feed repeating a UID).
 */
export interface WeakEventIdentityFields {
  /** The wiring row's slug — a body, not a town. */
  slug: string;
  /** The resolved start instant, ISO 8601. */
  startIso: string;
  summary: string | null;
  location: string | null;
  description: string | null;
}

/**
 * A stable identity for an event with no `UID`.
 *
 * The prefix `w-` marks it as WEAK in the id itself, so a meeting id read out
 * of a snapshot says whether its identity came from the publisher or from us.
 * That is the same discipline `carried` uses on a carried row: a value that was
 * inferred should say so where somebody will see it.
 */
export function weakEventIdentity(fields: WeakEventIdentityFields): string {
  const parts = [
    fields.slug,
    fields.startIso,
    (fields.summary ?? "").trim().toLowerCase().replace(/\s+/g, " "),
    (fields.location ?? "").trim().toLowerCase().replace(/\s+/g, " "),
    (fields.description ?? "").trim().toLowerCase().replace(/\s+/g, " "),
  ];
  // A unit separator, because it cannot appear in any of these fields and so
  // cannot let two different tuples produce one joined string.
  const digest = createHash("sha256").update(parts.join("")).digest("hex");
  return `w-${digest.slice(0, 16)}`;
}

/**
 * One sitting of a recurring series is one record. An iCalendar feed publishes a recurring board as one
 * `UID` carried by several `VEVENT`s (the master with an `RRULE`, plus overrides naming their slot in
 * `RECURRENCE-ID`), so the `UID` alone cannot identify a sitting.
 *
 * Identity is RFC 5545's: the `UID` plus the instance's original start (its recurrence slot). A sitting
 * keeps its id when it is moved. The slot is a UTC instant `YYYYMMDDTHHMMSSZ` (or `YYYYMMDD` for an
 * all-day series) after the `UID` and a `/`. Nothing splits a meeting id on `/`. A non-recurring event's
 * id is `ical:<slug>:<UID>`.
 */
export const OCCURRENCE_SEPARATOR = "/";

/** A UTC instant `YYYYMMDDTHHMMSSZ`, or a calendar date `YYYYMMDD`. */
const OCCURRENCE_STAMP = /^\d{8}(?:T\d{6}Z)?$/;

/** `2026-09-15T23:00:00.000Z` → `20260915T230000Z`, or null when unparseable. */
export function occurrenceStampFromInstant(iso: string): string | null {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return null;
  return new Date(at).toISOString().replace(/\.\d{3}Z$/, "Z").replace(/[-:]/g, "");
}

/** The instant a timed slot stamp names, or null for a date stamp or any other text. */
export function occurrenceStampInstant(stamp: string): string | null {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(stamp);
  return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}.000Z` : null;
}

/** The id of one occurrence of the series whose id is `seriesId`. */
export function occurrenceId(seriesId: string, stamp: string): string {
  if (!OCCURRENCE_STAMP.test(stamp)) {
    throw new Error(`OCCURRENCE_STAMP_INVALID:${stamp}`);
  }
  return `${seriesId}${OCCURRENCE_SEPARATOR}${stamp}`;
}

/**
 * The series id and slot an occurrence id was built from, or null for an id of
 * any other shape.
 */
export function occurrenceParts(
  id: string,
): { readonly seriesId: string; readonly stamp: string } | null {
  const at = id.lastIndexOf(OCCURRENCE_SEPARATOR);
  if (at <= 0) return null;
  const stamp = id.slice(at + 1);
  if (!OCCURRENCE_STAMP.test(stamp)) return null;
  return { seriesId: id.slice(0, at), stamp };
}

/** The part of a meeting a supersession claim is checked against. */
export interface OccurrenceSupersessionFacts {
  readonly id: string;
  readonly bodyId?: string | null;
  readonly startsAt: string;
}

/**
 * When an occurrence record replaces the series record it was hiding in: the old `UID`-only id is no
 * longer produced, and carrying it forward would show one sitting twice. Replaced only when the
 * replacement is an occurrence of the same series (`<old id>/<slot>`), for the same body, that is the
 * same sitting (same start) or the same instance (its slot is the old record's start). Anything else
 * takes the ordinary path.
 */
export function supersedesSeriesRecord(
  prior: OccurrenceSupersessionFacts,
  successor: OccurrenceSupersessionFacts,
): boolean {
  const parts = occurrenceParts(successor.id);
  if (!parts || parts.seriesId !== prior.id) return false;
  if ((successor.bodyId ?? null) !== (prior.bodyId ?? null)) return false;
  const before = Date.parse(prior.startsAt);
  if (!Number.isFinite(before)) return false;
  if (Date.parse(successor.startsAt) === before) return true;
  const slot = occurrenceStampInstant(parts.stamp);
  return slot !== null && Date.parse(slot) === before;
}

/**
 * Identity for a sitting two routes number differently (e.g. Legistar's WebAPI and its portal calendar
 * grid do not share an id space). The key is `body | local date | local wall-clock time` in the body's
 * own zone:
 * - The body, not the division: several bodies can share one division.
 * - Local date and time: what a clerk publishes and a reader reads.
 * - The kind is not in the key: one route may write it and the other leave it blank.
 * Two bodies at one time, one body twice in a day, and two routes disagreeing about the time all stay
 * separate sittings.
 */
export interface SittingKeyFields {
  /** The registry body id — the strongest thing available. */
  bodyId?: string | null;
  /** WHERE, used only when there is no body id. */
  ocdId?: string | null;
  /** Display geography, the last resort so two division-less bodies cannot collide. */
  jurisdiction?: string | null;
  /** ISO 8601 WITH OFFSET, as every adapter writes it. */
  startsAt: string;
  /** The IANA zone the body meets in. */
  timeZone: string;
}

/** The separator, chosen because it cannot occur in an id, a date or a clock. */
const UNIT_SEPARATOR = "";

/**
 * The local calendar date and wall-clock time an instant lands on in a zone.
 *
 * `Intl` rather than string surgery on `startsAt`, because two adapters write
 * the same moment differently — `2026-09-08T13:00:00-07:00` from one and
 * `2026-09-08T20:00:00.000Z` from another — and a comparison that cannot see
 * through an offset is not a comparison of times.
 */
export function localWallClock(
  startsAt: string,
  timeZone: string,
): { date: string; time: string } | null {
  const at = Date.parse(startsAt);
  if (!Number.isFinite(at)) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(at));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const date = `${get("year")}-${get("month")}-${get("day")}`;
  // Some ICU builds render midnight as "24"; normalize so two spellings of one
  // minute cannot key differently.
  const hour = get("hour") === "24" ? "00" : get("hour");
  if (!get("year") || !hour) return null;
  return { date, time: `${hour}:${get("minute")}` };
}

/**
 * The cross-route identity of one sitting, or null when the record cannot be
 * placed in time.
 *
 * Null rather than a fallback key: a record with an unparseable start has no
 * sitting identity, and giving it one would let two unrelated unparseable
 * records merge into one meeting.
 */
export function sittingKey(fields: SittingKeyFields): string | null {
  const local = localWallClock(fields.startsAt, fields.timeZone);
  if (!local) return null;
  return sittingKeyFromLocal({ ...fields, ...local });
}

/**
 * The same key, for a route that never published an instant (a calendar grid, an RSS title, a clerk's
 * schedule table, none stating a zone). Built from the local date and wall clock directly; `sittingKey`
 * calls this, so the two cannot drift. `localDate` is `YYYY-MM-DD` and `localTime` is 24-hour `HH:MM`;
 * callers normalize first.
 */
export interface LocalSittingKeyFields {
  bodyId?: string | null;
  ocdId?: string | null;
  jurisdiction?: string | null;
  /** `YYYY-MM-DD`, the body's own calendar date. */
  date: string;
  /** `HH:MM`, 24-hour, the body's own wall clock. */
  time: string;
}

export function sittingKeyFromLocal(fields: LocalSittingKeyFields): string | null {
  const who =
    fields.bodyId ??
    (fields.ocdId ? `division:${fields.ocdId}` : null) ??
    (fields.jurisdiction ? `jurisdiction:${fields.jurisdiction}` : null);
  if (!who || !fields.date || !fields.time) return null;
  return [who, fields.date, fields.time].join(UNIT_SEPARATOR);
}

/** Words that name a sitting's kind or the notice, never which body sits. */
const NOT_THE_BODY = new Set([
  "agenda", "for", "meeting", "meetings", "regular", "special", "executive",
  "session", "committee", "the", "of", "via", "zoom", "and", "a",
]);

/**
 * The body a sitting belongs to, as its own published words name it: "GOVERNING BOARD AGENDA SPECIAL
 * MEETING" and "Governing Board Meeting - via Zoom" are both `governing-board`. Shared by the Diligent
 * schedule union and `reissuesSitting`, so they never disagree about which body a listing names.
 */
export function sittingBodyKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((word) => word && !NOT_THE_BODY.has(word))
    .map((word) => (word.length > 4 ? word.replace(/s$/, "") : word))
    .join("-");
}

/** The part of a listed meeting a re-issued-sitting claim is checked against. */
export interface ListedSittingFacts extends OccurrenceSupersessionFacts {
  readonly bodyName?: string | null;
  readonly title?: string | null;
  /** Absent means `MINUTE`, as on `Meeting`. */
  readonly startPrecision?: string | null;
  readonly timeZone?: string | null;
}

/**
 * A sitting its publisher re-issued under a new id. A fresh row of the same partition holds a prior
 * row's sitting only when every clause holds:
 * - the same registry body (`bodyId`), present on both;
 * - the same body in the listings' own words: `sittingBodyKey` of `bodyName` agrees and names something,
 *   and `sittingBodyKey` of `title` agrees;
 * - the same local date and minute in the same `timeZone` (`sittingKey`), both dated to the minute (a
 *   `DAY`-precision listing proves no time).
 * No fuzzy match. The title is required because some feeds give every row one body name.
 */
export function reissuesSitting(prior: ListedSittingFacts, successor: ListedSittingFacts): boolean {
  if (prior.id === successor.id) return false;
  const bodyId = prior.bodyId ?? null;
  if (!bodyId || (successor.bodyId ?? null) !== bodyId) return false;
  const timeZone = prior.timeZone ?? null;
  if (!timeZone || (successor.timeZone ?? null) !== timeZone) return false;
  if ((prior.startPrecision ?? "MINUTE") !== "MINUTE" || (successor.startPrecision ?? "MINUTE") !== "MINUTE") {
    return false;
  }
  const body = sittingBodyKey(prior.bodyName ?? "");
  if (!body || sittingBodyKey(successor.bodyName ?? "") !== body) return false;
  if (sittingBodyKey(prior.title ?? "") !== sittingBodyKey(successor.title ?? "")) return false;
  const at = (startsAt: string): string | null => {
    try {
      return sittingKey({ bodyId, startsAt, timeZone });
    } catch (error) {
      // A zone Intl cannot resolve places nothing in time, so it proves nothing.
      if (error instanceof RangeError) return null;
      throw error;
    }
  };
  const before = at(prior.startsAt);
  return before !== null && before === at(successor.startsAt);
}

/**
 * Which route supplied this field. A merged record draws different fields from different routes (the
 * grid's location and kind, the RSS first-published instant, the per-meeting iCalendar wall clock, the
 * WebAPI agenda file), so each field names its own route.
 */
export type SittingRoute =
  | "INSITE_CALENDAR_GRID"
  | "INSITE_CALENDAR_RSS"
  | "INSITE_ICAL_EXPORT"
  | "LEGISTAR_WEBAPI_EVENTS";

export interface SittingFieldProvenance {
  /** The meeting id this describes. */
  meetingId: string;
  /** Its cross-route identity — see `sittingKey`. */
  key: string;
  /** Field name to the route that supplied its value. */
  fields: Record<string, SittingRoute>;
  /** The portal's own meeting id, when a portal route supplied the record. */
  insiteId?: string | null;
  /** Mandatory alongside the id on `View.ashx`; carried so a later run can re-read. */
  insiteGuid?: string | null;
  /** The WebAPI's `EventId`, when that route supplied the record. */
  legistarEventId?: number | null;
  /**
   * When the publisher itself first published this sitting, from the RSS
   * `pubDate`. Null when no feed item was read — never a stand-in date.
   */
  firstPublishedAt?: string | null;
}

/** The part of `Meeting` supersession actually reads. */
export interface MeetingLike {
  id: string;
  bodyId?: string;
  ocdId?: string | null;
  jurisdiction?: string;
  bodyName?: string;
  title?: string;
  startsAt: string;
  timeZone: string;
  status?: string;
  agendaUrl?: string | null;
}

/**
 * How a sitting changed between two readings of the public record.
 *
 * Keyed on the SOURCE's own stable identifier (the namespaced meeting id, which
 * carries the portal's number) rather than on `sittingKey`, because the thing
 * most worth catching — a sitting moved to another time — is precisely a change
 * of the sitting key.
 */
export type SittingChange =
  | { kind: "NEW"; meeting: MeetingLike }
  | { kind: "UNCHANGED"; meeting: MeetingLike }
  | { kind: "RESCHEDULED"; meeting: MeetingLike; from: string; to: string }
  | { kind: "CANCELED"; meeting: MeetingLike }
  | { kind: "UPDATED"; meeting: MeetingLike; changed: string[] }
  /**
   * The row was in the earlier reading and is not in the later one.
   *
   * **This is NOT a cancellation and may never be rendered as one.** A row can
   * leave a grid because the range filter moved past it, because the portal was
   * partially served, or because the clerk re-filed it — and "the calendar no
   * longer lists it" is a fact about our reading, not about the body. The
   * earlier record is carried with its own provenance and the state is named,
   * so a surface can say what is true instead of asserting an absence.
   */
  | { kind: "ABSENT_FROM_LATEST"; meeting: MeetingLike };

/**
 * Reconcile an earlier reading of a body's calendar against a later one.
 *
 * Both arrays are readings of the SAME source. This only says what the public
 * record now says, in terms that keep a body's decision distinct from our own
 * retrieval; the caller decides what to do with it.
 */
export function reconcileSittings(
  previous: MeetingLike[],
  current: MeetingLike[],
): SittingChange[] {
  const before = new Map(previous.map((m) => [m.id, m]));
  const changes: SittingChange[] = [];

  for (const meeting of current) {
    const was = before.get(meeting.id);
    before.delete(meeting.id);

    if (!was) {
      changes.push({ kind: "NEW", meeting });
      continue;
    }
    // A cancellation the body itself declared outranks every other difference:
    // a sitting that moved AND was called off is called off.
    if (meeting.status === "CANCELED" && was.status !== "CANCELED") {
      changes.push({ kind: "CANCELED", meeting });
      continue;
    }
    if (Date.parse(meeting.startsAt) !== Date.parse(was.startsAt)) {
      changes.push({
        kind: "RESCHEDULED",
        meeting,
        from: was.startsAt,
        to: meeting.startsAt,
      });
      continue;
    }
    const changed = (["title", "bodyName", "agendaUrl", "status"] as const).filter(
      (field) => (meeting[field] ?? null) !== (was[field] ?? null),
    );
    changes.push(
      changed.length > 0
        ? { kind: "UPDATED", meeting, changed }
        : { kind: "UNCHANGED", meeting },
    );
  }

  for (const meeting of before.values()) {
    changes.push({ kind: "ABSENT_FROM_LATEST", meeting });
  }

  return changes;
}
