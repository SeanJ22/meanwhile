/**
 * "In seat until", and age — item 6d, 2026-08-15.
 *
 * Two facts a reader asks about an officeholder before almost anything else,
 * and both are governed by the same rule: **rendered only where a source
 * states them, never derived.**
 *
 * The temptation in both cases is obvious and both are refused. A term end
 * could be computed from an office's cycle — four years from the last
 * election — and it would be right most of the time and wrong for exactly the
 * seats a reader is most likely to be confused about: an appointment to a
 * vacancy, a special election, a staggered board, a state with an odd
 * calendar. An age could be scraped from a news profile or an encyclopedia,
 * and it would be right most of the time and unciteable every time.
 *
 * So: the federal roster carries both (the congress-legislators bulk file's
 * `terms[].end` and `bio.birthday`, 537 of 537 members as of 2026-08-15).
 * State legislators carry a term end and no birthday. Curated local rosters
 * and the statewide executives carry neither, and their cards say nothing at
 * all rather than guessing.
 */

import { formatDateLong } from "../text/format-date.ts";

/**
 * The age at a given instant, from a birth date.
 *
 * **Computed at render, never stored.** An age is a fact about today, so a
 * stored one is wrong from the day after it is written — the same reason a
 * meeting stores its instant rather than "in three days". `now` is a
 * parameter so a test can pin it without touching the clock.
 */
export function ageFrom(birthDate: string | null, now: Date): number | null {
  if (!birthDate || !/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) return null;
  const [y, m, d] = birthDate.split("-").map(Number);
  if (!y || !m || !d) return null;

  let age = now.getFullYear() - y;
  const month = now.getMonth() + 1;
  const day = now.getDate();
  // Not yet had this year's birthday.
  if (month < m || (month === m && day < d)) age -= 1;

  // A parse that produces something impossible is a parse gone wrong, not a
  // person. Silently rendering "age 312" is worse than rendering nothing.
  if (age < 18 || age > 120) return null;
  return age;
}

/**
 * The "In seat until" value, in the reader's words.
 *
 * The full date where the source gives one; the YEAR alone where that is all
 * it gives. A source that publishes only a year must not have a January 1st
 * invented for it — that is a specific, checkable, wrong claim about when
 * somebody's term ends, manufactured out of a formatting convenience.
 */
export function inSeatUntil(termEnd: string | null): string | null {
  if (!termEnd) return null;
  /*
   * **BC-12 (2026-08-24) — the author's literal instance.** His words: *"in
   * seat until January 3rd, 2029," never "01-03-2029."* This built the
   * numeric form by hand off its own regex, so it was a SECOND date-format
   * implementation that `formatDateMDY` could be fixed without touching —
   * the duplicate shape RULING 103 exists for. Both call one formatter now.
   */
  const spelled = formatDateLong(termEnd);
  if (spelled) return spelled;
  // A year on its own is all some sources publish, and a year is already
  // "spelled out" — there is no month or day to expand and none is invented.
  const yearOnly = /^(\d{4})$/.exec(termEnd.trim());
  return yearOnly ? yearOnly[1] : null;
}
