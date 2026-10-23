import { stateFromRegistryRuntimeContractId } from "../civic-data/state-scopes.ts";

export const ATTEMPT_FAMILIES = ["meetings", "people", "services", "elections", "filings"] as const;
export type AttemptFamily = (typeof ATTEMPT_FAMILIES)[number];

/** The family each existing publication door serves. Unknown doors serve none. */
const FAMILY_OF_CONTRACT: Readonly<Record<string, AttemptFamily>> = {
  "comment-access": "meetings",
  "everyday-routing": "services",
  "ballot-navigation": "elections",
  "official-filings": "filings",
};

export function attemptFamilyOf(contractId: string | undefined): AttemptFamily | null {
  if (contractId === undefined) return null;
  return stateFromRegistryRuntimeContractId(contractId) ? "people" : FAMILY_OF_CONTRACT[contractId] ?? null;
}

export interface FamilyAttemptLike {
  readonly bodyId: string;
  readonly at: string;
  readonly status: "PUBLISHED" | "PARTIALLY_PUBLISHED" | "HELD";
  readonly family: AttemptFamily | null;
  readonly acceptedCount: number | null;
  readonly versionId: string | null;
}

export interface FamilyAttempts<T extends FamilyAttemptLike> {
  /** The latest attempt of any outcome, for this family only. */
  readonly latest: T;
  /** The latest attempt that published something, or null when none has. */
  readonly lastGood: T | null;
  /** What is published now for this family: the last good attempt's own count and version, or null. */
  readonly publishedNow: { readonly at: string; readonly acceptedCount: number | null; readonly versionId: string | null } | null;
}

export type BodyFamilyAttempts<T extends FamilyAttemptLike> = Partial<Record<AttemptFamily, FamilyAttempts<T>>>;

/** One entry per family this body has an attempt in; a family with none is absent, never borrowed. */
export function attemptsByFamily<T extends FamilyAttemptLike>(attempts: readonly T[]): BodyFamilyAttempts<T> {
  const out: Partial<Record<AttemptFamily, { latest: T; lastGood: T | null }>> = {};
  for (const attempt of attempts) {
    if (attempt.family === null) continue;
    const entry = out[attempt.family] ?? { latest: attempt, lastGood: null };
    if (attempt.at > entry.latest.at) entry.latest = attempt;
    if (attempt.status !== "HELD" && (entry.lastGood === null || attempt.at > entry.lastGood.at)) entry.lastGood = attempt;
    out[attempt.family] = entry;
  }
  const result: Partial<Record<AttemptFamily, FamilyAttempts<T>>> = {};
  for (const family of ATTEMPT_FAMILIES) {
    const entry = out[family];
    if (entry) result[family] = { ...entry, publishedNow: entry.lastGood
      ? { at: entry.lastGood.at, acceptedCount: entry.lastGood.acceptedCount, versionId: entry.lastGood.versionId } : null };
  }
  return result;
}
