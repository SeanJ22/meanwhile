import type { CommitteeTypeLabel } from "./committee-types.ts";

/**
 * The pill colour family for each funding type label; the whole assignment.
 * Families live in app/globals.css (--pill-<family>-text/bg per theme) and
 * never approach the party palette, so no type reads as partisan or as good
 * or bad money.
 */
export type PillFamily =
  | "teal"
  | "cyan"
  | "amber"
  | "gold"
  | "slate"
  | "stone";

const PILL_FAMILY_BY_TYPE_ID: Readonly<Record<string, PillFamily>> = {
  "joint-fundraiser": "cyan",
  "another-candidate-committee": "teal",
  "leadership-pac": "slate",
  "super-pac": "amber",
  "single-candidate-ie": "amber",
  "hybrid-pac": "gold",
  "party-committee": "stone",
  "pac-corporation": "slate",
  "pac-labor": "teal",
  "pac-trade-association": "gold",
  "pac-membership": "cyan",
  "pac-cooperative": "teal",
  "pac-no-capital-stock": "stone",
  pac: "stone",
  organization: "stone",
};

/** The CSS class pair for a typed label's pill. Unmapped ids get the neutral stone family. */
export function pillClassFor(label: CommitteeTypeLabel): string {
  return `pill pill--${PILL_FAMILY_BY_TYPE_ID[label.id] ?? "stone"}`;
}

export { PILL_FAMILY_BY_TYPE_ID };
