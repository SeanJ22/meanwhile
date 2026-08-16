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

/**
 * SOMEONE_ELSE (M63, 2026-08-15) is the fourth answer, and it is accepted
 * ONLY on a candidate in a contest with exactly one candidate.
 *
 * The author's reasoning, which is the whole justification for a new enum
 * value: in an uncontested race the other three answers collect almost
 * nothing. Yes is what the ballot forces on you, No cannot distinguish
 * disliking this candidate from wanting a choice at all, and a reader who
 * simply wants somebody else has no way to say it. "Someone else" is the
 * only honest sentiment measure an uncontested race has.
 *
 * Context-restricted at the write path, not just hidden in the UI: offered
 * on a contested race the answer would mean something different, and mixing
 * the two meanings into one bucket is the sort of quiet corruption the
 * incumbent/challenger split exists to prevent. `getSingleCandidateTargetIds()`
 * derives the permitted set from the committed ballot data, so a contest
 * stops qualifying the moment a second candidate files.
 */
/**
 * The five-point funding scale (2026-08-15, the author's design).
 *
 * "Would you vote for someone whose campaign is funded this way?" asked the
 * reader to convert a feeling about money into a voting intention, which is
 * two questions wearing one button row. The funding surfaces now ask the
 * question they are actually about — *how do you feel about how this campaign
 * is funded* — on a five-point scale with an explicit way to say the honest
 * fifth answer, which on a funding display is very often the true one.
 *
 * These five are accepted on FUNDING targets and refused everywhere else, the
 * same way `SOMEONE_ELSE` is refused outside a one-candidate contest. Votes
 * and candidates keep yes/no/unsure.
 */
export type ReactionValue =
  | "YES"
  | "NO"
  | "UNSURE"
  | "SOMEONE_ELSE"
  | "LOVE"
  | "LIKE"
  | "DISLIKE"
  | "HATE"
  | "DONT_CARE";
export const REACTION_VALUES: ReactionValue[] = [
  "YES",
  "NO",
  "UNSURE",
  "SOMEONE_ELSE",
  "LOVE",
  "LIKE",
  "DISLIKE",
  "HATE",
  "DONT_CARE",
];

/**
 * **Scale versions — the data-honesty mechanic** (2026-08-15).
 *
 * A reaction row means nothing without the instrument that produced it. The
 * funding surfaces asked a yes/no/unsure question until 2026-08-15 and ask a
 * five-point question after it: those are **different instruments**, and rows
 * from the two are not comparable in any direction. Averaging them, summing
 * them, or reporting them under one denominator would be a fabricated trend —
 * the numbers would move because the question changed and nothing else.
 *
 * So every row carries the version of the scale it was collected on, the
 * aggregator groups by it, and the break is dated below where a buyer reading
 * an export can find it. Nothing migrates: v1 funding rows stay exactly what
 * they were, answers to a question we no longer ask.
 */
export type ScaleVersion = 1 | 2;

export interface ReactionScale {
  version: ScaleVersion;
  /** The values this scale admits, in the order a surface offers them. */
  values: ReactionValue[];
  /** What this instrument asks, for the record that travels with an export. */
  question: string;
}

export const SCALE_V1: ReactionScale = {
  version: 1,
  values: ["YES", "NO", "UNSURE", "SOMEONE_ELSE"],
  question: "Would you vote for someone who holds this position?",
};

export const SCALE_V2_FUNDING: ReactionScale = {
  version: 2,
  values: ["LOVE", "LIKE", "DISLIKE", "HATE", "DONT_CARE"],
  question: "How do you feel about how this campaign is funded?",
};

/**
 * When the funding instrument changed, and from what to what.
 *
 * Recorded here rather than in a comment because it has to travel: an export
 * carrying both v1 and v2 funding rows must be able to say why they are in
 * separate columns, and "the question changed on this date" is the only
 * answer that makes the two honest side by side.
 */
export const SCALE_BREAKS: Array<{
  targetTypes: string[];
  date: string;
  from: ScaleVersion;
  to: ScaleVersion;
  why: string;
}> = [
  {
    targetTypes: ["FUNDING_TOTAL_REACTION", "CONTRIBUTOR_REACTION"],
    date: "2026-08-15",
    from: 1,
    to: 2,
    why: "The funding question changed from a voting-intention yes/no/unsure to a five-point feeling about the funding itself. Rows either side are different instruments and are never combined.",
  },
];

/** The scale a target type is collected on TODAY. Server-decided, never sent. */
export function scaleForTargetType(targetType: ReactionTargetType): ReactionScale {
  return FUNDING_REACTION_TYPES.includes(targetType) ? SCALE_V2_FUNDING : SCALE_V1;
}

