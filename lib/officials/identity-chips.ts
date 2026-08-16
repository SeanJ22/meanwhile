import { TIER_LABEL, type Tier } from "../ocd/tiers.ts";

import type { SeatHolder } from "./lookup.ts";

/**
 * The outlined chips beside the party chip on an identity header (item 3,
 * 2026-08-16).
 *
 * Pure and separate from the component so a test can hold it, and because
 * this is exactly the kind of derivation that quietly grows a guess. The
 * rule: **every chip is a fact somebody published, or it does not render.**
 *
 * - **State** comes off the member's own current term in the pinned
 *   congress-legislators file (item 7), not off parsing a seat label. "AZ-6"
 *   happens to start with a state code and "State House District 19" does
 *   not, and a chip derived by string-guessing is a chip that will one day
 *   be wrong about somebody's state.
 * - **Chamber** likewise. A local roster carries neither, so a local card
 *   renders the tier instead — which is also a fact, just a coarser one.
 * - **Incumbent** is definitional on an officeholder card: this person holds
 *   this seat. It is the same chip a challenger gets on a ballot card, at
 *   the same height, in the same outline — equal effort is a geometric claim
 *   here as much as an editorial one.
 */

const CHAMBER_LABEL: Record<string, string> = {
  house: "House",
  senate: "Senate",
};

export type SeatStanding = "INCUMBENT" | "CHALLENGER" | null;

export function identityChipsFor(
  holder: SeatHolder,
  tier: Tier,
  standing: SeatStanding = null,
): string[] {
  const chips: string[] = [];

  if (holder.state) chips.push(holder.state);

  const chamber = holder.chamber ? CHAMBER_LABEL[holder.chamber] : null;
  if (chamber) chips.push(chamber);
  else chips.push(TIER_LABEL[tier]);

  if (standing === "INCUMBENT") chips.push("Incumbent");
  if (standing === "CHALLENGER") chips.push("Challenger");

  return chips;
}
