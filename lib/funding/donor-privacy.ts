/**
 * DONOR RENDERING IS AGGREGATE ONLY. (2026-08-26, RULING 167.)
 *
 * No individual donor name and no donor address renders anywhere in this
 * product, for FEC data or for state data. Totals, source types, in-state
 * versus out-of-state and employer-level rollups are what a reader gets.
 *
 * **This is a RENDER rule, not a COLLECTION rule.** The filings are retrieved
 * and held with their provenance intact, because a claim about money still
 * needs its source record. What is forbidden is putting a private individual in
 * front of a reader, next to a map, in a product organised around the reader's
 * own address. Publishing them is lawful; rendering them searchably builds a
 * way to locate private individuals by their politics, and this project will
 * not build that.
 *
 * **AN ORGANIZATION IS NOT A DONOR IN THIS SENSE AND IS UNTOUCHED.** A
 * committee, a PAC, a party and a corporation render with their filed name and
 * committee type, exactly as the organizations-render-as-filed rule already
 * requires. Narrowing that would delete the funding surface's whole point.
 *
 * **WHY AN AGGREGATE AND NOT AN ANONYMISED ROW.** The obvious cheap fix is to
 * keep the rows and drop the names. That fails: twenty rows carrying an amount,
 * a city and a date are re-identifiable against the FEC's own public search in
 * about a minute, so the product would have published the same record with one
 * column hidden. The row has to stop being a row.
 *
 * Client-safe: types and arithmetic only, no `node:` imports.
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
   * The candidate's own money, held apart because it is a fact about the
   * PUBLIC PERSON whose card this is rather than about a private donor — and
   * because folding it into "individual donors" would tell a reader that
   * strangers gave money that the candidate in fact gave themselves.
   *
   * It renders with no name: the name is the candidate's, it is at the top of
   * the card already, and repeating it here would be the one individual-donor
   * name on the page.
   */
  readonly candidateOwnMoney: number;
}

/** The FEC's entity typing for a candidate's own money. */
const CANDIDATE_ENTITY_TYPES = new Set(["CAN"]);

export function isCandidateOwnMoney(group: ContributorGroup): boolean {
  return group.entityType !== null && CANDIDATE_ENTITY_TYPES.has(group.entityType);
}

/**
 * Fold every individual filer into one aggregate.
 *
 * The parts equal the whole and a guard asserts it: `amount` is the plain sum
 * of the groups handed in, `byState` sums to `amount` minus nothing, and
 * `candidateOwnMoney` is a SUBSET of `amount` rather than a sibling of it — a
 * reader shown two figures that do not reconcile has been given a third,
 * invented one.
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
    // The unknown-state bucket goes last however large it is: it is a fact
    // about our record rather than about where the money came from, and
    // sorting it into the middle would read as a place.
    if (a.state === null) return 1;
    if (b.state === null) return -1;
    if (b.amount !== a.amount) return b.amount - a.amount;
    return a.state.localeCompare(b.state);
  });

  return { donors: individuals.length, filings, amount, byState: shares, candidateOwnMoney };
}

/**
 * Is this group allowed to render with its filed name?
 *
 * The ONE question both render sites ask, so the answer cannot differ between
 * them (RULING 103 — three copies of an initials function is how a class defect
 * survives the fix). A caller that wants a name calls this first.
 */
export function mayRenderFiledName(group: Pick<ContributorGroup, "kind">): boolean {
  return group.kind === "COMMITTEE_OR_ORGANIZATION";
}

/**
 * Is this group allowed to render a place?
 *
 * Same answer, asked separately on purpose. A city plus an amount plus a date
 * is re-identifiable without a name, so the location is withheld from
 * individuals even where a name never was.
 */
export function mayRenderFiledLocation(group: Pick<ContributorGroup, "kind">): boolean {
  return group.kind === "COMMITTEE_OR_ORGANIZATION";
}
