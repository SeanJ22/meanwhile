/**
 * **THE CAMPAIGN-SITE VERIFIER'S READS, RECORDED AS ACQUISITIONS.** (2026-09-25.)
 *
 * A read counts as CONFIRMATION only when the pipeline can see it for what it
 * is: a COMPLETED Attempt by a deterministic ACQUIRER — never the Scout's own
 * Attempt, never a SCOUT-role Attempt — whose artifact is in the artifact log
 * and whose bytes are vaulted. This records exactly that, through the same
 * coordinator calls every acquisition uses (work item, route task, lease,
 * Attempt, vaulted artifact, INGESTED disposition), on whatever repositories
 * and vault it is handed: an isolated in-memory plane for the replay and the
 * tests, the standing plane once the runner calls it.
 *
 * It also answers the audit's question "what did the vault hold": a read made
 * this run is served from memory; an earlier artifact (a Scout's vaulted page,
 * a previous run's read) from a read-only vault index, its bytes re-hashed.
 */
import { DurableEvidenceStore } from "../evidence/durable-store.ts";
import { recordAcquisition } from "../evidence/artifact.ts";
import { putArtifact } from "../evidence/store.ts";
import { includeVaultCapture, readHeldBytes, type VaultIndex } from "../evidence/read-only-vault.ts";
import { fingerprint } from "../ids.ts";
import { abandonAttempt, beginAttemptFor, claimRouteTask, disposeRouteTask, recordArtifactMetadata, registerRouteTask, registerWorkItem } from "../repository/coordinator.ts";
import type { ArtifactRecord, ControlPlaneRepositories } from "../repository/types.ts";
import { createRouteTask } from "../route-task.ts";
import { createWorkItem } from "../work-item.ts";
import { FLEET_POLICY_VERSION } from "../workers/runtime.ts";
import { verdictOfRecordedPermission } from "../scheduler/robots.ts";
import type { PermissionState } from "../../workstate/types.ts";
import {
  CAMPAIGN_SITE_VERIFIER_ID,
  heldPageRead,
  siteHost,
  type CampaignSiteLead,
  type CampaignSitePageRead,
} from "../../candidates/campaign-site-verifier.ts";
import type { CandidatePublicationLink } from "./campaign-publication-links.ts";

export const CAMPAIGN_SITE_READ_PROJECT = "freshness";
export const CAMPAIGN_SITE_READ_ROUTE = "campaign-site-verifier";
export const CANDIDATE_PUBLICATION_READ_ROUTE = "candidate-publication-linked";

export interface CampaignSiteReadRecorder {
  readonly recordRead: (subjectId: string, lead: CampaignSiteLead, read: CampaignSitePageRead) => Promise<ArtifactRecord>;
  readonly recordPublicationRead: (subjectId: string, link: CandidatePublicationLink, read: CampaignSitePageRead) => Promise<ArtifactRecord>;
  readonly recordPublicationBlock: (subjectId: string, link: CandidatePublicationLink, status: number, note: string) => Promise<void>;
  readonly recordPublicationAbort: (subjectId: string, link: CandidatePublicationLink, kind: "ABORTED" | "TIMED_OUT", reason: string) => Promise<void>;
  readonly heldPage: (artifact: ArtifactRecord) => Promise<CampaignSitePageRead | null>;
}

