/** Official polling tools from sourced, held ballot-navigation records. */
import {
  currentCuratedReaderRecords,
  type BallotNavigationProjectionRecord,
} from "../civic-data/curated-reader-read-model.ts";

import { electionFieldIssue, type PublishedElectionField } from "../civic-data/election-fields.ts";

export interface PollingPlaceLink {
  state: string;
  /** The reader-facing line — plain words, 15-year-old test. */
  label: string;
  url: string;
  sourceOrg: string;
  /** The source description of the tool; never inferred access requirements. */
  note: string;
  verification: string;
  verifiedAt: string;
}

/** Read official state tools from the settled navigation pointer, never code seeds. */
export function currentPollingPlaceLinks(): readonly PollingPlaceLink[] {
  const records = currentCuratedReaderRecords<{ readonly kind: string }>("ballot-navigation", []);
  const sourced = records
    .filter(row => row.kind === "ELECTION_FIELD" && electionFieldIssue(row) === null)
    .map(row => (row as unknown as PublishedElectionField).value)
    // This selector serves state tools. A county's tool cannot speak for its state.
    .filter(value => value.fieldKind === "polling_lookup" && value.divisionId === `ocd-division/country:us/state:${value.state.toLowerCase()}`)
    .sort((a, b) => b.verifiedAt.localeCompare(a.verifiedAt))
    .map(value => ({ state: value.state, label: "Find your polling place", url: value.navigationUrl!, sourceOrg: value.sourceOrg,
      note: value.quote, verification: value.quote, verifiedAt: value.verifiedAt }));
  const held = records.filter(row => row.kind === "POLLING_PLACE_LINK")
    .map(row => (row as unknown as BallotNavigationProjectionRecord).value as unknown as PollingPlaceLink);
  const states = new Set<string>();
  return [...sourced, ...held].filter(link => {
    if (states.has(link.state)) return false;
    states.add(link.state);
    return true;
  });
}
export function pollingPlaceLinkFor(state: string, projection?: readonly PollingPlaceLink[]): PollingPlaceLink | null {
  return (projection ?? currentPollingPlaceLinks()).find((l) => l.state === state) ?? null;
}
