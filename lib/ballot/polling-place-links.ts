/**
 * Official polling-place lookups, per covered state (item 6, 2026-08-15).
 *
 * The sibling of `registration-links.ts`, and the same discipline: every
 * entry is the state election authority's own tool, and every URL was
 * fetched and verified — the verification sentence says how, including
 * which rung of the ladder answered when a plain client got a 403.
 *
 * This is the SHALLOW version deliberately. The deeper thing — taking the
 * reader's own address and naming their polling place on our own surface —
 * is a tracker row, not this file. Pointing at the authority's own tool is
 * honest and correct today; a lookup we build ourselves would have to be
 * right about every precinct in three states before it could ship, and a
 * polling place that is wrong by one street is worse than a link.
 */

export interface PollingPlaceLink {
  state: string;
  /** The reader-facing line — plain words, 15-year-old test. */
  label: string;
  url: string;
  sourceOrg: string;
  /** What the tool asks for, so nobody taps into a surprise. */
  note: string;
  verification: string;
  verifiedAt: string;
}

export const POLLING_PLACE_LINKS: PollingPlaceLink[] = [
  {
    state: "AZ",
    label: "Find your polling place",
    url: "https://my.arizona.vote/WhereToVote.aspx?s=pollingplace",
    sourceOrg: "Arizona Secretary of State",
    note: "You'll need your date of birth and either a driver's licence number or the last four of your Social Security number.",
    verification:
      "azsos.gov/elections/voters (fetched 2026-08-15) names the Arizona Voter Information Portal as where voting locations are found; the portal host challenges plain clients, so the polling-place entry itself was opened in a browser on 2026-08-15 and served the portal's lookup form.",
    verifiedAt: "2026-08-15",
  },
  {
    state: "NJ",
    label: "Find your polling place",
    url: "https://voter.svrs.nj.gov/polling-place-search",
    sourceOrg: "New Jersey Division of Elections",
    note: "You'll need your name, date of birth and county.",
    verification:
      'nj.gov/state/elections/vote-polling-location.shtml (fetched 2026-08-15) links this as its "Polling Place Search Tool"; the tool serves 200.',
    verifiedAt: "2026-08-15",
  },
  {
    state: "NH",
    label: "Find your polling place",
    url: "https://app.sos.nh.gov/pollingplacesampleballot",
    sourceOrg: "New Hampshire Secretary of State",
    note: "Search by address; it shows your sample ballot as well.",
    verification:
      'sos.nh.gov/elections/voters links "Find my Polling Location" to app.sos.nh.gov, whose own menu links this page as "Search Polling Places and Sample Ballots by Address". Both pages 403 a plain client and were opened in a browser on 2026-08-15.',
    verifiedAt: "2026-08-15",
  },
];

export function pollingPlaceLinkFor(state: string): PollingPlaceLink | null {
  return POLLING_PLACE_LINKS.find((l) => l.state === state) ?? null;
}
