import type { CoverageTier } from "../meetings/constants.ts";
import type { SeatHolder } from "../officials/lookup.ts";
import { allOfficialRows } from "../officials/tier-grouping.ts";

import { governingRosterHoldersForDivision } from "./body-rosters.ts";
import type { CoverageSummary } from "./coverage.ts";

/**
 * The render-gating logic of the coverage notice, extracted where a test can
 * reach it.
 *
 * Why this file exists: the notice used to return null whenever the cascade
 * landed on the `exact` rung — and the notice is the *only* surface that
 * renders who governs and represents a point. That coupling was invisible
 * while the demo zips sat on the widened rung; the moment the composite
 * served real meetings everywhere, every zip went `exact` and the entire
 * representation surface — 537 federal officials, three state rosters, the
 * governing-body list — vanished from the product while every test stayed
 * green. Success in meetings silently deleted representation.
 *
 * The invariant, per CLAUDE.md's count rule applied to a UI panel: a panel
 * must not render silently empty (or not at all) while the store behind it is
 * populated. These functions are that decision, and
 * `tests/representation.test.ts` holds them against the committed rosters.
 */

/**
 * **Who represents a division — the one resolver every officials surface
 * reads** (the class fix, 2026-08-15).
 *
 * A division's people live in two stores and neither one is optional:
 *
 * - **Legislative seats** — a congressional district, a state house district,
 *   a state senate district — come off the coverage summary's `seats`, which
 *   is the officeholder index keyed by division.
 * - **Local governing bodies** — a county board, a council, a school board —
 *   come off the curated body rosters, whose ids suffix a division `#governing`
 *   or `#board`.
 *
 * The defect this replaces: the district battlecard's Representation tab read
 * the roster store ALONE. Rosters hold no legislative seats by construction,
 * so **every congressional, state-house and state-senate division card denied
 * its own officeholder** — NH-2 rendering "No sourced officeholder for this
 * division yet" with Goodlander sitting in the index the small popup beside it
 * was already reading. Not one card: three of the six division types, at every
 * zip, and the ones with the largest overlays on the map.
 *
 * It was a parallel join, which is why it drifted: two surfaces answering the
 * same question from different stores will always eventually disagree, and the
 * one nobody screenshots is the one that stays wrong. There is one resolver
 * now, and `tests/representation.test.ts` asserts per division type that a
 * division any surface holds people for is a division the card holds the same
 * people for.
 */
export function representationForDivision(
  coverage: CoverageSummary | null | undefined,
  ocdId: string | null,
): SeatHolder[] {
  if (!ocdId) return [];
  const seat = coverage?.seats.find((s) => s.ocdId === ocdId);
  if (seat?.representatives.length) return seat.representatives;
  return governingRosterHoldersForDivision(ocdId);
}

/**
 * What to say when the resolver comes back empty — and it must be sayable
 * without knowing which store was asked.
 *
 * A local division whose boundary exists has a government by construction, and
 * saying so is a different fact from a legislative seat we simply have not
 * sourced. Both are our gap, stated as ours.
 *
 * **Three different empties, three different sentences** (M112,
 * 2026-08-16). The battlecard for a district the reader is not standing in
 * has to ASK who holds it — `useDivisionRepresentation` — and neither the
 * question in flight nor a failed question is an absence of record. Saying
 * "no sourced officeholder" for either is the render-default rule (M111)
 * broken by a timing gap instead of a null: it turns our own unfinished or
 * failed lookup into a claim about a government. Each of these sentences is
 * about US, and they say which of us went wrong.
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
    ? "We know this division has a governing body because its boundary exists. We haven't sourced who sits on it."
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
    coverage.seats.length > 0 ||
    coverage.senators.length > 0 ||
    coverage.statewideExecutives.length > 0
  );
}

/**
 * Distinct named officeholders in the summary — the panel's denominator.
 * Reads the SAME tier-grouping derivation every officials surface
 * renders (item 2c), so the stat card's N and the door's rows cannot
 * disagree: local roster members, state legislators, the governor, the
 * federal delegation.
 */
export function namedHolderCount(coverage: CoverageSummary | null): number {
  if (!coverage) return 0;
  return allOfficialRows(coverage).length;
}

/**
 * Whether the notice renders at all.
 *
 * On the failure rungs it always renders — that is the cascade explaining
 * itself. On `exact` it renders exactly when there is representation to show.
 * It must never return false while `hasRepresentation` is true: that is the
 * regression this module exists to guard against.
 */
export function shouldRenderNotice(
  tier: CoverageTier,
  coverage: CoverageSummary | null,
): boolean {
  if (tier !== "exact") return true;
  return hasRepresentation(coverage);
}

/**
 * Which lead sentence the coverage body opens with.
 *
 * `all-wired` is the state the old component had no words for — it never
 * rendered when nothing was missing, which is exactly when the reader most
 * deserves the list of who governs them.
 */
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
