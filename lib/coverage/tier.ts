/**
 * The coverage tier: a stamped position on a ladder defined outside us. Not
 * the OCD level `tier` in lib/ocd/tiers.ts.
 *
 *   TIER_0  roster only        In the Census or NCES universe; nothing else known.
 *   TIER_1  territory resolved Confirmed to govern this zip.
 *   TIER_2  bodies enumerated  Its councils, boards and commissions are known
 *                              (never derivable from geometry or government counts).
 *   TIER_3  Kelly depth        Every official and candidate has photo, phone,
 *                              working contact, a verified page and a campaign site.
 *
 * Tiers are stored and stamped, never inferred at read time. promote() takes
 * evidence and computes the tier; there is no setter.
 */

export const COVERAGE_TIERS = ["TIER_0", "TIER_1", "TIER_2", "TIER_3"] as const;
export type CoverageTier = (typeof COVERAGE_TIERS)[number];

/** The absence of a tier, not a fifth tier; never ordered against the four. */
export const COVERAGE_TIER_UNKNOWN = "UNKNOWN" as const;
export type CoverageTierOrUnknown = CoverageTier | typeof COVERAGE_TIER_UNKNOWN;

/** Reader-facing wording; never "Tier 1". */
export const COVERAGE_TIER_READER_LABEL: Record<CoverageTier, string> = {
  TIER_0: "We know this government exists. We have not confirmed what it covers.",
  TIER_1: "We have confirmed which governments cover this area.",
  TIER_2: "We have the councils, boards and commissions inside those governments.",
  TIER_3: "We have the people too — who they are, and how to reach them.",
};

/** Always about our research, never a claim about the place. */
export const COVERAGE_TIER_ZIP_HEADLINE: Record<CoverageTier, string> = {
  TIER_0:
    "We have some of the governments that cover this ZIP code, and we are still working out the rest.",
  TIER_1: "We know which governments cover this ZIP code. We are still finding their boards and councils.",
  TIER_2: "We have the governments here and the boards and councils inside them. We are still filling in the people.",
  TIER_3: "We have the governments here, their boards and councils, and the people who sit on them.",
};

/** What stands between a tier and the next one. */
export const COVERAGE_TIER_NEXT_STEP: Record<CoverageTier, string> = {
  TIER_0: "Work out which of the remaining governments reach this ZIP code.",
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


/** Every field is a checkable count, so a stamped tier can always be re-derived. */
export interface CoverageEvidence {
  /** Governments in the Census/NCES universe touching this zip. */
  universeGovernments: number;
  /** Of those, confirmed by territory to govern this zip. */
  territoryResolved: number;
  /** Of the territory-resolved governments, how many have their bodies enumerated. */
  bodiesEnumeratedFor: number;
  /** Officials and candidates on those bodies, and how many are Kelly-complete. */
  people: number;
  peopleAtKellyDepth: number;
}

/** Each rung is all-or-nothing against its own denominator. */
export function promote(evidence: CoverageEvidence): CoverageTier {
  const {
    universeGovernments,
    territoryResolved,
    bodiesEnumeratedFor,
    people,
    peopleAtKellyDepth,
  } = evidence;

  if (universeGovernments <= 0) return "TIER_0";
  if (territoryResolved < universeGovernments) return "TIER_0";
  if (bodiesEnumeratedFor < territoryResolved) return "TIER_1";
  // Zero people is not "all complete".
  if (people <= 0 || peopleAtKellyDepth < people) return "TIER_2";
  return "TIER_3";
}

/** True only when the stamp is above the evidence; a stamp below it is the safe direction. */
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


/** `stampedAt` is a wall-clock date (America/Phoenix) from `corepack pnpm stamp`. */
export interface StampedCoverageTier {
  tier: CoverageTier;
  stampedAt: string;
  evidence: CoverageEvidence;
}
