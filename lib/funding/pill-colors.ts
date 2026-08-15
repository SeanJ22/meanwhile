import type { CommitteeTypeLabel } from "./committee-types.ts";

/**
 * The pill family for each funding type label (design pass item 2b,
 * 2026-08-15, the author's spec). THIS FILE IS THE WHOLE ASSIGNMENT —
 * a type's color is decided here and nowhere else, so the same type is
 * always the same color on every surface.
 *
 * The families live in app/globals.css (--pill-<family>-text/bg per
 * theme) and deliberately never use or approach the party palette:
 * teals, cyans, ambers, golds, slates and warm stones only, so no
 * committee type reads as partisan and no color implies good or bad
 * money. Assignment within the allowed families is arbitrary; related
 * types share a family on purpose (the independent-expenditure pair in
 * amber, the connected-PAC cluster spread for scan-ability).
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

/** The CSS class pair for a typed label's pill. Unmapped ids get the
 *  neutral stone family rather than an error — a new label renders
 *  legibly the day it is added, and the test that pins this table to
 *  COMMITTEE_TYPE_LABELS is what keeps the map complete. */
export function pillClassFor(label: CommitteeTypeLabel): string {
  return `pill pill--${PILL_FAMILY_BY_TYPE_ID[label.id] ?? "stone"}`;
}

export { PILL_FAMILY_BY_TYPE_ID };
