/**
 * The one date formatter: dates spell out everywhere — `November 3rd, 2026`,
 * full month name, ordinal day, four-digit year — never `11-03-2026`.
 *
 * A plain `YYYY-MM-DD` is a CALENDAR DATE, not an instant: `new Date()` would
 * parse it as midnight UTC and a western zone would show the day before. So
 * the calendar form is read straight out of the string. Callers holding an
 * instant (a meeting's `startsAt`) resolve it to a calendar date in the
 * meeting's own zone first, as `lib/map/format.ts` does.
 */

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

/**
 * 1st, 2nd, 3rd, 4th … and the three exceptions that catch everybody: 11th,
 * 12th and 13th take "th" despite ending in 1, 2 and 3.
 */
export function ordinalDay(day: number): string {
  const teens = day % 100;
  if (teens >= 11 && teens <= 13) return `${day}th`;
  switch (day % 10) {
    case 1:
      return `${day}st`;
    case 2:
      return `${day}nd`;
    case 3:
      return `${day}rd`;
    default:
      return `${day}th`;
  }
}

/**
 * One ISO calendar date, spelled out. `2026-11-03` → `November 3rd, 2026`.
 *
 * Returns null for anything that is not a calendar date, so a caller can render
 * its own named gap rather than a half-parsed string. Never guesses.
 */
export function formatDateLong(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso.trim());
  if (!match) return null;
  const [, year, month, day] = match;
  const monthName = MONTHS[Number(month) - 1];
  if (!monthName) return null;
  return `${monthName} ${ordinalDay(Number(day))}, ${year}`;
}

/**
 * Every ISO date token inside a string, spelled out in place, so annotated
 * strings and ranges (`"2026-10-24 – 2026-11-01"`, `"2026-08-14 (revised)"`)
 * convert too.
 */
export function spellOutDates(text: string): string {
  return text.replace(
    /(\d{4})-(\d{2})-(\d{2})/g,
    (whole, y: string, m: string, d: string) =>
      formatDateLong(`${y}-${m}-${d}`) ?? whole,
  );
}
