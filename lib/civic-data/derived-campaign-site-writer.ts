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
 * - a candidacy that already carries a reviewed campaign link in
 *   `candidate-profiles` is held (the Reader enforces the same rule);
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
} from "../candidates/campaign-site-verifier.ts";

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
    };
    readonly audit: { readonly secondSignal: string };
    readonly publicationDoor: string;
  };
}

const text = (value: unknown): value is string => typeof value === "string" && value.trim() !== "";

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
    text(evidence.verifierId) && site.audit !== undefined && typeof site.audit.secondSignal === "string";
}

export const DERIVED_CAMPAIGN_SITE_HOLDS = [
  "MULTIPLE_VERIFIED_SITES",
  "PRIOR_CAMPAIGN_LINK_HELD",
  "NO_READER_KEY",
  /** The vault does not hold the verifying read's bytes: ours to restore, and nothing is published without them. */
  "EVIDENCE_NOT_HELD",
  /** The vaulted bytes are held but hash to other bytes, or do not verify again for the approval's own identity. */
  "REVERIFICATION_FAILED",
] as const;
export type DerivedCampaignSiteHoldCode = (typeof DERIVED_CAMPAIGN_SITE_HOLDS)[number];

/** The vaulted bytes of one approval's verifying read, as the writer found them. */
export interface HeldVerifyingRead {
  readonly body: string;
  /** sha256 (bare hex) the vault proved the bytes hash to. */
  readonly sha256: string;
  /** The vault's tier for them; a restricted body is never cited, so the caller never hands one here. */
  readonly tier: "RAW" | "SANITIZED_DERIVED";
  /** The robots verdict the read ran under, as its sidecar recorded it. */
  readonly permission: string | null;
}

export interface DerivedCampaignSitesPlan {
  /** The version's records, one per Reader key, sorted. */
  readonly records: readonly DerivedCampaignSiteRecord[];
  readonly published: readonly { readonly key: string; readonly candidacyId: string; readonly url: string; readonly approvalRecordId: string }[];
  readonly held: readonly { readonly key: string; readonly code: DerivedCampaignSiteHoldCode; readonly detail: string }[];
  /** Every input the version was computed from, deduplicated and sorted. */
  readonly inputs: readonly DerivedInputRef[];
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
  const read = {
    ...heldPageRead({
      requestedUrl: site.evidence.requestedUrl, finalUrl: site.evidence.finalUrl, httpStatus: site.evidence.httpStatus,
      contentType: site.evidence.contentType, body: held.body, retrievedAt: site.evidence.readAt, sha256: held.sha256,
    }),
    permissions: held.permission === null
      ? []
      : [{ origin, verdict: held.permission === "ALLOWED" ? "ALLOWED" as const : "DISALLOWED" as const, detail: `recorded on the vaulted sidecar of ${site.evidence.artifactId}` }],
  };
  const verdict = verifyCampaignSitePage(site.identity, { url: site.evidence.requestedUrl, origin: "RECORDED_SITE", ref: record.recordId }, read);
  return verdict.verdict === "VERIFIED"
    ? { ok: true, verification: verdict.verification }
    : { ok: false, detail: verdict.refusals.map((r) => `${r.code}: ${r.detail}`).join("; ") };
}

/**
 * **THE DERIVED VERSION.** Every approved campaign site, one record per Reader
 * key, from the approvals: an approval is never withdrawn from the pipeline
 * log, so the same approvals and bytes always give the same records. Pure: the
 * caller reads the approvals, their vaulted bytes and the promoted profiles.
 */
