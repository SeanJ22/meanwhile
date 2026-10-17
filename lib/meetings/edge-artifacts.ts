import { createHash } from "node:crypto";

import { ocdStateCode } from "../ocd/state-of.ts";
import type { PromotedEdgeEntry } from "../civic-data/read-model.ts";

export const READER_ARTIFACT_FORMAT_VERSION = 1 as const;

/** The 2-letter state (or DC, or territory: `lib/ocd/state-of.ts`) of an OCD division id, or null when it names none. */
export function stateOfOcdId(ocdId: string | null | undefined): string | null {
  return ocdStateCode(ocdId);
}

export interface ReaderManifest {
  readonly formatVersion: typeof READER_ARTIFACT_FORMAT_VERSION;
  readonly sequence: number;
  /** One index per state of the bodies whose meetings it holds; a body filed under two states is in both. */
  readonly meetingStates?: Readonly<Record<string, AuthorityArtifactRef>>;
  readonly everydayRouting?: unknown;
  readonly extrasVersionIds?: Readonly<Partial<Record<"everyday-routing", string | null>>>;
  readonly authorityArtifacts?: Partial<Record<GlobalAuthorityFamily, AuthorityArtifactRef>>;
  readonly stateFacts?: Readonly<Record<string, AuthorityArtifactRef>>;
  readonly stateAuthorities?: Partial<Record<StateAuthorityFamily, Readonly<Record<string, AuthorityArtifactRef>>>>;
  readonly registrations?: Readonly<Record<string, AuthorityArtifactRef>>;
  readonly stateLegislators?: Readonly<Record<string, AuthorityArtifactRef>>;
}

export const STATE_AUTHORITY_FAMILIES = ["registry-runtime", "ballot-contests", "candidate-profiles", "candidate-publications", "voting-sites", "candidate-campaign-sites-derived"] as const;
export type StateAuthorityFamily = typeof STATE_AUTHORITY_FAMILIES[number];
export type GlobalAuthorityFamily = Exclude<AuthorityFamily, StateAuthorityFamily>;
export type GlobalPromotedAuthorityFamily = PromotedAuthorityFamily;
export function isStateAuthorityFamily(family: string): family is StateAuthorityFamily {
  return (STATE_AUTHORITY_FAMILIES as readonly string[]).includes(family);
}

/** Each artifact carries one or more proven pointers whole, read through each pointer's own typed Reader. */
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

export const PROMOTED_AUTHORITY_FAMILIES: readonly PromotedAuthorityFamily[] = [
  "other-reader-data",
  "state-votes",
  "ballot-navigation",
  "official-filings",
  "member-offices",
  "nh-members",
  "federal-funding",
  "state-money",
  "pima-finance",
  "federal-votes",
  "federal-key-votes",
  "officeholder-statements",
  "prl-archives",
  "prl-profiles",
  "executive-actions",
  "government-domains",
];

/** A proven-pointer family's artifact value: every pointer the family names, each proven or answered absent. */
export interface PromotedFamilyArtifactValue {
  readonly kind: "PROMOTED_POINTERS";
  readonly entries: readonly PromotedEdgeEntry[];
}

export function isPromotedAuthorityFamily(family: AuthorityFamily): family is PromotedAuthorityFamily {
  return (PROMOTED_AUTHORITY_FAMILIES as readonly string[]).includes(family);
}

export type AuthorityFamily =
  | "census-districts"
  | "federal-directory"
  | "campaign-sites"
  | "state-legislators"
  | "meeting-outcomes"
  | "everyday-routing"
  | PromotedAuthorityFamily
  | StateAuthorityFamily;

export const GLOBAL_AUTHORITY_FAMILIES: readonly GlobalAuthorityFamily[] = [
  "census-districts",
  "federal-directory",
  "campaign-sites",
  "state-legislators",
  "meeting-outcomes",
  "everyday-routing",
  ...PROMOTED_AUTHORITY_FAMILIES,
];

export const AUTHORITY_FAMILIES: readonly AuthorityFamily[] = [...GLOBAL_AUTHORITY_FAMILIES, ...STATE_AUTHORITY_FAMILIES];

export interface AuthorityArtifactRef {
  readonly layout?: "records";
  readonly key: string;
  readonly version: string;
  readonly sha: string;
}

export function sha256OfJson(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
