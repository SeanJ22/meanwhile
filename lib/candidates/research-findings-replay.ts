/**
 * **HELD RESEARCH FINDINGS, REPLAYED — READ-ONLY.** (2026-09-25.)
 *
 * What paid research and the free Marginalia route already hold, run through
 * the campaign-site verifier and the complete chain, to answer three
 * questions without touching production: how many held findings verify, why
 * every other one is refused, and what `candidate-profiles` version would be
 * published.
 *
 * Two modes, and the difference is the point:
 *
 * - **OFFLINE** judges the bytes the vault already holds. A Scout's own vaulted
 *   page can show what a finding points at, but it can never CONFIRM the
 *   finding (the pipeline refuses the Scout's own Attempt), so OFFLINE reports
 *   verdicts and the would-be LINKS, never a door-shaped package. A lead the
 *   vault holds no bytes for is NOT_READ, still owed — never refused.
 * - **LIVE** runs the whole chain on an isolated in-memory control plane: our
 *   own robots-first read (injected `ResearchRuntime`), the checks, the audit,
 *   the approval, then `planCampaignSitePublication`. Only LIVE writes a
 *   `candidate-profiles` package, for the owner's installed-runtime door.
 *
 * Nothing here writes a production store, a tracked path or the runner's vault.
 */
import { createHash } from "node:crypto";

import { evaluatePermission, DEFAULT_ROBOTS_TOKEN } from "../control-plane/scheduler/robots.ts";
import { createMemoryRepositories } from "../control-plane/repository/memory.ts";
import type { ArtifactRecord } from "../control-plane/repository/types.ts";
import { appendTransition, contextFromRepositories, scoutResultItemId } from "../control-plane/promotion/pipeline.ts";
import { PROMOTION_PIPELINE_FORMAT_VERSION, type ActivationGateReading, type ScoutedRecord } from "../control-plane/promotion/types.ts";
import {
  CAMPAIGN_SITE_FIELD,
  CAMPAIGN_SITE_RECORD_CLASS,
  marginaliaLeads,
  projectCampaignSiteChains,
  type CampaignSiteApprovedRecord,
  type CampaignSiteChainReport,
  type CampaignSiteSubject,
  type HeldMarginaliaResponse,
  type LeadReadResult,
} from "../control-plane/promotion/campaign-site-chain.ts";
import { campaignSiteReadRecorder } from "../control-plane/promotion/campaign-site-reads.ts";
import { planCampaignSitePublication, type CampaignSitePublicationPlan } from "../civic-data/campaign-site-publication.ts";
import type { ManualProjectionPrior } from "../civic-data/manual-projections.ts";
import type { ResearchRuntime } from "../hunt/robots-first-fetch.ts";
import {
  campaignSiteHostRefusal,
  candidateDisplayName,
  heldPageRead,
  readCampaignSiteLead,
  siteHost,
  verifyCampaignSitePage,
  type CampaignSiteLead,
  type CampaignSiteRefusalCode,
} from "./campaign-site-verifier.ts";

/** One vaulted read the replay may use: a Scout's page, a robots.txt reading, an index answer. */
export interface HeldRead {
  readonly artifactId: string;
  readonly attemptId: string;
  readonly canonicalUrl: string;
  readonly contentType: string;
  readonly httpStatus: number;
  readonly retrievedAt: string;
  readonly body: string;
  /** sha256 (bare hex) of the held bytes. */
  readonly sha256: string;
  readonly methodRouteId: string | null;
  /** The robots verdict the retrieval ran under, as the vault recorded it. */
  readonly permission: string | null;
}

/** One held paid-research finding: a Scout result's subject, its URL (if it named one), and the pages its Attempt vaulted. */
export interface HeldScoutFinding {
  readonly attemptId: string;
  readonly obligationId: string;
  readonly subjectId: string;
  readonly outcome: "ROUTE_CANDIDATE" | "EVIDENCE_FOUND";
  readonly routeId: string | null;
  readonly canonicalUrl: string | null;
  readonly artifactIds: readonly string[];
  readonly recordedAt: string;
  readonly summary: string;
}

