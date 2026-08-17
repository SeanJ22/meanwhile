import { WIRED_STATUSES, type CoveredBody } from "./coverage.ts";

/**
 * ONE DENOMINATOR for the Who Governs Here card (item 1a, 2026-08-17).
 *
 * ## What shipped
 *
 * Production at 85701 stated three different numbers for one list:
 *
 * - the lead prose: **"4 bodies govern the area around 85701"**
 * - the disclosure link: **"Why these 5?"**
 * - the rendered rows: **5** (Pima, Tucson, Public Housing Authority Board of
 *   Commissioners, Tucson Unified District, Board of Adjustment)
 *
 * ## The cause, and the half of the suspect that was wrong
 *
 * Two definitions on one surface. The prose read the server's
 * `counts.governing` — bodies whose `bodyClass` is `GOVERNING`, four of them
 * at 85701. The rows were the first five of the **whole** 60-body array,
 * governing and not.
 *
 * The brief named the Public Housing Authority board as the row that moved
 * between the two definitions. **It is not.** The PHA board is classed
 * `GOVERNING` and sits inside the four. The row that moved is the **Board of
 * Adjustment**, a `COMMISSION`, fifth in a list cut at five from a sixty-row
 * array — it was in the list because the list was never the governing set,
 * not because anything reclassified.
 *
 * ## The second instance, which a narrower fix would have left live
 *
 * The reader's device-local narrowing (M26) shrinks the RENDERED list on the
 * client. `counts.governing` is computed on the server and cannot see it. So
 * a fix that merely re-pointed the prose at the server count would have held
 * until a reader narrowed to their own school district, and then re-opened
 * the same gap by hand — with no deploy, no data change, and nothing to
 * notice it.
 *
 * ## The rule this file enforces
 *
 * Every number the card states is derived from ONE array, after narrowing.
 * `rows.length === governingCount` is not a property that happens to hold at
 * today's four zips; it is the same expression twice, and `tests/
 * who-governs.test.ts` proves it against synthetic inputs far larger than
 * anything the registry holds.
 *
 * Both definitions are real and both are needed — fifty Tucson advisory
 * committees must never read as fifty governments (D29) — so both are said on
 * screen in plain language rather than one number standing for two ideas.
 */
export interface WhoGoverns {
  /** The rows the card renders, in the order coverage returned them. */
  rows: CoveredBody[];
  /**
   * The number the lead prose states. Identical to `rows.length` by
   * construction; named separately only because the prose reads better with a
   * name, and kept as the same expression so it cannot drift.
   */
  governingCount: number;
  /** How many of `rows` have a calendar actually wired. */
  governingWithSource: number;
  /** Boards, committees and commissions — real bodies, not governments. */
  others: number;
  /** How many of `others` have a calendar actually wired. */
  othersWithSource: number;
}

/**
 * @param bodies every body coverage returned for this point
 * @param selectedOcdIds the reader's device-local narrowing choices (M26);
 *        empty when they have not narrowed, which is the default and must
 *        stay the effortless one
 */
export function deriveWhoGoverns(
  bodies: readonly CoveredBody[],
  selectedOcdIds: ReadonlySet<string>,
): WhoGoverns {
  /*
   * The narrowing, unchanged in meaning: where the reader picked a
   * municipality or school district, bodies of that TYPE narrow to the
   * choice; every other type stays fully listed.
   */
  const narrowedTypes = new Set(
    bodies
      .filter((b) => b.ocdId !== null && selectedOcdIds.has(b.ocdId))
      .map((b) => b.divisionType),
  );
  const narrowed = bodies.filter(
    (b) =>
      !narrowedTypes.has(b.divisionType) ||
      (b.ocdId !== null && selectedOcdIds.has(b.ocdId)),
  );

  const rows = narrowed.filter((b) => b.bodyClass === "GOVERNING");
  const wired = (list: readonly CoveredBody[]) =>
    list.filter((b) => WIRED_STATUSES.has(b.coverageStatus)).length;

  return {
    rows,
    // Deliberately `rows.length`, not a second count of the same predicate.
    // Two expressions that must agree are two expressions that can disagree.
    governingCount: rows.length,
    governingWithSource: wired(rows),
    others: narrowed.length - rows.length,
    othersWithSource: wired(narrowed) - wired(rows),
  };
}
