import { createHash } from "node:crypto";
import { cachedZoneFormatter } from "../time/zoned.ts";

const localClockFormatter = cachedZoneFormatter("en-CA", {
  year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
});

export interface WeakEventIdentityFields {
  /** The wiring row's slug — a body, not a town. */
  slug: string;
  /** The resolved start instant, ISO 8601. */
  startIso: string;
  summary: string | null;
  location: string | null;
  description: string | null;
}

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

export function localWallClock(
  startsAt: string,
  timeZone: string,
): { date: string; time: string } | null {
  const at = Date.parse(startsAt);
  if (!Number.isFinite(at)) return null;
  const parts = localClockFormatter(timeZone).formatToParts(new Date(at));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const date = `${get("year")}-${get("month")}-${get("day")}`;
  // Some ICU builds render midnight as "24"; normalize so two spellings of one
  // minute cannot key differently.
  const hour = get("hour") === "24" ? "00" : get("hour");
  if (!get("year") || !hour) return null;
  return { date, time: `${hour}:${get("minute")}` };
}

export function sittingKey(fields: SittingKeyFields): string | null {
  const local = localWallClock(fields.startsAt, fields.timeZone);
  if (!local) return null;
  return sittingKeyFromLocal({ ...fields, ...local });
}

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

export type SittingChange =
  | { kind: "NEW"; meeting: MeetingLike }
  | { kind: "UNCHANGED"; meeting: MeetingLike }
  | { kind: "RESCHEDULED"; meeting: MeetingLike; from: string; to: string }
  | { kind: "CANCELED"; meeting: MeetingLike }
  | { kind: "UPDATED"; meeting: MeetingLike; changed: string[] }

  | { kind: "ABSENT_FROM_LATEST"; meeting: MeetingLike };

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
