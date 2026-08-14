/**
 * Reaction domain types and validation — shared by the client control, the
 * API route, and the aggregation layer. No Node imports here: the client
 * bundles this file.
 *
 * The rules this encodes (CLAUDE.md, reaction capture):
 * - a reaction attaches to a specific record (a roll-call vote today),
 *   never to a person as a whole;
 * - the store is identifier-free — the only continuity is a random
 *   browser-local key, stored hashed (see lib/db/schema.ts);
 * - every row is tier-stamped from day one so aggregates are tier-shaped
 *   before any verification exists.
 */

export type ReactionTargetType = "FEDERAL_VOTE";
export const REACTION_TARGET_TYPES: ReactionTargetType[] = ["FEDERAL_VOTE"];

export type ReactionValue = "YES" | "NO" | "UNSURE";
export const REACTION_VALUES: ReactionValue[] = ["YES", "NO", "UNSURE"];

/**
 * ANONYMOUS is the only tier any row carries today. The other two are
 * designed (T02) and enumerated now so the aggregation contract — and every
 * export shape downstream of it — never needs reshaping when they arrive.
 */
export type VerificationTier = "ANONYMOUS" | "LOCALITY_VERIFIED" | "VOTER_MATCHED";
export const VERIFICATION_TIERS: VerificationTier[] = [
  "ANONYMOUS",
  "LOCALITY_VERIFIED",
  "VOTER_MATCHED",
];

/** What the client sends. Everything else about the row is server-derived. */
export interface ReactionSubmission {
  targetType: ReactionTargetType;
  targetId: string;
  reaction: ReactionValue;
  /** The browser's random continuity key — hashed before storage. */
  reactionKey: string;
  /** Orientation only, same basis as the search log. All optional. */
  zip?: string | null;
  lat?: number | null;
  lng?: number | null;
}

export function isValidTargetType(value: unknown): value is ReactionTargetType {
  return typeof value === "string" && (REACTION_TARGET_TYPES as string[]).includes(value);
}

export function isValidReactionValue(value: unknown): value is ReactionValue {
  return typeof value === "string" && (REACTION_VALUES as string[]).includes(value);
}

/**
 * The key the browser mints: URL-safe, 16–64 chars. Anything else is
 * rejected — fail closed, never coerced.
 */
export function isValidReactionKey(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{16,64}$/.test(value);
}

/** Roll-call ids are short and shaped; a cap keeps the column honest. */
export function isPlausibleTargetId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 64;
}