export interface ReplayLeadRow {
  readonly subjectId: string;
  readonly origin: "SCOUT_FINDING" | "MARGINALIA_POINTER";
  readonly ref: string;
  readonly url: string;
  readonly outcome: "VERIFIED" | "REFUSED" | "NOT_READ";
  readonly codes: readonly CampaignSiteRefusalCode[];
  readonly historical: readonly number[] | null;
  readonly verification: string | null;
}

export interface MarginaliaRecordRow {
  readonly subjectId: string;
  readonly artifactId: string;
  readonly retrievedAt: string;
  readonly resultUrls: number;
  readonly noHit: boolean;
  readonly candidateBrandedLeads: readonly string[];
}

export interface ReplayReport {
  readonly mode: "OFFLINE" | "LIVE";
  readonly now: string;
  readonly findings: { readonly scout: number; readonly marginaliaRecords: number; readonly unjoined: number };
  readonly leads: readonly ReplayLeadRow[];
  readonly counts: Readonly<Record<string, number>>;
  readonly marginalia: readonly MarginaliaRecordRow[];
  /** LIVE only: the chain's own report. */
  readonly chain: CampaignSiteChainReport | null;
  /** OFFLINE: the links that WOULD publish if our own read confirmed each held-bytes verdict; LIVE: the plan from real approvals. */
  readonly wouldPublish: readonly { readonly key: string; readonly candidacyId: string; readonly url: string }[];
  readonly held: CampaignSitePublicationPlan["held"];
  /** LIVE only: the package for `manual-promote --contract=candidate-profiles`. */
  readonly plan: CampaignSitePublicationPlan | null;
}

function latestBy<T extends { readonly retrievedAt: string }>(rows: readonly T[]): T | null {
  return [...rows].sort((a, b) => (a.retrievedAt < b.retrievedAt ? 1 : -1))[0] ?? null;
}

function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/** A lead read from HELD bytes only: robots-first against a held robots.txt reading, or NOT_READ. */
function offlineRead(held: readonly HeldRead[], lead: CampaignSiteLead): LeadReadResult {
  const pre = campaignSiteHostRefusal(lead.url);
  if (pre !== null) return { ok: false, refusal: pre };
  const origin = originOf(lead.url);
  const robots = origin === null ? null : latestBy(held.filter((h) => h.canonicalUrl === `${origin}/robots.txt`));
  const page = latestBy(held.filter((h) => h.canonicalUrl === lead.url && /html/i.test(h.contentType)));
  if (page === null) return { ok: false, refusal: { code: "NOT_READ", detail: `the vault holds no read of ${lead.url}; a live robots-first read is owed` } };
  const permission = robots !== null
    ? evaluatePermission({ robotsText: robots.body, status: robots.httpStatus, transportError: null, contentType: robots.contentType }, lead.url, DEFAULT_ROBOTS_TOKEN)
    : page.permission === "ALLOWED" ? { verdict: "ALLOWED" as const, detail: `the held read ${page.artifactId} ran under ALLOWED` } : null;
  if (permission === null) return { ok: false, refusal: { code: "NOT_READ", detail: `no held robots reading covers ${origin}; a live robots-first read is owed` } };
  if (permission.verdict === "DISALLOWED" || permission.verdict === "CANNOT_TELL") {
    return { ok: false, refusal: { code: "ROBOTS_REFUSED", detail: `${origin}: ${permission.verdict} (${permission.detail})` } };
  }
  return {
    ok: true,
    read: {
      ...heldPageRead({ requestedUrl: lead.url, httpStatus: page.httpStatus, contentType: page.contentType, body: page.body, retrievedAt: page.retrievedAt, sha256: page.sha256 }),
      permissions: [{ origin: origin!, verdict: permission.verdict, detail: permission.detail }],
    },
  };
}

