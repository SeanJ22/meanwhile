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
 * carries the Commons file page and the license). `partyLabel` stays
 * null: these rows carry what
 * the office's own page publishes, and the governor's office page styles
 * itself officeholder-first, not party-first — party is on the ballot
 * surfaces where it is sourced from filings.
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
  holder: SeatHolder;
  /** The state's own page the row was read from. */
  sourceUrl: string;
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
      partyLabel: null,
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
    },
    sourceUrl: "https://azgovernor.gov/",
    sourceOrg: "Office of the Arizona Governor",
    collectedAt: "2026-08-14",
    verification: "PAGE_FETCHED",
  },
  {
    stateOcdId: "ocd-division/country:us/state:nj",
    holder: {
      id: "statewide:nj/governor",
      name: "Mikie Sherrill",
      officeTitle: "Governor",
      partyLabel: null,
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
    },
    sourceUrl: "https://www.nj.gov/governor/",
    sourceOrg: "Office of the Governor of New Jersey",
    collectedAt: "2026-08-14",
    verification: "PAGE_FETCHED",
  },
  {
    stateOcdId: "ocd-division/country:us/state:nh",
    holder: {
      id: "statewide:nh/governor",
      name: "Kelly Ayotte",
      officeTitle: "Governor",
      partyLabel: null,
      websiteUrl: "https://www.governor.nh.gov/",
      sourceUrl: "https://www.governor.nh.gov/",
      email: null,
      // Read off governor.nh.gov in a real browser 2026-08-14: page
      // titled "Welcome | Governor Kelly Ayotte", phone 603-271-2121
      // published on the page.
      phone: "(603) 271-2121",
      contactFormUrl: "https://www.governor.nh.gov/contact-governor-ayotte",
      photoUrl: "/officials/statewide-nh-governor.jpg",
      campaignUrl: null,
    },
    sourceUrl: "https://www.governor.nh.gov/",
    sourceOrg: "Office of the Governor of New Hampshire",
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
    if (states.has(executive.stateOcdId)) holders.push(executive.holder);
  }
  return holders;
}
