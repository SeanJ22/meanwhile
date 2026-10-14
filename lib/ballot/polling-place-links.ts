import {
  currentCuratedReaderRecords,
  currentElectionFields,
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
  purpose?: "polling_lookup" | "ballot_lookup";
  sourceUrl?: string;
}

export function currentPollingPlaceLinks(): readonly PollingPlaceLink[] {
  const links = currentCuratedReaderRecords<BallotNavigationProjectionRecord>("ballot-navigation", [])
    .filter((record): record is BallotNavigationProjectionRecord => record.kind === "POLLING_PLACE_LINK")
    .map((record) => ({ ...record.value, purpose: "polling_lookup" }) as unknown as PollingPlaceLink);
  for (const { value } of currentElectionFields()) {
    if (!["polling_lookup", "ballot_lookup"].includes(value.fieldKind) || !value.navigationUrl) continue;
    links.push({ state: value.state, purpose: value.fieldKind as PollingPlaceLink["purpose"],
      label: value.fieldKind === "ballot_lookup" ? "Look up your sample ballot" : "Find your polling place", url: value.navigationUrl, sourceUrl: value.url, sourceOrg: value.sourceOrg,
      note: value.quote, verification: value.quote, verifiedAt: value.verifiedAt });
  }
  return links.filter((link, index) => links.findLastIndex(other => other.state === link.state && other.purpose === link.purpose && other.url === link.url) === index);
}
