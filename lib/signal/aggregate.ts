import { VERIFICATION_TIERS, questionForRow, valuesForScaleVersion, type ReactionTargetType, type ReactionValue, type ScaleVersion, type VerificationTier } from "./reactions.ts";

/**
 * The aggregation contract: reactions in, per-division tier-split tallies out, with n stated at every
 * level.
 * - Tallies are per verification tier, never blended; every tier appears in every tally, zeros included.
 * - n is stated, always.
 * - No identity in, none out: output carries division ids and counts only.
 * - Scales are never mixed: a tally is per (target, division, scale version), and breaks are dated in
 *   `SCALE_BREAKS`.
 */

/** The slice of a stored reaction row the aggregator reads. */
export interface ReactionRowForAggregation {
  targetType: ReactionTargetType;
  targetId: string;
  reaction: ReactionValue;
  /** Which instrument produced this row. Absent means 1, matching the column default. */
  scaleVersion?: ScaleVersion;
  ocdIds: string[];
  verificationTier: VerificationTier;
  /**
   * Quarantine mark: non-null means the row tripped an intake limit and is excluded from every aggregate
   * unconditionally.
   */
  suspectReason?: string | null;
  /**
   * Whose traffic this row is. `ORGANIC` is the only class an aggregate may count; absent is treated as
   * `UNKNOWN` and excluded.
   */
  runClass?: string | null;
}

/**
 * Answer counts for ONE scale. Every value of that scale is present with a
 * zero and no value of any other scale appears — a buyer must be able to
 * tell "nobody chose this" from "this column did not exist when the data was
 * collected", and a column that appears only sometimes cannot be told apart
 * from a missing one.
 */
export type AnswerCounts = Partial<Record<ReactionValue, number>>;

export interface TierTally extends AnswerCounts {
  YES?: number;
  NO?: number;
  UNSURE?: number;
  /**
   * The uncontested-race answer, present on every tally with a zero. Structurally zero outside a
   * one-candidate contest (the write path refuses it), so a non-zero count on a contested race is a bug.
   */
  SOMEONE_ELSE?: number;
  /** Rows in this tier — always the sum of the answer counts. */
  n: number;
}

export interface DivisionTally {
  targetType: ReactionTargetType;
  targetId: string;
  /** The division this tally is for. */
  ocdId: string;
  /** The instrument these counts were collected on. Never blended. */
  scaleVersion: ScaleVersion;
  /** What that instrument asked, in the words the reader saw. */
  question: string;
  /** Every tier in the enum, zeros included — the confidence mix, visible. */
  tiers: Record<VerificationTier, TierTally>;
  /** Rows contributing to this division, across all tiers. */
  n: number;
}

function emptyTiers(version: ScaleVersion): Record<VerificationTier, TierTally> {
  return Object.fromEntries(
    VERIFICATION_TIERS.map((tier) => [
      tier,
      {
        ...Object.fromEntries(valuesForScaleVersion(version).map((v) => [v, 0])),
        n: 0,
      },
    ]),
  ) as Record<VerificationTier, TierTally>;
}

/**
 * Rows that count: not quarantined, and organic traffic only. Funding reactions count like every other
 * reaction; FEC contributor records themselves are never sold.
 */
export function rowsEligibleForAggregation(
  rows: ReactionRowForAggregation[],
): ReactionRowForAggregation[] {
  // Quarantined rows are out first and unconditionally: stored, never counted, exported or sold.
  const clean = rows
    .filter((row) => row.suspectReason == null)
    // Whose traffic: an allowlist, so a new class is excluded the moment it exists and an absent value is
    // UNKNOWN and out. Unconditional.
    .filter((row) => (row.runClass ?? "UNKNOWN") === "ORGANIC");
  return clean;
}

/**
 * A reaction from a reader looking at six overlapping divisions counts once
 * in each division's tally — that is what an area-level total means. It is
 * never double-counted *within* a division.
 */
export function aggregateReactions(
  rows: ReactionRowForAggregation[],
): DivisionTally[] {
  const byKey = new Map<string, DivisionTally>();

  for (const row of rowsEligibleForAggregation(rows)) {
    // Absent means 1: every row written before the funding scale changed
    // is a v1 row, which is exactly what the column default says.
    const version: ScaleVersion = row.scaleVersion ?? 1;
    for (const ocdId of new Set(row.ocdIds)) {
      const key = `${row.targetType}\u0000${row.targetId}\u0000${ocdId}\u0000v${version}`;
      let tally = byKey.get(key);
      if (!tally) {
        tally = {
          targetType: row.targetType,
          targetId: row.targetId,
          ocdId,
          scaleVersion: version,
          // The question as this row's instrument asked it, by version, so an older tally keeps the wording it
          // was collected under.
          question: questionForRow(row.targetType, version),
          tiers: emptyTiers(version),
          n: 0,
        };
        byKey.set(key, tally);
      }
      const tier = tally.tiers[row.verificationTier];
      // A value off this tally's scale would mean the write path let two
      // instruments into one column. Counted into n either way — an
      // aggregate that quietly drops a row it cannot classify is the empty
      // success this repo keeps catching — but never into a column it does
      // not belong in.
      if (row.reaction in tier) tier[row.reaction] = (tier[row.reaction] ?? 0) + 1;
      tier.n += 1;
      tally.n += 1;
    }
  }

  return [...byKey.values()];
}
