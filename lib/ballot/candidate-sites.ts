import { currentCandidateProfilesProjection } from "../civic-data/manual-read-models.ts";
import {
  composeCampaignLinks,
  currentDerivedCampaignSiteRecords,
  type DerivedCampaignSiteRecord,
} from "../civic-data/derived-campaign-sites.ts";

/**
 * Hunted-and-verified links for ballot candidates (session 2026-08-16, 2b).
 *
 * The filing's own `websiteUrl` field stays what it always was — a URL the
 * candidate stated IN the filing, carried verbatim. This module is the other
 * thing: links we went and FOUND, each verified by fetching it and reading
 * the page. The two are kept apart because they are different claims with
 * different provenance.
 *
 * Shape rules, from the brief:
 * - campaign site AND official site where the person holds office;
 * - both labeled, official primary;
 * - a URL recorded here MUST have been fetched and verified — a 404 or a
 *   generic landing is a MISS and belongs in the hunt log, never here;
 * - a candidate without a found site gets a recorded hunt in
 *   `data/ballot/candidate-links-2026.json`'s `hunts` array, not a blank.
 *
 * Keys: the candidacy id for filed candidates, or `<contestId>|<name>` for
 * certified-lineup nominees (who exist only as canvass names).
 */

export interface VerifiedLink {
  url: string;
  /** What the fetched page showed — the person and the race/office, named. */
  verification: string;
  attemptedAt: string;
  /**
   * WHAT THIS LINK IS, IN PLAIN WORDS — and where it is not "official site".
   *
   * RULING 122 and RULING 145 both turn on the same clause: a page a party
   * publishes about a candidate, or a campaign's presence on a platform, fills
   * the field **with the host labelled**. Rendering either under a bare
   * "official site" or "campaign site" would present a party's website or a
   * social platform as the candidate's own, which is the exact line the
   * organisations-render-as-filed rule draws.
   *
   * Absent, the card's own default stands — a link this project fetched on the
   * candidate's own domain needs no explaining, and adding a label to every one
   * of those would be words a reader has to read for nothing.
   */
  label?: string;
}

export interface CandidateLinks {
  /** The person's page in the office they currently hold, if any. */
  official: VerifiedLink | null;
  /** The campaign site. Rendered labeled, after the official link. */
  campaign: VerifiedLink | null;
}

export interface RecordedHunt {
  key: string;
  name: string;
  /** What was searched and what came back — the honest miss. */
  note: string;
  attemptedAt: string;
}

export interface CandidateLinksFile {
  readonly curatedAt: string;
  readonly note: string;
  readonly links: Readonly<Record<string, CandidateLinks>>;
  readonly hunts: readonly RecordedHunt[];
}

/*
 * VERIFIED CAMPAIGN SITES THE STANDING RUNNER PUBLISHED (2026-09-25) join the
 * reviewed links here, and only here, so /ballot and Ask read one set: a site
 * the campaign-site chain verified fills a candidate's campaign slot only when
 * no reviewed campaign link is held for them (lib/civic-data/derived-campaign-sites.ts).
 */
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

/** Whether this key's campaign link is a verified site the runner published, not a reviewed link. */
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
