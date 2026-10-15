import { TIER_LABEL, type Tier } from "../ocd/tiers.ts";

import { standingChipMayAttach } from "./elected-role.ts";
import type { SeatHolder } from "./lookup.ts";

/** The outlined chips beside the party chip: every chip is a fact somebody published, or it does not render. */

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
  if (holder.selectionMethod === "APPOINTED") chips.push("Appointed");

  if (holder.state) chips.push(holder.state);

  const chamber = holder.chamber ? CHAMBER_LABEL[holder.chamber] : null;
  if (chamber) chips.push(chamber);
  else chips.push(TIER_LABEL[tier]);

  // The standing chip is gated on electedness, asked once in `lib/officials/elected-role.ts`.
  if (standing && holder.selectionMethod !== "APPOINTED" && holder.selectionMethod !== "UNKNOWN" && (holder.selectionMethod === "ELECTED_STATEWIDE" || standingChipMayAttach(holder.officeTitle))) {
    if (standing === "INCUMBENT") chips.push("Incumbent");
    if (standing === "CHALLENGER") chips.push("Challenger");
  }

  return chips;
}