export function planDerivedCampaignSites(input: {
  readonly approvals: readonly PublishableCampaignSiteApproval[];
  /** The verifying read's vaulted bytes for one approval, or null when the vault holds none. */
  readonly held: (record: PublishableCampaignSiteApproval) => HeldVerifyingRead | null;
  /** The promoted candidate-profiles version this version is composed against, with its links; null when none is promoted. */
  readonly profiles: { readonly input: DerivedInputRef & { readonly kind: "PROMOTED_VERSION" }; readonly links: Readonly<Record<string, CandidateLinksShape>> } | null;
}): DerivedCampaignSitesPlan {
  const inputs = new Map<string, DerivedInputRef>();
  const add = (i: DerivedInputRef) => inputs.set(inputKey(i), i);
  if (input.profiles !== null) add(input.profiles.input);
  const held: { key: string; code: DerivedCampaignSiteHoldCode; detail: string }[] = [];
  const byCandidacy = new Map<string, PublishableCampaignSiteApproval[]>();
  for (const record of input.approvals) {
    /* Every approval read is an input, published or held: the version answers for each. */
    add({ kind: "PIPELINE_APPROVAL", itemId: record.itemId, recordId: record.recordId, approvedAt: record.at });
    byCandidacy.set(record.campaignSite.candidacyId, [...(byCandidacy.get(record.campaignSite.candidacyId) ?? []), record]);
  }
  const records: DerivedCampaignSiteRecord[] = [];
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
      a.record.campaignSite.url.localeCompare(b.record.campaignSite.url) || a.record.recordId.localeCompare(b.record.recordId))[0]!;
    const site = chosen.record.campaignSite;
    if (site.readerKeys.length === 0) {
      held.push({ key: candidacyId, code: "NO_READER_KEY", detail: `${candidacyId} joins no Reader key; nothing is keyed by a guess` });
      continue;
    }
    const linked = site.readerKeys.find((key) => profileLinks[key]?.campaign);
    if (linked !== undefined) {
      held.push({ key: linked, code: "PRIOR_CAMPAIGN_LINK_HELD", detail: `${linked} already carries the reviewed campaign link ${profileLinks[linked]!.campaign!.url} for ${name}; a reviewed link always wins` });
      continue;
    }
    add({ kind: "VAULTED_EVIDENCE", artifactId: site.evidence.artifactId, contentHash: `sha256-${site.evidence.sha256}`, tier: chosen.held.tier, retrievedAt: site.evidence.readAt });
    for (const key of site.readerKeys) {
      records.push({
        id: key,
        candidacyId,
        candidateName: name,
        campaign: {
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
            approvalItemId: chosen.record.itemId,
            approvalRecordId: chosen.record.recordId,
            approvedAt: chosen.record.at,
            secondSignal: site.audit.secondSignal,
          },
        },
      });
      published.push({ key, candidacyId, url: site.url, approvalRecordId: chosen.record.recordId });
    }
  }
  const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  return {
    records: records.sort(byId),
    published: published.sort((a, b) => a.key.localeCompare(b.key)),
    held: held.sort((a, b) => `${a.key}\n${a.code}`.localeCompare(`${b.key}\n${b.code}`)),
    inputs: [...inputs.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, i]) => i),
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
  const uncited = readModel.records.filter((r) => !cited.has(r.campaign.evidence.artifactId) || !cited.has(r.campaign.evidence.approvalRecordId)).map((r) => r.id);
  const violations = [
    ...(shapeIssue === null ? [] : [`the version is not a derived campaign-sites version: ${shapeIssue}`]),
    ...(uncited.length === 0 ? [] : [`record(s) ${uncited.join(", ")} rest on an approval or vaulted read the version does not name as an input`]),
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
      consumer: "the profile Reader's campaign slot (lib/ballot/candidate-sites.ts), a reviewed link always winning",
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
  readonly profiles: Parameters<typeof planDerivedCampaignSites>[0]["profiles"] | { readonly unreadable: string };
  /** Whether the activation gate opens candidate-enrichment for campaignSite (`classFieldOpen`). */
  readonly gateOpen: boolean;
  readonly now: string;
}): { readonly candidate: RoutineCandidate; readonly plan: DerivedCampaignSitesPlan | null } {
  if (!input.gateOpen) {
    return { candidate: derivedCampaignSitesFailedCandidate(input.now, "GATE_CLOSED: the activation gate does not open candidate-enrichment for campaignSite, so nothing new is published"), plan: null };
  }
  if ("unreadable" in input.approvals) {
    return { candidate: derivedCampaignSitesFailedCandidate(input.now, `The pipeline's campaign-site approvals could not be read: ${input.approvals.unreadable}`), plan: null };
  }
  if (input.profiles !== null && "unreadable" in input.profiles) {
    return { candidate: derivedCampaignSitesFailedCandidate(input.now, `The promoted candidate-profiles version could not be read: ${input.profiles.unreadable}`), plan: null };
  }
  const plan = planDerivedCampaignSites({ approvals: input.approvals, held: input.held, profiles: input.profiles });
  if (plan.records.length === 0) {
    const why = input.approvals.length === 0
      ? "NO_APPROVED_SITE_YET: the campaign-site chain has approved no site"
      : `NO_PUBLISHABLE_SITE: all ${input.approvals.length} approval(s) are held (${plan.held.map((h) => `${h.code} ${h.key}`).join("; ")})`;
    return { candidate: derivedCampaignSitesFailedCandidate(input.now, `${why}; nothing is published and the prior sites, if any, stay live.`), plan };
  }
  return { candidate: derivedCampaignSitesCandidate(plan, input.now), plan };
}