/** A held finding as the SCOUTED record production maps it to (`scoutedFromScoutResult`): same item id, same Scout actor. */
export function scoutedFromHeldFinding(finding: HeldScoutFinding): ScoutedRecord {
  const itemId = scoutResultItemId({ attemptId: finding.attemptId }, finding.routeId);
  return {
    formatVersion: PROMOTION_PIPELINE_FORMAT_VERSION, recordId: `${itemId}:scouted`, itemId, at: finding.recordedAt,
    actor: { role: "SCOUT", lane: "BOUNDED_MODEL_WORKER", instance: finding.attemptId }, stage: "SCOUTED",
    source: { kind: "SCOUT_RESULT", attemptId: finding.attemptId, obligationId: finding.obligationId, outcome: finding.outcome, routeId: finding.routeId },
    recordClass: CAMPAIGN_SITE_RECORD_CLASS, subjectId: finding.subjectId, canonicalUrl: finding.canonicalUrl,
    artifactIds: finding.artifactIds, scoutAttemptId: finding.attemptId, summary: finding.summary,
  };
}

/** A held read as the artifact-log row its own Attempt wrote. */
export function heldArtifactRecord(h: HeldRead): ArtifactRecord {
  return {
    artifactId: h.artifactId, workItemId: `held:${h.attemptId}`, routeTaskId: null, attemptId: h.attemptId, tier: "RAW",
    contentHash: `sha256-${h.sha256}`, byteLength: Buffer.byteLength(h.body, "utf8"), contentType: h.contentType,
    canonicalUrl: h.canonicalUrl, partial: false, recordedAt: h.retrievedAt,
  };
}

