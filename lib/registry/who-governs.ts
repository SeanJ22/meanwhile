import type { BodyStanding } from "../state/resolved-location.ts";

import type { CoveredBody } from "./coverage.ts";
import { WIRED_STATUSES } from "./coverage-client.ts";

/**
 * One denominator for the Who Governs Here card. Every number the card states is derived from one
 * array, after the address scope is applied: `governingCount` is `rows.length`, the same expression
 * twice, so the prose and the rows cannot disagree. Governing bodies and other boards are both stated in
 * plain language, so advisory committees never read as governments.
 *
 * Nothing is dropped for the reader's address: a body that governs elsewhere in the ZIP is annotated
 * (`standing`), and `elsewhere` lets the card say so.
 */
export interface WhoGoverns<T extends CoveredBody = CoveredBody> {
  /** The rows the card renders, in the order coverage returned them. */
  rows: T[];
  /**
   * The number the lead prose states. Identical to `rows.length` by
   * construction; named separately only because the prose reads better with a
   * name, and kept as the same expression so it cannot drift.
   */
  governingCount: number;
  /** How many of `rows` have a calendar actually wired. */
  governingWithSource: number;
  /**
   * The other bodies themselves, from the same array `others` is the length of, so the panel can show
   * every body it counts.
   */
  otherRows: T[];
  /** Boards, committees and commissions — real bodies, not governments. */
  others: number;
  /** How many of `others` have a calendar actually wired. */
  othersWithSource: number;
  /**
   * How many of `rows` the reader's own address excludes (`ELSEWHERE_IN_ZIP`). Zero when no address has
   * been resolved, meaning "we have not been told". A count for the card to say, never a filter.
   */
  elsewhere: number;
}

/**
 * The order of the governing list: county, then city or town, then school district, then every other
 * district. A neutral structural criterion (what kind of government each is), stated on screen in the
 * "Why these N?" disclosure. Within a kind the incoming order is preserved; there is no neutral way to
 * rank two special districts.
 */
const GOVERNMENT_KIND_ORDER: readonly string[] = [
  "county",
  "place",
  "school_district",
];

export function orderByGovernmentKind<T extends { divisionType: string | null }>(
  rows: readonly T[],
): T[] {
  const rank = (row: T): number => {
    const at = GOVERNMENT_KIND_ORDER.indexOf(row.divisionType ?? "");
    /* A kind the vocabulary does not name sorts after the three, never before
       them and never dropped. A division type a source introduces next month
       lands here by existing rather than by anyone remembering to add it. */
    return at === -1 ? GOVERNMENT_KIND_ORDER.length : at;
  };
  /* A STABLE sort, and the stability is load-bearing: within one kind the
     incoming order is preserved, so nothing here invents a preference between
     two special districts. */
  return [...rows].sort((a, b) => rank(a) - rank(b));
}

export function deriveWhoGoverns<T extends CoveredBody & { standing?: BodyStanding }>(
  bodies: readonly T[],
): WhoGoverns<T> {
  const rows = orderByGovernmentKind(
    bodies.filter((b) => b.bodyClass === "GOVERNING"),
  );
  const wired = (list: readonly CoveredBody[]) =>
    list.filter((b) => WIRED_STATUSES.has(b.coverageStatus)).length;

  const otherRows = bodies.filter((b) => b.bodyClass !== "GOVERNING");

  return {
    rows,
    // Deliberately `rows.length`, not a second count of the same predicate.
    // Two expressions that must agree are two expressions that can disagree.
    governingCount: rows.length,
    governingWithSource: wired(rows),
    otherRows,
    // The same array's length, for the same reason `governingCount` is `rows.length`.
    others: otherRows.length,
    othersWithSource: wired(bodies) - wired(rows),
    // Counted off `rows`, the same array the card renders. Only an explicit `ELSEWHERE_IN_ZIP`, which only
    // the reader's own address can produce, counts.
    elsewhere: rows.filter((b) => b.standing === "ELSEWHERE_IN_ZIP").length,
  };
}
