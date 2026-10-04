import {
  contributorBand,
  OWN_MONEY_BAND_ID,
  UNFILED_BAND_ID,
} from "./labels.ts";
import type { ContributionRow } from "./types.ts";

export { OWN_MONEY_BAND_ID, UNFILED_BAND_ID };

/**
 * **Concentration, on the FEC's own axis** — D06's third named feature,
 * shipped 2026-08-19 (g20).
 *
 * ## Why this is not "industry concentration", and why that is the honest form
 *
 * D06's own wording asks for industry concentration. g19 declined to ship it
 * and wrote down why: an industry figure needs an employer-to-industry
 * taxonomy, the FEC publishes none, and every taxonomy that exists is an
 * aggregator's proprietary classification — which `CLAUDE.md`'s source rule
 * excludes by name, and which would have this product deciding what kind of
 * thing an organization is. "Organizations render as filed, never
 * characterized" forbids that outright.
 *
 * The design ships concentration **by the FEC's own entity typing**
 * instead. That is what this file computes. Every band below is a
 * category the contributing committee itself filed — `committee_type`,
 * `organization_type`, `designation` — mapped through the single
 * author-reviewable table in `./committee-types.ts` and nowhere else. A
 * trade association's PAC and a super PAC are different facts about who is
 * paying, and the FEC is the one saying which is which. We carry the
 * meaning; we do not generate it.
 *
 * ## Three things this deliberately does not do
 *
 * 1. **It never crosses the committee/individual line.** The rows a reader
 *    is shown are two separately-sampled top-fives (see section 3 of
 *    `./concentration.ts`), so a share computed across both would be a share
 *    of a base we chose. Bands are computed over the COMMITTEE side only,
 *    and every share states that base in the reader's words.
 * 2. **An unfiled typing is a named gap, never "an organization".** A row
 *    whose filing carries no typing at all falls into its own band whose
 *    label says whose gap it is — the filing's. Defaulting it into the
 *    generic organization band would convert an absence into a claim, which
 *    the render-default rule forbids one layer up.
 * 3. **It ranks nothing and nobody.** The bands sort by dollars because that
 *    is the figure; the sort is arithmetic on a published number, and no
 *    candidate, committee or category is scored, graded or recommended.
 *
 * ## The band derivation is NOT here, and that is the point
 *
 * `contributorBand` in `./labels.ts` is the one ladder that answers "what
 * kind of filer is this row" — candidate's own money, then the committee
 * table, then the FEC's entity typing, then the named gap. The first draft
 * of this file called `committeeTypeLabelFor` directly and skipped two of
 * those rungs; the real snapshot caught it, and what it caught was a
 * candidate's own $80,000 rendering as an untyped committee. See that
 * file's header for the full count.
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
   * How many distinct categories the money falls across. This IS the
   * concentration figure: one band means every committee dollar here came
   * from one kind of filer, and more bands mean it is spread wider.
   */
  bandCount: number;
}

/**
 * Compute the bands. Returns null when there is no committee money to
 * compute over — a reader then sees nothing here rather than an empty
 * category list, which would read as "no committee money", a claim about
 * the campaign rather than about our sample.
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
    // Null only for an individual donor, which cannot occur on this side —
    // but a `?? gap` here would be a default manufacturing a claim, so it
    // is skipped instead and the totals below are recomputed from the
    // bands, never from `committees`.
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

  // Stated N equals rendered rows: the base is the sum of what the bands
  // actually hold, so a skipped row can never leave the headline dollars
  // larger than the dollars the reader can see listed underneath.
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
 * The sentences, in the reader's words.
 *
 * **Level register** — a claim surface about a real person's money. It says
 * what kind of filer the money came from and how much; it never says whether
 * that is a lot, whether it is good, or what it suggests about anybody.
 *
 * The base is stated first, in the sentence before any figure, because every
 * dollar below is a dollar out of it and the base is not the campaign's whole
 * book.
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
