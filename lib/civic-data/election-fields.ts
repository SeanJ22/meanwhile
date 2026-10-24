import type { WorkerPublicationCapture } from "./worker-roster-publication.ts";
import type { GovernmentWebsiteDelegation, OfficialLinkingPage } from "./source-authority.ts";
import { FIPS_TO_STATE } from "../ocd/fips.ts";

export const ELECTION_FIELD_KINDS = ["registration_page", "registration_deadline", "mail_ballot_request_deadline", "early_voting", "polling_lookup", "registration_lookup", "ballot_lookup", "certified_outcome", "election_office"] as const;
export type ElectionFieldKind = typeof ELECTION_FIELD_KINDS[number];

export function electionFieldState(divisionId: string): string | null {
  const match = /^ocd-division\/country:us\/(state|district|territory):([a-z]{2})(?:\/|$)/.exec(divisionId);
  if (!match) return null;
  return Object.values(FIPS_TO_STATE).find(entry => entry.prefix === match[1] &&
    entry.postal.toLowerCase() === match[2])?.postal ?? null;
}

export function sourcedElectionDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const instant = Date.parse(value);
  return Number.isFinite(instant) && new Date(instant).toISOString().slice(0, 10) === value;
}

export interface ElectionFieldInput {
  readonly divisionId: string;
  readonly kind: ElectionFieldKind;
  readonly sourceUrl: string;
  readonly value: string;
  readonly quote: string;
  readonly dates: readonly string[];
  readonly electionDate?: string;
  readonly navigationUrl?: string | null;
  readonly phone?: string | null;
  readonly document: { readonly url: string; readonly text: string; readonly collectedAt: string; readonly capture?: WorkerPublicationCapture };
  readonly linkingPage?: OfficialLinkingPage;
  readonly websiteDelegation?: GovernmentWebsiteDelegation | null;
}

export interface PublishedElectionField {
  readonly id: string;
  readonly kind: "ELECTION_FIELD";
  readonly value: {
    readonly state: string;
    readonly divisionId: string;
    readonly fieldKind: ElectionFieldKind;
    readonly text: string;
    readonly quote: string;
    readonly dates: readonly string[];
    readonly electionDate?: string;
    readonly url: string;
    readonly navigationUrl: string | null;
    readonly phone?: string | null;
    readonly verifiedAt: string;
    readonly collectedAt: string;
    readonly sourceOrg: string;
  };
}

export function electionFieldIssue(input: unknown): string | null {
  const row = input as PublishedElectionField | null;
  if (!row || row.kind !== "ELECTION_FIELD" || !row.id || !row.value) return "Election field identity is missing.";
  const value = row.value;
  const state = electionFieldState(value.divisionId);
  if (!state || value.state !== state || !ELECTION_FIELD_KINDS.includes(value.fieldKind) || !value.text?.trim() || !value.quote?.trim() ||
      !/^https:\/\//.test(value.url) || !Number.isFinite(Date.parse(value.verifiedAt)) || !Number.isFinite(Date.parse(value.collectedAt)) ||
      !Array.isArray(value.dates) || value.dates.some(date => !sourcedElectionDate(date))) return "Election field territory, value, source or source date is invalid.";
  const navigation = value.fieldKind.endsWith("_lookup") || value.fieldKind === "registration_page";
  if (value.fieldKind === "election_office") {
    if (!value.phone?.trim() || value.navigationUrl !== null && !/^https?:\/\//.test(value.navigationUrl)) return "Election office has no phone line or a valid official link.";
  } else if (navigation ? !value.navigationUrl || !/^https?:\/\//.test(value.navigationUrl) : value.navigationUrl !== null) return "Election lookup is navigation only.";
  if (value.electionDate !== undefined && !sourcedElectionDate(value.electionDate)) return "Election field has an invalid election date.";
  return null;
}
