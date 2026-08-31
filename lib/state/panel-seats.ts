/**
 * **THE SEATS THE READER ACTUALLY HOLDS, ONCE THEY HAVE TOLD US WHERE THEY
 * ARE.** (WGH-22, 2026-08-30. Third session on this report.)
 *
 * ## What the owner met
 *
 * At 85641, address entered and resolved, two surfaces on one screen:
 *
 * ```
 *   the districts popup   State House District 17 · State Senate District 17
 *   Who Governs Here      State House District 19  "not yours — covers
 *                         State Senate District 19   another part of 85641"
 *                         ...and District 17 nowhere on the panel.
 * ```
 *
 * The owner's words: *if it stays stagnant when we put in an address, people
 * are not going to put in addresses, and that's a huge problem.*
 *
 * ## Two defects, and the second is the one nobody had named
 *
 * **The app is not failing to resolve.** It resolved correctly and then
 * displayed the other answer, wearing a label that proves it knew. That is the
 * reported half, and on its own it would be a presentation problem.
 *
 * The half underneath: the panel's STATE and FEDERAL sections are built from
 * `coverage.seats`, which is the **zip's** seats. The reader's own divisions
 * live in `coverage.divisions`, which is what the districts popup reads and
 * what the address actually settled. Nothing joined the two — so when the
 * zip's seat list happened not to carry District 17, the panel could not show
 * it, and hiding the District 19 rows would have left the state section
 * EMPTIER rather than righter.
 *
 * WGH-15 routed the seats through `applyResolvedLocation` on 2026-08-28, which
 * made the panel able to MARK a wrong row. It could not make the panel able to
 * show the right one, because the right one was never in the list it was
 * marking.
 *
 * ## What this does
 *
 * ```
 *   YOURS      one row per division the reader's address is inside, at the
 *              legislative levels, holders resolved through the shared
 *              resolver — sourced from coverage.divisions, so a district the
 *              zip's seat list never carried still appears
 *   ELSEWHERE  the zip's other districts, POSITIVELY excluded by the address,
 *              kept and moved behind a disclosure
 * ```
 *
 * **Nothing is removed** (RULING 26, RULING 27). The elsewhere rows are still
 * on the panel and still reachable — they govern real people in this zip and
 * we hold them in full. What changes is that they stop sitting in the list a
 * reader reads as *these are yours*, which is the state the owner photographed
 * with a red circle around it.
 *
 * That reading of RULING 26/27 is deliberate and it is narrow: the rule
 * forbids suppressing something because something ELSE is missing —
 * collection state governing display. Moving a row we have POSITIVELY
 * established is not the reader's is a fact about the reader's address, not a
 * fact about our collection, and the row is disclosed rather than dropped.
 *
 * ## Without an address, nothing changes
 *
 * `UNSETTLED` is not `ELSEWHERE_IN_ZIP`. A reader who has given only a zip
 * sees exactly what they saw before — the whole zip's representation, in one
 * list, unpartitioned. There is nothing to partition on, and inventing one
 * would be the panel guessing.
 */

import type { CoverageSummary, Seat } from "../registry/coverage.ts";
import type { SeatHolder } from "../officials/lookup.ts";

import { divisionTypeLabel } from "./derive.ts";
import {
  applyResolvedLocation,
  standingOf,
  type BodyStanding,
  type ResolvedLocation,
} from "./resolved-location.ts";

/** The legislative levels this panel splits into State and Federal sections. */
export const STATE_SEAT_TYPES = ["sldl", "sldu"] as const;
export const FEDERAL_SEAT_TYPES = ["cd"] as const;

/** A seat row as the panel renders it, whichever list it came from. */
export interface PanelSeat {
  readonly ocdId: string;
  readonly label: string;
  readonly divisionType: string;
  readonly tier: Seat["tier"];
  readonly representatives: readonly SeatHolder[];
  readonly standing: BodyStanding;
}

