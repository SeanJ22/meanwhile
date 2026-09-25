/**
 * **VERIFIED CAMPAIGN SITES THE STANDING RUNNER PUBLISHES, READ BESIDE THE
 * CANDIDATE PROFILES.** (2026-09-25.)
 *
 * Sean, 2026-09-21: "You may enable automatic promotion for qualifying
 * results. Fix the gap, recover value already paid for." (RULING 292.) A
 * campaign site qualifies only through the complete chain
 * (`lib/control-plane/promotion/campaign-site-chain.ts`): our own robots-first
 * read, five measured checks, an audit with measured controls and an
 * independent second signal, and the approval burdens.
 *
 * ## Why a derived store of its own, not the `candidate-profiles` pointer
 *
 * `candidate-profiles` is the owner's door (EXPLICIT_OWNER_INVOCATION_ONLY),
 * and one pointer has one writer: the civic-data firewall refuses a routine
 * adapter that reaches a manual door, and a second, clocked writer of the
 * profiles pointer would race the owner's reviewed packages. So the runner
 * writes this store only (routine contract `candidate-campaign-sites-derived`,
 * DERIVED: authentic only as its pipeline approvals, their vaulted bytes and
 * the promoted `candidate-profiles` version it was composed against), and the
 * profile Reader composes the two:
 *
 * - a derived link fills a Reader key's `campaign` slot only when no key of
 *   the same candidacy already carries a campaign link in `candidate-profiles`:
 *   one person, one campaign link, and a reviewed link always wins;
 * - the key's official link, card and hunts stay exactly as `candidate-profiles`
 *   holds them;
 * - the link renders through the same slot and the same `{url, verification,
 *   attemptedAt}` every campaign link uses, so /ballot and Ask show it exactly
 *   as they show a reviewed one; Ask names this pointer as the link's holding.
 *
 * A malformed version is never served, and a store error stays an error: the
 * profile Reader then shows what `candidate-profiles` holds and nothing more.
 */
import {
  civicDataReadNotInitialized,
  readPromotedCivicData,
  type CivicDataReadResult,
  type PromotedCivicDataReadOptions,
} from "./read-model.ts";

/**
 * The Reader's link shapes (`VerifiedLink`, `CandidateLinks` in
 * lib/ballot/candidate-sites.ts), held structurally: the runner's writer child
 * imports this module, and its import closure may not reach the Reader.
 */
export interface VerifiedLinkShape {
  readonly url: string;
  readonly verification: string;
  readonly attemptedAt: string;
  readonly label?: string;
}
export interface CandidateLinksShape {
  readonly official: VerifiedLinkShape | null;
  readonly campaign: VerifiedLinkShape | null;
}

export const DERIVED_CAMPAIGN_SITES_CONTRACT_ID = "candidate-campaign-sites-derived" as const;
export const DERIVED_CAMPAIGN_SITES_SOURCE_ID = "candidate-campaign-site-chain" as const;
export const DERIVED_CAMPAIGN_SITES_RECORD_CLASS = "CURATED_READER_RECORD" as const;
export const DERIVED_CAMPAIGN_SITES_SCOPE = "US:candidate-campaign-sites-derived" as const;

/** What a published link rests on: the verifying read's vaulted bytes and the approval, named exactly. */
export interface DerivedCampaignSiteEvidence {
  readonly verifierId: string;
  readonly artifactId: string;
  readonly attemptId: string;
  /** sha256 (bare hex) of the exact vaulted bytes. */
  readonly sha256: string;
  readonly requestedUrl: string;
  readonly finalUrl: string;
  readonly httpStatus: number;
  readonly readAt: string;
  readonly approvalItemId: string;
  readonly approvalRecordId: string;
  readonly approvedAt: string;
  /** The audit's independent second signal, as it recorded it. */
  readonly secondSignal: string;
}

/** A campaign link as this store publishes it: the Reader's own link shape, and its evidence. */
export type DerivedCampaignLink = VerifiedLinkShape & { readonly evidence: DerivedCampaignSiteEvidence };

