import type { ContributionRow } from "./types.ts";

/**
 * Where the money came from, and how concentrated it is.
 *
 * Geography is in-state, not in-district: the FEC gives the filed state
 * exactly, and a zip can never resolve a district. It is labelled in-state
 * everywhere it renders.
 *
 * Concentration uses the FEC's own entity and committee typing
 * (`./type-concentration.ts`), never an industry taxonomy, which the FEC does
 * not publish.
 *
 * The base is the five largest contributions from committees and
 * organizations plus the five largest from individuals, as fetched, not the
 * campaign's ten largest. So the org-versus-individual count (5 and 5 by
 * construction) is never rendered, and those sums render as dollars, not as a
 * share.
 *
 * A non-zero share that rounds to zero renders as "under 1%".
 */

export interface FundingConcentration {
  /** How many contributions this was computed over. The denominator. */
  contributionCount: number;
  /** Their total, in dollars. */
  totalAmount: number;

  /** Contributions filed from the candidate's own state. */
  inStateCount: number;
  inStateAmount: number;
  outStateAmount: number;
  unlocatedAmount: number;
  /**
   * The candidate's state, as the FEC records it. Null when we do not have
   * it — and then the in-state figures are meaningless and `hasGeography`
   * is false, rather than a zero that reads as "none came from home".
   */
  candidateState: string | null;
  /** False when the comparison could not be made at all. */
  hasGeography: boolean;

  /** From committees and organizations, by the FEC's own entity typing. */
  organizationCount: number;
  organizationAmount: number;
  /** From individuals. */
  individualCount: number;
  individualAmount: number;

  /**
   * The single largest contribution's amount. Kept as dollars rather than
   * as a precomputed share so the rounding rule lives in one place — the
   * one that knows not to render a small non-zero as "0%".
   */
  largestAmount: number;
}

/**
 * The FEC's own entity typing for the money's source, carried on the row as
 * `kind`. A candidate's own money falls on the individual side.
 */
function isOrganization(row: ContributionRow): boolean {
  return row.kind === "COMMITTEE_OR_ORGANIZATION";
}

/**
 * Compute the figures. Null when there is nothing to compute over, so a
 * caller renders nothing rather than zeros.
 */
export function concentrationOf(
  rows: ContributionRow[],
  candidateState: string | null,
): FundingConcentration | null {
  if (rows.length === 0) return null;

  const total = rows.reduce((sum, row) => sum + row.amount, 0);
  if (total <= 0) return null;

  const home = candidateState?.trim().toUpperCase() || null;
  // Geography is only claimable when we know the candidate's state AND at
  // least one contribution states its own. A contribution with no state
  // filed is counted in the denominator and in neither side of the split,
  // because "we don't know where this came from" is not "it came from away".
  const withState = rows.filter((row) => Boolean(row.state?.trim()));
  const hasGeography = home !== null && withState.length > 0;

  const inState = hasGeography
    ? withState.filter((row) => row.state!.trim().toUpperCase() === home)
    : [];

  const organizations = rows.filter(isOrganization);
  const individuals = rows.filter((row) => !isOrganization(row));

  const largest = rows.reduce((max, row) => Math.max(max, row.amount), 0);

  const sum = (list: ContributionRow[]) =>
    list.reduce((acc, row) => acc + row.amount, 0);

  return {
    contributionCount: rows.length,
    totalAmount: total,
    inStateCount: inState.length,
    inStateAmount: sum(inState),
    outStateAmount: hasGeography ? sum(withState.filter(row => row.state!.trim().toUpperCase() !== home)) : 0,
    unlocatedAmount: sum(rows.filter(row => !row.state?.trim())),
    candidateState: home,
    hasGeography,
    organizationCount: organizations.length,
    organizationAmount: sum(organizations),
    individualCount: individuals.length,
    individualAmount: sum(individuals),
    largestAmount: largest,
  };
}

/** A share in the reader's words: no decimals, and never "0%" for a small non-zero. */
export function shareWords(part: number, whole: number): string {
  if (whole <= 0 || part <= 0) return "0%";
  const exact = (part / whole) * 100;
  if (exact < 1) return "under 1%";
  if (exact > 99 && exact < 100) return "over 99%";
  return `${Math.round(exact)}%`;
}

/** Whole dollars, grouped, for a sentence. */
function dollars(amount: number): string {
  return "$" + Math.round(amount).toLocaleString("en-US");
}

/**
 * The sentences, in the reader's words. States shares, never characterizes
 * them. The base is spelled out first, because every figure is a share of it
 * and it is not the campaign's whole book.
 */
export function concentrationSentences(
  concentration: FundingConcentration,
  stateName: string | null,
): string[] {
  const sentences = [`Contributions listed above: ${dollars(concentration.totalAmount)}.`];
  if (concentration.hasGeography) {
    const where = stateName ?? concentration.candidateState;
    sentences.push(`Filed from inside ${where}: ${dollars(concentration.inStateAmount)}.`);
    sentences.push(`Filed from outside ${where}: ${dollars(concentration.outStateAmount)}.`);
    if (concentration.unlocatedAmount > 0) sentences.push(`State not stated on the filing: ${dollars(concentration.unlocatedAmount)}.`);
  } else {
    sentences.push("We're working on getting this info");
  }
  if (concentration.organizationCount > 0) sentences.push(`${dollars(concentration.organizationAmount)} came from committees and organizations.`);
  if (concentration.individualCount > 0) sentences.push(`${dollars(concentration.individualAmount)} came from individual people.`);
  return sentences;
}
