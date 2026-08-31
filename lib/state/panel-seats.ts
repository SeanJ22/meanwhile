/**
 * **THE SEATS THE READER ACTUALLY HOLDS, ONCE THEY HAVE TOLD US WHERE THEY
 * ARE.** (WGH-22 — reported 8/28, "fixed" 8/28 and 8/30, falsified again
 * 2026-08-31. Third recurrence of the class; WGH-12 and WGH-15 are the same
 * defect wearing earlier numbers.)
 *
 * ## What the owner met, three times
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
 * ## What each previous repair actually did, measured
 *
 * **WGH-15 (8/28)** routed the panel's seats through `applyResolvedLocation`,
 * which made the panel able to MARK a row as not the reader's. It could not
 * make the panel able to SHOW the right one.
 *
 * **WGH-22 (8/30)** moved the marked rows behind a disclosure and tried to add
 * the missing ones from `coverage.divisions`. Driven against production on
 * 2026-08-31 at the owner's exact address, the panel's State section came back
 * **empty**: District 19 correctly set aside, District 17 still absent. The
 * addition could never fire, at any ZIP, for any reader, because of one line
 * in `summarizeCoverage`:
 *
 * ```
 *   const seats = divisions.filter((d) => SEAT_TYPES.has(d.divisionType))
 * ```
 *
 * **`coverage.divisions` IS `coverage.seats` at the seat levels.** One
 * point-in-polygon answer at the ZIP centroid, carried twice under two names.
 * A district absent from one is absent from the other by construction, so
 * "reach the other list" was a fix over a distinction that does not exist. It
 * went green because its test hand-built a `CoverageSummary` whose `divisions`
 * carried District 17 while its `seats` did not — a shape production cannot
 * emit. The test agreed with the reasoning that produced it, and neither had
 * met the surface.
 *
 * ## What this does now
 *
 * ```
 *   YOURS   the divisions the reader's ADDRESS confirmed at these levels,
 *           named and staffed by asking for them by key, PLUS the ZIP's seats
 *           the address did not rule out
 *   GONE    the districts the address positively excluded — off the panel,
 *           unlabelled, out of scope (RULING 222)
 * ```
 *
 * `confirmedDivisionIds` is the reader's own answer and it is on their device.
 * It is the only list that carries District 17 at 85641, so it is the list the
 * panel is built from. What it does NOT carry is a name or a roster, and a
 * reader surface may never print an OCD-ID — so those are asked for by
 * division key through `hooks/use-confirmed-divisions.ts` and injected here as
 * rows. This module stays a pure function over data.
 *
 * ## RULING 222, and why the disclosure is gone rather than improved
 *
 * The 8/30 reading kept excluded districts on the panel behind a disclosure,
 * arguing RULING 26/27 forbade dropping them. The author's ruling of
 * 2026-08-31 settles that reading: **before a confirmed address the scope is
 * the ZIP; after one, the scope IS the address.** Show-everything guarantees
 * completeness within the correct scope and never licensed displaying entities
 * we determined do not govern this reader. A *"not yours"* label on a
 * governing-entities surface is prohibited outright — an entity that is not
 * theirs is out of scope, not annotated.
 *
 * ## Without an address, nothing changes
 *
 * `UNSETTLED` is not `ELSEWHERE_IN_ZIP`. A reader who has given only a ZIP
 * sees exactly what they saw before: the whole ZIP's representation, in one
 * list, unpartitioned. There is nothing to scope to, and inventing one would
 * be the panel guessing.
 */

import type { CoverageSummary, Seat } from "../registry/coverage.ts";
import type { SeatHolder } from "../officials/lookup.ts";

import { divisionTypeLabel } from "./derive.ts";
import {
  excludedByAddress,
  scopedToAddress,
  standingOf,
  type BodyStanding,
  type ResolvedLocation,
} from "./resolved-location.ts";

/** The legislative levels this panel splits into State and Federal sections. */
export const STATE_SEAT_TYPES = ["sldl", "sldu"] as const;
export const FEDERAL_SEAT_TYPES = ["cd"] as const;

/**
 * How a row's people were arrived at, so the panel can say the right sentence
 * when there are none.
 *
 * `resolved` needs no sentence. The other three are three DIFFERENT facts and
 * `representationNoteFor` already words each one — collapsing them is how a
 * lookup still in flight renders as a district with no members.
 */
export type SeatSourcing = "resolved" | "looking" | "unsourced" | "unavailable";

