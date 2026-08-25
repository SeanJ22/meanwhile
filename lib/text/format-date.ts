/**
 * **BC-12 / BAL-4 (2026-08-24, the author's walkthrough) — DATES SPELL OUT,
 * PRODUCT-WIDE, AND THERE IS ONE FORMATTER.**
 *
 * His instruction, verbatim in the brief: *dates spell out everywhere — "in
 * seat until January 3rd, 2029," never "01-03-2029."*
 *
 * ## Why this file exists rather than a third `formatDate`
 *
 * RULING 103 says a class sweep covers duplicated IMPLEMENTATIONS, not only
 * named instances, and this defect had two of them wearing different names:
 *
 * - `formatDateMDY` in `lib/map/format.ts` — the ballot page's election dates,
 *   every "read {date}" provenance line, and the whole funding surface.
 * - `inSeatUntil` in `lib/officials/tenure.ts` — which built `${m}/${d}/${y}`
 *   by hand off a regex, and is the LITERAL instance the author quoted. It
 *   does not call the other one and never did, so fixing the other one would
 *   have left "01/03/2029" on screen exactly where he saw it.
 *
 * Neither was findable from the other by grepping a shared name. That is the
 * duplicate-implementation shape, so the answer is one function both call.
 *
 * ## The convention
 *
 * `November 3rd, 2026` — full month name, ordinal day, four-digit year. The
 * ordinal is the author's ("January 3rd", "November 3rd"), not a bare numeral.
 *
 * ## Time zones, and why this reads the string rather than a `Date`
 *
 * A plain `YYYY-MM-DD` is a CALENDAR DATE, not an instant. `new Date("2026-11-03")`
 * parses as midnight UTC, and formatting that in America/Phoenix returns
 * November 2nd — an election date off by one day, which in this product is a
 * false claim about a government. So the calendar form is read straight out of
 * the string and never round-tripped through a `Date` at all.
 *
 * Callers holding a true INSTANT (a meeting's `startsAt`) must resolve it to a
 * calendar date in the meeting's own zone first — `lib/map/format.ts` does
 * exactly that through `Intl` before calling in here.
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
 * Every ISO date token inside a string, spelled out in place.
 *
 * This is the shape `formatDateMDY` carried and it is kept, because several
 * callers hand in annotated strings and ranges — `"2026-10-24 – 2026-11-01"`,
 * `"2026-08-14 (revised)"` — and a formatter that only accepted a bare date
 * would silently return them unconverted.
 */
export function spellOutDates(text: string): string {
  return text.replace(
    /(\d{4})-(\d{2})-(\d{2})/g,
    (whole, y: string, m: string, d: string) =>
      formatDateLong(`${y}-${m}-${d}`) ?? whole,
  );
}
