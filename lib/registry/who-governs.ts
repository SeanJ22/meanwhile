import type { BodyStanding } from "../state/resolved-location.ts";

import type { CoveredBody } from "./coverage.ts";
import { WIRED_STATUSES } from "./coverage-client.ts";

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
  /**
   * **WGH-18 (2026-08-30) — the other bodies THEMSELVES, not just how many.**
   *
   * The panel stated *"We also track 27 more board and committee calendars
   * here. 30 more bodies are being added."* and gave a reader no way to see
   * one of them: reaching the list meant closing the panel, opening the
   * sidebar, and clicking Bodies here (65). The owner: *"there's no way for me
   * to find out which one of those are."*
   *
   * Naming a number a reader cannot open is the same defect as WGH-19's
   * completeness claim, one step earlier — a panel describing contents it does
   * not show. So the rows come out beside the count, from the SAME array the
   * count is the length of, which is this file's own discipline: two
   * expressions that must agree are two expressions that can disagree.
   */
  otherRows: T[];
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
/**
 * **THE ORDER OF THE GOVERNING LIST.** (WGH-17, 2026-08-30.)
 *
 * The owner, reading eight flat rows at 85701: *"if I wanna know in general
 * who governs me I think it's fair to say Pima. Tucson, TUSD, those are
 * primarily the ones that people wanna see... I'm not even sure why it's
 * picked these specific ones."*
 *
 * It had not picked them. They were in whatever order the coverage summary
 * returned, which reads as arbitrary because it is.
 *
 * ## Why this is not a ranking, and the distinction is the whole of it
 *
 * `CLAUDE.md` forbids ordering by anything but a NEUTRAL CRITERION, and it
 * forbids ranking, scoring or ordering CANDIDATES at all. This orders
 * GOVERNMENTS, by WHAT KIND OF GOVERNMENT EACH ONE IS — a structural fact
 * published by the Census division vocabulary, not a judgment about which
 * matters more.
 *
 * The criterion is also STATED ON SCREEN, in the "Why these N?" disclosure,
 * which is what makes it checkable by a reader rather than a hidden weighting.
 * A criterion a reader cannot see is a ranking whatever it is called.
 *
 * ## The order, and it is the reader's own question
 *
 * County, then city or town, then school district, then every other district.
 * That is the sequence in the owner's dictation verbatim, and it is the
 * sequence of a person asking *who governs me* rather than the sequence of a
 * database. Within a kind, nothing is reordered: the incoming order survives,
 * because there is no neutral criterion for ranking two special districts
 * against each other and inventing one would be exactly what this rule bans.
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

  const rows = orderByGovernmentKind(
    narrowed.filter((b) => b.bodyClass === "GOVERNING"),
  );
  const wired = (list: readonly CoveredBody[]) =>
    list.filter((b) => WIRED_STATUSES.has(b.coverageStatus)).length;

  const otherRows = narrowed.filter((b) => b.bodyClass !== "GOVERNING");

  return {
    rows,
    // Deliberately `rows.length`, not a second count of the same predicate.
    // Two expressions that must agree are two expressions that can disagree.
    governingCount: rows.length,
    governingWithSource: wired(rows),
    otherRows,
    /* WGH-18: the SAME array's length, for the same reason `governingCount` is
       `rows.length`. The panel now renders these rows, so a count derived any
       other way could state a number the disclosure does not open. */
    others: otherRows.length,
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