/** A seat row as the panel renders it, whichever list it came from. */
export interface PanelSeat {
  readonly ocdId: string;
  /**
   * The division's own name. **Null is renderable; an OCD-ID is not.** A row
   * whose name has not come back yet renders its named gap, never its key.
   */
  readonly label: string | null;
  readonly divisionType: string;
  readonly tier: Seat["tier"];
  readonly representatives: readonly SeatHolder[];
  readonly standing: BodyStanding;
  readonly sourcing: SeatSourcing;
}

/**
 * A confirmed division the coverage payload does not carry, as the caller
 * resolved it. The shape `hooks/use-confirmed-divisions.ts` returns.
 */
export interface ConfirmedRow {
  readonly ocdId: string;
  readonly label: string | null;
  readonly divisionType: string | null;
  readonly tier: string | null;
  readonly holders: readonly SeatHolder[];
  readonly status: SeatSourcing;
}

export interface PanelSeats {
  /** The reader's own, or the whole ZIP's when no address has settled. */
  readonly yours: readonly PanelSeat[];
  /**
   * The districts the address POSITIVELY excluded. **Never rendered**
   * (RULING 222). Carried so a check can assert they were dropped rather than
   * never computed, and so the count of what was set aside stays inspectable.
   */
  readonly excluded: readonly PanelSeat[];
  /** True once an address has settled at least one of these levels. */
  readonly settled: boolean;
}

function seatOf(seat: Seat, location: ResolvedLocation): PanelSeat {
  return {
    ocdId: seat.ocdId,
    label: seat.label,
    divisionType: seat.divisionType,
    tier: seat.tier,
    representatives: seat.representatives,
    standing: standingOf({ ocdId: seat.ocdId }, location),
    // A seat off the coverage payload came with its people or genuinely has
    // none we hold. There is no request in flight to be honest about.
    sourcing: seat.representatives.length > 0 ? "resolved" : "unsourced",
  };
}

/**
 * Split the panel's seats for one set of division types.
 *
 * `confirmed` is injected rather than fetched so this stays a pure function
 * over data — the resolver reaches a route, and a module the panel imports for
 * arithmetic must not reach the network.
 */
export function panelSeatsFor(
  coverage: CoverageSummary,
  location: ResolvedLocation,
  divisionTypes: readonly string[],
  confirmed: readonly ConfirmedRow[] = [],
): PanelSeats {
  const inScope = coverage.seats.filter((s) => divisionTypes.includes(s.divisionType));

  /*
   * **A STANDING IS NEVER REWRITTEN HERE, AND THAT IS THE WHOLE DISCIPLINE.**
   *
   * An earlier cut of this function stamped every row it added `CONFIRMED`.
   * Driven against the real surface it did the worst possible thing: it
   * promoted rows the reader's address EXCLUDES from a hedged claim to a
   * confident wrong one. `standingOf` is the only thing that may say what a
   * row IS. This function only decides which list each row goes in.
   */
  const kept = scopedToAddress(inScope, location).map((s) => seatOf(s as Seat, location));
  const excluded = excludedByAddress(inScope, location).map((s) =>
    seatOf(s as Seat, location),
  );

  /*
   * The reader's own districts, which the ZIP-scoped payload provably cannot
   * carry when the ZIP crosses a legislative line. Only rows this section's
   * levels own, only ones not already listed, and — the same gate as before —
   * only ones `standingOf` independently confirms. A caller handing over a
   * division the location does not confirm cannot widen the panel with it.
   */
  const seen = new Set(kept.map((s) => s.ocdId));
  const mine: PanelSeat[] = confirmed
    .filter((row) => {
      if (seen.has(row.ocdId)) return false;
      if (row.divisionType !== null && !divisionTypes.includes(row.divisionType)) {
        return false;
      }
      return standingOf({ ocdId: row.ocdId }, location) === "CONFIRMED";
    })
    .map((row) => ({
      ocdId: row.ocdId,
      label: row.label,
      // The level is the honest fallback for a type the route did not name;
      // it is what the id already says, not a guess about the division.
      divisionType: row.divisionType ?? divisionTypes[0] ?? "",
      tier: (row.tier ?? "state") as Seat["tier"],
      representatives: row.holders,
      standing: "CONFIRMED" as const,
      sourcing: row.status,
    }));

  return {
    yours: [...mine, ...kept],
    excluded,
    settled: excluded.length > 0 || mine.length > 0,
  };
}

/** Re-exported so the panel names a division type without a second table. */
export { divisionTypeLabel };
