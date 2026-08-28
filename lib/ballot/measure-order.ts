import type { Contest } from "./types.ts";

/**
 * **THE ORDER BALLOT MEASURES ARE PRESENTED IN.**
 * (BAL-29, the 2026-08-28 reader-feedback sweep.)
 *
 * ## The defect
 *
 * A reader at 85641 met Proposition 425 above Proposition 423. There was no
 * ordering rule at all: the page rendered `contests.filter(type === "MEASURE")`
 * in whatever order the curated file happened to list them. The statewide
 * propositions looked ordered only because they were entered that way; the
 * four local ones — 425, 423, 428, 429 — were not.
 *
 * ## Why sorting the title string would be the wrong repair
 *
 * `"Proposition 100" < "Proposition 20"` lexicographically, because `'1'`
 * sorts before `'2'`. A string sort would trade one wrong order for a worse
 * one that only shows up once a jurisdiction numbers past 99 — which Arizona
 * already does, and which nobody would notice until it shipped.
 *
 * So the NUMBER is parsed and compared as a number.
 *
 * ## The precedence, and why the authority always wins
 *
 * `CLAUDE.md` forbids ordering by anything but a neutral criterion, and the
 * election authority's own ballot order is the most neutral criterion there
 * is: it is the order the reader will actually meet these questions in.
 *
 * 1. **`ballotOrder`, when the authority published one.** No inference.
 * 2. **The proposition number, ascending.** Neutral, stable, and the order
 *    every Arizona sample ballot uses.
 * 3. **The title, locale-compared.** Only for a measure carrying no number at
 *    all, so an unnumbered question never floats to an arbitrary position.
 *
 * A measure with an authority order is never reordered by its number, and the
 * two groups do not interleave: everything the authority placed comes first,
 * in its order, because a partial official order is still official for the
 * part it covers. Guessing where an unordered measure belongs inside it would
 * be this module inventing a ballot.
 *
 * This is presentation only. It changes nothing about which measures a reader
 * is shown — `CLAUDE.md` is explicit that collection state never governs
 * display, and neither does ordering.
 */

/** The proposition number a measure carries, or null when it names none. */
export function measureNumber(contest: {
  title?: string | null;
  id?: string | null;
}): number | null {
  const fromTitle = (contest.title ?? "").match(
    // The trailing `\.?` matters: authorities abbreviate it "Prop. No. 7".
    /\b(?:proposition|prop|measure|question|issue)\.?\s*(?:no\.?\s*)?(\d{1,5})\b/i,
  );
  if (fromTitle) return Number(fromTitle[1]);

  // The id is a fallback, not a parallel truth: `ballot-az-pima:prop-423`.
  const fromId = (contest.id ?? "").match(/(?:^|[:\-_])(?:prop|measure|q)-?(\d{1,5})\b/i);
  return fromId ? Number(fromId[1]) : null;
}

/** A measure the election authority placed itself. */
interface Ordered {
  ballotOrder?: number | null;
}

/**
 * Measures in the order a reader should meet them.
 *
 * Pure and total: it never drops a contest, and the returned array always has
 * the same members as the input. A sort that could lose a row would be a
 * completeness bug wearing an ordering bug's clothes.
 */
export function orderMeasures<T extends Contest & Ordered>(
  measures: readonly T[],
): T[] {
  const placed = measures.filter(
    (m) => typeof m.ballotOrder === "number" && Number.isFinite(m.ballotOrder),
  );
  const unplaced = measures.filter((m) => !placed.includes(m));

  placed.sort((a, b) => (a.ballotOrder as number) - (b.ballotOrder as number));

  unplaced.sort((a, b) => {
    const an = measureNumber(a);
    const bn = measureNumber(b);
    if (an !== null && bn !== null && an !== bn) return an - bn;
    // A numbered measure precedes an unnumbered one, so the numbered run stays
    // contiguous and readable.
    if (an !== null && bn === null) return -1;
    if (an === null && bn !== null) return 1;
    return (a.title ?? "").localeCompare(b.title ?? "");
  });

  return [...placed, ...unplaced];
}
