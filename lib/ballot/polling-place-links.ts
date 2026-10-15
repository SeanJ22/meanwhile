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

/** Lookup routes are published from saved official pages, without a state-specific seed. */
export const POLLING_PLACE_LINKS: readonly PollingPlaceLink[] = [];

export function currentPollingPlaceLinks(): readonly PollingPlaceLink[] {
  return currentCuratedReaderRecords<BallotNavigationProjectionRecord>("ballot-navigation", [])
    .filter((record): record is BallotNavigationProjectionRecord => record.kind === "POLLING_PLACE_LINK")
    .map((record) => record.value as unknown as PollingPlaceLink);
}

export function pollingPlaceLinkFor(state: string, projection?: readonly PollingPlaceLink[]): PollingPlaceLink | null {
  return (projection ?? currentPollingPlaceLinks()).find((l) => l.state === state) ?? null;
}
