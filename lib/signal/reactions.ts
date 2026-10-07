/**
 * Reaction domain types and validation, shared by the client control, the API route and the
 * aggregation layer. No Node imports: the client bundles this file.
 * - A reaction attaches to a specific record, never to a person as a whole.
 * - The store is identifier-free; the only continuity is a random browser-local key, stored hashed.
 * - Every row is tier-stamped.
 */

/**
 * Reaction target classes.
 * - CANDIDATE: "Would you vote for them?", reader expression only, never an input to any ordering,
 *   ranking or recommendation.
 * - FUNDING_TOTAL_REACTION and CONTRIBUTOR_REACTION: reactions to the committee-totals and contributor
 *   displays, keyed by FEC candidate id. They count in aggregates like every other reaction; the filing
 *   records they react to never do.
 * - MEASURE_PROVISION: a measure is decomposed into contested provisions and the reaction attaches to a
 *   provision (`<contestId>#<slug>`, lib/ballot/measure-provisions.ts), never to the measure as a
 *   whole. All five provision kinds collect.
 */
export type ReactionTargetType =
  | "FEDERAL_VOTE"
  | "CANDIDATE"
  | "FUNDING_TOTAL_REACTION"
  | "CONTRIBUTOR_REACTION"
  | "MEASURE_PROVISION";
export const REACTION_TARGET_TYPES: ReactionTargetType[] = [
  "FEDERAL_VOTE",
  "CANDIDATE",
  "FUNDING_TOTAL_REACTION",
  "CONTRIBUTOR_REACTION",
  "MEASURE_PROVISION",
];

/** The funding reaction classes — the filter a ripcord pull applies. */
export const FUNDING_REACTION_TYPES: ReactionTargetType[] = [
  "FUNDING_TOTAL_REACTION",
  "CONTRIBUTOR_REACTION",
];

/**
 * Reaction values.
 * - SOMEONE_ELSE is accepted only on a candidate in a contest with exactly one candidate, enforced at
 *   the write path (`getSingleCandidateTargetIds()` derives the set from the promoted ballot data).
 * - The five-point funding scale is accepted on funding targets and refused everywhere else. Votes and
 *   candidates keep yes/no/unsure.
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
 * Scale versions. A reaction row means nothing without the instrument that produced it; rows from
 * different instruments are not comparable in any direction. Every row carries its scale version, the
 * aggregator groups by it, and the break is dated in `SCALE_BREAKS`. Nothing migrates.
 */
export type ScaleVersion = 1 | 2 | 3;

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
 * The contributions instrument, v3: same values as v2 with different wording, versioned separately so
 * its rows never pool with answers to the older wording. The wording lives on the scale.
 */
export const SCALE_V3_CONTRIBUTIONS: ReactionScale = {
  version: 3,
  values: ["LOVE", "LIKE", "DISLIKE", "HATE", "DONT_CARE"],
  question: "How do you feel about these contributions?",
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
  {
    targetTypes: ["CONTRIBUTOR_REACTION"],
    date: "2026-08-16",
    from: 2,
    to: 3,
    why: "Until this date the contributions control asked 'how do you feel about how this campaign is funded' while sitting over a table of named contributors, so an answer could be about the campaign's finances or about the donors on screen and the row does not say which. The current wording asks about the contributions only. Same five values; two populations, never pooled.",
  },
];

/**
 * The scale a target type is collected on TODAY. Server-decided, never sent.
 *
 * Order matters: the contributions table is a funding type, so its own
 * version has to be checked before the general funding one.
 */
export function scaleForTargetType(targetType: ReactionTargetType): ReactionScale {
  if (targetType === "CONTRIBUTOR_REACTION") return SCALE_V3_CONTRIBUTIONS;
  return FUNDING_REACTION_TYPES.includes(targetType) ? SCALE_V2_FUNDING : SCALE_V1;
}

/**
 * The question a target type actually asks, per target type (the scale and the question are not the
 * same thing). Kept, currently empty, because the divergence it guards against is cheap to re-open.
 */
const QUESTION_BY_TYPE: Partial<Record<ReactionTargetType, string>> = {
  /** The provision question: it asks about the part, never how to vote on the measure. */
  MEASURE_PROVISION: "Do you like this part?",
};

export function questionForTargetType(targetType: ReactionTargetType): string {
  return QUESTION_BY_TYPE[targetType] ?? scaleForTargetType(targetType).question;
}

/**
 * What the funding controls asked before the v1 → v2 break. No live surface asks it; the rows that
 * answered it are permanent.
 */
export const RETIRED_V1_FUNDING_QUESTION =
  "Would you vote for someone whose campaign is funded this way?";

/**
 * The question a stored row was asked, by its target type and stamped scale version, so an older row is
 * never labelled with today's wording.
 */
export function questionForRow(
  targetType: ReactionTargetType,
  version: ScaleVersion,
): string {
  if (version === scaleForTargetType(targetType).version) {
    return questionForTargetType(targetType);
  }
  if (version === 3) return SCALE_V3_CONTRIBUTIONS.question;
  if (version === 2) return SCALE_V2_FUNDING.question;
  // v1 means two different questions depending on what was being asked
  // about: a funding target asked the retired funding sentence, everything
  // else asked — and still asks — about the position.
  return FUNDING_REACTION_TYPES.includes(targetType)
    ? RETIRED_V1_FUNDING_QUESTION
    : SCALE_V1.question;
}

/**
 * The wording that older contributions rows were actually answering, recorded beside the v2 → v3
 * break in `SCALE_BREAKS`.
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
  if (version === 2) return SCALE_V2_FUNDING.values;
  if (version === 3) return SCALE_V3_CONTRIBUTIONS.values;
  return SCALE_V1.values;
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

// ── The optional verbatim ──────────────────────────────────────────────
// Each reaction has a one-tap binary and an optional free-text field; the text is never required.
// Everything here is validation: a malformed payload is refused.

/**
 * The length cap. Long enough for a paragraph of real opinion, short enough
 * that the field is not a document upload — the point is colour beside a
 * binary, not a submission.
 */
export const FREE_TEXT_MAX_CHARS = 1000;

/** The threat notice, adjacent to the field. Says "may", not "will". Pinned in tests/reactions.test.ts. */
export const FREE_TEXT_THREAT_NOTICE =
  "Threats of violence are removed and may be reported to law enforcement.";

/** What the field asks for. Optional, and it says so. */
export const FREE_TEXT_PROMPT = "Anything you want to add? (optional)";

/**
 * Is this a storable verbatim?
 *
 * `undefined` and `null` are VALID — the field is optional and its absence
 * is the ordinary case. A present value must be a string within the cap.
 * Whitespace-only is treated as absent rather than refused: a reader who
 * tabs through the box has not written anything, and refusing their binary
 * over it would be friction with nothing behind it.
 */
export function isValidFreeText(value: unknown): value is string | null | undefined {
  if (value === undefined || value === null) return true;
  if (typeof value !== "string") return false;
  return value.length <= FREE_TEXT_MAX_CHARS;
}

/**
 * The value to store: trimmed, or null when there is nothing there.
 *
 * Call only after `isValidFreeText`. Returning null for whitespace keeps the
 * column honest — an empty string in a text column reads, to anyone counting
 * later, as a reader who submitted a blank comment on purpose.
 */
export function normalizeFreeText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

