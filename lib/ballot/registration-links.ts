/**
 * Official voter-registration-status checkers, per covered state (2c).
 *
 * Every entry is the state election authority's own tool, and every URL was
 * verified this session — either fetched directly, or (where the tool's host
 * challenges plain clients) confirmed as the destination the authority's own
 * fetched page links to. The verification sentence records which.
 */

export interface RegistrationLink {
  state: string;
  /** The reader-facing line — plain words, 15-year-old test. */
  label: string;
  url: string;
  sourceOrg: string;
  verification: string;
  verifiedAt: string;
}

export const REGISTRATION_LINKS: RegistrationLink[] = [
  {
    state: "AZ",
    label: "Check whether you're registered to vote",
    url: "https://my.arizona.vote/WhereToVote.aspx?s=individual",
    sourceOrg: "Arizona Secretary of State",
    verification:
      "azsos.gov/elections/voters (fetched 2026-08-13) links this as the Arizona Voter Information Portal; the portal host itself challenges non-browser clients.",
    verifiedAt: "2026-08-13",
  },
  {
    state: "NJ",
    label: "Check whether you're registered to vote",
    url: "https://voter.svrs.nj.gov/registration-check",
    sourceOrg: "New Jersey Division of Elections",
    verification:
      "nj.gov/state/elections/voter-registration.shtml (fetched 2026-08-13) links this checker on the state's own voter-system host; the checker serves 200.",
    verifiedAt: "2026-08-13",
  },
  {
    state: "NH",
    label: "Look up your voter registration",
    url: "https://app.sos.nh.gov/voterinformation",
    sourceOrg: "New Hampshire Secretary of State",
    verification:
      'Fetched 2026-08-13 (browser-UA rung): page titled "Voter Information Lookup | New Hampshire".',
    verifiedAt: "2026-08-13",
  },
];

export function registrationLinkFor(state: string): RegistrationLink | null {
  return REGISTRATION_LINKS.find((l) => l.state === state) ?? null;
}
