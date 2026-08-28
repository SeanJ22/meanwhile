import type { BodyStanding } from "../state/resolved-location.ts";

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
 *
 * ## WGH-15 (2026-08-28): this function READS `standing`
 *
 * `coverage-notice.tsx` has piped `applyResolvedLocation(bodies, location)`
 * into here since the 8/28 sweep. The annotation arrived, travelled through
 * unread — the parameter was typed `readonly CoveredBody[]`, so `standing` was
 * invisible to the compiler and to every line below — and came out the far side
 * still unread. Only `couldGovern` survived into the render, and that survived
 * because the SPREAD carried it, not because anything here looked at it.
 *
 * That is the WGH-12/13/14 defect — *correct, and had zero consumers* — one
 * level further down. So two things change and neither is a filter:
 *
 * - the input is **generic**, so the annotation survives into `rows` with its
 *   type intact and a surface can render it;
 * - `elsewhere` counts the rows the reader's own address EXCLUDES.
 *
 * **Nothing is dropped, and `governingCount === rows.length` still holds by
 * construction.** RULING 26 and RULING 27: collection state never governs
 * display, and an address is evidence, not a display filter. A body that
 * governs somewhere else in the zip is a body we hold in full and the reader
 * can still see — the card ANNOTATES it, and `elsewhere` is what lets the card
 * say so in its own words instead of leaving the reader to spot it.
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
  /** Boards, committees and commissions — real bodies, not governments. */
  others: number;
  /** How many of `others` have a calendar actually wired. */
  othersWithSource: number;
  /**
   * **WGH-15.** How many of `rows` the reader's own address EXCLUDES —
   * `ELSEWHERE_IN_ZIP`, a body that governs somewhere else in the zip they
   * typed.
   *
   * Zero whenever no address has been resolved, and that zero is *"we have not
   * been told"*, never *"none of these are excluded"*. `standingOf` returns
   * `UNSETTLED` for every body under `SELF_DECLARED_ZIP` and under `BROWSING`,
   * so this can only be non-zero on evidence the reader themselves supplied.
   *
   * It is a count for the CARD TO SAY, not a threshold for it to filter on.
   * Nothing here or downstream may remove a row because of it.
   */
  elsewhere: number;
}

/**
 * @param bodies every body coverage returned for this point
 * @param selectedOcdIds the reader's device-local narrowing choices (M26);
 *        empty when they have not narrowed, which is the default and must
 *        stay the effortless one
 */
export function deriveWhoGoverns<T extends CoveredBody & { standing?: BodyStanding }>(
  bodies: readonly T[],
  selectedOcdIds: ReadonlySet<string>,
): WhoGoverns<T> {
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
    /*
     * WGH-15. Counted off `rows` — the SAME array the card renders and the same
     * one `governingCount` is the length of — for the reason the whole file
     * exists: a second traversal of a second array is how one surface came to
     * state three numbers for one list. A row with no annotation is not
     * excluded; only an explicit `ELSEWHERE_IN_ZIP` is, and only the reader's
     * own address can produce one.
     */
    elsewhere: rows.filter((b) => b.standing === "ELSEWHERE_IN_ZIP").length,
  };
}
