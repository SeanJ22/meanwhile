import {
  contributorBand,
  OWN_MONEY_BAND_ID,
  UNFILED_BAND_ID,
} from "./labels.ts";
import type { ContributionRow } from "./types.ts";

export { OWN_MONEY_BAND_ID, UNFILED_BAND_ID };

/**
 * Concentration on the FEC's own axis: how committee money divides across the
 * categories contributing committees filed for themselves, through
 * `contributorBand` in `./labels.ts` (the one ladder). Not industry
 * concentration: the FEC publishes no industry taxonomy.
 *
 * 1. Committee side only: the rows shown are two separately sampled
 *    top-fives, so a share across both would be a share of a base we chose.
 * 2. An unfiled typing is a named gap band, never "an organization".
 * 3. Bands sort by dollars; nothing is scored or ranked.
 */

export interface TypeConcentrationBand {
  /** `CommitteeTypeLabel.id`, or `UNFILED_BAND_ID` for the named gap. */
  id: string;
  /** Lowercase, to sit inside a sentence. */
  label: string;
  /** How many contribution rows fell in this band. */
  count: number;
  /** Their total, in dollars. */
  amount: number;
}

export interface TypeConcentration {
  /** The committee-and-organization rows this was computed over. */
  contributionCount: number;
  /** Their total, in dollars — the base every share below is a share of. */
  totalAmount: number;
  /** The FEC categories this money falls across, dollars descending. */
  bands: TypeConcentrationBand[];
  /**
   * How many distinct categories the money falls across: the concentration
   * figure itself.
   */
  bandCount: number;
}

/**
 * Compute the bands. Null when there is no committee money to compute over,
 * so the reader sees nothing rather than an empty list.
 */
export function typeConcentrationOf(
  rows: ContributionRow[],
): TypeConcentration | null {
  const committees = rows.filter(
    (row) => row.kind === "COMMITTEE_OR_ORGANIZATION",
  );
  if (committees.length === 0) return null;

  const total = committees.reduce((sum, row) => sum + row.amount, 0);
  if (total <= 0) return null;

  const byBand = new Map<string, TypeConcentrationBand>();
  for (const row of committees) {
    // Null only for an individual, which cannot occur on this side; skipped
    // rather than defaulted, and totals are recomputed from the bands.
    const band = contributorBand(row);
    if (!band) continue;
    const { id, label } = band;
    const existing = byBand.get(id);
    if (existing) {
      existing.count += 1;
      existing.amount += row.amount;
    } else {
      byBand.set(id, { id, label, count: 1, amount: row.amount });
    }
  }

  const bands = [...byBand.values()].sort((a, b) => {
    if (b.amount !== a.amount) return b.amount - a.amount;
    return a.label.localeCompare(b.label);
  });

  if (bands.length === 0) return null;

  // The base is the sum of what the bands hold, so the headline never exceeds the listed dollars.
  return {
    contributionCount: bands.reduce((sum, b) => sum + b.count, 0),
    totalAmount: bands.reduce((sum, b) => sum + b.amount, 0),
    bands,
    bandCount: bands.length,
  };
}

/** Whole dollars, grouped, for a sentence. */
function dollars(amount: number): string {
  return "$" + Math.round(amount).toLocaleString("en-US");
}

/**
 * The sentences, in the reader's words. States what kind of filer and how
 * much, never whether that is a lot or what it suggests.
 */
export function typeConcentrationSentences(
  concentration: TypeConcentration,
): string[] {
  return concentration.bands.map(band =>
    band.id === OWN_MONEY_BAND_ID
      ? `${dollars(band.amount)} was ${band.label}.`
      : `${dollars(band.amount)} from ${band.label}.`,
  );
}
