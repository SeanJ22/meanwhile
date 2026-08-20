/**
 * THE COVERAGE TIER (RULING 6, Prompt B item 6, 2026-08-20).
 *
 * Until now this product reported coverage against its own registry — how
 * many of the bodies we already knew about were filled in. That number always
 * looked good and meant nothing, because a registry that defines its own
 * denominator cannot be caught missing anything. The coverage tier replaces it
 * with a stated position on a ladder whose rungs are defined OUTSIDE us.
 *
 * NAMING, because this repo already uses the word. `lib/ocd/tiers.ts` has a
 * `tier` meaning the OCD LEVEL axis — federal, state, local. That is a
 * different thing entirely and the two must never be confused, so everything
 * here says COVERAGE tier, in full, in every identifier and every column name.
 *
 * THE FOUR TIERS, in RULING 6's vocabulary verbatim:
 *
 *   TIER_0  roster only        The government appears in the Census or NCES
 *                              universe. Nothing else is known.
 *   TIER_1  territory resolved The government is confirmed to govern this zip.
 *   TIER_2  bodies enumerated  The governing bodies inside that government are
 *                              known — councils, boards, commissions — not
 *                              merely the government itself.
 *   TIER_3  Kelly depth        Every official and candidate carries photo,
 *                              phone, working contact, a specific verified
 *                              page, and a campaign site.
 *
 * RULING 9 IS THE HINGE BETWEEN 1 AND 2. Census counts GOVERNMENTS; this
 * product renders BODIES. Tucson is one row in the Census file and holds a
 * dozen governing bodies. So Census and NCES can establish Tier 0 and Tier 1
 * and can NEVER establish Tier 2 — no amount of boundary geometry tells you
 * that a city has a council, a planning commission and a board of adjustment.
 * `promote()` below enforces exactly that: a Tier 2 claim requires enumerated
 * bodies as evidence and refuses geometry as a substitute.
 *
 * THE TIER IS STORED AND STAMPED, NEVER INFERRED AT READ TIME. A tier
 * computed from "what happens to be present when someone asks" drifts
 * silently every time a fetch fails: a bad afternoon at one vendor would
 * demote a zip, and a lucky cache would promote one. Stamped, a tier is a
 * claim somebody made on a date, and a later session can be held to it.
 *
 * RULING 6, LAST CLAUSE: **a tier may never be raised by a session that did
 * not do the work that raises it.** `promote()` takes EVIDENCE, not a tier,
 * and computes the tier from it. There is no setter.
 */

export const COVERAGE_TIERS = ["TIER_0", "TIER_1", "TIER_2", "TIER_3"] as const;
export type CoverageTier = (typeof COVERAGE_TIERS)[number];

/**
 * What an aggregate record carries when the tier at the time of writing is not
 * recoverable. It is NOT a fifth tier and it is never ordered against the
 * four — it is the absence of a tier, named, per the render-default rule.
 */
export const COVERAGE_TIER_UNKNOWN = "UNKNOWN" as const;
export type CoverageTierOrUnknown = CoverageTier | typeof COVERAGE_TIER_UNKNOWN;

/** Reader-facing wording, item 7.1. Plain language; never "Tier 1". */
export const COVERAGE_TIER_READER_LABEL: Record<CoverageTier, string> = {
  TIER_0: "We know this government exists. We have not confirmed what it covers.",
  TIER_1: "We have confirmed which governments cover this area.",
  TIER_2: "We have the councils, boards and commissions inside those governments.",
  TIER_3: "We have the people too — who they are, and how to reach them.",
};

/**
 * A one-line summary for a zip surface. Deliberately about US and what WE
 * have done, never about the place: "we have not confirmed" is a fact about
 * our research, and "this town has nothing" would be a fact about the town.
 */
export const COVERAGE_TIER_ZIP_HEADLINE: Record<CoverageTier, string> = {
  TIER_0: "We are still working out which governments cover this ZIP code.",
  TIER_1: "We know which governments cover this ZIP code. We are still finding their boards and councils.",
  TIER_2: "We have the governments here and the boards and councils inside them. We are still filling in the people.",
  TIER_3: "We have the governments here, their boards and councils, and the people who sit on them.",
};

/** What specifically stands between a tier and the next one. Item 11.3. */
export const COVERAGE_TIER_NEXT_STEP: Record<CoverageTier, string> = {
  TIER_0: "Resolve which governments' territory contains this ZIP code.",
  TIER_1: "Enumerate the governing bodies inside each resolved government.",
  TIER_2: "Fill in every official and candidate on those bodies to Kelly depth.",
  TIER_3: "Nothing. This is the top of the ladder.",
};

export const COVERAGE_TIER_RANK: Record<CoverageTier, number> = {
  TIER_0: 0,
  TIER_1: 1,
  TIER_2: 2,
  TIER_3: 3,
};

/* -------------------------------------------------------------------------- */
/* Promotion                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The evidence a promotion is computed FROM. Every field is a count of
 * something checkable, so a claimed tier can always be re-derived and a
 * disagreement is a bug rather than an opinion.
 */
