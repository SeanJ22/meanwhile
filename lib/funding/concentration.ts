import type { ContributionRow } from "./types.ts";

/**
 * **Where the money came from, and how concentrated it is** — tracker D06,
 * built 2026-08-18 (g19).
 *
 * D06 asks for three things. Two of them ship here. The third does not, and
 * the reason is written down rather than left as a silent omission.
 *
 * ## 1. "In-district vs out-of-district share" ships as IN-STATE
 *
 * The FEC gives us the state a contribution was filed from, exactly. It does
 * not give us a district, and the only route from what we have to a district
 * would be the contributor's zip — which is precisely the inference CLAUDE.md
 * forbids: "Zip is orientation only. ZCTAs cross city, county, school
 * district, and legislative boundaries, so a zip can never resolve a ballot."
 * A congressional district is a ballot fact. So an "in-district share"
 * computed here would be a number with a state's worth of error in it,
 * rendered to a reader as precision.
 *
 * IN-STATE is the same question at the resolution the filing actually
 * supports, and it is exact: the filed `state` against the candidate's own
 * `state`. It is labelled as in-state everywhere it renders. Nothing rounds
 * it up to a district.
 *
 * ## 2. Concentration ships by the FEC's OWN codes, not by industry
 *
 * **Shipped 2026-08-19 (g20). The band
 * computation itself lives in `./type-concentration.ts`; the reasoning below
 * is why it takes the shape it does, and it has not changed.**
 *
 * D06's wording is "industry concentration", and that cannot ship honestly.
 * An industry figure requires an employer-to-industry taxonomy. The FEC
 * publishes none — its itemized records carry employer and occupation as
 * free text, and this snapshot does not even carry those fields. The
 * taxonomies that exist belong to third-party aggregators, and CLAUDE.md's
 * source rule excludes them by name: "Do not add advocacy organizations,
 * PACs, or endorsement sites as sources. Go to the underlying government
 * filing." Building our own would be the app deciding what kind of thing an
 * organization is, which "organizations render as filed, never
 * characterized" forbids outright.
 *
 * So concentration renders on the axis the filings themselves supply: how
 * much of the reported money came from COMMITTEES AND ORGANIZATIONS versus
 * from INDIVIDUALS, which is the FEC's own entity typing, and how much of it
 * the single largest contributor accounts for — and, since g20, how the
 * committee money divides across the FEC's own committee CATEGORIES
 * (`./type-concentration.ts`), each one a category the contributing
 * committee filed for itself.
 *
 * ## 3. The base is not "the ten largest", and the first draft said it was
 *
 * These figures are computed over the rows the reader is shown, and those
 * rows are **the five largest contributions from committees and
 * organizations PLUS the five largest from individuals** — two separate
 * top-fives, fetched that way by `scripts/fetch-fec.mts` (`TOP_N = 5`,
 * once per `is_individual` pass). They are NOT the ten largest
 * contributions the campaign reported, and the first version of this file
 * said they were. Checked against the real snapshot before shipping, which
 * is the only reason it was caught: every candidate came back "orgs=5
 * indiv=5", which is not a fact about any campaign, it is our own sampling
 * method reflected back.
 *
 * Two consequences, and both are load-bearing:
 *
 * 1. **The org-versus-individual COUNT is meaningless** and is never
 *    rendered. It is 5 and 5 by construction. Reporting it would be
 *    reporting our fetch loop as a finding about somebody's campaign.
 * 2. **Dollars are rendered as dollars, not as a share.** "The five biggest
 *    committee gifts came to $X, the five biggest individual gifts to $Y"
 *    is exactly true. "99% came from committees" is not — it is 99% of a
 *    base we picked.
 *
 * The geographic split survives intact, because it is a property of the
 * rows rather than of how they were selected, and it renders with its base
 * spelled out in the reader's words.
 *
 * ## 4. A rounded percent may not manufacture a zero
 *
 * Booker's in-state figure was two real contributions that rounded to "0%
 * of the total" — rendered beside "That is 2 of 10 contributions", which a
 * reader cannot reconcile and which states an absence that is not true. A
 * non-zero amount that rounds to zero renders as "under 1%".
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
 * The FEC's own entity typing for the money's source, carried on the row
 * as `kind` and derived there from the filed entity type. A candidate's own
 * money falls on the individual side, because that is what it is — a
 * person's money — and nothing here re-decides what the filing already
 * says.
 */
function isOrganization(row: ContributionRow): boolean {
  return row.kind === "COMMITTEE_OR_ORGANIZATION";
}

/**
 * Compute the figures. Returns null when there is nothing to compute over,
 * so a caller renders nothing rather than a row of zeros — zeros here would
 * say "no money came from anywhere", which is a claim, and the honest
 * statement is that we are not showing this.
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

/**
 * A share, in the reader's words. Never a decimal place, and never a zero
 * standing in for a small non-zero — "0%" beside "2 of 10 contributions"
 * is a contradiction a reader cannot resolve, and it asserts an absence
 * that is not true.
 */
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
 * The sentences, in the reader's words.
 *
 * **Level register**, per the voice doctrine: this is a claim surface about
 * a real person's money, so it states and never characterizes. It says what
 * share came from where; it never says whether that is a lot, whether it is
 * good, or what it suggests about the candidate.
 *
 * **The base is spelled out first**, before any figure, because every
 * number below is a share of it and the base is not the campaign's whole
 * book. See section 3 of this file's header for what the base actually is
 * and how the first draft got it wrong.
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
