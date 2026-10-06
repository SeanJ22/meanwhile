/**
 * **THE AUTOMATIC DOOR FOR APPROVED CAMPAIGN SITES: THE DERIVED VERSION AND ITS
 * CANDIDATE.** (2026-09-25.)
 *
 * Sean, 2026-09-21: "You may enable automatic promotion for qualifying
 * results. Fix the gap, recover value already paid for." (RULING 292.) The
 * standing runner's child (`scripts/derive-candidate-campaign-sites.mts`)
 * reads every campaign-site approval the pipeline holds, the vaulted bytes of
 * each approval's verifying read and the promoted `candidate-profiles`
 * version, and this module turns them into one version of the routine DERIVED
 * contract `candidate-campaign-sites-derived` (why a store of its own:
 * `derived-campaign-sites.ts`). No owner step: it enters
 * `processRegisteredRoutineCandidate` like every routine source.
 *
 * What it guarantees before anything is published:
 *
 * - each approval's vaulted bytes are the bytes it names (sha256), and they
 *   verify AGAIN, now, for the approval's own canonical identity, through the
 *   same verifier the chain used; the published sentence is the one the vault
 *   proves today, never the approval's copy;
 * - one person, one campaign link: two verified hosts for one candidacy hold
 *   it; several pages of one host publish the shallowest;
 * - newer fully verified evidence may refresh the same campaign URL; conflicting
 *   URLs or unproved dates retain the working link (the Reader enforces this too);
 * - the version names every input it was computed from (each approval read,
 *   each cited vaulted read, the profiles version), and its raw hash and time
 *   are exactly `derivedRetrieval` of them;
 * - everything held is an excluded fact with its reason: Admin's held records.
 *
 * Its import closure holds no filesystem writer (the civic-data firewall's
 * rule for a routine child), so the approval it reads is held structurally
 * here rather than imported from the chain.
 */
import { createHash } from "node:crypto";

import { canonicalCivicDataJson } from "./changes.ts";
import { derivedRetrieval, type DerivedInputRef } from "./derived-authority.ts";
import { derivedRequestedUrl } from "./derived-door.ts";
import {
  DERIVED_CAMPAIGN_SITES_CONTRACT_ID,
  DERIVED_CAMPAIGN_SITES_RECORD_CLASS,
  DERIVED_CAMPAIGN_SITES_SCOPE,
  DERIVED_CAMPAIGN_SITES_SOURCE_ID,
  derivedCampaignSitesProjectionIssue,
  derivedCandidateDocumentId,
  derivedCandidateRevisionId,
  type CandidateLinksShape,
  type DerivedCampaignSiteRecord,
  type DerivedCampaignSitesProjection,
} from "./derived-campaign-sites.ts";
import { sourceProjectionEvidence, type RoutineCandidate } from "./types.ts";
import {
  heldPageRead,
  sitePathLength,
  verifyCampaignSitePage,
  type CampaignSiteIdentity,
  type CampaignSiteSourceReference,
  type CampaignSiteSupportingRead,
} from "../candidates/campaign-site-verifier.ts";
import { verdictOfRecordedPermission } from "../control-plane/scheduler/robots.ts";
import { campaignLinkRefreshIssue } from "./campaign-link-refresh.ts";
import { extractHtmlText } from "../extract/html-text.ts";
import type { DerivedCampaignSiteEvidence } from "./derived-campaign-sites.ts";
import type { DerivedLinkedPublicationEvidence } from "./derived-campaign-sites.ts";
import { candidatePublicationCaptureIssue, candidatePublicationCaptureTargets, candidatePublicationLinks,
  type HeldCandidatePublicationRead as HeldLinkedPublicationRead } from "../control-plane/promotion/campaign-publication-links.ts";
export type { HeldCandidatePublicationRead as HeldLinkedPublicationRead } from "../control-plane/promotion/campaign-publication-links.ts";
import type { CandidateDocument, CandidatePublicationDate } from "../candidates/corpus.ts";
import { readHeldBytes, type HeldVaultArtifact, type VaultIndex } from "../control-plane/evidence/read-only-vault.ts";

/** The door an approval names when this writer may publish it (the chain's `CAMPAIGN_SITE_PUBLICATION_DOOR`). */
export const DERIVED_CAMPAIGN_SITE_DOOR = "CANDIDATE_CAMPAIGN_SITES_DERIVED_CONTRACT" as const;

/**
 * What the writer reads of one APPROVED campaign-site pipeline record: the
 * chain's `CampaignSiteApprovedRecord`, held structurally.
 */
export interface PublishableCampaignSiteApproval {
  readonly itemId: string;
  readonly recordId: string;
  /** When the approval was made. */
  readonly at: string;
  readonly stage: "APPROVED_FOR_PROMOTION";
  readonly campaignSite: {
    readonly candidacyId: string;
    readonly candidateName: string;
    readonly identity: CampaignSiteIdentity;
    readonly readerKeys: readonly string[];
    readonly url: string;
    readonly host: string;
    readonly verification: string;
    readonly evidence: {
      readonly verifierId: string;
      readonly artifactId: string;
      readonly attemptId: string;
      readonly sha256: string;
      readonly requestedUrl: string;
      readonly finalUrl: string;
      readonly httpStatus: number;
      readonly contentType: string;
      readonly readAt: string;
      readonly cycleSource?: CampaignSiteSourceReference;
    };
    readonly audit?: { readonly secondSignal: string };
    readonly publicationDoor: string;
  };
}

const text = (value: unknown): value is string => typeof value === "string" && value.trim() !== "";
/** Only an exact source tag identifying its own article publication time may
 * supply a publication date. A retrieval time or generic event `<time>` never
 * substitutes for it. Multiple conflicting source-stated dates stay unknown. */
