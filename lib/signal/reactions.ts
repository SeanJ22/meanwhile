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
 * the ballot card and the official popup lands on the same committee. Rows
 * of these two types count in aggregates and exports like every other
 * reaction; the filing records they react to never do (Sean, 2026-10-01 —
 * see lib/signal/aggregate.ts).
 */
/**
 * MEASURE_PROVISION (P03, 2026-08-18) is the class CLAUDE.md's reaction
 * section describes first and which shipped last: **a measure is decomposed
 * into contested provisions and the reaction attaches to a PROVISION, never
 * to the measure as a whole.** The target id is the provision's own
 * `<contestId>#<slug>` key from lib/ballot/measure-provisions.ts, which was
 * built in that shape for exactly this and has been sitting unused since.
 *
 * All five provision kinds collect — FUNDING, PROGRAM, OVERSIGHT, SUNSET and
 * START. There is no kind that is asked about and no kind that is not: a
 * sensor that skipped a kind would report a measure's parts as more or less
 * contested than the reader found them.
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
 * derives the permitted set from the canonical promoted ballot data, so a contest
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
 * The contributions instrument — **v3, the author's ruling (g3 item 7,
 * 2026-08-16).**
 *
 * The values are identical to v2's and the wording changed by one clause, so
 * the previous session filed the change as a REWORDING and explicitly not as
 * a scale break. The author overruled that, and the ruling is the
 * conservative one: **the contributions prompt gets its own version so its
 * rows never pool with answers to the older wording.**
 *
 * The reason it matters more than the size of the edit suggests: until
 * 2026-08-16 this control asked "how do you feel about how this campaign is
 * FUNDED" while sitting over a table of named contributors. Some readers
 * answered about the campaign's finances and some about the donors in front
 * of them, and there is no way to tell which from the row. Pooling those with
 * answers to the current, unambiguous question would put two populations
 * under one denominator — and the export layer, which groups by version,
 * cannot catch what the registry says is one instrument.
 *
 * The wording lives on the scale, per the ruling: the version and the
 * question a buyer is told the number answers are now the same object.
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
 *
 * **g3 item 7 (2026-08-16) closed the gap the note above describes.** The two
 * funding controls are no longer one instrument: the contributions table
 * collects on `SCALE_V3_CONTRIBUTIONS`, whose question IS its wording, so the
 * version and the question a buyer is told the number answers can no longer
 * disagree. This override map is kept — empty — because the divergence it
 * guards against is real and cheap to re-open, and because deleting it would
 * take the reasoning with it.
 */
const QUESTION_BY_TYPE: Partial<Record<ReactionTargetType, string>> = {
  /**
   * The provision question (P03, 2026-08-18). It shares the v1 scale with
   * votes and candidates — the answer set is genuinely the same three — but
   * it asks about a different civic object, so it gets its own wording here
   * rather than inheriting "Do you like this vote?".
   *
   * It asks about the PART, not the ballot: this is a sensor, and the
   * product never tells anyone how to vote. "Would you vote yes on this
   * proposition" is a recommendation surface wearing a question mark.
   */
  MEASURE_PROVISION: "Do you like this part?",
};

export function questionForTargetType(targetType: ReactionTargetType): string {
  return QUESTION_BY_TYPE[targetType] ?? scaleForTargetType(targetType).question;
}

/**
 * What the funding controls asked BEFORE the 2026-08-15 break.
 *
 * Named rather than inlined because it is the only wording in the system with
 * no live surface behind it: nothing asks it today, and the rows that answered
 * it are permanent. A retired question that lives as a string literal in the
 * aggregator is a fact about the data with nowhere to be read.
 */
export const RETIRED_V1_FUNDING_QUESTION =
  "Would you vote for someone whose campaign is funded this way?";

/**
 * **The question a STORED ROW was asked** — by its target type and the scale
 * version stamped on it (g3 item 7, 2026-08-16).
 *
 * `questionForTargetType` answers for the instrument in use TODAY. A row
 * written months ago answered whatever was on screen then, and labelling it
 * with today's wording is how a scale break disappears — the export would
 * carry two populations under one sentence and the buyer could not tell.
 *
 * The aggregator used to hold one hardcoded fallback for "not the live
 * version", which was right while there was exactly one older version and
 * became wrong the moment a second target type moved to v3: a v2
 * CONTRIBUTOR_REACTION row would have been labelled with the v1 wording,
 * skipping a version. The lookup is by version now, so it stays right as
 * versions accumulate.
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
 * **The contributions prompt's rewording — the history behind the v3 break.**
 *
 * Recorded on 2026-08-16 as a rewording INSIDE v2, with the version bump left
 * for the author because bucketing and export are on `CLAUDE.md`'s ask-before
 * list. **He ruled the same day: bump it** (g3 item 7). So the change is now
 * filed in `SCALE_BREAKS` as v2 → v3, and this entry stays as the record of
 * what the older rows were actually answering.
 *
 * That is the useful half of it. A break says "these two sets are not
 * comparable"; only this says WHY, in the words that were on the screen. A
 * buyer holding pre-break `CONTRIBUTOR_REACTION` rows can read here that they
 * answered the totals' sentence while looking at a contributions table, which
 * is the fact that makes them uninterpretable — not the version number.
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


/* ── The optional verbatim (P03, 2026-08-18) ─────────────────────────────
 *
 * "Each reaction has a one-tap binary and an optional free-text field.
 * Binary carries volume; text carries color. Never require the text."
 * — CLAUDE.md, reaction capture.
 *
 * Unblocked by the author 2026-08-18, and captured without a switch since
 * October 1, 2026 (Sean: everything typed is captured).
 *
 * Everything here is validation: a malformed payload is refused.
 */

/**
 * The length cap. Long enough for a paragraph of real opinion, short enough
 * that the field is not a document upload — the point is colour beside a
 * binary, not a submission.
 */
export const FREE_TEXT_MAX_CHARS = 1000;

/**
 * **The threat notice, adjacent to the field** — CLAUDE.md requires it, and
 * requires the word "may" rather than "will": a stated commitment that is not
 * honoured on every instance is worse than a reserved right.
 *
 * Pinned in tests/reactions.test.ts so a reword cannot quietly turn the
 * reserved right into a promise. Level register — this is a claim surface,
 * about a real consequence for a real person.
 */
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

