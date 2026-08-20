/**
 * **Every dated voting event, and whether a reader can put it in a calendar.**
 * (F01-continued session 2, item 16, 2026-08-19.)
 *
 * ## The defect
 *
 * The author, on device, on 07866: in-person early voting renders as
 * `10/24/2026 – 11/01/2026` **with no add-to-calendar affordance**, while
 * every single-date step beside it has one. The code said so in as many
 * words — *"Range and past dates render without a link"* — and a range is
 * precisely the event a reader most needs in a calendar, because it is the
 * one with a window to miss rather than a deadline to remember.
 *
 * ## Two bugs, and the second was invisible
 *
 * 1. **A range got nothing.** A regex demanded `^\d{4}-\d{2}-\d{2}$` and a
 *    window has two dates in it.
 * 2. **"Is it still ahead?" was decided in UTC.** The comparison read
 *    `new Date().toISOString().slice(0, 10)`, which is a day AHEAD of
 *    America/Phoenix for the seven hours after 5pm local — so a step dated
 *    today lost its affordance seven hours early, every evening. It is the
 *    same UTC-slice defect item 0B fixed in `scripts/photo-census.mts`, and
 *    session 1's own tracker note (`F09`) named this file as its remaining
 *    instance and left it for this item. It is worse here than there,
 *    because this one is reader-facing.
 *
 * ## Why the parse is a module rather than a regex in JSX
 *
 * Because the same question is asked in three places on the ballot page and
 * was answered differently in each. A window is a VALUE — a start and an
 * inclusive end — and once it is a value, "does it have an affordance" stops
 * being a string test that a new date format can silently fail.
 */

/** The Phoenix day, `YYYY-MM-DD`. */
export function phoenixToday(now: Date = new Date()): string {
  // `en-CA` formats as ISO; the locale is a formatting trick and not a claim
  // about where anyone is. Same computation `pnpm stamp` performs — the rule
  // in CLAUDE.md is that a date entering anything comes from the Phoenix
  // wall clock, and a UTC read after 5pm local is a day ahead.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Phoenix",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export interface DatedWindow {
  /** `YYYY-MM-DD`. */
  start: string;
  /**
   * `YYYY-MM-DD`, INCLUSIVE, and null for a single-day event.
   *
   * Inclusive because that is what the authority published: New Jersey's
   * early voting runs THROUGH November 1st. The exclusive end an `.ics`
   * `DTEND` needs is computed at the calendar layer, once, where the
   * off-by-one belongs.
   */
  end: string | null;
}

const ISO = /(\d{4}-\d{2}-\d{2})/g;

/**
 * Read a step's `date` field as a window.
 *
 * The field is deliberately loose — `ElectionDates` documents it as "ISO
 * date, or a short official phrase where no single date exists" — so a value
 * with no ISO date in it at all is a real case (an authority saying "45 days
 * before the election"). That returns null, and null means NO AFFORDANCE,
 * which is correct: a phrase is not a date and inventing one would be the
 * fabrication rule.
 */
export function windowOf(date: string): DatedWindow | null {
  const found = date.match(ISO);
  if (!found || found.length === 0) return null;
  const start = found[0];
  const last = found[found.length - 1];
  return { start, end: last !== start ? last : null };
}

/**
 * Does this event still lie ahead of the reader?
 *
 * A WINDOW counts as ahead until its LAST day is past — a reader on the 30th
 * of October can still act on a window that closes on the 1st of November,
 * and judging the window by its first day would take the affordance away
 * exactly when it is most useful.
 */
export function isUpcoming(window: DatedWindow, today: string = phoenixToday()): boolean {
  return (window.end ?? window.start) >= today;
}

/**
 * Every dated voting event a surface should offer a calendar for.
 *
 * Returns the window and the reason when there is none, so a caller can
 * report `N of M carry the affordance` with the misses named rather than
 * silently dropping them. An operation that can return nothing is asked what
 * it returned.
 */
export function calendarableSteps<T extends { label: string; date: string }>(
  steps: readonly T[],
  today: string = phoenixToday(),
): { step: T; window: DatedWindow | null; upcoming: boolean }[] {
  return steps.map((step) => {
    const window = windowOf(step.date);
    return {
      step,
      window,
      upcoming: window !== null && isUpcoming(window, today),
    };
  });
}
