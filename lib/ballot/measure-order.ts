import type { Contest } from "./types.ts";

export function measureNumber(contest: {
  title?: string | null;
  id?: string | null;
}): number | null {
  const fromTitle = (contest.title ?? "").match(
    // The trailing `\.?` matters: authorities abbreviate it "Prop. No. 7".
    /\b(?:proposition|prop|measure|question|issue)\.?\s*(?:no\.?\s*)?(\d{1,5})\b/i,
  );
  if (fromTitle) return Number(fromTitle[1]);

  // The id is a fallback, not a parallel truth.
  const fromId = (contest.id ?? "").match(/(?:^|[:\-_])(?:prop|measure|q)-?(\d{1,5})\b/i);
  return fromId ? Number(fromId[1]) : null;
}

interface Ordered {
  ballotOrder?: number | null;
}

/**
 * The authority's `ballotOrder` first, then the proposition number compared as a number, then the title.
 * Placed measures come first, in the authority's order, and never interleave with unplaced ones.
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
