import { formatDateLong } from "../text/format-date.ts";

/**
 * A sitting's date and time in the body's own zone. The calendar date is
 * resolved through `Intl` in that zone, never by slicing the ISO string (a
 * stored UTC instant for an evening sitting lands on the next UTC day). The
 * same rule as `lib/map/format.ts`, over the two fields the evidence carries.
 */

export interface SittingTime {
  startsAt: string;
  timeZone?: string | null;
  /**
   * `DAY` when the publisher posted a date and no time: `startsAt` is then
   * local midnight as an ordering artifact and no time is printed from it.
   * Absent means `MINUTE`.
   */
  startPrecision?: "MINUTE" | "DAY";
}

/** True when the publisher gave a start time (the map's `startTimeIsKnown`, for the Ask shape). */
export function startTimePosted(sitting: SittingTime): boolean {
  return sitting.startPrecision !== "DAY";
}

/** The zone a sitting is read in. UTC is the stated fallback, never passed off as local. */
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
 * One reader-safe fragment ("Tuesday, September 8th, 2026 at 7:00 PM MST"),
 * using the product's `formatDateLong`. No ISO string or IANA zone name.
 */
export function readableSitting(sitting: SittingTime): string {
  const date = localDate(sitting);
  const spelled = formatDateLong(date) ?? date;
  /* A date-only posting prints the date and says the time was not posted. */
  const base = startTimePosted(sitting)
    ? `${localWeekday(sitting)}, ${spelled} at ${localTime(sitting)}`
    : `${localWeekday(sitting)}, ${spelled} (start time not posted)`;
  /* An unknown zone is named as unknown: our gap. */
  return zoneOf(sitting).known
    ? base
    : `${base} (we have not recorded this body's time zone, so this is shown in UTC)`;
}
