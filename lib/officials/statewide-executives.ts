import type { SeatHolder } from "./lookup.ts";
import { stateOcdIdFrom } from "./lookup.ts";

/**
 * Statewide elected executives, curated from each state's own site
 * (session item 2b, wall clock 2026-08-14 second session).
 *
 * Why this module exists: the who-governs card is built from division
 * rows — legislators attach via districts — and a statewide executive is
 * elected by no district on the map, so no row ever claimed them. The
 * registry's shape became the card's blind spot, and the most prominent
 * officer in every state was missing from every zip. Statewide
 * executives are a first-class attachment, exactly the shape `senators`
 * already takes: keyed to the state division id, derived from the OCD
 * prefix of the divisions the geometry resolved.
 *
 * **Governor only, today.** Other statewide executives (secretary of
 * state, attorney general, …) are a later addition; the card's coverage
 * language names this honestly rather than implying completeness.
 *
 * Officeholder discipline: every name and contact below was read off the
 * cited state page. Photos follow the photo rule — hunted in the dedicated
 * photo session (2026-08-14): each governor's portrait was matched on
 * Wikimedia Commons by attribute-verified identity, judged a clean solo
 * portrait, committed metadata-stripped under public/officials/, and its
 * license recorded in lib/registry/official-photos.json (the manifest row
 * carries the Commons file page and the license).
 *
 * **Party (M61, 2026-08-15).** These rows shipped with `partyLabel: null`
 * on the reasoning that a governor's own office page styles itself
 * officeholder-first, so party was left to the ballot surfaces. The author
 * caught the consequence in production: Kelly Ayotte read "Republican" on
 * the ballot and carried nothing at all on the who-governs card, two
 * surfaces disagreeing about the same person. The standing rule is that
 * party renders wherever it is held, so the fix is to hold it — from the
 * same class of record the ballot cites, the election authority's own
 * certified filing, one per row and named on the row. Not from the office
 * page, which genuinely does not state it, and not from anybody's
 * knowledge.
 *
 * `partySourceUrl` is the record, and `tests/party.test.ts` will not let a
 * party ship without one.
 *
 * Verification states follow the everyday.ts precedent: a
 * PENDING_BROWSER row must be verified in a real browser before ship —
 * all three sites wall plain clients (403 / empty shell to WebFetch,
 * rungs recorded in docs/source-ladder.md).
 */

export type StatewideVerification = "PAGE_FETCHED" | "PENDING_BROWSER";

export interface StatewideExecutive {
  /** The state division this office serves — the attachment key. */
  stateOcdId: string;
  /**
   * Everything about the person EXCEPT their provenance, which this entry
   * already states below and `statewideExecutivesFor` attaches (item 1,
   * 2026-08-16). Writing it twice is how two records of the same fact come
   * to disagree.
   */
  holder: Omit<SeatHolder, "provenance">;
  /** The state's own page the row was read from. */
  sourceUrl: string;
  /**
   * The election authority record the holder's party was read from (M61).
   * Required whenever the holder carries a party: the office page does not
   * state it, so the claim has to cite the filing that does.
   */
  partySourceUrl?: string;
  partySourceOrg?: string;
  sourceOrg: string;
  collectedAt: string;
  verification: StatewideVerification;
}

