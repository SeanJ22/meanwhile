import {
  currentCuratedReaderRecords,
  currentElectionFields,
  type BallotNavigationProjectionRecord,
} from "../civic-data/curated-reader-read-model.ts";

export interface RegistrationLink {
  state: string;
  label: string;
  url: string;
  sourceOrg: string;
  verification: string;
  verifiedAt: string;
  purpose?: "registration_page" | "registration_lookup";
  sourceUrl?: string;
}

export function currentRegistrationLinks(): readonly RegistrationLink[] {
  const links = currentCuratedReaderRecords<BallotNavigationProjectionRecord>("ballot-navigation", [])
    .filter((record): record is BallotNavigationProjectionRecord => record.kind === "REGISTRATION_LINK")
    .map((record) => ({ ...record.value, purpose: "registration_lookup" }) as unknown as RegistrationLink);
  for (const { value } of currentElectionFields()) {
    if (!["registration_page", "registration_lookup"].includes(value.fieldKind) || !value.navigationUrl) continue;
    links.push({ state: value.state, purpose: value.fieldKind as RegistrationLink["purpose"],
      label: value.fieldKind === "registration_page" ? "Voter registration" : "Registration status", url: value.navigationUrl, sourceUrl: value.url, sourceOrg: value.sourceOrg,
      verification: value.quote, verifiedAt: value.verifiedAt });
  }
  return links.filter((link, index) => links.findLastIndex(other => other.state === link.state && other.purpose === link.purpose && other.url === link.url) === index);
}