export interface CoverageEvidence {
  /** Governments in the Census/NCES universe touching this zip. */
  universeGovernments: number;
  /** Of those, confirmed by territory to govern this zip. */
  territoryResolved: number;
  /**
   * Of the territory-resolved governments, how many have their BODIES
   * enumerated — councils, boards, commissions. RULING 9: this can never be
   * derived from a government count, and nothing in this module will do so.
   */
  bodiesEnumeratedFor: number;
  /** Officials and candidates on those bodies, and how many are Kelly-complete. */
  people: number;
  peopleAtKellyDepth: number;
}

/**
 * The promotion rules, checkable (item 6.2).
 *
 * Each rung is ALL-OR-NOTHING against its own denominator. A zip where nine of
 * ten governments are territory-resolved is not Tier 1: the tenth is exactly
 * the government a reader might live under, and a tier that rounds up is a
 * coverage claim that flatters itself — the thing this whole model replaces.
 */
export function promote(evidence: CoverageEvidence): CoverageTier {
  const {
    universeGovernments,
    territoryResolved,
    bodiesEnumeratedFor,
    people,
    peopleAtKellyDepth,
  } = evidence;

  // Nothing in the universe means nothing has been established at all. This is
  // Tier 0 rather than an error: a zip we have not looked up yet is honestly
  // described by "we know governments exist; we have not confirmed what covers
  // this."
  if (universeGovernments <= 0) return "TIER_0";
  if (territoryResolved < universeGovernments) return "TIER_0";
  if (bodiesEnumeratedFor < territoryResolved) return "TIER_1";
  // Tier 3 requires PEOPLE, and zero people is not "all of them are complete".
  // An empty set trivially satisfies "every element has property P", which is
  // exactly how a vacuous truth becomes a false coverage claim.
  if (people <= 0 || peopleAtKellyDepth < people) return "TIER_2";
  return "TIER_3";
}

/**
 * Does the stamped tier exceed what the evidence supports? (item 6.5)
 *
 * Asymmetric on purpose. A stamped tier BELOW the evidence is fine — it means
 * work was done and the stamp has not caught up, which is the safe direction.
 * A stamped tier ABOVE the evidence is a false coverage claim, and that is the
 * only thing this returns true for.
 */
export function tierExceedsEvidence(
  stamped: CoverageTier,
  evidence: CoverageEvidence,
): boolean {
  return COVERAGE_TIER_RANK[stamped] > COVERAGE_TIER_RANK[promote(evidence)];
}

export function isCoverageTier(v: unknown): v is CoverageTier {
  return typeof v === "string" && (COVERAGE_TIERS as readonly string[]).includes(v);
}

export function isCoverageTierOrUnknown(v: unknown): v is CoverageTierOrUnknown {
  return isCoverageTier(v) || v === COVERAGE_TIER_UNKNOWN;
}

/* -------------------------------------------------------------------------- */
/* The stamped record                                                         */
/* -------------------------------------------------------------------------- */

/**
 * A stamped tier. `stampedAt` is a wall-clock date from `corepack pnpm stamp`
 * (America/Phoenix) — an agent does not know today's date, and a stamp is the
 * whole reason this is a claim rather than a guess.
 */
export interface StampedCoverageTier {
  tier: CoverageTier;
  stampedAt: string;
  evidence: CoverageEvidence;
}

/**
 * RULING 7 — the equal-depth gate, in one place rather than per surface
 * (item 7.3).
 *
 * No candidate cards ship in a contest until EVERY candidate in that contest
 * can ship at equal depth. This is not a display preference. The app can say
 * nothing about anyone and still tilt a race, because a thin card tracks
 * incumbency and campaign professionalism rather than merit — the tester's
 * finding, in her words: "Karen might be the perfect fit for me, but she has
 * no information here. So I'm only going to look at the folks that do."
 *
 * Returned as a decision with a REASON, so a surface that hides cards can say
 * why rather than rendering an unexplained blank.
 */
export interface CandidateDepth {
  candidateId: string;
  hasPhoto: boolean;
  hasBlurb: boolean;
  hasContact: boolean;
  hasCampaignSite: boolean;
}

export type EqualDepthDecision =
  | { render: true; depth: number }
  | { render: false; reason: string; shallowest: number; deepest: number };

/** How many of the four depth fields a candidate carries. */
export function depthOf(c: CandidateDepth): number {
  return [c.hasPhoto, c.hasBlurb, c.hasContact, c.hasCampaignSite].filter(Boolean).length;
}

export function equalDepthGate(candidates: CandidateDepth[]): EqualDepthDecision {
  // A contest with no candidates has nothing to render and nothing to skew.
  if (candidates.length === 0) return { render: true, depth: 0 };

  const depths = candidates.map(depthOf);
  const shallowest = Math.min(...depths);
  const deepest = Math.max(...depths);

  if (shallowest === deepest) return { render: true, depth: deepest };

  return {
    render: false,
    shallowest,
    deepest,
    reason:
      "Candidates in this contest are not researched to the same depth yet, so no " +
      "cards are shown. Showing the ones we know most about would put a thumb on " +
      "the scale for whoever has the most professional campaign.",
  };
}
