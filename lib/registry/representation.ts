import type { CoverageTier } from "../meetings/constants.ts";

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

/** Does the summary hold anything a representation panel could render? */
export function hasRepresentation(coverage: CoverageSummary | null): boolean {
  if (!coverage) return false;
  return (
    coverage.bodies.length > 0 ||
    coverage.seats.length > 0 ||
    coverage.senators.length > 0
  );
}

/** Distinct named officeholders in the summary — the panel's denominator. */
export function namedHolderCount(coverage: CoverageSummary | null): number {
  if (!coverage) return 0;
  const ids = new Set<string>();
  for (const seat of coverage.seats) {
    for (const holder of seat.representatives) ids.add(holder.id);
  }
  for (const holder of coverage.senators) ids.add(holder.id);
  return ids.size;
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
    case "MEETINGS":
      return coverage.counts.withoutSource > 0
        ? "meetings-missing-calendars"
        : "all-wired";
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
