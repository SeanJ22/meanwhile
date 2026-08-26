import { ripcordPulled } from "../ripcords.ts";
import {
  FUNDING_REACTION_TYPES,
  SCALE_BREAKS,
  VERIFICATION_TIERS,
  questionForRow,
  valuesForScaleVersion,
  type ReactionTargetType,
  type ReactionValue,
  type ScaleVersion,
  type VerificationTier,
} from "./reactions.ts";

/**
 * The aggregation contract — the function the data business sells, born
 * tested (tests/reactions.test.ts) even while only test data flows.
 *
 * Reactions in, per-division tier-split tallies out, with n stated at every
 * level. The rules it must never break:
 *
 * - **Tallies are per verification tier, never blended.** CLAUDE.md: every
 *   export reports its confidence mix; a single blended number is the
 *   forbidden shape. Every tier in the enum appears in every tally — a tier
 *   with no rows says 0, it does not disappear — so a buyer can see the mix
 *   is all-ANONYMOUS today rather than inferring it.
 * - **n is stated, always.** An aggregate without its denominator is the
 *   count invariant violated at the exact layer it matters most.
 * - **No identity in, none out.** The input rows carry no identifier
 *   (schema-guaranteed); the output carries division ids and counts only.
 * - **Scales are never mixed.** A tally is per (target, division, SCALE
 *   VERSION). The funding question changed from yes/no/unsure to a
 *   five-point scale on 2026-08-15; rows either side are different
 *   instruments, and one denominator over both would report a trend caused
 *   by the question changing and nothing else. The break is dated in
 *   `SCALE_BREAKS` and every tally carries its version, so a buyer holding
 *   two columns can read why there are two.
 */

/** The slice of a stored reaction row the aggregator reads. */
export interface ReactionRowForAggregation {
  targetType: ReactionTargetType;
  targetId: string;
  reaction: ReactionValue;
  /**
   * Which instrument produced this row. Absent means 1 — every row written
   * before the funding scale changed is a v1 row, which is what the column
   * default says in the database too.
   */
  scaleVersion?: ScaleVersion;
  ocdIds: string[];
  verificationTier: VerificationTier;
  /**
   * Quarantine mark (T08) — non-null means the row tripped an intake limit
   * and is excluded from every aggregate unconditionally (no flag governs
   * this: the clean pool is the only pool the business draws from).
   */
  suspectReason?: string | null;
  /**
   * **Whose traffic this row is** (item 0D, 2026-08-19). `ORGANIC` is the
   * only class an aggregate may count.
   *
   * Optional in the TYPE and treated as `UNKNOWN` when absent, which is the
   * conservative reading and the only safe one: a caller that has not been
   * taught to carry the column must not thereby have its rows counted as
   * readers. Absent means excluded, never included.
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
   * The uncontested-race answer (M63). Present on every tally with a zero,
   * the same way every verification tier is present with zeros: a buyer
   * reading a tally must be able to tell "nobody chose this" from "this
   * column did not exist when the data was collected", and a column that
   * appears only sometimes cannot be told apart from a missing one.
   *
   * Structurally zero outside a one-candidate contest — the write path
   * refuses the value there — so a non-zero count on a contested race is
   * evidence of a bug, not of reader sentiment.
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

/** The recorded scale changes, carried with the aggregate that needs them. */
export function scaleBreaksFor(targetType: ReactionTargetType) {
  return SCALE_BREAKS.filter((b) => b.targetTypes.includes(targetType));
}

/**
 * The ripcord filter (D34): while `ripcord.fundingReactionsInAggregates`
 * is pulled, funding reactions are stored but never aggregated, so nothing
 * derived from them can enter an export or a licensed aggregate. The
 * targetType is the provenance tag, which is what makes the pull a filter
 * rather than a hunt.
 *
 * **The flag ships LIVE from 2026-08-15, on the author's ruling** (see
 * lib/ripcords.ts for the ruling verbatim): what is licensed is
 * reader-attention signal — anonymous opinions about a display — and never
 * FEC-derived data. A buyer receives what readers felt, not contributor
 * records. The switch stays in the code as a belt: the machinery, the
 * provenance tag and the filter are unchanged, so a pull is still one flag
 * away and still a filter rather than a migration.
 */
export function rowsEligibleForAggregation(
  rows: ReactionRowForAggregation[],
): ReactionRowForAggregation[] {
  // Quarantined rows (T08) are out FIRST and UNCONDITIONALLY — no ripcord
  // governs this filter. A row that tripped an intake limit is stored (the
  // author reviews; nothing auto-deletes) but never counted, never
  // exported, never sold.
  const clean = rows
    .filter((row) => row.suspectReason == null)
    // WHOSE TRAFFIC (item 0D, 2026-08-19). An ALLOWLIST, exactly as the
    // search log's sold read path is: a class that does not exist yet is
    // excluded the moment it exists rather than the moment someone
    // remembers to exclude it, and an absent value is UNKNOWN and therefore
    // out. This filter is unconditional — no ripcord governs it, because a
    // column nobody reads is not a claim, and the claim a buyer pays for is
    // that our own traffic is separable from a reader's.
    .filter((row) => (row.runClass ?? "UNKNOWN") === "ORGANIC");
  if (!ripcordPulled("ripcord.fundingReactionsInAggregates")) return clean;
  return clean.filter((row) => !FUNDING_REACTION_TYPES.includes(row.targetType));
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
          // The question as this row's instrument asked it. An older tally
          // keeps the wording it was collected under rather than being
          // relabelled with the current one — relabelling is how a scale
          // break disappears.
          //
          // By VERSION since g3 (2026-08-16). This was one hardcoded
          // "anything that isn't current" string, which was right while
          // exactly one older version existed and silently became wrong when
          // the contributions table moved to v3: a v2 row would have been
          // labelled with the v1 wording, skipping a version.
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
