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

const cached = new WeakMap<CandidateLinksFile, WeakMap<readonly DerivedCampaignSiteRecord[], { readonly file: CandidateLinksFile; readonly derivedKeys: ReadonlySet<string> }>>();

function composedLinks(state: string): { readonly file: CandidateLinksFile; readonly derivedKeys: ReadonlySet<string> } {
  const profiles = currentCandidateProfilesProjection(state).links;
  const derived = currentDerivedCampaignSiteRecords(state);
  const held = cached.get(profiles) ?? new WeakMap();
  const prior = held.get(derived);
  if (prior) return prior;
  const { links, derivedKeys } = composeCampaignLinks(profiles.links, derived);
  const result = { file: derivedKeys.size === 0 ? profiles : { ...profiles, links }, derivedKeys };
  held.set(derived, result);
  cached.set(profiles, held);
  return result;
}

function load(state: string): CandidateLinksFile { return composedLinks(state).file; }

export function campaignLinkIsDerived(state: string, key: string): boolean {
  return composedLinks(state).derivedKeys.has(key);
}

export function linksForCandidacy(state: string, candidacyId: string): CandidateLinks | null {
  return load(state).links[candidacyId] ?? null;
}

export function linksForNominee(
  state: string,
  contestId: string,
  name: string,
): CandidateLinks | null {
  return load(state).links[`${contestId}|${name}`] ?? null;
}

export function allCandidateLinks(state: string): CandidateLinksFile {
  return load(state);
}
