/** "In seat until" and age: rendered only where a source states them, never derived. */

import { formatDateLong } from "../text/format-date.ts";

/** The age at an instant, from a birth date; computed at render, never stored. */
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

/** "In seat until" in the reader's words: the full date where given, the year alone where that is all the source gives. */
export function inSeatUntil(termEnd: string | null): string | null {
  if (!termEnd) return null;
  const spelled = formatDateLong(termEnd);
  if (spelled) return spelled;
  // A year on its own is all some sources publish, and a year is already
  // "spelled out" — there is no month or day to expand and none is invented.
  const yearOnly = /^(\d{4})$/.exec(termEnd.trim());
  return yearOnly ? yearOnly[1] : null;
}