export function campaignSiteReadRecorder(input: {
  readonly repos: ControlPlaneRepositories;
  /** Where new reads are vaulted. Never the runner's own vault from a replay. */
  readonly vaultRoot: string;
  readonly methodVersion: number;
  readonly now: () => string;
  /** Earlier vaulted bytes (a Scout's pages, earlier runs' reads), read-only. */
  readonly heldVault?: VaultIndex | null;
}): CampaignSiteReadRecorder {
  const store = new DurableEvidenceStore(input.vaultRoot);
  const made = new Map<string, CampaignSitePageRead>();

  const recordRead: CampaignSiteReadRecorder["recordRead"] = async (subjectId, lead, read) => {
    const at = input.now();
    const item = createWorkItem({
      project: CAMPAIGN_SITE_READ_PROJECT,
      subject: `campaign-site:${subjectId}`,
      obligation: "Read the candidate's campaign-site lead robots-first and verify the page names them, their office and the current cycle",
      why: "A research lead reaches a reader only after our own deterministic read confirms it.",
      contract: { requiresValidation: true, requiresAudit: true },
      now: at,
    });
    if ((await input.repos.workItems.read(item.id)) === null) await registerWorkItem(input.repos, item, at);
    const routeId = `${CAMPAIGN_SITE_READ_ROUTE}:${fingerprint([lead.url, read.retrievedAt])}`;
    const task = createRouteTask({ workItemId: item.id, routeId, routeLabel: "Campaign-site verifier read (robots-first)", target: lead.url, inherited: false, now: at });
    await registerRouteTask(input.repos, task, at);
    const holder = `campaign-site-reader:${fingerprint([subjectId, lead.url, read.retrievedAt])}`;
    const claim = await claimRouteTask(input.repos, { routeTaskId: task.id, holder, now: at, ttlMs: 60_000 });
    const attempt = await beginAttemptFor(input.repos, {
      routeTaskId: task.id,
      workItemId: item.id,
      worker: { role: "ACQUIRER", provider: "campaign-site-verifier", version: CAMPAIGN_SITE_VERIFIER_ID, instance: holder },
      lease: claim.lease.value,
      now: at,
      methodVersion: input.methodVersion,
      policyVersion: FLEET_POLICY_VERSION,
    });
    const { artifact } = recordAcquisition({
      canonicalUrl: lead.url,
      retrievalUrl: read.finalUrl,
      retrievedAt: read.retrievedAt,
      httpStatus: read.httpStatus,
      contentType: read.contentType,
      sourceId: siteHost(read.finalUrl) ?? "campaign-site",
      methodRouteId: CAMPAIGN_SITE_READ_ROUTE,
      workItemId: item.id,
      attemptId: attempt.id,
      permission: permissionStateOf(read),
      transport: "REACHABLE",
    }, read.body);
    const {key} = await putArtifact(store, CAMPAIGN_SITE_READ_PROJECT, artifact, Buffer.from(read.body, "utf8"));
    if(input.heldVault) includeVaultCapture(input.heldVault,artifact,key,input.vaultRoot);
    const record: ArtifactRecord = {
      artifactId: artifact.id, workItemId: item.id, routeTaskId: task.id, attemptId: attempt.id, tier: artifact.tier,
      contentHash: artifact.contentHash, byteLength: artifact.byteLength, contentType: artifact.contentType,
      canonicalUrl: lead.url, partial: false, recordedAt: read.retrievedAt,
    };
    await recordArtifactMetadata(input.repos, record, at);
    await disposeRouteTask(input.repos, {
      routeTaskId: task.id, attemptId: attempt.id, expectedTaskRevision: (await input.repos.routeTasks.mustRead(task.id)).revision,
      artifactIds: [artifact.id], now: at,
      disposition: { disposition: "INGESTED", attemptId: attempt.id, at, artifactIds: [artifact.id], observation: null,
        permission: artifact.permission, transport: "REACHABLE",
        note: `${CAMPAIGN_SITE_VERIFIER_ID} read ${lead.url} robots-first (${read.permissions.map((p) => `${p.origin} ${p.verdict}`).join("; ") || "no origin recorded"}; recorded, never a refusal: owner decision 2026-09-25) and vaulted ${artifact.contentHash}.` },
    });
    /* The verdict is re-made from what was vaulted: the vault's own hash, never the transport's. */
    made.set(artifact.id, { ...read, sha256: artifact.contentHash.replace(/^sha256-/, "") });
    return record;
  };

  const recordPublicationRead: CampaignSiteReadRecorder["recordPublicationRead"] = async (subjectId, link, read) => {
    if (link.source.candidacyId !== subjectId || read.requestedUrl !== link.url ||
      new URL(read.finalUrl).hostname !== new URL(link.source.sourceUrl).hostname ||
      read.httpStatus < 200 || read.httpStatus >= 300 || !/html/i.test(read.contentType)) {
      throw new Error("CANDIDATE_PUBLICATION_CAPTURE_SCOPE_MISMATCH");
    }
    const at = input.now();
    const item = createWorkItem({ project: CAMPAIGN_SITE_READ_PROJECT, subject: `candidate-publication:${subjectId}`,
      obligation: `Read linked candidate publication ${link.url}`,
      why: "An exact link on an approved campaign page led to this separate public document.",
      contract: { requiresValidation: true, requiresAudit: true }, now: at });
    if ((await input.repos.workItems.read(item.id)) === null) await registerWorkItem(input.repos, item, at);
    const routeId = `${CANDIDATE_PUBLICATION_READ_ROUTE}:${fingerprint([link.url, read.retrievedAt])}`;
    const task = createRouteTask({ workItemId: item.id, routeId, routeLabel: "Linked candidate publication read (robots-first)",
      target: link.url, inherited: false, now: at });
    await registerRouteTask(input.repos, task, at);
    const holder = `candidate-publication-reader:${fingerprint([subjectId, link.url, read.retrievedAt])}`;
    const claim = await claimRouteTask(input.repos, { routeTaskId: task.id, holder, now: at, ttlMs: 60_000 });
    const attempt = await beginAttemptFor(input.repos, { routeTaskId: task.id, workItemId: item.id,
      worker: { role: "ACQUIRER", provider: "candidate-publication-reader", version: "candidate-publication-reader/1", instance: holder },
      lease: claim.lease.value, now: at, methodVersion: input.methodVersion, policyVersion: FLEET_POLICY_VERSION });
    const { artifact } = recordAcquisition({ canonicalUrl: link.url, retrievalUrl: read.finalUrl,
      retrievedAt: read.retrievedAt, httpStatus: read.httpStatus, contentType: read.contentType,
      sourceId: siteHost(read.finalUrl) ?? "candidate-publication", methodRouteId: CANDIDATE_PUBLICATION_READ_ROUTE,
      workItemId: item.id, attemptId: attempt.id, permission: permissionStateOf(read), transport: "REACHABLE" }, read.body);
    const {key} = await putArtifact(store, CAMPAIGN_SITE_READ_PROJECT, artifact, Buffer.from(read.body, "utf8"));
    if(input.heldVault) includeVaultCapture(input.heldVault,artifact,key,input.vaultRoot);
    const record: ArtifactRecord = { artifactId: artifact.id, workItemId: item.id, routeTaskId: task.id, attemptId: attempt.id,
      tier: artifact.tier, contentHash: artifact.contentHash, byteLength: artifact.byteLength, contentType: artifact.contentType,
      canonicalUrl: link.url, partial: false, recordedAt: read.retrievedAt, publicationLink: link.source };
    await recordArtifactMetadata(input.repos, record, at);
    await disposeRouteTask(input.repos, { routeTaskId: task.id, attemptId: attempt.id,
      expectedTaskRevision: (await input.repos.routeTasks.mustRead(task.id)).revision, artifactIds: [artifact.id], now: at,
      disposition: { disposition: "INGESTED", attemptId: attempt.id, at, artifactIds: [artifact.id], observation: null,
        permission: artifact.permission, transport: "REACHABLE",
        note: `Linked publication ${link.url} from approved capture ${link.source.sourceArtifactId} at exact UTF-16 span ${link.source.start}-${link.source.end}; vaulted ${artifact.contentHash}.` } });
    return record;
  };

  const recordPublicationBlock: CampaignSiteReadRecorder["recordPublicationBlock"] = async (subjectId, link, status, note) => {
    if (link.source.candidacyId !== subjectId || !Number.isInteger(status) || status < 200) {
      throw new Error("CANDIDATE_PUBLICATION_BLOCK_SCOPE_MISMATCH");
    }
    const at = input.now();
    const item = createWorkItem({ project: CAMPAIGN_SITE_READ_PROJECT, subject: `candidate-publication:${subjectId}`,
      obligation: `Read linked candidate publication ${link.url}`,
      why: "An exact link on an approved campaign page led to this separate public document.",
      contract: { requiresValidation: true, requiresAudit: true }, now: at });
    if ((await input.repos.workItems.read(item.id)) === null) await registerWorkItem(input.repos, item, at);
    const routeId = `${CANDIDATE_PUBLICATION_READ_ROUTE}:${fingerprint([link.url, status, at])}`;
    const task = createRouteTask({ workItemId: item.id, routeId, routeLabel: "Linked candidate publication read (robots-first)",
      target: link.url, inherited: false, now: at });
    await registerRouteTask(input.repos, task, at);
    const holder = `candidate-publication-reader:${fingerprint([subjectId, link.url, status, at])}`;
    const claim = await claimRouteTask(input.repos, { routeTaskId: task.id, holder, now: at, ttlMs: 60_000 });
    const attempt = await beginAttemptFor(input.repos, { routeTaskId: task.id, workItemId: item.id,
      worker: { role: "ACQUIRER", provider: "candidate-publication-reader", version: "candidate-publication-reader/1", instance: holder },
      lease: claim.lease.value, now: at, methodVersion: input.methodVersion, policyVersion: FLEET_POLICY_VERSION });
    await disposeRouteTask(input.repos, { routeTaskId: task.id, attemptId: attempt.id,
      expectedTaskRevision: (await input.repos.routeTasks.mustRead(task.id)).revision, artifactIds: [], now: at,
      disposition: { disposition: "BLOCKED_CURRENTLY", attemptId: attempt.id, at, artifactIds: [], observation: null,
        permission: "CANNOT_TELL", transport: status === 401 || status === 403 || status === 429 ? "CHALLENGED" : "FAILED_AT_RUNG",
        note: `Linked publication ${link.url} answered HTTP ${status}; ${note}. The document remains owed.` } });
  };

  const recordPublicationAbort: CampaignSiteReadRecorder["recordPublicationAbort"] = async (subjectId, link, kind, reason) => {
    if (link.source.candidacyId !== subjectId || !reason.trim()) throw new Error("CANDIDATE_PUBLICATION_ABORT_SCOPE_MISMATCH");
    const at = input.now();
    const item = createWorkItem({ project: CAMPAIGN_SITE_READ_PROJECT, subject: `candidate-publication:${subjectId}`,
      obligation: `Read linked candidate publication ${link.url}`,
      why: "An exact link on an approved campaign page led to this separate public document.",
      contract: { requiresValidation: true, requiresAudit: true }, now: at });
    if ((await input.repos.workItems.read(item.id)) === null) await registerWorkItem(input.repos, item, at);
    const routeId = `${CANDIDATE_PUBLICATION_READ_ROUTE}:${fingerprint([link.url, kind, at])}`;
    const task = createRouteTask({ workItemId: item.id, routeId, routeLabel: "Linked candidate publication read (robots-first)",
      target: link.url, inherited: false, now: at });
    await registerRouteTask(input.repos, task, at);
    const holder = `candidate-publication-reader:${fingerprint([subjectId, link.url, kind, at])}`;
    const claim = await claimRouteTask(input.repos, { routeTaskId: task.id, holder, now: at, ttlMs: 60_000 });
    const attempt = await beginAttemptFor(input.repos, { routeTaskId: task.id, workItemId: item.id,
      worker: { role: "ACQUIRER", provider: "candidate-publication-reader", version: "candidate-publication-reader/1", instance: holder },
      lease: claim.lease.value, now: at, methodVersion: input.methodVersion, policyVersion: FLEET_POLICY_VERSION });
    await abandonAttempt(input.repos, { routeTaskId: task.id, attemptId: attempt.id, outcome: kind,
      reason: `Linked publication ${link.url}: ${reason}; no civic disposition or absence was inferred.`, now: at });
  };

  const heldPage: CampaignSiteReadRecorder["heldPage"] = async (artifact) => {
    const own = made.get(artifact.artifactId);
    if (own !== undefined) return own;
    const held = input.heldVault?.byId.get(artifact.artifactId) ?? null;
    if (held === null) return null;
    const bytes = await readHeldBytes(held);
    const page = heldPageRead({
      requestedUrl: artifact.canonicalUrl,
      finalUrl: held.retrievalUrl ?? artifact.canonicalUrl,
      httpStatus: held.httpStatus ?? 0,
      contentType: held.contentType,
      body: new TextDecoder().decode(bytes),
      retrievedAt: held.retrievedAt ?? artifact.recordedAt,
      sha256: held.contentHash.replace(/^sha256-/, ""),
    });
    /*
     * The robots verdict the retrieval ran under travels on the sidecar, whatever it was: recorded evidence, never a
     * refusal (owner decision 2026-09-25). An unrecorded one is never assumed.
     */
    let origin = artifact.canonicalUrl;
    try { origin = new URL(artifact.canonicalUrl).origin; } catch { /* the URL is kept as written */ }
    const verdict = verdictOfRecordedPermission(held.permission);
    return verdict === null
      ? page
      : { ...page, permissions: [{ origin, verdict, detail: `${held.permission} recorded on the vaulted sidecar of ${held.id}` }] };
  };

  return { recordRead, recordPublicationRead, recordPublicationBlock, recordPublicationAbort, heldPage };
}

/**
 * The robots verdict a read ran under, as the artifact records it: the final page's origin (the last reading when
 * none names that origin), recorded whatever it said. A read with no robots reading at all is CANNOT_TELL, never
 * ALLOWED.
 */
function permissionStateOf(read: Pick<CampaignSitePageRead, "finalUrl" | "permissions">): PermissionState {
  let finalOrigin: string | null = null;
  try { finalOrigin = new URL(read.finalUrl).origin; } catch { /* no origin to match */ }
  const reading = read.permissions.find((p) => p.origin === finalOrigin) ?? read.permissions.at(-1);
  switch (reading?.verdict) {
    case "ALLOWED":
    case "DISALLOWED":
    case "CANNOT_TELL":
      return reading.verdict;
    case "NO_ROBOTS":
      return "NOT_APPLICABLE";
    default:
      return "CANNOT_TELL";
  }
}
