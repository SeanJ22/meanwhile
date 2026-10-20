import { createHash } from "node:crypto";
import { ocdStateCode } from "../ocd/state-of.ts";
import type { PromotedEdgeEntry } from "../civic-data/read-model.ts";

/** The 2-letter state (or DC, or territory: `lib/ocd/state-of.ts`) of an OCD division id, or null when it names none. */
export function stateOfOcdId(ocdId: string | null | undefined): string | null {
  return ocdStateCode(ocdId);
}

export const STATE_AUTHORITY_FAMILIES = ["registry-runtime", "federal-directory", "ballot-contests", "candidate-profiles", "candidate-publications", "voting-sites", "candidate-campaign-sites-derived"] as const;
export type StateAuthorityFamily = typeof STATE_AUTHORITY_FAMILIES[number];
export type GlobalAuthorityFamily = Exclude<AuthorityFamily, StateAuthorityFamily>;
export type GlobalPromotedAuthorityFamily = PromotedAuthorityFamily;
/** Canonical promoted data families requested by reader routes. */
export type PromotedAuthorityFamily =
  | "other-reader-data"
  | "state-votes"
  | "ballot-navigation"
  | "official-filings"
  | "member-offices"
  | "nh-members"
  | "federal-funding"
  | "state-money"
  | "pima-finance"
  | "federal-votes"
  | "federal-key-votes"
  | "officeholder-statements"
  | "prl-archives"
  | "prl-profiles"
  | "executive-actions"
  | "government-domains";

/** Request-injected values for one canonical data family. */
export interface PromotedFamilyArtifactValue {
  readonly kind: "PROMOTED_POINTERS";
  readonly entries: readonly PromotedEdgeEntry[];
}

export type AuthorityFamily =
  | "census-districts"
  | "campaign-sites"
  | "state-legislators"
  | "meeting-outcomes"
  | "everyday-routing"
  | PromotedAuthorityFamily
  | StateAuthorityFamily;

export function sha256OfJson(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
