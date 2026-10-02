/** Official registration tools from sourced, held ballot-navigation records. */
import {
  currentCuratedReaderRecords,
  type BallotNavigationProjectionRecord,
} from "../civic-data/curated-reader-read-model.ts";

import { electionFieldIssue, type PublishedElectionField } from "../civic-data/election-fields.ts";

export interface RegistrationLink {
  state: string;
  /** The reader-facing line — plain words, 15-year-old test. */
  label: string;
  url: string;
  sourceOrg: string;
  verification: string;
  verifiedAt: string;
}

/** Read official state tools from the settled navigation pointer, never code seeds. */
export function currentRegistrationLinks(): readonly RegistrationLink[] {
  const records = currentCuratedReaderRecords<{ readonly kind: string }>("ballot-navigation", []);
  const sourced = records
    .filter(row => row.kind === "ELECTION_FIELD" && electionFieldIssue(row) === null)
    .map(row => (row as unknown as PublishedElectionField).value)
    // This selector serves state tools. A county's tool cannot speak for its state.
    .filter(value => value.fieldKind === "registration_lookup" && value.divisionId === `ocd-division/country:us/state:${value.state.toLowerCase()}`)
    .sort((a, b) => b.verifiedAt.localeCompare(a.verifiedAt))
    .map(value => ({ state: value.state, label: "Check whether you're registered to vote", url: value.navigationUrl!, sourceOrg: value.sourceOrg,
      verification: value.quote, verifiedAt: value.verifiedAt }));
  const held = records.filter(row => row.kind === "REGISTRATION_LINK")
    .map(row => (row as unknown as BallotNavigationProjectionRecord).value as unknown as RegistrationLink);
  const states = new Set<string>();
  return [...sourced, ...held].filter(link => {
    if (states.has(link.state)) return false;
    states.add(link.state);
    return true;
  });
}
export function registrationLinkFor(state: string, projection?: readonly RegistrationLink[]): RegistrationLink | null {
  return (projection ?? currentRegistrationLinks()).find((l) => l.state === state) ?? null;
}
