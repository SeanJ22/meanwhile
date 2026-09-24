import { createHash } from "node:crypto";

/**
 * **A-005 · IDENTITY FOR AN EVENT THE FEED DID NOT IDENTIFY.**
 * (External correctness audit of `336a3eb`, remediated 2026-08-24.)
 *
 * ## What was wrong
 *
 * `ical` built a meeting id as `ical:<slug>:<UID ?? start.iso>`. A feed that
 * publishes `UID` is fine. A feed that does not — and plenty do not — fell back
 * to **the start instant alone**, so any two events in one wiring row that
 * began at the same moment collapsed to one id. The second was swallowed by the
 * `seen` set with no drop counter, no duplicate counter, and no line anywhere
 * saying a meeting had been discarded.
 *
 * ## Why it is not an edge case
 *
 * Same-night, same-time sittings are the NORM in the towns this product exists
 * for. A Zoning Board at 7pm and a Conservation Commission at 7pm on alternate
 * Tuesdays in the same town hall is how small New England government schedules
 * itself, and where one calendar feed serves a whole town — which is exactly
 * the shape this adapter was written for, Newbury's 1,157-event feed — those
 * two events sit in the same row.
 *
 * So the class of body most likely to lose a meeting was the class of body
 * nobody else covers. That is the equal-effort failure arriving through a hash
 * function.
 *
 * ## What identity is instead
 *
 * Everything the feed DID publish about the event: the body slug, the start
 * instant, the summary, the location and the description. Two records agreeing
 * on all five are the same sitting published twice; two differing anywhere are
 * two sittings.
 *
 * **It is deliberately a HASH of the fields rather than the fields joined.**
 * A summary or a location carrying a colon would otherwise change how the id
 * splits, and `lib/meetings/*` splits meeting ids on `:` to recover the source
 * name. A fixed-width hex digest cannot do that.
 *
 * **And a collision judged here is COUNTED as a distinct kind.** An exact
 * duplicate is the feed publishing one UID twice — its statement. A weak-id
 * collision is this code deciding two records are the same sitting without the
 * feed saying so — our judgement. Pooling them would hide the one worth
 * watching inside the one that is routine.
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
 * **ONE SITTING OF A RECURRING SERIES IS ONE RECORD.** (2026-09-23.)
 *
 * ## What was wrong
 *
 * An iCalendar feed publishes a recurring board as ONE `UID` carried by
 * several `VEVENT`s: the series master (`DTSTART` plus an `RRULE`) and one
 * override per edited sitting, each naming the sitting it replaces with a
 * `RECURRENCE-ID`. `ical` keyed a meeting on the `UID` alone, so every sitting
 * of a series competed for one id, the first one in feed order won, and the
 * rest were counted as exact duplicates. Google Calendar serves its `.ics`
 * events in a different order on every request, so the one record changed
 * sitting from read to read. Production, 2026-09-14 to 09-23: the Town of
 * Bradford Conservation Commission's record moved its start 51 times across
 * five sittings, and Warner's Zoning Board record 39 times across three,
 * alternating between a held meeting and a cancelled one. A reader saw one
 * sitting at a time, never all of them.
 *
 * ## What identity is instead
 *
 * RFC 5545's own identity for one instance: the `UID` plus the instance's
 * ORIGINAL start (its recurrence slot). An override names its slot in
 * `RECURRENCE-ID`; the series master's own `DTSTART` is the slot of its first
 * instance. So a sitting keeps its id when the town moves it to another
 * night, and that move reads as a change of the record, not a new record.
 *
 * The slot is written as a UTC instant, `YYYYMMDDTHHMMSSZ`, or as the calendar
 * date `YYYYMMDD` for an all-day series, after the `UID` and a `/`. Nothing in
 * this repository splits a meeting id on `/`, and a UTC stamp does not change
 * when a feed respells the same instant in another `TZID`.
 *
 * A non-recurring event's id is unchanged: `ical:<slug>:<UID>`, exactly as
 * before.
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
 * **WHEN AN OCCURRENCE RECORD REPLACES THE SERIES RECORD IT WAS HIDING IN.**
 *
 * Every series that lived under one `UID`-only id before 2026-09-23 has such a
 * record in its last promoted version. On the first read under occurrence
 * identity that id is no longer produced. Carrying it forward as an
 * unexplained disappearance would show one sitting twice, under the old id and
 * the new, until it aged out of the window.
 *
 * The old record is replaced only when the replacement holds the same fact:
 * an occurrence of the same series (`<old id>/<slot>`), for the same body,
 * that is either the same sitting (same start) or the same instance (its slot
 * is the old record's start, and the town has since moved it). Anything else
 * is not a replacement, and the old record takes the ordinary path.
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
 * **IDENTITY FOR A SITTING TWO ROUTES NUMBER DIFFERENTLY.** (2026-08-28.)
 *
 * ## Why the publisher's own id cannot be the key here
 *
 * Granicus publishes the same Legistar meeting through two routes that do not
 * share an id space. `webapi.legistar.com/v1/pima/events` calls the Board of
 * Supervisors' 25 August sitting **1825**; the portal's own calendar grid calls
 * the same sitting **1381574**, and the WebAPI item endpoint 404s on the
 * portal's number. Measured 2026-08-28 across the seven August sittings both
 * routes carry: **7 of 7 agree on the body, the date and the time, and 0 of 7
 * agree on the id.**
 *
 * So keying identity on the vendor's identifier would publish every one of
 * those meetings twice, and the fix is not to prefer one route — it is to key
 * on what the two routes actually agree about.
 *
 * ## The key
 *
 * `body | local date | local wall-clock time`. WHICH BODY sat, on WHAT DAY, at
 * WHAT TIME, in the body's own zone.
 *
 * - **The body, not the division.** Six bodies share `county:pima`; a division
 *   key would merge two different bodies meeting at nine o'clock.
 * - **Local date and local TIME, not a bare instant.** They are the same thing
 *   for a fixed zone, and they are what a clerk publishes and a reader reads.
 * - **The kind is NOT in the key.** Pima's 8 September sittings are a 1:00 PM
 *   study session and a 5:00 PM regular meeting: the TIME already separates
 *   them. Putting "Study Session" in the key would split one sitting into two
 *   the moment one route wrote the kind and the other left it blank — which is
 *   exactly what these two routes do.
 *
 * ## What it deliberately does not collapse
 *
 * Two bodies at one time stay two sittings. One body twice in a day stays two
 * sittings. **Two routes disagreeing about the TIME stay two sittings**, which
 * is a finding rather than a merge: a published disagreement about when a
 * public meeting starts is something a reader should see, not something we
 * should average.
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
 * **THE SAME KEY, FOR A ROUTE THAT NEVER PUBLISHED AN INSTANT.**
 * (2026-08-28, the union correction.)
 *
 * `sittingKey` takes `startsAt` because every adapter that produces a `Meeting`
 * has resolved one. The routes that enumerate a body's future do not: the
 * calendar grid prints `12/15/2026` and `5:00 PM`, the calendar RSS prints
 * `Board of Supervisors - 12/15/2026 - 5:00 PM`, and the Clerk of the Board's
 * own schedule table prints `12/15/26` and `Regular (at 5:00 p.m.)`. **None of
 * them states a zone**, and constructing an instant just to key on it would
 * make identity depend on a zone lookup that the publisher never performed.
 *
 * So the key is built from the local calendar date and the local wall clock
 * DIRECTLY — which is what `sittingKey` reduces its instant to anyway, and is
 * why the two functions cannot drift: this is the one that does the joining and
 * `sittingKey` calls it.
 *
 * `localDate` is `YYYY-MM-DD` and `localTime` is 24-hour `HH:MM`. A caller
 * holding `8/13/2026` and `1:00 PM` normalizes BEFORE it gets here; two
 * spellings of one minute reaching this function are two keys, and that is the
 * caller's defect, not something this function may paper over.
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
 * The body a sitting belongs to, as its own published words name it:
 * "GOVERNING BOARD AGENDA SPECIAL MEETING" and "Governing Board Meeting - via
 * Zoom" are both `governing-board`; "Employee Benefit Trust Committee" and
 * "Employee Benefits Trust Meeting" are both `employee-benefit-trust`.
 *
 * Written for the Diligent schedule union (lib/sources/diligent/schedule-union.ts,
 * which still exports it) and kept here beside the other sitting identities
 * since 2026-09-24, because the partition writer's re-issued-sitting test
 * (`reissuesSitting`, below) reads the same key: the two can never disagree
 * about which body a listing names.
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
 * **A SITTING ITS PUBLISHER RE-ISSUED UNDER A NEW ID.** (2026-09-24.)
 *
 * ## What was wrong
 *
 * A publisher can stop listing a sitting under one id and list it again under
 * another. Tucson Unified's Diligent portal listed its Audit Committee's
 * 16 September 14:30 sitting as meeting 495, then as meeting 501. A successful
 * read that no longer holds an in-window row carries it forward, because an
 * omission alone never deletes a fact; nothing named 501 as the successor, so
 * a reader saw one meeting twice, the stale carried listing beside the fresh
 * one, and every count stated for the body included both.
 *
 * ## What the same sitting is
 *
 * A fresh row of the same partition holds a prior row's sitting only when
 * every clause holds, each read off the two rows' own published fields:
 *
 * - the same registry body (`bodyId`), present on both;
 * - the same body in the listings' own words: `sittingBodyKey` of the
 *   `bodyName` agrees and names something, AND `sittingBodyKey` of the
 *   `title` agrees;
 * - the same local calendar date and minute in the same `timeZone`
 *   (`sittingKey`), with both rows dated to the minute. A date-only listing
 *   (`startPrecision: "DAY"`) carries midnight as an ordering artifact, never a
 *   claim, so it proves no time.
 *
 * There is no fuzzy match. Keys that differ at all, or starts a minute apart,
 * are two sittings, and the prior row takes the ordinary path. The title is
 * required as well as the body name because some feeds give every row one
 * body name (an iCalendar feed that serves a whole town names each committee
 * only in its titles), and there two committees meeting at the same minute are
 * two sittings. A source whose titles do not normalize to a shared key simply
 * never matches.
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
 * **WHICH ROUTE SUPPLIED THIS FIELD.**
 *
 * `Provenance` on a `Meeting` names the record's source — one URL, one
 * organisation, one collection time. That is right while a record comes from
 * one place, and these records do not: the grid supplies the location and the
 * meeting kind, the RSS supplies the instant InSite first published the
 * sitting, the per-meeting iCalendar export confirms the wall clock, and the
 * WebAPI supplies the agenda file once the clerk finalises it. A merged record
 * naming a single source would be citing one route for a field another route
 * is the authority on.
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