export interface PanelSeats {
  /** The reader's own, or the whole zip's when no address has settled. */
  readonly yours: readonly PanelSeat[];
  /**
   * Districts the address POSITIVELY excluded. Empty without an address.
   * Kept, disclosed, never dropped.
   */
  readonly elsewhere: readonly PanelSeat[];
  /** True once an address has settled at least one of these levels. */
  readonly settled: boolean;
}

function seatOf(
  seat: Seat,
  location: ResolvedLocation,
): PanelSeat {
  return {
    ocdId: seat.ocdId,
    label: seat.label,
    divisionType: seat.divisionType,
    tier: seat.tier,
    representatives: seat.representatives,
    standing: standingOf({ ocdId: seat.ocdId }, location),
  };
}

/**
 * Split the panel's seats for one set of division types.
 *
 * `holdersFor` is injected rather than imported so this stays a pure function
 * over data — the resolver reaches the roster store, and a module the panel
 * imports for arithmetic should not reach a store.
 */
export function panelSeatsFor(
  coverage: CoverageSummary,
  location: ResolvedLocation,
  divisionTypes: readonly string[],
  holdersFor: (ocdId: string) => SeatHolder[],
): PanelSeats {
  const inScope = coverage.seats.filter((s) => divisionTypes.includes(s.divisionType));
  const annotated = applyResolvedLocation(inScope, location).map((s) =>
    seatOf(s as Seat, location),
  );

  /*
   * **A STANDING IS NEVER REWRITTEN HERE, AND THAT IS THE WHOLE DISCIPLINE.**
   *
   * The first cut of this function built `yours` from `coverage.divisions` and
   * stamped every row `CONFIRMED`. Driven against the real surface it did the
   * worst possible thing: `coverage.divisions` at 85641 without a live
   * re-resolve still carries District 19, so the panel promoted two rows the
   * reader's address EXCLUDES from a hedged claim to a confident wrong one —
   * exactly the regression `keepsCouldGovernPill` was written to refuse, made
   * one level up.
   *
   * `standingOf` is the only thing that may say what a row is. This function
   * only decides which LIST each row goes in.
   */
  const elsewhere = annotated.filter((s) => s.standing === "ELSEWHERE_IN_ZIP");
  const kept = annotated.filter((s) => s.standing !== "ELSEWHERE_IN_ZIP");

  /*
   * The other half of WGH-22, and the half nobody had named: a district the
   * reader IS in that the zip's seat list never carried. `coverage.seats` is
   * the zip's; `coverage.divisions` is what the address settled, and it is
   * what the districts popup reads. Adding a row here is only safe because
   * `standingOf` decides the row's standing — a division that is merely in the
   * zip's division list arrives `UNSETTLED` and reads as it always did.
   */
  const seen = new Set(kept.map((s) => s.ocdId));
  const missing: PanelSeat[] = coverage.divisions
    .filter((d) => divisionTypes.includes(d.divisionType) && !seen.has(d.ocdId))
    .map((d) => ({
      ocdId: d.ocdId,
      label: d.label,
      divisionType: d.divisionType,
      tier: d.tier,
      representatives: holdersFor(d.ocdId),
      standing: standingOf({ ocdId: d.ocdId }, location),
    }))
    /* Only a row the address CONFIRMED is added. Anything else would be this
       function widening the panel on evidence it does not have. */
    .filter((s) => s.standing === "CONFIRMED");

  return {
    yours: [...missing, ...kept],
    elsewhere,
    settled: elsewhere.length > 0 || missing.length > 0,
  };
}

/** The disclosure's own label. Plain language, and the count is derived. */
export function elsewhereDisclosureLabel(count: number, zip: string): string {
  return count === 1
    ? `1 more district covers another part of ${zip}`
    : `${count} more districts cover other parts of ${zip}`;
}

/** Re-exported so the panel names a division type without a second table. */
export { divisionTypeLabel };
