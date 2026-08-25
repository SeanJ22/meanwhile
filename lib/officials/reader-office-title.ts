/**
 * **ASK-11 (2026-08-25) — an office title a reader sees is spelled the way a
 * reader spells it, and it is spelled the SAME way everywhere.**
 *
 * The author read `Assemblymember` off the New Jersey Ask answer. The class is
 * not one word: it is office titles that arrive run together from the filing
 * that published them, next to the same office written out on another surface.
 * Measured across every committed `officeTitle` in `lib/` and `data/` —
 * **90 distinct values** — the run-together set is exactly two:
 *
 *   80x  `Assemblymember`
 *    5x  `Councilmember`
 *
 * And the reason this is a defect rather than a preference is the third
 * number: **`Council Member Ward 1` also exists, twice.** One product,
 * one office, two spellings, decided by which clerk typed the roster.
 *
 * ## What this does NOT do
 *
 * It does not touch the stored record. `officeTitle` is what the filing said
 * and it stays exactly that — the organizations-render-as-filed discipline
 * applies to offices too, and a title we rewrote in the data would be a title
 * nobody could check against the source. This is a DISPLAY map, applied at the
 * render sites, and the value it is given is returned unchanged whenever no
 * rule matches.
 *
 * ## Why a map and not a general de-camelCaser
 *
 * A rule that split any run-together word would have to decide what to do with
 * `At-Large`, `Chairman`, and every proper noun in a body's name, and it would
 * be wrong about one of them the first week. Two named entries are checkable;
 * a heuristic is a thing that surprises you later. New entries are cheap.
 */

/**
 * Reader spellings for titles that arrive run together. Keyed on the exact
 * filed string, lower-cased, so a roster that shouts it still matches.
 */
const READER_SPELLING = new Map<string, string>([
  ["assemblymember", "Assembly member"],
  ["councilmember", "Council member"],
]);

/**
 * The title as a reader should see it. Anything unrecognised is returned
 * VERBATIM — this map never guesses at a title it has not been taught.
 */
export function readerOfficeTitle(title: string | null | undefined): string {
  if (!title) return "";
  const trimmed = title.trim();
  const mapped = READER_SPELLING.get(trimmed.toLowerCase());
  if (mapped) return mapped;

  /*
   * A filed title often carries a qualifier after the office — `Councilmember
   * Ward 3`, `Assemblymember, District 25`. The office is still the office, so
   * the leading word is mapped and the qualifier is carried through untouched.
   */
  const [, head, rest] = trimmed.match(/^([A-Za-z]+)([\s,].*)$/) ?? [];
  if (head) {
    const mappedHead = READER_SPELLING.get(head.toLowerCase());
    if (mappedHead) return `${mappedHead}${rest}`;
  }
  return trimmed;
}

/** Every title this map knows, for a test that wants the denominator. */
export function readerSpellingCount(): number {
  return READER_SPELLING.size;
}
