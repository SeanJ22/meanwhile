import {
  currentCuratedReaderRecords,
  type BallotNavigationProjectionRecord,
} from "../civic-data/curated-reader-read-model.ts";

export interface PollingPlaceLink {
  state: string;
  label: string;
  url: string;
  sourceOrg: string;
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

export function currentPollingPlaceLinks(): readonly PollingPlaceLink[] {
  const seed: BallotNavigationProjectionRecord[] = POLLING_PLACE_LINKS.map((value) => ({
    id: `polling-place:${value.state}`,
    kind: "POLLING_PLACE_LINK",
    value: value as unknown as Readonly<Record<string, unknown>>,
  }));
  return currentCuratedReaderRecords("ballot-navigation", seed)
    .filter((record): record is BallotNavigationProjectionRecord => record.kind === "POLLING_PLACE_LINK")
    .map((record) => record.value as unknown as PollingPlaceLink);
}

export function pollingPlaceLinkFor(state: string, projection?: readonly PollingPlaceLink[]): PollingPlaceLink | null {
  return (projection ?? currentPollingPlaceLinks()).find((l) => l.state === state) ?? null;
}
