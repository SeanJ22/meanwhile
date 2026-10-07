import { currentCandidateProfilesProjection } from "../civic-data/manual-read-models.ts";
import {
  composeCampaignLinks,
  currentDerivedCampaignSiteRecords,
  type DerivedCampaignSiteRecord,
} from "../civic-data/derived-campaign-sites.ts";

export interface VerifiedLink {
  url: string;
  verification: string;
  attemptedAt: string;
  label?: string;
}

export interface CandidateLinks {
  official: VerifiedLink | null;
  campaign: VerifiedLink | null;
}

export interface RecordedHunt {
  key: string;
  name: string;
  note: string;
  attemptedAt: string;
}

export interface CandidateLinksFile {
  readonly curatedAt: string;
  readonly note: string;
  readonly links: Readonly<Record<string, CandidateLinks>>;
  readonly hunts: readonly RecordedHunt[];
}

let composedFrom: { readonly profiles: CandidateLinksFile; readonly derived: readonly DerivedCampaignSiteRecord[] } | null = null;
let composed: { readonly file: CandidateLinksFile; readonly derivedKeys: ReadonlySet<string> } | null = null;

function composedLinks(): { readonly file: CandidateLinksFile; readonly derivedKeys: ReadonlySet<string> } {
  const profiles = currentCandidateProfilesProjection().links;
  const derived = currentDerivedCampaignSiteRecords();
  if (composed !== null && composedFrom?.profiles === profiles && composedFrom.derived === derived) return composed;
  const { links, derivedKeys } = composeCampaignLinks(profiles.links, derived);
  composed = { file: derivedKeys.size === 0 ? profiles : { ...profiles, links }, derivedKeys };
  composedFrom = { profiles, derived };
  return composed;
}

function load(): CandidateLinksFile {
  return composedLinks().file;
}

export function campaignLinkIsDerived(key: string): boolean {
  return composedLinks().derivedKeys.has(key);
}

export function linksForCandidacy(candidacyId: string): CandidateLinks | null {
  return load().links[candidacyId] ?? null;
}

export function linksForNominee(
  contestId: string,
  name: string,
): CandidateLinks | null {
  return load().links[`${contestId}|${name}`] ?? null;
}

export function allCandidateLinks(): CandidateLinksFile {
  return load();
}
