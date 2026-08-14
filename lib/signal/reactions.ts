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

/**
 * CANDIDATE (3d, 2026-08-16) is the fourth reaction class beside votes and
 * the designed measure/agenda classes. The question is "Would you vote for
 * them?" — reader expression captured and stored, NEVER an input to any
 * ordering, ranking, or recommendation the product renders; the neutrality
 * guards extend over this class like every other.
 */
/**
 * FUNDING_TOTAL_REACTION and CONTRIBUTOR_REACTION (D34, 2026-08-18) are the
 * funding classes — reactions to the committee-totals display and the
 * contributor display, keyed by FEC candidate id so a reader's answer on
 * the ballot card and the official popup lands on the same committee. The
 * type IS the provenance tag the ripcord doctrine requires: while
 * `ripcord.fundingReactionsInAggregates` is pulled (it ships pulled), rows
 * of these two types are stored but excluded from aggregation and every
 * export — see lib/signal/aggregate.ts.
 */
export type ReactionTargetType =
  | "FEDERAL_VOTE"
  | "CANDIDATE"
  | "FUNDING_TOTAL_REACTION"
  | "CONTRIBUTOR_REACTION";
export const REACTION_TARGET_TYPES: ReactionTargetType[] = [
  "FEDERAL_VOTE",
  "CANDIDATE",
  "FUNDING_TOTAL_REACTION",
  "CONTRIBUTOR_REACTION",
];

/** The funding reaction classes — the filter a ripcord pull applies. */
export const FUNDING_REACTION_TYPES: ReactionTargetType[] = [
  "FUNDING_TOTAL_REACTION",
  "CONTRIBUTOR_REACTION",
];

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

/**
 * Roll-call ids are short; candidacy ids and lineup-nominee keys
 * (`<contestId>|<name>`) run longer. The cap keeps the column honest.
 */
export function isPlausibleTargetId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 128;
}
