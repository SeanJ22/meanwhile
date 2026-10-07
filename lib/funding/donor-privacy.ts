/**
 * Donor rendering is aggregate only. No individual donor name or address
 * renders anywhere, for FEC or state data: totals, source types, in-state
 * versus out-of-state and employer-level rollups only. This is a render rule;
 * filings are held with provenance intact. Organizations (committees, PACs,
 * parties, corporations) render as filed. Rows are folded, not anonymised: an
 * amount, a city and a date are re-identifiable without a name.
 *
 * Client-safe: types and arithmetic only.
 */

import type { ContributorGroup } from "./grouping.ts";

/** One state's share of the individual money. A state is not an address. */
export interface StateShare {
  /** Two-letter USPS code as filed, or null where the filing carried none. */
  readonly state: string | null;
  readonly donors: number;
  readonly amount: number;
}

export interface IndividualAggregate {
  /** Distinct individual filers folded in. Never rendered beside a name. */
  readonly donors: number;
  /** Filings behind those donors, so a reader can see folding happened. */
  readonly filings: number;
  readonly amount: number;
  /** Amount descending, with the unknown-state bucket last. */
  readonly byState: readonly StateShare[];
  /**
   * The candidate's own money, held apart because it is about the public
   * person, not a private donor. Renders with no name.
   */
  readonly candidateOwnMoney: number;
}

/** The FEC's entity typing for a candidate's own money. */
const CANDIDATE_ENTITY_TYPES = new Set(["CAN"]);

export function isCandidateOwnMoney(group: ContributorGroup): boolean {
  return group.entityType !== null && CANDIDATE_ENTITY_TYPES.has(group.entityType);
}

/**
 * Fold every individual filer into one aggregate. The parts equal the whole:
 * `byState` sums to `amount`, and `candidateOwnMoney` is a subset of `amount`.
 */
export function aggregateIndividuals(groups: readonly ContributorGroup[]): IndividualAggregate {
  const individuals = groups.filter((g) => g.kind === "INDIVIDUAL");

  const byState = new Map<string | null, { donors: number; amount: number }>();
  let amount = 0;
  let filings = 0;
  let candidateOwnMoney = 0;

  for (const g of individuals) {
    amount += g.amount;
    filings += g.count;
    if (isCandidateOwnMoney(g)) candidateOwnMoney += g.amount;
    const key = g.state && g.state.trim() ? g.state.trim().toUpperCase() : null;
    const cell = byState.get(key) ?? { donors: 0, amount: 0 };
    cell.donors += 1;
    cell.amount += g.amount;
    byState.set(key, cell);
  }

  const shares: StateShare[] = [...byState].map(([state, v]) => ({ state, donors: v.donors, amount: v.amount }));
  shares.sort((a, b) => {
    // The unknown-state bucket goes last: it is about our record, not a place.
    if (a.state === null) return 1;
    if (b.state === null) return -1;
    if (b.amount !== a.amount) return b.amount - a.amount;
    return a.state.localeCompare(b.state);
  });

  return { donors: individuals.length, filings, amount, byState: shares, candidateOwnMoney };
}

/** Is this group allowed to render with its filed name? Both render sites ask this. */
export function mayRenderFiledName(group: Pick<ContributorGroup, "kind">): boolean {
  return group.kind === "COMMITTEE_OR_ORGANIZATION";
}

/**
 * Is this group allowed to render a place? Asked separately: a city plus an
 * amount plus a date is re-identifiable without a name.
 */
export function mayRenderFiledLocation(group: Pick<ContributorGroup, "kind">): boolean {
  return group.kind === "COMMITTEE_OR_ORGANIZATION";
}
