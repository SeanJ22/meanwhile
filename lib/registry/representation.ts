import type { CoverageTier } from "../meetings/constants.ts";
import type { SeatHolder } from "../officials/lookup.ts";
import { allOfficialRows } from "../officials/tier-grouping.ts";

import { projectedGoverningHoldersForDivision } from "./body-roster-client.ts";
import type { CoverageSummary } from "./coverage.ts";

/**
 * The coverage notice's render-gating logic, kept where a test can reach it. A panel must never render
 * empty (or not at all) while the store behind it is populated.
 */

/**
 * Who represents a division: the one resolver every officials surface reads. Legislative seats come
 * off the coverage summary's `seats`; local governing bodies come off the curated body rosters (ids
 * suffixed `#governing` or `#board`). Both stores, always, so no two surfaces disagree.
 */
export function representationForDivision(
  coverage: CoverageSummary | null | undefined,
  ocdId: string | null,
): SeatHolder[] {
  if (!ocdId) return [];
  const seat = coverage?.seats.find((s) => s.ocdId === ocdId);
  if (seat?.representatives.length) return seat.representatives;
  return projectedGoverningHoldersForDivision(coverage, ocdId);
}

/**
 * What to say when the resolver comes back empty, sayable without knowing which store was asked. A
 * lookup in flight, a failed lookup and an absence of record are three different sentences, each about
 * our gap, never a claim about a government.
 */
export function representationNoteFor(
  tier: string,
  state: "gap" | "looking" | "unavailable" = "gap",
): string {
  if (state === "looking") return "Looking up who holds this seat…";
  if (state === "unavailable") {
    return "We couldn't check who holds this seat just now.";
  }
  return tier === "local"
    ? "We haven't sourced the governing body and its members for this division yet."
    : "No sourced officeholder for this division yet.";
}

/** The note state a resolver status implies. `resolved` needs no note. */
export function noteStateFor(
  status: "resolved" | "looking" | "unsourced" | "unavailable",
): "gap" | "looking" | "unavailable" {
  if (status === "looking") return "looking";
  if (status === "unavailable") return "unavailable";
  return "gap";
}

/** Does the summary hold anything a representation panel could render? */
export function hasRepresentation(coverage: CoverageSummary | null): boolean {
  if (!coverage) return false;
  return (
    coverage.bodies.length > 0 ||
    (coverage.governments?.length ?? 0) > 0 ||
    (coverage.governmentInventoryStates?.length ?? 0) > 0 ||
    (coverage.stateOffices?.length ?? 0) > 0 ||
    coverage.seats.length > 0 ||
    coverage.senators.length > 0 ||
    coverage.statewideExecutives.length > 0
  );
}

/**
 * Distinct named officeholders in the summary: the panel's denominator. Reads the same tier grouping
 * every officials surface renders, so the stat card and the rows cannot disagree.
 */
export function namedHolderCount(coverage: CoverageSummary | null): number {
  if (!coverage) return 0;
  return allOfficialRows(coverage).length;
}

/**
 * Whether the notice renders at all. On the failure rungs it always renders; on `exact` it renders when
 * there is representation to show. It must never return false while `hasRepresentation` is true.
 */
export function shouldRenderNotice(
  tier: CoverageTier,
  coverage: CoverageSummary | null,
): boolean {
  if (tier !== "exact") return true;
  return hasRepresentation(coverage);
}

/** Which lead sentence the coverage body opens with. */
export type LeadKind =
  | "unmapped"
  | "none-scheduled"
  | "meetings-missing-calendars"
  | "no-source"
  | "all-wired";

export function leadKind(coverage: CoverageSummary): LeadKind {
  switch (coverage.state) {
    case "UNMAPPED":
      return "unmapped";
    case "NONE_SCHEDULED":
      return "none-scheduled";
    case "MEETINGS": {
      // The lead speaks about governments. Advisory boards and commissions
      // get their own sentence; a missing advisory calendar must not turn
      // "we watch all of their calendars" into a false claim, nor the other
      // way around.
      const g = coverage.counts.governing;
      return g.withSource < g.total ? "meetings-missing-calendars" : "all-wired";
    }
    case "NO_SOURCE":
      return "no-source";
  }
}

/** The card's mono header, by tier and what there is to say. */
export function noticeLabel(
  tier: CoverageTier,
  coverage: CoverageSummary | null,
): string {
  if (tier === "widened") return "Radius widened";
  if (tier === "concluded") return "Recently concluded";
  if (tier === "none") {
    if (!coverage) return "No coverage yet";
    return coverage.state === "UNMAPPED" ? "Not mapped yet" : "Coverage gap";
  }
  return "Who governs here";
}