export const STATEWIDE_EXECUTIVES: readonly StatewideExecutive[] = [
  {
    stateOcdId: "ocd-division/country:us/state:az",
    holder: {
      id: "statewide:az/governor",
      name: "Katie Hobbs",
      officeTitle: "Governor",
      // Read off the Secretary of State's own certified nomination list
      // (2026 Candidate Nominations), the same filing the ballot surface
      // already cites for this candidacy.
      partyLabel: "Democratic",
      websiteUrl: "https://azgovernor.gov/",
      sourceUrl: "https://azgovernor.gov/",
      // Read off azgovernor.gov/constituent-services in a real browser
      // 2026-08-14: "602-542-4331 · engage@az.gov", office titled
      // "Office of the Arizona Governor Katie Hobbs".
      email: "engage@az.gov",
      phone: "(602) 542-4331",
      contactFormUrl: "https://azgovernor.gov/constituent-services",
      photoUrl: "/officials/statewide-az-governor.jpg",
      campaignUrl: null,
      // 6d: no sourced term end or birth date on a governor's own page.
      termEnd: null,
      birthDate: null,
    },
    sourceUrl: "https://azgovernor.gov/",
    sourceOrg: "Office of the Arizona Governor",
    partySourceUrl:
      "https://azsos.gov/sites/default/files/docs/2026-Candidate-Nominations-and-Petitions-Filed-0330.pdf",
    partySourceOrg: "Arizona Secretary of State (candidate nominations filed)",
    collectedAt: "2026-08-14",
    verification: "PAGE_FETCHED",
  },
  {
    stateOcdId: "ocd-division/country:us/state:nj",
    holder: {
      id: "statewide:nj/governor",
      name: "Mikie Sherrill",
      officeTitle: "Governor",
      // Read off the Division of Elections' certified tally, "Official List
      // Candidates for Governor", dated 12/03/2025: MIKIE SHERRILL (w) …
      // Democratic. Fetched and text-extracted 2026-08-15.
      partyLabel: "Democratic",
      websiteUrl: "https://www.nj.gov/governor/",
      sourceUrl: "https://www.nj.gov/governor/",
      email: null,
      // The office's own site (read in a real browser 2026-08-14,
      // titled "Office of New Jersey Governor Mikie Sherrill") publishes
      // NO phone number — the contact form is the published channel.
      // An absence is an absence; the draft's 609 number was removed
      // because the page doesn't state it.
      phone: null,
      contactFormUrl: "https://www.nj.gov/governor/contact/",
      photoUrl: "/officials/statewide-nj-governor.jpg",
      campaignUrl: null,
      // 6d: no sourced term end or birth date on a governor's own page.
      termEnd: null,
      birthDate: null,
    },
    sourceUrl: "https://www.nj.gov/governor/",
    sourceOrg: "Office of the Governor of New Jersey",
    partySourceUrl:
      "https://nj.gov/state/elections/assets/pdf/election-results/2025/2025-official-general-results-governor.pdf",
    partySourceOrg: "New Jersey Division of Elections (official general election results)",
    collectedAt: "2026-08-14",
    verification: "PAGE_FETCHED",
  },
  {
    stateOcdId: "ocd-division/country:us/state:nh",
    holder: {
      id: "statewide:nh/governor",
      name: "Kelly Ayotte",
      officeTitle: "Governor",
      // Read off the Secretary of State's cumulative candidate filings
      // (7.16.26), the same filing the NH ballot surface already cites.
      partyLabel: "Republican",
      websiteUrl: "https://www.governor.nh.gov/",
      sourceUrl: "https://www.governor.nh.gov/",
      email: null,
      // Read off governor.nh.gov in a real browser 2026-08-14: page
      // titled "Welcome | Governor Kelly Ayotte", phone 603-271-2121
      // published on the page.
      phone: "(603) 271-2121",
      contactFormUrl: "https://www.governor.nh.gov/contact-governor-ayotte",
      photoUrl: "/officials/statewide-nh-governor.png",
      campaignUrl: null,
      // 6d: no sourced term end or birth date on a governor's own page.
      termEnd: null,
      birthDate: null,
    },
    sourceUrl: "https://www.governor.nh.gov/",
    sourceOrg: "Office of the Governor of New Hampshire",
    partySourceUrl:
      "https://www.sos.nh.gov/sites/g/files/ehbemt561/files/docs/cumulative-filings-7.16.26.pdf",
    partySourceOrg: "New Hampshire Secretary of State (cumulative candidate filings)",
    collectedAt: "2026-08-14",
    verification: "PAGE_FETCHED",
  },
];

/**
 * The statewide executives for whichever state these divisions sit in —
 * the `senatorsFor` shape: identifiers in, holders out, the state read
 * off the OCD prefix the geometry already resolved.
 */
export function statewideExecutivesFor(ocdIds: string[]): SeatHolder[] {
  const states = new Set<string>();
  for (const ocdId of ocdIds) {
    const state = stateOcdIdFrom(ocdId);
    if (state) states.add(state);
  }

  const holders: SeatHolder[] = [];
  for (const executive of STATEWIDE_EXECUTIVES) {
    if (!states.has(executive.stateOcdId)) continue;
    // Item 1 (2026-08-16): the entry already recorded the publisher and the
    // read date; the holder handed to the surfaces did not carry them, so a
    // card listing a governor could not say who published the claim. Attached
    // here rather than duplicated into each literal above — one place, and it
    // cannot drift from the `sourceOrg`/`collectedAt` the tests already hold.
    holders.push({
      ...executive.holder,
      provenance: {
        sourceUrl: executive.sourceUrl,
        sourceOrg: executive.sourceOrg,
        collectedAt: executive.collectedAt,
        verifiedAt: null,
      },
    });
  }
  return holders;
}
