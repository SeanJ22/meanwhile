import {
  currentCuratedReaderRecords,
  type BallotNavigationProjectionRecord,
} from "../civic-data/curated-reader-read-model.ts";

export interface RegistrationLink {
  state: string;
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

export function currentRegistrationLinks(): readonly RegistrationLink[] {
  const seed: BallotNavigationProjectionRecord[] = REGISTRATION_LINKS.map((value) => ({
    id: `registration:${value.state}`,
    kind: "REGISTRATION_LINK",
    value: value as unknown as Readonly<Record<string, unknown>>,
  }));
  return currentCuratedReaderRecords("ballot-navigation", seed)
    .filter((record): record is BallotNavigationProjectionRecord => record.kind === "REGISTRATION_LINK")
    .map((record) => record.value as unknown as RegistrationLink);
}

export function registrationLinkFor(state: string, projection?: readonly RegistrationLink[]): RegistrationLink | null {
  return (projection ?? currentRegistrationLinks()).find((l) => l.state === state) ?? null;
}
