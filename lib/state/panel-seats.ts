/**
 * The seats the reader actually holds, once they have told us where they are.
 *
 * `coverage.divisions` IS `coverage.seats` at the seat levels (one
 * point-in-polygon answer at the ZIP centroid), so a district the reader's
 * address is in can be absent from both when the ZIP crosses a legislative
 * line. The panel is therefore built from `confirmedDivisionIds`, the reader's
 * own answer:
 *
 * ```
 *   YOURS   the divisions the reader's ADDRESS confirmed at these levels,
 *           named and staffed by asking for them by key, PLUS the ZIP's seats
 *           the address did not rule out
 *   GONE    the districts the address positively excluded — off the panel,
 *           unlabelled, out of scope
 * ```
 *
 * Before a confirmed address the scope is the ZIP; after one, the scope IS the
 * address. Names and rosters for confirmed divisions come from
 * `hooks/use-confirmed-divisions.ts` and are injected, so this stays a pure
 * function; a reader surface never prints an OCD-ID.
 *
 * Without an address (`UNSETTLED`), the whole ZIP's representation is shown,
 * unpartitioned.
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
export const FEDERAL_SEAT_TYPES = ["cd", "country"] as const;
export const LOCAL_SEAT_TYPES = ["place", "county", "cousub", "county_subdivision", "school_district", "ward", "council_district"] as const;

/**
 * How a row's people were arrived at, so the panel can say the right sentence
 * when there are none. `resolved` needs no sentence; the other three are
 * different facts, worded by `representationNoteFor`.
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
   * The districts the address POSITIVELY excluded. Never rendered; carried so
   * a check can assert they were dropped rather than never computed.
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
 * Splits the panel's seats for one set of division types. `confirmed` is
 * injected so this pure function never reaches the network.
 */
export function panelSeatsFor(
  coverage: CoverageSummary,
  location: ResolvedLocation,
  divisionTypes: readonly string[],
  confirmed: readonly ConfirmedRow[] = [],
): PanelSeats {
  const inScope = coverage.seats.filter((s) => divisionTypes.includes(s.divisionType));

  /*
   * A standing is never rewritten here: `standingOf` alone says what a row is;
   * this function only decides which list each row goes in.
   */
  const kept = scopedToAddress(inScope, location).map((s) => seatOf(s as Seat, location));
  const excluded = excludedByAddress(inScope, location).map((s) =>
    seatOf(s as Seat, location),
  );

  /*
   * The reader's own districts that the ZIP-scoped payload cannot carry: only
   * rows this section's levels own, not already listed, and independently
   * confirmed by `standingOf`.
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