/**
 * **The question a target type actually asks** (item 5, 2026-08-16).
 *
 * The scale and the question are not the same thing, and this session is
 * where they came apart. The two funding controls share the five-point scale
 * — same values, same version, genuinely one instrument's answer set — but
 * they now ask about two different civic objects: the totals ("how this
 * campaign is funded") and the contributions table ("these contributions").
 * They asked WORD FOR WORD the same thing until today, which read to a reader
 * as a nag and produced an annoyed second answer.
 *
 * `scale.question` would have labelled the contributions tally with the
 * totals' wording. An export whose question line does not match the question
 * asked is a false claim about how the number was collected, and the buyer
 * has no way to catch it. So the label is per TARGET TYPE.
 *
 * **The buckets do not change.** They never did: `aggregateReactions` has
 * always keyed on `targetType` alongside `targetId`, `ocdId` and the scale
 * version, and the store's unique index carries `targetType` too. This
 * corrects a LABEL, and it is the correction the reworded prompt requires.
 */
const QUESTION_BY_TYPE: Partial<Record<ReactionTargetType, string>> = {
  FUNDING_TOTAL_REACTION: "How do you feel about how this campaign is funded?",
  CONTRIBUTOR_REACTION: "How do you feel about these contributions?",
};

export function questionForTargetType(targetType: ReactionTargetType): string {
  return QUESTION_BY_TYPE[targetType] ?? scaleForTargetType(targetType).question;
}

/**
 * **The contributions prompt was reworded inside v2** (2026-08-16), and that
 * is recorded here rather than smoothed over.
 *
 * It is NOT a scale break: the value set, the version and the meaning of each
 * answer are unchanged, so the rows remain comparable in a way a scale break's
 * rows never are. What changed is which object the reader was looking at when
 * they answered — and until this date the contributions control asked the
 * totals' sentence, so a handful of v2 CONTRIBUTOR_REACTION rows written
 * before it were answering that wording on the contributions display.
 *
 * A version bump would be the heavier, cleaner instrument, and it changes how
 * reactions are bucketed and exported — CLAUDE.md's ask-before list. Recorded
 * for the author's ruling instead of taken unattended.
 */
export const QUESTION_REWORDINGS: Array<{
  targetType: ReactionTargetType;
  date: string;
  from: string;
  to: string;
  why: string;
}> = [
  {
    targetType: "CONTRIBUTOR_REACTION",
    date: "2026-08-16",
    from: "How do you feel about how this campaign is funded?",
    to: "How do you feel about these contributions?",
    why: "The two funding controls asked the same sentence about two different objects — the totals and the named contributions — which read as a repeat and collected an annoyed second answer. Same scale, same values, same version; the object being asked about is now named.",
  },
];

/** The values a scale admits, for a lookup that reads as a lookup. */
export function valuesForScaleVersion(version: ScaleVersion): ReactionValue[] {
  return version === 2 ? SCALE_V2_FUNDING.values : SCALE_V1.values;
}

/**
 * Values whose meaning depends on their context, and the context they
 * require. A value listed here is refused wherever that context does not
 * hold — the server-side validity table each value ships with.
 *
 * `SINGLE_CANDIDATE_CONTEST` — "Someone else" only means what it says in a
 * race with one candidate.
 * `FUNDING_TARGET` — the five-point scale is a question about money, and the
 * same word means something different asked about a person.
 */
export type ValueContext = "SINGLE_CANDIDATE_CONTEST" | "FUNDING_TARGET";

export const CONTEXT_RESTRICTED_VALUES: Readonly<
  Partial<Record<ReactionValue, ValueContext>>
> = {
  SOMEONE_ELSE: "SINGLE_CANDIDATE_CONTEST",
  LOVE: "FUNDING_TARGET",
  LIKE: "FUNDING_TARGET",
  DISLIKE: "FUNDING_TARGET",
  HATE: "FUNDING_TARGET",
  DONT_CARE: "FUNDING_TARGET",
};

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
 * Is this answer on the scale this target is collected on?
 *
 * The stricter half of the validity table, and it runs in BOTH directions: a
 * five-point answer is refused on a vote, and yes/no/unsure is refused on a
 * funding target. The second direction is what makes the scale break clean —
 * without it a stale client would keep writing v1 rows into a v2 column and
 * the two instruments would silently blend, which is the exact thing the
 * versioning exists to prevent.
 */
export function isValueOnScaleFor(
  targetType: ReactionTargetType,
  value: ReactionValue,
): boolean {
  return scaleForTargetType(targetType).values.includes(value);
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