function sourcePublicationDate(html: string, artifactId: string, rawContentHash: string): CandidatePublicationDate | undefined {
  const found: CandidatePublicationDate[] = [];
  // Keep offsets in the original source. Masking or rewriting HTML before
  // scanning would make a returned span unverifiable against vaulted bytes.
  const inert = [...html.matchAll(/<!--[\s\S]*?-->|<(script|style|textarea|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi)]
    .map(match => ({ start: match.index ?? -1, end: (match.index ?? -1) + match[0].length }));
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const quote = match[0], start = match.index;
    if (start === undefined || inert.some(range => start >= range.start && start < range.end) ||
      !/\bproperty\s*=\s*["']article:published_time["']/i.test(quote)) continue;
    const value = /\bcontent\s*=\s*["']([^"']+)["']/i.exec(quote)?.[1];
    if (!value || !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:[^"']+)?$/.test(value)) continue;
    if (value.includes("T") && !Number.isFinite(Date.parse(value))) continue;
    const date = value.slice(0, 10), parsed = Date.parse(`${date}T00:00:00.000Z`);
    if (!Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== date) continue;
    found.push({ date, basis: "ARTICLE_PUBLISHED_TIME_META", artifactId, rawContentHash,
      start, end: start + quote.length, quote, offsetUnit: "UTF16_CODE_UNITS" });
  }
  return new Set(found.map(row => row.date)).size === 1 ? found[0] : undefined;
}

function versionedDocument(input: { candidateKey: string; documentUrl: string; content: string; rawContentHash: string;
  artifactId: string; retrievedAt: string; contentType: string; html: string }): CandidateDocument {
  const contentHash = sha256Hex(input.content), extractorVersion = 2;
  const revisionId = derivedCandidateRevisionId({ candidateKey: input.candidateKey, documentUrl: input.documentUrl,
    rawContentHash: input.rawContentHash, contentHash, extractorVersion });
  const publicationDate = sourcePublicationDate(input.html, input.artifactId, input.rawContentHash);
  return { id: derivedCandidateDocumentId(input.candidateKey, contentHash, revisionId), candidateKey: input.candidateKey,
    sourceClass: "CAMPAIGN_SITE", basis: "HUNTED_AND_VERIFIED", metaDescription: null, documentUrl: input.documentUrl,
    contentHash, sourceContentHash: input.rawContentHash, retrievedAt: input.retrievedAt,
    contentType: input.contentType, text: input.content, extraction: "html", extractionNote: null, extractorVersion,
    sourceRevision: { revisionId, artifactId: input.artifactId, canonicalUrl: input.documentUrl,
      rawContentHash: input.rawContentHash, capturedAt: input.retrievedAt, extractionVersion: extractorVersion,
      supersedesRevisionId: null }, ...(publicationDate ? { publicationDate } : {}) };
}

/** Whether one pipeline log row is an APPROVED campaign-site record this door publishes. A row it cannot read is not one. */
export function isPublishableCampaignSiteApproval(value: unknown): value is PublishableCampaignSiteApproval {
  const r = value as Partial<PublishableCampaignSiteApproval> | null;
  const site = r?.campaignSite;
  const identity = site?.identity;
  const evidence = site?.evidence;
  return r !== null && typeof r === "object" && r.stage === "APPROVED_FOR_PROMOTION" && text(r.itemId) && text(r.recordId) && text(r.at) &&
    site !== undefined && site.publicationDoor === DERIVED_CAMPAIGN_SITE_DOOR && text(site.candidacyId) && text(site.candidateName) &&
    Array.isArray(site.readerKeys) && text(site.url) && text(site.host) && typeof site.verification === "string" &&
    identity !== undefined && text(identity.candidacyId) && text(identity.givenName) && text(identity.familyName) && text(identity.officeTitle) &&
    typeof identity.ocdId === "string" && text(identity.stateCode) && typeof identity.cycle === "number" &&
    evidence !== undefined && text(evidence.artifactId) && text(evidence.attemptId) && text(evidence.sha256) && text(evidence.requestedUrl) &&
    text(evidence.finalUrl) && typeof evidence.httpStatus === "number" && typeof evidence.contentType === "string" && text(evidence.readAt) &&
    text(evidence.verifierId);
}

export const DERIVED_CAMPAIGN_SITE_HOLDS = [
  "MULTIPLE_VERIFIED_SITES",
  "PRIOR_CAMPAIGN_LINK_HELD",
  "NO_READER_KEY",
  /** The vault does not hold the verifying read's bytes: ours to restore, and nothing is published without them. */
  "EVIDENCE_NOT_HELD",
  /** The vaulted bytes are held but hash to other bytes, or do not verify again for the approval's own identity. */
  "REVERIFICATION_FAILED",
  "PUBLICATION_TEXT_UNREADABLE",
  "LINKED_PUBLICATION_UNVERIFIED",
] as const;
export type DerivedCampaignSiteHoldCode = (typeof DERIVED_CAMPAIGN_SITE_HOLDS)[number];

/** The vaulted bytes of one approval's verifying read, as the writer found them. */
export interface HeldVerifyingRead {
  readonly body: string;
  /** sha256 (bare hex) the vault proved the bytes hash to. */
  readonly sha256: string;
  /** The vault's tier for them; a restricted body is never cited, so the caller never hands one here. */
  readonly tier: "RAW" | "SANITIZED_DERIVED";
  /** The robots verdict the read ran under, as its sidecar recorded it: evidence carried with the read, never a refusal. */
  readonly permission: string | null;
  /** Separately captured bytes for a current-candidacy source cited by the approval. */
  readonly cycleSource?: CampaignSiteSupportingRead & { readonly tier: "RAW" | "SANITIZED_DERIVED" };
}

/** Read each approval's own primary and supporting captures from their saved sidecars. */
export async function heldCampaignSiteReads(vault: VaultIndex | ((artifactId: string) => Promise<HeldVaultArtifact | null>), approvals: readonly PublishableCampaignSiteApproval[]): Promise<Map<string, HeldVerifyingRead>> {
  const capture = typeof vault === "function" ? vault : async (artifactId: string) => vault.byId.get(artifactId) ?? null;
  const held = new Map<string, HeldVerifyingRead>();
  for (const approval of approvals) {
    const artifact = await capture(approval.campaignSite.evidence.artifactId);
    if (artifact === null || artifact.tier === "RESTRICTED_RAW" || held.has(approval.recordId)) continue;
    try {
      const sourceRef = approval.campaignSite.evidence.cycleSource;
      const supporting = sourceRef ? await capture(sourceRef.artifactId) : undefined;
      const cycleSource = supporting && supporting.tier !== "RESTRICTED_RAW" && supporting.canonicalUrl && supporting.retrievedAt
        ? { source: { artifactId: supporting.id, sha256: supporting.contentHash.slice("sha256-".length),
            requestedUrl: supporting.canonicalUrl, finalUrl: supporting.retrievalUrl ?? supporting.canonicalUrl,
            httpStatus: supporting.httpStatus ?? 0, contentType: supporting.contentType, readAt: supporting.retrievedAt },
          page: heldPageRead({ requestedUrl: supporting.canonicalUrl, finalUrl: supporting.retrievalUrl ?? supporting.canonicalUrl,
            httpStatus: supporting.httpStatus ?? 0, contentType: supporting.contentType, retrievedAt: supporting.retrievedAt,
            sha256: supporting.contentHash.slice("sha256-".length), body: new TextDecoder().decode(await readHeldBytes(supporting)) }),
          tier: supporting.tier === "SANITIZED_DERIVED" ? "SANITIZED_DERIVED" as const : "RAW" as const } : undefined;
      held.set(approval.recordId, { body: new TextDecoder().decode(await readHeldBytes(artifact)),
        sha256: artifact.contentHash.slice("sha256-".length),
        tier: artifact.tier === "SANITIZED_DERIVED" ? "SANITIZED_DERIVED" : "RAW", permission: artifact.permission,
        ...(cycleSource ? { cycleSource } : {}) });
    } catch {
      /* A body that does not hash to its commitment remains owed. */
    }
  }
  return held;
}

function publicationEvidence(record: PublishableCampaignSiteApproval): DerivedCampaignSiteEvidence {
  const site = record.campaignSite;
  return { ...site.evidence, approvalItemId: record.itemId, approvalRecordId: record.recordId,
    approvedAt: record.at, ...(site.audit ? { secondSignal: site.audit.secondSignal } : {}) };
}

export interface DerivedCampaignSitesPlan {
  /** The version's records, one per Reader key, sorted. */
  readonly records: readonly DerivedCampaignSiteRecord[];
  readonly published: readonly { readonly key: string; readonly candidacyId: string; readonly url: string; readonly approvalRecordId: string }[];
  readonly held: readonly { readonly key: string; readonly code: DerivedCampaignSiteHoldCode; readonly detail: string }[];
  /** Every input the version was computed from, deduplicated and sorted. */
  readonly inputs: readonly DerivedInputRef[];
  /** Already GOOD Reader facts carried through their exact promoted version. */
  readonly prior?: PromotedCampaignSites;
}

export interface PromotedCampaignSites {
  readonly input: DerivedInputRef & { readonly kind: "PROMOTED_VERSION" };
  readonly projection: DerivedCampaignSitesProjection;
}

const inputKey = (input: DerivedInputRef): string => canonicalCivicDataJson(input);

/**
 * Verify one approval's vaulted bytes again, for the approval's own canonical
 * identity, exactly as the chain verified them: the verdict a published row
 * carries is the one the vault proves now, never the approval's copy.
 */
export function reverifyApprovedSite(record: PublishableCampaignSiteApproval, held: HeldVerifyingRead):
  | { readonly ok: true; readonly verification: string }
  | { readonly ok: false; readonly detail: string } {
  const site = record.campaignSite;
  if (held.sha256 !== site.evidence.sha256) {
    return { ok: false, detail: `the vault's bytes for ${site.evidence.artifactId} hash to ${held.sha256}, not the approved ${site.evidence.sha256}` };
  }
  let origin = site.evidence.finalUrl;
  try { origin = new URL(site.evidence.finalUrl).origin; } catch { /* kept as written; the verdict refuses a malformed URL */ }
  /* The verdict the sidecar recorded, as it was: evidence, never a refusal (owner decision 2026-09-25). None recorded, none assumed. */
  const recorded = verdictOfRecordedPermission(held.permission);
  const read = {
    ...heldPageRead({
      requestedUrl: site.evidence.requestedUrl, finalUrl: site.evidence.finalUrl, httpStatus: site.evidence.httpStatus,
      contentType: site.evidence.contentType, body: held.body, retrievedAt: site.evidence.readAt, sha256: held.sha256,
    }),
    permissions: recorded === null
      ? []
      : [{ origin, verdict: recorded, detail: `${held.permission} recorded on the vaulted sidecar of ${site.evidence.artifactId}` }],
  };
  if (site.evidence.cycleSource && (!held.cycleSource ||
    canonicalCivicDataJson(site.evidence.cycleSource) !== canonicalCivicDataJson(held.cycleSource.source))) {
    return { ok: false, detail: "the independently captured current-candidacy source is missing or differs from the approved source" };
  }
  const verdict = verifyCampaignSitePage(site.identity, { url: site.evidence.requestedUrl, origin: "RECORDED_SITE", ref: record.recordId }, read,
    site.evidence.cycleSource ? held.cycleSource : undefined);
  return verdict.verdict === "VERIFIED"
    ? { ok: true, verification: verdict.verification }
    : { ok: false, detail: verdict.refusals.map((r) => `${r.code}: ${r.detail}`).join("; ") };
}

/**
 * **THE DERIVED VERSION.** Every approved campaign site, one record per Reader
 * key, from the approvals and the exact prior GOOD version. An unavailable
 * capture is no withdrawal of its previously verified facts. Pure: the caller
 * reads the approvals, their vaulted bytes, the promoted profiles and prior.
 */
export function planDerivedCampaignSites(input: {
  readonly approvals: readonly PublishableCampaignSiteApproval[];
  /** The verifying read's vaulted bytes for one approval, or null when the vault holds none. */
  readonly held: (record: PublishableCampaignSiteApproval) => HeldVerifyingRead | null;
  /** The promoted candidate-profiles version this version is composed against, with its links; null when none is promoted. */
  readonly profiles: { readonly input: DerivedInputRef & { readonly kind: "PROMOTED_VERSION" }; readonly links: Readonly<Record<string, CandidateLinksShape>> } | null;
  readonly linkedPublications?: readonly HeldLinkedPublicationRead[];
  readonly prior?: PromotedCampaignSites | null;
}): DerivedCampaignSitesPlan {
  const inputs = new Map<string, DerivedInputRef>();
  const add = (i: DerivedInputRef) => inputs.set(inputKey(i), i);
  if (input.profiles !== null) add(input.profiles.input);
  if (input.prior) add(input.prior.input);
  const held: { key: string; code: DerivedCampaignSiteHoldCode; detail: string }[] = [];
  const byCandidacy = new Map<string, PublishableCampaignSiteApproval[]>();
  for (const record of input.approvals) {
    /* Every approval read is an input, published or held: the version answers for each. */
    add({ kind: "PIPELINE_APPROVAL", itemId: record.itemId, recordId: record.recordId, approvedAt: record.at });
    byCandidacy.set(record.campaignSite.candidacyId, [...(byCandidacy.get(record.campaignSite.candidacyId) ?? []), record]);
  }
  const records = new Map<string, DerivedCampaignSiteRecord>((input.prior?.projection.records ?? []).map(record => [record.id, record]));
  const published: { key: string; candidacyId: string; url: string; approvalRecordId: string }[] = [];
  const profileLinks = input.profiles?.links ?? {};
  for (const [candidacyId, approvals] of [...byCandidacy].sort(([a], [b]) => a.localeCompare(b))) {
    /* The vault first: an approval whose bytes are not what it says is held by name, and never counted as a site. */
    const verified: { record: PublishableCampaignSiteApproval; verification: string; held: HeldVerifyingRead }[] = [];
    for (const record of approvals) {
      const bytes = input.held(record);
      if (bytes === null) {
        held.push({ key: candidacyId, code: "EVIDENCE_NOT_HELD", detail: `the vault holds no bytes for ${record.campaignSite.evidence.artifactId}, the read ${record.recordId} rests on` });
        continue;
      }
      const again = reverifyApprovedSite(record, bytes);
      if (!again.ok) {
        held.push({ key: candidacyId, code: "REVERIFICATION_FAILED", detail: `${record.campaignSite.url} (${record.recordId}): ${again.detail}` });
        continue;
      }
      verified.push({ record, verification: again.verification, held: bytes });
    }
    if (verified.length === 0) continue;
    const hosts = [...new Set(verified.map((v) => v.record.campaignSite.host))].sort();
    const name = verified[0]!.record.campaignSite.candidateName;
    if (hosts.length > 1) {
      held.push({ key: candidacyId, code: "MULTIPLE_VERIFIED_SITES", detail: `${hosts.join(", ")} each verified for ${name}; one campaign link is never chosen by guess` });
      continue;
    }
    const chosen = [...verified].sort((a, b) => sitePathLength(a.record.campaignSite.url) - sitePathLength(b.record.campaignSite.url) ||
      a.record.campaignSite.url.localeCompare(b.record.campaignSite.url) ||
      b.record.campaignSite.evidence.readAt.localeCompare(a.record.campaignSite.evidence.readAt) || a.record.recordId.localeCompare(b.record.recordId))[0]!;
    const site = chosen.record.campaignSite;
    if (site.readerKeys.length === 0) {
      held.push({ key: candidacyId, code: "NO_READER_KEY", detail: `${candidacyId} joins no Reader key; nothing is keyed by a guess` });
      continue;
    }
    const refresh = { url: site.url, attemptedAt: site.evidence.readAt.slice(0, 10) };
    const linked = site.readerKeys.find((key) => {
      const issue = campaignLinkRefreshIssue(profileLinks[key]?.campaign, refresh);
      return issue !== null && !issue.startsWith("CAMPAIGN_READ_NOT_NEWER");
    });
    if (linked !== undefined) {
      held.push({ key: linked, code: "PRIOR_CAMPAIGN_LINK_HELD", detail: `${linked}: ${campaignLinkRefreshIssue(profileLinks[linked]?.campaign, refresh)}; the working link for ${name} is preserved` });
      continue;
    }
    const priorRefreshIssues = new Map<string, string>();
    const conflictingPrior = site.readerKeys.find(key => {
      const prior = records.get(key);
      const issue = prior ? campaignLinkRefreshIssue(prior.campaign, refresh) : null;
      if (issue !== null) priorRefreshIssues.set(key, issue);
      return issue !== null && !issue.startsWith("CAMPAIGN_READ_NOT_NEWER");
    });
    if (conflictingPrior !== undefined) {
      held.push({ key: conflictingPrior, code: "PRIOR_CAMPAIGN_LINK_HELD",
        detail: `${conflictingPrior}: CONFLICTING_CAMPAIGN_URL; the previously GOOD link remains live while the new source conflict stays owed` });
      continue;
    }
    add({ kind: "VAULTED_EVIDENCE", artifactId: site.evidence.artifactId, contentHash: `sha256-${site.evidence.sha256}`, tier: chosen.held.tier, retrievedAt: site.evidence.readAt });
    if (site.evidence.cycleSource && chosen.held.cycleSource) {
      const source = site.evidence.cycleSource;
      add({ kind: "VAULTED_EVIDENCE", artifactId: source.artifactId, contentHash: `sha256-${source.sha256}`,
        tier: chosen.held.cycleSource.tier, retrievedAt: source.readAt });
    }
    for (const key of site.readerKeys) {
      const priorRecord = records.get(key);
      const priorRefreshIssue = priorRefreshIssues.get(key);
      const samePriorApproval = priorRecord?.campaign.evidence.approvalRecordId === chosen.record.recordId &&
        priorRecord.campaign.evidence.artifactId === site.evidence.artifactId &&
        priorRecord.campaign.evidence.sha256 === site.evidence.sha256 && priorRecord.campaign.evidence.readAt === site.evidence.readAt;
      const profileRefreshIssue = campaignLinkRefreshIssue(profileLinks[key]?.campaign, refresh);
      if (profileRefreshIssue) held.push({ key, code: "PRIOR_CAMPAIGN_LINK_HELD",
        detail: `${key}: ${profileRefreshIssue}; the Reader retains its equally recent or newer reviewed profile link, while independently verified publications attach` });
      if (priorRefreshIssue && !samePriorApproval) held.push({ key, code: "PRIOR_CAMPAIGN_LINK_HELD",
        detail: `${key}: ${priorRefreshIssue}; the prior GOOD campaign link and its actual observation date remain unchanged, while independently verified publications attach` });
      const publications: NonNullable<DerivedCampaignSiteRecord["publications"]>[number][] = [...(priorRecord?.publications ?? [])];
      const inheritedPublications = new Set(publications.map(publication => publication.document.id));
      // Every independently verified captured revision survives. No new fetch,
      // inference, model call or separate publication approval is involved.
      for (const page of [...verified].sort((a, b) => a.record.campaignSite.evidence.readAt.localeCompare(b.record.campaignSite.evidence.readAt))) {
        const captured = page.record.campaignSite;
        if (!captured.readerKeys.includes(key)) continue;
        let content = "";
        try { content = extractHtmlText(page.held.body); } catch { /* named below; the separately verified link survives */ }
        if (!content) {
          held.push({ key: `${key}:${captured.evidence.artifactId}`, code: "PUBLICATION_TEXT_UNREADABLE",
            detail: "The campaign link is independently verified, but its captured page yielded no complete readable text. Document extraction repair remains owed; this is not publisher absence." });
          continue;
        }
        const document = versionedDocument({ candidateKey: key, documentUrl: captured.evidence.finalUrl, content,
          rawContentHash: captured.evidence.sha256, artifactId: captured.evidence.artifactId,
          retrievedAt: captured.evidence.readAt, contentType: captured.evidence.contentType, html: page.held.body });
        if (publications.some(row => row.document.id === document.id)) continue;
        add({ kind: "VAULTED_EVIDENCE", artifactId: captured.evidence.artifactId, contentHash: `sha256-${captured.evidence.sha256}`,
          tier: page.held.tier, retrievedAt: captured.evidence.readAt });
        publications.push({ document, evidence: publicationEvidence(page.record) });
      }
      for (const capture of input.linkedPublications ?? []) {
        const row = capture.record;
        const observed = verified.flatMap(page => candidatePublicationLinks({ html: page.held.body,
          sourceUrl: page.record.campaignSite.evidence.finalUrl, sourceArtifactId: page.record.campaignSite.evidence.artifactId,
          sourceContentHash: `sha256-${page.record.campaignSite.evidence.sha256}`,
          approvalRecordId: page.record.recordId, candidacyId }).map(link => ({ page, link })))
          .find(({ link }) => candidatePublicationCaptureTargets(link, capture));
        const source = row.publicationLink ?? observed?.link.source;
        if (!source || source.candidacyId !== candidacyId || !site.readerKeys.includes(key)) continue;
        const parent = verified.find(page => page.record.recordId === source.approvalRecordId &&
          page.record.campaignSite.evidence.artifactId === source.sourceArtifactId &&
          `sha256-${page.record.campaignSite.evidence.sha256}` === source.sourceContentHash);
        if (!parent) {
          held.push({ key: `${key}:${row.artifactId}`, code: "LINKED_PUBLICATION_UNVERIFIED",
            detail: "The linked page names no exact independently verified parent approval in this version." });
          continue;
        }
        const link = { url: observed?.link.url ?? row.canonicalUrl, source };
        const attempt = capture.attempt;
        const actualHash = sha256Hex(capture.body);
        const issue = candidatePublicationCaptureIssue(link, parent.held.body, capture);
        if (issue !== null) {
          held.push({ key: `${key}:${row.artifactId}`, code: "LINKED_PUBLICATION_UNVERIFIED",
            detail: `The linked page remains owed: ${issue}.` });
          continue;
        }
        let content = "";
        try { content = extractHtmlText(capture.body); } catch { /* a failed extraction stays a named hold */ }
        if (!content) {
          held.push({ key: `${key}:${row.artifactId}`, code: "PUBLICATION_TEXT_UNREADABLE",
            detail: "The linked candidate page was captured, but complete readable text was not extracted." });
          continue;
        }
        const document = versionedDocument({ candidateKey: key, documentUrl: capture.vaultRetrievalUrl!, content,
          rawContentHash: actualHash, artifactId: row.artifactId, retrievedAt: capture.vaultRetrievedAt!,
          contentType: row.contentType, html: capture.body });
        if (publications.some(existing => existing.document.id === document.id)) continue;
        add({ kind: "VAULTED_EVIDENCE", artifactId: source.sourceArtifactId, contentHash: source.sourceContentHash,
          tier: parent.held.tier, retrievedAt: parent.record.campaignSite.evidence.readAt });
        add({ kind: "VAULTED_EVIDENCE", artifactId: row.artifactId, contentHash: row.contentHash,
          tier: row.tier as "RAW" | "SANITIZED_DERIVED", retrievedAt: capture.vaultRetrievedAt! });
        const evidence: DerivedLinkedPublicationEvidence = { kind: "LINKED_PAGE", approvalItemId: parent.record.itemId,
          approvalRecordId: parent.record.recordId, sourceArtifactId: source.sourceArtifactId,
          sourceContentHash: source.sourceContentHash, sourceUrl: source.sourceUrl,
          hrefStart: source.start, hrefEnd: source.end, hrefQuote: source.quote, offsetUnit: source.offsetUnit,
          artifactId: row.artifactId, attemptId: attempt.id, sha256: actualHash,
          requestedUrl: row.canonicalUrl, finalUrl: capture.vaultRetrievalUrl!,
          httpStatus: capture.vaultHttpStatus!, readAt: row.recordedAt };
        publications.push({ document, evidence });
      }
      // Supersession is only a relation among distinct captured revisions of
      // this exact URL and extractor. It never compares one campaign page to
      // another or treats the latest retrieval as a source publication date.
      const byUrl = new Map<string, typeof publications>();
      for (const publication of publications) {
        const doc = publication.document;
        if (!doc.sourceRevision) continue;
        const lineage = `${doc.documentUrl}\u0000${doc.sourceRevision.extractionVersion}`;
        byUrl.set(lineage, [...(byUrl.get(lineage) ?? []), publication]);
      }
      for (const lineage of byUrl.values()) {
        lineage.sort((a, b) => a.document.retrievedAt.localeCompare(b.document.retrievedAt) ||
          a.document.sourceRevision!.revisionId.localeCompare(b.document.sourceRevision!.revisionId));
        for (let index = 1; index < lineage.length; index += 1) {
          const current = lineage[index]!, previous = lineage[index - 1]!;
          if (inheritedPublications.has(current.document.id)) continue;
          publications[publications.indexOf(current)] = { ...current, document: { ...current.document,
            sourceRevision: { ...current.document.sourceRevision!, supersedesRevisionId: previous.document.sourceRevision!.revisionId } } };
        }
      }
      records.set(key, {
        id: key,
        candidacyId,
        candidateName: name,
        publications,
        campaign: priorRecord && priorRefreshIssue ? priorRecord.campaign : {
          url: site.url,
          verification: chosen.verification,
          attemptedAt: site.evidence.readAt.slice(0, 10),
          evidence: {
            verifierId: site.evidence.verifierId,
            artifactId: site.evidence.artifactId,
            attemptId: site.evidence.attemptId,
            sha256: site.evidence.sha256,
            requestedUrl: site.evidence.requestedUrl,
            finalUrl: site.evidence.finalUrl,
            httpStatus: site.evidence.httpStatus,
            readAt: site.evidence.readAt,
            ...(site.evidence.cycleSource ? { cycleSource: site.evidence.cycleSource } : {}),
            approvalItemId: chosen.record.itemId,
            approvalRecordId: chosen.record.recordId,
            approvedAt: chosen.record.at,
            ...(site.audit ? { secondSignal: site.audit.secondSignal } : {}),
          },
        },
      });
      published.push({ key, candidacyId, url: site.url, approvalRecordId: chosen.record.recordId });
    }
  }
  const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  return {
    records: [...records.values()].sort(byId),
    published: published.sort((a, b) => a.key.localeCompare(b.key)),
    held: held.sort((a, b) => `${a.key}\n${a.code}`.localeCompare(`${b.key}\n${b.code}`)),
    inputs: [...inputs.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, i]) => i),
    ...(input.prior ? { prior: input.prior } : {}),
  };
}

const DERIVED_CAMPAIGN_SITES_PARSER = "candidate-campaign-site-chain/1" as const;
const sha256Hex = (value: string): string => createHash("sha256").update(value).digest("hex");
const FACT_KIND = "2026 candidates' campaign sites, each read robots-first by our own Attempt, verified on vaulted bytes and approved by the campaign-site chain";

export function derivedCampaignSitesProjection(plan: DerivedCampaignSitesPlan): DerivedCampaignSitesProjection {
  return { kind: "candidate-campaign-sites-derived", formatVersion: 1, records: plan.records };
}

/**
 * The derived version's candidate: authentic only as the inputs it names
 * (`retrieval.derived`). Its semantic violations are every rule its records
 * break, so a malformed version is never GOOD; its holds are excluded facts,
 * Admin's held records.
 */
export function derivedCampaignSitesCandidate(plan: DerivedCampaignSitesPlan, attemptedAt: string): RoutineCandidate {
  const readModel = derivedCampaignSitesProjection(plan);
  const retrieval = derivedRetrieval(plan.inputs);
  const succeeded = retrieval.retrievedAt !== null;
  const retrievedAt = retrieval.retrievedAt ?? attemptedAt;
  const shapeIssue = derivedCampaignSitesProjectionIssue(readModel);
  const cited = new Set(plan.inputs.flatMap((i) => (i.kind === "VAULTED_EVIDENCE" ? [i.artifactId] : i.kind === "PIPELINE_APPROVAL" ? [i.recordId] : [])));
  const priorValid = plan.prior !== undefined && plan.prior.input.recordClass === DERIVED_CAMPAIGN_SITES_RECORD_CLASS &&
    plan.prior.input.scope === DERIVED_CAMPAIGN_SITES_SCOPE &&
    sha256Hex(canonicalCivicDataJson(plan.prior.projection)) === plan.prior.input.readModelSha256 &&
    plan.inputs.some(input => canonicalCivicDataJson(input) === canonicalCivicDataJson(plan.prior!.input));
  const inherited = new Map((priorValid ? plan.prior!.projection.records : []).map(record => [record.id, record]));
  const inheritedIdentity = (record: DerivedCampaignSiteRecord) => {
    const prior = inherited.get(record.id);
    return prior?.candidacyId === record.candidacyId && prior?.candidateName === record.candidateName ? prior : undefined;
  };
  const uncited = readModel.records.filter(r =>
    (!cited.has(r.campaign.evidence.artifactId) || !cited.has(r.campaign.evidence.approvalRecordId)) &&
    canonicalCivicDataJson(r.campaign) !== canonicalCivicDataJson(inheritedIdentity(r)?.campaign)).map(r => r.id);
  const uncitedPublications = readModel.records.flatMap(r => (r.publications ?? []).filter(p => !cited.has(p.evidence.artifactId) ||
    !cited.has(p.evidence.approvalRecordId) || ("kind" in p.evidence && p.evidence.kind === "LINKED_PAGE" && !cited.has(p.evidence.sourceArtifactId)))
    .filter(p => !(inheritedIdentity(r)?.publications ?? []).some(prior => canonicalCivicDataJson(prior) === canonicalCivicDataJson(p))).map(p => p.document.id));
  const violations = [
    ...(shapeIssue === null ? [] : [`the version is not a derived campaign-sites version: ${shapeIssue}`]),
    ...(plan.prior && !priorValid ? ["the inherited campaign facts do not match their referenced promoted version"] : []),
    ...(uncited.length === 0 ? [] : [`record(s) ${uncited.join(", ")} rest on an approval or vaulted read the version does not name as an input`]),
    ...(uncitedPublications.length === 0 ? [] : [`publication(s) ${uncitedPublications.join(", ")} lack their exact approved capture input`]),
  ];
  const normalized = sha256Hex(canonicalCivicDataJson(readModel));
  const normalizedPayload = {
    readModel,
    decisions: { published: plan.published.map((p) => p.key), held: plan.held.map((h) => `${h.code}:${h.key}`) },
  };
  return {
    id: `cv-${sha256Hex(`${DERIVED_CAMPAIGN_SITES_CONTRACT_ID}\u001f${DERIVED_CAMPAIGN_SITES_SCOPE}\u001f${retrieval.rawHash}\u001f${retrievedAt}\u001f${attemptedAt}\u001f${normalized}`).slice(0, 32)}`,
    sourceId: DERIVED_CAMPAIGN_SITES_SOURCE_ID,
    recordClass: DERIVED_CAMPAIGN_SITES_RECORD_CLASS,
    scope: DERIVED_CAMPAIGN_SITES_SCOPE,
    sourceProjectionEvidence: sourceProjectionEvidence(DERIVED_CAMPAIGN_SITES_SOURCE_ID, DERIVED_CAMPAIGN_SITES_RECORD_CLASS, DERIVED_CAMPAIGN_SITES_SCOPE),
    retrieval: {
      succeeded,
      requestedUrl: derivedRequestedUrl(DERIVED_CAMPAIGN_SITES_SOURCE_ID, DERIVED_CAMPAIGN_SITES_SCOPE),
      finalUrl: null,
      httpStatus: null,
      retrievedAt,
      rawHash: succeeded ? retrieval.rawHash : null,
      ...(succeeded ? {} : { failureDetail: "No timed input: the derived campaign sites cannot claim when they were computed from." }),
      derived: { inputs: plan.inputs },
    },
    normalization: {
      succeeded: true,
      parserVersion: DERIVED_CAMPAIGN_SITES_PARSER,
      schemaVersion: "candidate-campaign-sites-derived:1",
      normalizedHash: normalized,
      normalizedPayloadHash: sha256Hex(canonicalCivicDataJson(normalizedPayload)),
      inputRecords: readModel.records.length,
      outputRecords: readModel.records.length,
      droppedRecords: 0,
      missingRequiredFields: [],
    },
    identities: readModel.records.map((record) => ({
      subjectId: record.id,
      jurisdiction: "US",
      identifiers: { record_id: record.id, candidacy_id: record.candidacyId },
      matchBasis: "EXACT_SCOPED_ID" as const,
      ambiguous: false,
    })),
    temporal: { version: DERIVED_CAMPAIGN_SITES_SCOPE, expectedVersion: DERIVED_CAMPAIGN_SITES_SCOPE, sourceThrough: retrievedAt, staleAtRetrieval: false },
    semantics: { factKind: FACT_KIND, violations },
    horizon: {
      kind: "OPEN_FACT_SET",
      query: "every campaign site the campaign-site chain approved; no claim that a candidate the version does not name has no site",
      returnedRecords: readModel.records.length,
      declaredTotal: null,
      paginationComplete: false,
      claimsComplete: false,
    },
    absence: { claimsAbsence: false, basis: "NONE", exactSubject: null, exactHorizon: null },
    dependentChecks: [{
      consumer: "the profile Reader's campaign slot (lib/ballot/candidate-sites.ts), preserving working links on conflicts and failed updates",
      passed: violations.length === 0,
      detail: `${readModel.records.length} Reader key(s) over ${new Set(readModel.records.map((r) => r.candidacyId)).size} candidacy(ies); ${plan.held.length} approval(s) held by name.`,
    }],
    normalizedPayload,
    readModel,
    excludedFacts: plan.held.map((h) => ({
      key: `campaign-site:${h.key}|${h.code}`,
      code: `CAMPAIGN_SITE_HELD_${h.code}`,
      detail: h.detail,
      record: { key: h.key, reason: h.code },
    })),
  };
}

/** A pass that cannot read its inputs, or has nothing approved to publish, records a refused candidate; the last known good sites stay live. */
export function derivedCampaignSitesFailedCandidate(attemptedAt: string, failureDetail: string): RoutineCandidate {
  return {
    id: `cv-${sha256Hex(`${DERIVED_CAMPAIGN_SITES_CONTRACT_ID}\u001f${DERIVED_CAMPAIGN_SITES_SCOPE}\u001ffailed\u001f${attemptedAt}`).slice(0, 32)}`,
    sourceId: DERIVED_CAMPAIGN_SITES_SOURCE_ID,
    recordClass: DERIVED_CAMPAIGN_SITES_RECORD_CLASS,
    scope: DERIVED_CAMPAIGN_SITES_SCOPE,
    sourceProjectionEvidence: sourceProjectionEvidence(DERIVED_CAMPAIGN_SITES_SOURCE_ID, DERIVED_CAMPAIGN_SITES_RECORD_CLASS, DERIVED_CAMPAIGN_SITES_SCOPE),
    retrieval: { succeeded: false, requestedUrl: derivedRequestedUrl(DERIVED_CAMPAIGN_SITES_SOURCE_ID, DERIVED_CAMPAIGN_SITES_SCOPE), finalUrl: null, httpStatus: null, retrievedAt: attemptedAt, rawHash: null, failureDetail },
    normalization: {
      succeeded: false, parserVersion: DERIVED_CAMPAIGN_SITES_PARSER, schemaVersion: "candidate-campaign-sites-derived:1", normalizedHash: null,
      inputRecords: 0, outputRecords: 0, droppedRecords: 0, missingRequiredFields: [], failureDetail,
    },
    identities: [],
    temporal: { version: DERIVED_CAMPAIGN_SITES_SCOPE, expectedVersion: DERIVED_CAMPAIGN_SITES_SCOPE, sourceThrough: attemptedAt, staleAtRetrieval: false },
    semantics: { factKind: FACT_KIND, violations: [] },
    horizon: { kind: "OPEN_FACT_SET", query: "no inputs read", returnedRecords: 0, declaredTotal: null, paginationComplete: false, claimsComplete: false },
    absence: { claimsAbsence: false, basis: "NONE", exactSubject: null, exactHorizon: null },
    dependentChecks: [],
    normalizedPayload: null,
    readModel: null,
  };
}

/**
 * **ONE PASS OF THE DOOR.** What the child promotes, decided from what it
 * read. A read that failed, a closed gate, or no approved site yet refuses the
 * pass by name (the prior GOOD sites stay live); otherwise the planned version.
 */
export function derivedCampaignSitesPass(input: {
  readonly approvals: readonly PublishableCampaignSiteApproval[] | { readonly unreadable: string };
  readonly held: (record: PublishableCampaignSiteApproval) => HeldVerifyingRead | null;
  readonly linkedPublications?: readonly HeldLinkedPublicationRead[];
  readonly prior?: PromotedCampaignSites | null | { readonly unreadable: string };
  readonly profiles: Parameters<typeof planDerivedCampaignSites>[0]["profiles"] | { readonly unreadable: string };
  /** Accepted for older callers only; §3 publication is automatic. */
  readonly gateOpen?: boolean;
  readonly now: string;
}): { readonly candidate: RoutineCandidate; readonly plan: DerivedCampaignSitesPlan | null } {
  if ("unreadable" in input.approvals) {
    return { candidate: derivedCampaignSitesFailedCandidate(input.now, `The pipeline's campaign-site approvals could not be read: ${input.approvals.unreadable}`), plan: null };
  }
  if (input.profiles !== null && "unreadable" in input.profiles) {
    return { candidate: derivedCampaignSitesFailedCandidate(input.now, `The promoted candidate-profiles version could not be read: ${input.profiles.unreadable}`), plan: null };
  }
  if (input.prior && "unreadable" in input.prior) {
    return { candidate: derivedCampaignSitesFailedCandidate(input.now, `The prior GOOD campaign-sites version could not be read: ${input.prior.unreadable}`), plan: null };
  }
  const plan = planDerivedCampaignSites({ approvals: input.approvals, held: input.held, profiles: input.profiles, prior: input.prior,
    linkedPublications: input.linkedPublications });
  if (plan.records.length === 0) {
    const why = input.approvals.length === 0
      ? "NO_APPROVED_SITE_YET: the campaign-site chain has approved no site"
      : `NO_PUBLISHABLE_SITE: all ${input.approvals.length} approval(s) are held (${plan.held.map((h) => `${h.code} ${h.key}`).join("; ")})`;
    return { candidate: derivedCampaignSitesFailedCandidate(input.now, `${why}; nothing is published and the prior sites, if any, stay live.`), plan };
  }
  return { candidate: derivedCampaignSitesCandidate(plan, input.now), plan };
}
