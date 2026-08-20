/**
 * **A person's name with one token in it is INCOMPLETE, not a value.**
 * (F01-continued item 10a, 2026-08-19.)
 *
 * Vail Unified's superintendent was carried as "Carruth". Nobody caught it,
 * because nothing in this product had ever been asked the question — a name
 * was a string, and a string is a string. The full name was sitting in a plain
 * fetch of the district's own page the whole time (`lib/registry/body-rosters.ts`
 * records why the hunt missed it), so this is the DETECTOR half: the thing
 * that makes a hand-verification of every superintendent unnecessary.
 *
 * ## Why a bare surname is worse than a gap
 *
 * "Carruth" on a card is not a partial answer, it is a confident one. A reader
 * cannot tell it from a mononym, cannot search for the person, and cannot see
 * that the product is unsure. The named-gap rule in `CLAUDE.md` is exactly
 * this case one layer up: a null renders as its named gap and never as an
 * assertion — and a surname alone is an assertion about a real person's name.
 *
 * ## What counts as a token
 *
 * Suffixes and honorifics are not given names, so they are removed before
 * counting. "Carruth Jr." is still one token; "Dr. Trujillo" is still one
 * token; "Gabriel Trujillo" is two. An initial IS a token — "J. Carruth" is
 * complete enough to identify and search, and a great many officials publish
 * themselves that way.
 *
 * ## Mononyms
 *
 * A single-token name can be a real whole name. Nothing in this product's data
 * carries a marker saying so, and inventing one from the shape of the string
 * would be guessing about a person. So the detector FLAGS every single-token
 * name and the resolution is per row, recorded — the sweep in
 * `scripts/name-census.mts` prints them all, and today there are none that a
 * source publishes as a whole name.
 */

/** Trailing generational and credential suffixes. Never a given name. */
const SUFFIX =
  /^(jr|sr|ii|iii|iv|v|vi|phd|ph\.d|md|m\.d|edd|ed\.d|esq|jd|j\.d|dds|d\.d\.s|rn|cpa|usa|usaf|usn|ret)\.?$/i;

/** Leading honorifics and offices. A title is not half a name. */
const HONORIFIC =
  /^(dr|mr|mrs|ms|miss|mx|rev|fr|sr|hon|honorable|sen|senator|rep|representative|gov|governor|mayor|judge|justice|sheriff|supt|superintendent|chief|capt|col|gen|lt|sgt|prof|professor|councilman|councilwoman|councilmember|commissioner|chair|chairman|chairwoman|president|clerk|treasurer|assessor|recorder|selectman|selectwoman)\.?$/i;

/**
 * The name's tokens, with honorifics and suffixes removed.
 *
 * Exported because a caller that wants to SAY what is missing needs the same
 * decomposition the detector used, and two copies of this would drift.
 */
export function nameTokens(name: string | null | undefined): string[] {
  if (name === null || name === undefined) return [];
  const tokens = name
    .normalize("NFC")
    .replace(/[‘’']/g, "'")
    .split(/[\s ]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
    // Punctuation-only fragments are not tokens.
    .filter((t) => /[\p{L}\p{N}]/u.test(t));

  /*
   * **Position matters, and the first version of this got it wrong in a way
   * worth keeping.** It filtered both lists across the whole name, so "J.D."
   * matched the Juris Doctor pattern and came off — flagging *J.D. Mesnard*
   * and *J.D. Bernardy*, two sitting state legislators who publish themselves
   * exactly that way, as half-named. A detector that reports real people as
   * defects is a detector somebody switches off. So honorifics come off the
   * FRONT, suffixes come off the BACK, and neither list is applied anywhere
   * else in the string.
   */
  let start = 0;
  while (start < tokens.length && HONORIFIC.test(tokens[start].replace(/[.,]+$/, ""))) {
    start += 1;
  }
  let end = tokens.length;
  while (end > start && SUFFIX.test(tokens[end - 1].replace(/[.,]+$/, ""))) {
    end -= 1;
  }
  return tokens.slice(start, end);
}

/**
 * True when this string cannot stand as a person's name.
 *
 * Empty and whitespace-only count: a card with nothing in the name slot is the
 * same defect wearing less.
 */
export function isIncompletePersonName(name: string | null | undefined): boolean {
  if (name === null || name === undefined) return true;
  return nameTokens(name).length < 2;
}

/**
 * The honest line for a person whose name we hold incompletely.
 *
 * It is a fact about OUR record, in the gap's own register, and it never
 * prints the fragment as though it were the name. The fragment stays available
 * to whoever hunts the rest — it is in the data — but it does not render as an
 * answer, because a reader cannot tell a half-sourced name from a whole one.
 */
export const INCOMPLETE_NAME_LINE = "We haven’t recorded this person’s full name yet.";

/**
 * What to render in a name slot: the name, or the named gap.
 *
 * One function, so a surface cannot decide to print the fragment "just this
 * once" — which is how it reached a card in the first place.
 */
export function displayPersonName(name: string | null | undefined): string {
  return isIncompletePersonName(name) ? INCOMPLETE_NAME_LINE : (name as string).trim();
}