/** One Reader key's verified campaign site. */
export interface DerivedCampaignSiteRecord {
  /** The Reader key: a ballot candidacy id, or a lineup nominee's `<contestId>|<Name>`. */
  readonly id: string;
  /** The canonical candidacy the site verified for. */
  readonly candidacyId: string;
  readonly candidateName: string;
  readonly campaign: DerivedCampaignLink;
}

export interface DerivedCampaignSitesProjection {
  readonly kind: "candidate-campaign-sites-derived";
  readonly formatVersion: 1;
  readonly records: readonly DerivedCampaignSiteRecord[];
}

/** The one sentence template every verified campaign link carries (the chain's rendering-symmetry check). */
export const CAMPAIGN_SITE_VERIFICATION_TEMPLATE = /^Fetched \d{4}-\d{2}-\d{2} \(campaign-site-verifier\/1\): '.+' — names .+, the (office|district) \(".+"\), and the \d{4} election\.$/;

const SHA256 = /^[a-f0-9]{64}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const text = (value: unknown): value is string => typeof value === "string" && value.trim() !== "";
const instant = (value: unknown): value is string => typeof value === "string" && Number.isFinite(Date.parse(value));
const https = (value: unknown): boolean => {
  try {
    const url = new URL(String(value));
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
};

/** Why a projection is not a derived campaign-sites version, or null. Checked on every read: a malformed version is never served. */
export function derivedCampaignSitesProjectionIssue(value: unknown): string | null {
  const v = value as Partial<DerivedCampaignSitesProjection> | null;
  if (typeof v !== "object" || v === null || v.kind !== "candidate-campaign-sites-derived" || v.formatVersion !== 1 || !Array.isArray(v.records)) {
    return "not a derived candidate campaign-sites version";
  }
  const ids = new Set<string>();
  const urlByCandidacy = new Map<string, string>();
  for (const record of v.records) {
    const link = record?.campaign;
    const evidence = link?.evidence;
    if (!record || !text(record.id) || ids.has(record.id)) return "a record has no Reader key, or a duplicate one";
    ids.add(record.id);
    if (!text(record.candidacyId) || !text(record.candidateName)) return `${record.id} names no canonical candidacy`;
    if (!link || !https(link.url)) return `${record.id}: its campaign link is not an https URL`;
    if (!CAMPAIGN_SITE_VERIFICATION_TEMPLATE.test(link.verification ?? "")) return `${record.id}: its verification does not follow the one sentence template`;
    if (!DAY.test(link.attemptedAt ?? "")) return `${record.id}: its read date is not a day`;
    if (link.label !== undefined) return `${record.id}: a verified campaign link carries no label`;
    if (!evidence || !SHA256.test(evidence.sha256 ?? "") || !text(evidence.artifactId) || !text(evidence.attemptId) || !text(evidence.verifierId) ||
        !instant(evidence.readAt) || evidence.readAt.slice(0, 10) !== link.attemptedAt || !https(evidence.finalUrl) || !text(evidence.requestedUrl) ||
        !Number.isInteger(evidence.httpStatus) || evidence.httpStatus < 200 || evidence.httpStatus >= 300 ||
        !text(evidence.approvalItemId) || !text(evidence.approvalRecordId) || !instant(evidence.approvedAt) || !text(evidence.secondSignal)) {
      return `${record.id}: its evidence does not name its vaulted read and its approval exactly`;
    }
    /* One person, one campaign link: every key of one candidacy carries the same site. */
    const prior = urlByCandidacy.get(record.candidacyId);
    if (prior !== undefined && prior !== link.url) return `${record.candidacyId} carries two campaign links (${prior}, ${link.url})`;
    urlByCandidacy.set(record.candidacyId, link.url);
  }
  return null;
}

let installed: CivicDataReadResult<DerivedCampaignSitesProjection> | null = null;

/** Read the promoted derived campaign sites, refusing a malformed version. A store error stays an error, never "no sites". */
export async function readDerivedCampaignSites(
  options: PromotedCivicDataReadOptions = {},
): Promise<CivicDataReadResult<DerivedCampaignSitesProjection>> {
  const result = await readPromotedCivicData<DerivedCampaignSitesProjection>(DERIVED_CAMPAIGN_SITES_RECORD_CLASS, DERIVED_CAMPAIGN_SITES_SCOPE, options);
  if (result.kind === "PROMOTED") {
    const issue = derivedCampaignSitesProjectionIssue(result.value);
    if (issue !== null) {
      installed = { kind: "STORE_UNREACHABLE", value: null, metadata: result.metadata, code: "PROMOTION_PROOF_INVALID", detail: `${DERIVED_CAMPAIGN_SITES_CONTRACT_ID} ${result.metadata.versionId}: ${issue}` };
      return installed;
    }
  }
  installed = result;
  return result;
}

/**
 * Refresh this process's derived sites for the profile Reader, in their own
 * failure domain: whatever happens here, the profile read it accompanies is
 * unaffected, and a failure is kept as this store's read state.
 */
export async function refreshDerivedCampaignSites(options: PromotedCivicDataReadOptions = {}): Promise<CivicDataReadResult<DerivedCampaignSitesProjection>> {
  try {
    return await readDerivedCampaignSites(options);
  } catch (error) {
    installed = {
      kind: "STORE_UNREACHABLE", value: null,
      metadata: civicDataReadNotInitialized(DERIVED_CAMPAIGN_SITES_RECORD_CLASS, DERIVED_CAMPAIGN_SITES_SCOPE, "").metadata,
      code: "STORE_READ_FAILED",
      detail: `${DERIVED_CAMPAIGN_SITES_CONTRACT_ID}: ${error instanceof Error ? error.message : String(error)}`,
    };
    return installed;
  }
}

export function derivedCampaignSitesReadState(): CivicDataReadResult<DerivedCampaignSitesProjection> {
  return installed ?? civicDataReadNotInitialized(DERIVED_CAMPAIGN_SITES_RECORD_CLASS, DERIVED_CAMPAIGN_SITES_SCOPE, "The derived candidate campaign sites have not been read for this process.");
}

/** Where Ask names a derived link as held: this pointer, at the record's own Reader key. */
export function derivedCampaignSiteHoldingPath(key: string): string {
  return `civic-data:${DERIVED_CAMPAIGN_SITES_RECORD_CLASS}:${DERIVED_CAMPAIGN_SITES_SCOPE}#/records/${key.replaceAll("~", "~0").replaceAll("/", "~1")}/campaign`;
}

export interface ComposedCandidateLinks<L extends CandidateLinksShape> {
  readonly links: Readonly<Record<string, L | CandidateLinksShape>>;
  /** The Reader keys whose campaign link this store supplied. */
  readonly derivedKeys: ReadonlySet<string>;
}

/**
 * **A REVIEWED LINK ALWAYS WINS.** Compose the profile links with the derived
 * sites: a candidacy whose any Reader key already carries a campaign link in
 * `candidate-profiles` keeps it, on every key; otherwise each of its keys gets
 * the derived link, beside the official link profiles hold for that key. Pure.
 */
export function composeCampaignLinks<L extends CandidateLinksShape>(
  profiles: Readonly<Record<string, L>>,
  derived: readonly DerivedCampaignSiteRecord[],
): ComposedCandidateLinks<L> {
  const byCandidacy = new Map<string, DerivedCampaignSiteRecord[]>();
  for (const record of derived) byCandidacy.set(record.candidacyId, [...(byCandidacy.get(record.candidacyId) ?? []), record]);
  const links: Record<string, L | CandidateLinksShape> = { ...profiles };
  const derivedKeys = new Set<string>();
  for (const records of byCandidacy.values()) {
    if (records.some((record) => profiles[record.id]?.campaign)) continue;
    for (const record of records) {
      links[record.id] = { official: profiles[record.id]?.official ?? null, campaign: record.campaign };
      derivedKeys.add(record.id);
    }
  }
  return { links, derivedKeys };
}

const NO_RECORDS: readonly DerivedCampaignSiteRecord[] = [];

/** The derived records this process holds for the Reader, or none when the store was not read, is empty, or failed. */
export function currentDerivedCampaignSiteRecords(): readonly DerivedCampaignSiteRecord[] {
  const state = derivedCampaignSitesReadState();
  return state.kind === "PROMOTED" ? state.value.records : NO_RECORDS;
}