export async function replayResearchFindings(input: {
  readonly subjects: ReadonlyMap<string, CampaignSiteSubject>;
  readonly findings: readonly HeldScoutFinding[];
  readonly held: readonly HeldRead[];
  readonly marginalia: readonly HeldMarginaliaResponse[];
  readonly prior: ManualProjectionPrior | null;
  readonly gate: Pick<ActivationGateReading, "promotionEnabled" | "openRecordClasses" | "openFields">;
  readonly now: string;
  /** Present for LIVE: our own robots-first reads, vaulted under `vaultRoot` (never the runner's vault). */
  readonly live?: { readonly runtime: ResearchRuntime; readonly vaultRoot: string; readonly methodVersion: number; readonly maxReads?: number } | null;
}): Promise<ReplayReport> {
  const heldById = new Map(input.held.map((h) => [h.artifactId, h]));
  const marginaliaRows: MarginaliaRecordRow[] = [];
  for (const record of input.marginalia) {
    const subject = input.subjects.get(record.subjectId);
    let resultUrls = 0;
    try { resultUrls = (JSON.parse(record.body) as { results?: unknown[] }).results?.length ?? 0; } catch { resultUrls = 0; }
    const found = subject === undefined ? null : marginaliaLeads(record, subject);
    marginaliaRows.push({ subjectId: record.subjectId, artifactId: record.artifactId, retrievedAt: record.retrievedAt, resultUrls,
      noHit: found?.noHit ?? resultUrls === 0, candidateBrandedLeads: found?.leads.map((l) => l.url) ?? [] });
  }

  const count = (rows: readonly ReplayLeadRow[]): Record<string, number> => {
    const out: Record<string, number> = { VERIFIED: 0, REFUSED: 0, NOT_READ: 0, HISTORICAL: 0 };
    for (const row of rows) {
      out[row.outcome] = (out[row.outcome] ?? 0) + 1;
      if (row.historical !== null) out.HISTORICAL = (out.HISTORICAL ?? 0) + 1;
      for (const code of row.codes) out[code] = (out[code] ?? 0) + 1;
    }
    return out;
  };

  if (!input.live) {
    /* OFFLINE: verdicts on held bytes; would-be links only. */
    const rows: ReplayLeadRow[] = [];
    let unjoined = 0;
    const leadsFor = (finding: HeldScoutFinding): string[] => finding.canonicalUrl !== null ? [finding.canonicalUrl]
      : [...new Set(finding.artifactIds.map((id) => heldById.get(id)).filter((h): h is HeldRead => h !== undefined && /html/i.test(h.contentType)).map((h) => h.canonicalUrl))];
    const judge = (subjectId: string, origin: ReplayLeadRow["origin"], ref: string, url: string) => {
      const subject = input.subjects.get(subjectId)!;
      const lead: CampaignSiteLead = { url, origin, ref };
      const read = offlineRead(input.held, lead);
      if (!read.ok) {
        rows.push({ subjectId, origin, ref, url, outcome: read.refusal.code === "NOT_READ" ? "NOT_READ" : "REFUSED", codes: [read.refusal.code], historical: null, verification: null });
        return;
      }
      const verdict = verifyCampaignSitePage(subject, lead, read.read);
      rows.push(verdict.verdict === "VERIFIED"
        ? { subjectId, origin, ref, url, outcome: "VERIFIED", codes: [], historical: null, verification: verdict.verification }
        : { subjectId, origin, ref, url, outcome: "REFUSED", codes: verdict.refusals.map((r) => r.code), historical: verdict.historical?.years ?? null, verification: null });
    };
    for (const finding of input.findings) {
      if (!input.subjects.has(finding.subjectId)) { unjoined += 1; continue; }
      for (const url of leadsFor(finding).slice(0, 6)) judge(finding.subjectId, "SCOUT_FINDING", finding.attemptId, url);
    }
    for (const record of input.marginalia) {
      const subject = input.subjects.get(record.subjectId);
      if (subject === undefined) { unjoined += 1; continue; }
      const found = marginaliaLeads(record, subject);
      for (const refused of found.refused) rows.push({ subjectId: record.subjectId, origin: "MARGINALIA_POINTER", ref: record.artifactId, url: refused.url, outcome: "REFUSED", codes: [refused.refusal.code], historical: null, verification: null });
      for (const lead of found.leads) judge(record.subjectId, "MARGINALIA_POINTER", record.artifactId, lead.url);
    }
    /* The would-be links: one per candidacy with one verified host, keyed exactly, held against the prior as the writer would. */
    const byCandidacy = new Map<string, ReplayLeadRow[]>();
    for (const row of rows) if (row.outcome === "VERIFIED") byCandidacy.set(row.subjectId, [...(byCandidacy.get(row.subjectId) ?? []), row]);
    const would: CampaignSiteApprovedRecord[] = [];
    for (const [candidacyId, verified] of byCandidacy) {
      const subject = input.subjects.get(candidacyId)!;
      for (const row of verified) {
        would.push({
          formatVersion: PROMOTION_PIPELINE_FORMAT_VERSION, recordId: `replay-would:${createHash("sha256").update(`${candidacyId}|${row.url}`).digest("hex").slice(0, 16)}`,
          itemId: "replay-would", at: input.now, actor: { role: "RELEASE_ORCHESTRATOR", lane: "DETERMINISTIC", instance: "replay-would" },
          stage: "APPROVED_FOR_PROMOTION", chain: { scouted: "replay", confirmed: "replay", verified: "replay", audited: "replay" },
          recordClass: CAMPAIGN_SITE_RECORD_CLASS, field: CAMPAIGN_SITE_FIELD,
          campaignSite: {
            field: CAMPAIGN_SITE_FIELD, candidacyId, candidateName: candidateDisplayName(subject), readerKeys: subject.readerKeys,
            url: row.url, host: siteHost(row.url) ?? "", verification: row.verification ?? "",
            evidence: { verifierId: "campaign-site-verifier/1", artifactId: "replay", attemptId: "replay", sha256: "0".repeat(64), requestedUrl: row.url, finalUrl: row.url, httpStatus: 200, contentType: "text/html", readAt: input.now },
            audit: { startedFrom: [], secondSignal: "" }, publicationDoor: "CANDIDATE_PROFILES_MANUAL_CONTRACT",
          },
        });
      }
    }
    const plan = planCampaignSitePublication({ approved: would, prior: input.prior, gate: input.gate, reviewedAt: input.now });
    return {
      mode: "OFFLINE", now: input.now,
      findings: { scout: input.findings.length, marginaliaRecords: input.marginalia.length, unjoined },
      leads: rows, counts: count(rows), marginalia: marginaliaRows, chain: null,
      wouldPublish: plan.published.map(({ key, candidacyId, url }) => ({ key, candidacyId, url })), held: plan.held, plan: null,
    };
  }

  /* LIVE: the whole chain on an isolated in-memory plane. */
  const repos = createMemoryRepositories();
  const ctx = await contextFromRepositories(repos);
  for (const h of input.held) await repos.artifacts.append(`held:${h.attemptId}`, h.artifactId, heldArtifactRecord(h), h.retrievedAt);
  for (const finding of input.findings) await appendTransition(repos, scoutedFromHeldFinding(finding), ctx, input.now);
  let clock = Date.parse(input.now);
  const recorder = campaignSiteReadRecorder({
    repos, vaultRoot: input.live.vaultRoot, methodVersion: input.live.methodVersion, now: () => new Date(clock += 1_000).toISOString(),
    heldVault: { byId: new Map(), byHash: new Map(), byWorkItem: new Map() },
  });
  const heldPage = async (artifact: ArtifactRecord) => {
    const h = heldById.get(artifact.artifactId);
    if (h !== undefined) {
      return { ...heldPageRead({ requestedUrl: h.canonicalUrl, httpStatus: h.httpStatus, contentType: h.contentType, body: h.body, retrievedAt: h.retrievedAt, sha256: h.sha256 }),
        permissions: h.permission === "ALLOWED" ? [{ origin: originOf(h.canonicalUrl) ?? h.canonicalUrl, verdict: "ALLOWED" as const, detail: `recorded on held ${h.artifactId}` }] : [] };
    }
    return recorder.heldPage(artifact);
  };
  const live = input.live;
  const chain = await projectCampaignSiteChains(repos, {
    subjects: input.subjects, marginalia: input.marginalia, gate: input.gate, now: input.now, maxReads: live.maxReads,
    readLead: async (lead) => {
      const out = await readCampaignSiteLead(lead, live.runtime);
      return out.ok ? { ok: true, read: out.read } : { ok: false, refusal: out.refusal };
    },
    recordRead: recorder.recordRead,
    heldPage,
  });
  const rows: ReplayLeadRow[] = chain.leads.map((l) => ({
    subjectId: l.subjectId, origin: l.lead.origin === "MARGINALIA_POINTER" ? "MARGINALIA_POINTER" : "SCOUT_FINDING", ref: l.lead.ref, url: l.lead.url,
    outcome: l.outcome === "DEFERRED" ? "NOT_READ" : l.outcome, codes: l.refusals.map((r) => r.code), historical: l.historical, verification: null,
  }));
  const plan = planCampaignSitePublication({ approved: chain.approved, prior: input.prior, gate: input.gate, reviewedAt: input.now });
  return {
    mode: "LIVE", now: input.now,
    findings: { scout: input.findings.length, marginaliaRecords: input.marginalia.length, unjoined: chain.unjoined.length },
    leads: rows, counts: count(rows), marginalia: marginaliaRows, chain,
    wouldPublish: plan.published.map(({ key, candidacyId, url }) => ({ key, candidacyId, url })), held: plan.held, plan,
  };
}
