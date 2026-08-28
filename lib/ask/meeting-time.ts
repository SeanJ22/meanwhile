import { formatDateLong } from "../text/format-date.ts";

/**
 * **A SITTING'S DATE AND TIME, IN THE BODY'S OWN ZONE.**
 * (PR #212 follow-up, 2026-08-28.)
 *
 * ## The wrong fact this closes
 *
 * The grounded route put the raw stored instant into the evidence record:
 *
 * ```
 *   Vail Unified District: Governing Board Meeting,
 *   starting 2026-09-09T02:00:00.000Z in time zone America/Phoenix.
 * ```
 *
 * Two defects in one line. The identifier reached a reader surface, which the
 * plain-language rule forbids on its own. And the DATE IS WRONG. Vail's board
 * meets on the second and fourth Tuesday at 7:00 p.m. — the district says so on
 * its own portal page — and 02:00Z is 7:00 p.m. the **previous** calendar day
 * in Arizona. Every one of the eleven Vail sittings in the corpus is stored
 * with a UTC date one day later than the day the meeting is actually held.
 *
 * So a reader asking what is on the agenda was told the board meets on
 * Wednesday September 9th. It meets on **Tuesday September 8th**. The record
 * was correctly retrieved, correctly attributed, about the right government —
 * and printed the wrong day, which is precisely the class of failure this
 * product cannot survive. `lib/map/format.ts` has resolved dates through the
 * meeting's own zone since BC-12 for exactly this reason; the Ask pipeline was
 * built without that lesson and re-learned it.
 *
 * ## Why this is a separate module rather than a call into `lib/map/format`
 *
 * Those functions take a whole `Meeting` — the map's record shape, with
 * `startPrecision`, `jurisdiction` and a dozen fields the evidence pack does
 * not carry. This takes the two fields the question actually needs. The rule
 * is identical and is the one already proven in the map's formatter: resolve
 * the calendar date through `Intl` in the body's zone, never by slicing the
 * ISO string, because a slice reads whatever offset the string happens to
 * carry.
 */

export interface SittingTime {
  startsAt: string;
  timeZone?: string | null;
}

/**
 * The zone a sitting is read in.
 *
 * **UTC is the fallback and it is stated rather than hidden.** A body whose
 * publisher never gave us a zone is a gap in our collection, and printing its
 * instant in some default zone as though it were local would manufacture the
 * exact claim this module exists to prevent.
 */
export function zoneOf(sitting: SittingTime): { zone: string; known: boolean } {
  return sitting.timeZone
    ? { zone: sitting.timeZone, known: true }
    : { zone: "UTC", known: false };
}

/** `YYYY-MM-DD` in the body's own zone. */
export function localDate(sitting: SittingTime): string {
  const { zone } = zoneOf(sitting);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(sitting.startsAt));
}

/** The weekday name in the body's own zone — half of deciding to attend. */
export function localWeekday(sitting: SittingTime): string {
  const { zone } = zoneOf(sitting);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    weekday: "long",
  }).format(new Date(sitting.startsAt));
}

/** The clock, with the zone abbreviation the reader's own region uses. */
export function localTime(sitting: SittingTime): string {
  const { zone } = zoneOf(sitting);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(sitting.startsAt));
}

/**
 * One reader-safe sentence fragment: *"Tuesday, September 8th, 2026 at 7:00 PM
 * MST"*.
 *
 * The spelled-out date is the product-wide convention (`formatDateLong`), so a
 * sitting reads the same in an Ask answer as it does on a meeting card. No ISO
 * string, no identifier, no zone name in IANA form — none of those are things a
 * person says, and every one of them is a plain-language violation on a reader
 * surface.
 */
export function readableSitting(sitting: SittingTime): string {
  const date = localDate(sitting);
  const spelled = formatDateLong(date) ?? date;
  const base = `${localWeekday(sitting)}, ${spelled} at ${localTime(sitting)}`;
  /* An unknown zone is NAMED as unknown rather than silently rendered as UTC
     wearing a local face. Whose gap it is: ours. */
  return zoneOf(sitting).known
    ? base
    : `${base} (we have not recorded this body's time zone, so this is shown in UTC)`;
}
