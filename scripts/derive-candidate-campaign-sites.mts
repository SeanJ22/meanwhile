/**
 * **VERIFIED CAMPAIGN SITES, PUBLISHED BY THE STANDING RUNNER WITH NO OWNER
 * STEP.** (2026-09-25; Sean, 2026-09-21: "You may enable automatic promotion
 * for qualifying results. Fix the gap, recover value already paid for."
 * RULING 292.)
 *
 *   node --experimental-strip-types scripts/derive-candidate-campaign-sites.mts --promote
 *
 * The standing runner's child for the `candidate-campaign-sites-derived`
 * routine contract. It fetches nothing from any publisher and calls no model.
 * It reads:
 *
 * - every APPROVED campaign-site record in the control plane's promotion
 *   pipeline log (read only; the research cycle's campaign-site pass made them);
 * - the vault, read only (`lib/control-plane/evidence/read-only-vault.ts`): the
 *   bytes of each approval's verifying read, proved against their sidecar;
 * - the promoted `candidate-profiles` version, so a working reviewed campaign
 *   link is preserved when independently verified documents attach;
 * - this contract's prior GOOD version, preserving facts and quoted history
 *   exactly when unrelated older source captures are unavailable locally.
 *
 * `derivedCampaignSitesPass` (lib/civic-data/derived-campaign-site-writer.ts)
 * verifies each approval's vaulted bytes again for its own canonical identity
 * and plans the version; it promotes through
 * `processRegisteredRoutineCandidate`, whose door checks the promoted input
 * against the store. Anything it cannot read refuses the pass by name and
 * leaves the last known good sites live. The profile Reader composes the
 * published sites with `candidate-profiles` on its next read.
 */
import { join } from "node:path";

import { neon } from "@neondatabase/serverless";

import { promotedInputRef } from "../lib/civic-data/derived-authority.ts";
import { DERIVED_CAMPAIGN_SITES_CONTRACT_ID, DERIVED_CAMPAIGN_SITES_RECORD_CLASS, DERIVED_CAMPAIGN_SITES_SCOPE,
  readDerivedCampaignSites, type CandidateLinksShape } from "../lib/civic-data/derived-campaign-sites.ts";
import {
  derivedCampaignSitesFailedCandidate,
  derivedCampaignSitesPass,
  isPublishableCampaignSiteApproval,
  heldCampaignSiteReads,
  type HeldVerifyingRead,
  type HeldLinkedPublicationRead,
  type PublishableCampaignSiteApproval,
} from "../lib/civic-data/derived-campaign-site-writer.ts";
import { promoteDerivedCandidate } from "../lib/civic-data/derived-child-receipt.ts";
import { requiredManualProductionContract } from "../lib/civic-data/manual-contracts.ts";
import { readPromotedCivicData } from "../lib/civic-data/read-model.ts";
import { PostgresRoutineDataStore } from "../lib/civic-data/store.ts";
import type { RoutineCandidate } from "../lib/civic-data/types.ts";
import { findHeldCapture, readHeldBytes } from "../lib/control-plane/evidence/read-only-vault.ts";
import { heldArtifactCaptures } from "../lib/civic-data/held-artifact-captures.ts";
import { ACTIVATION_GATE, classFieldOpen } from "../lib/control-plane/promotion/activation-policy.ts";
import { prepareProductionCivicDataWrite } from "../lib/civic-data/production-write.ts";
import { installNeonRequestDeadline } from "../lib/ops/neon-request-deadline.ts";

if (!process.argv.includes("--promote")) {
  throw new Error("usage: scripts/derive-candidate-campaign-sites.mts --promote (the standing runner's child; there is no dry mode against production)");
}
installNeonRequestDeadline();
prepareProductionCivicDataWrite();

const store = new PostgresRoutineDataStore();
const now = new Date().toISOString();
const PROFILES = requiredManualProductionContract("candidate-profiles");

/* An unchanged pass (the same approvals, the same bytes, the same profiles) is receipted on the pointed version, never re-promoted (R23). */
async function finish(candidate: RoutineCandidate): Promise<void> {
  await promoteDerivedCandidate(store, DERIVED_CAMPAIGN_SITES_CONTRACT_ID, candidate, now);
}

/** Every APPROVED campaign-site record in the pipeline log, narrowed in the database to approvals only. */
async function readApprovals(): Promise<PublishableCampaignSiteApproval[] | { readonly unreadable: string }> {
  const controlPlane = process.env.WTP_CONTROL_PLANE_DATABASE_URL;
  if (!controlPlane) return { unreadable: "the control plane's pipeline log is not configured (WTP_CONTROL_PLANE_DATABASE_URL)" };
  try {
    const sql = neon(controlPlane);
    const rows = await sql.query(
      "SELECT record FROM cp_log_promotion_pipeline WHERE record->>'stage' = 'APPROVED_FOR_PROMOTION' AND record->'campaignSite' IS NOT NULL ORDER BY log_key, position",
      [],
    ) as { record: unknown }[];
    return rows.map((row) => (typeof row.record === "string" ? JSON.parse(row.record) as unknown : row.record)).filter(isPublishableCampaignSiteApproval);
  } catch (error) {
    return { unreadable: error instanceof Error ? error.message : String(error) };
  }
}

/** Distinct completed publication acquisitions. The child never infers
 * article authority from a URL in prose or from uncommitted vault bytes. */
async function linkedPublicationReads(vaultRoot: string, approvals: readonly PublishableCampaignSiteApproval[]): Promise<readonly HeldLinkedPublicationRead[] | { readonly unreadable: string }> {
  const controlPlane = process.env.WTP_CONTROL_PLANE_DATABASE_URL;
  if (!controlPlane) return { unreadable: "the control plane's publication attempts are not configured" };
  const candidacies = [...new Set(approvals.map(row => row.campaignSite.candidacyId))];
  if (!candidacies.length) return [];
  try {
    const rows = await neon(controlPlane).query(
      `SELECT a.record, t.value AS attempt, w.value AS work_item FROM cp_log_artifacts a
       JOIN cp_attempts t ON t.id = a.record->>'attemptId'
       JOIN cp_work_items w ON w.id = a.record->>'workItemId'
       WHERE a.record ? 'publicationLink' AND a.record->'publicationLink'->>'candidacyId' = ANY($1::text[])
       ORDER BY a.log_key, a.position`, [candidacies],
    ) as { record: unknown; attempt: unknown; work_item: unknown }[];
    const out: HeldLinkedPublicationRead[] = [];
    for (const row of rows) {
      const record = (typeof row.record === "string" ? JSON.parse(row.record) : row.record) as HeldLinkedPublicationRead["record"];
      const attempt = (typeof row.attempt === "string" ? JSON.parse(row.attempt) : row.attempt) as HeldLinkedPublicationRead["attempt"];
      const workItem = (typeof row.work_item === "string" ? JSON.parse(row.work_item) : row.work_item) as { subject?: unknown };
      // One unreadable capture holds only its own publication (it stays unverified, owed work);
      // it never blocks every other approved campaign link from reaching readers (§3).
      console.log(`RCD_PROGRESS linked-publication ${record.artifactId}`);
      const artifact = await findHeldCapture(vaultRoot, record);
      if (!artifact || artifact.tier === "RESTRICTED_RAW") {
        process.stderr.write(`LINKED_PUBLICATION_CAPTURE_UNREADABLE ${record.artifactId}: missing or restricted in this vault\n`);
        continue;
      }
      let body: string;
      try { body = new TextDecoder("utf-8", { fatal: true }).decode(await readHeldBytes(artifact)); }
      catch {
        process.stderr.write(`LINKED_PUBLICATION_CAPTURE_UNREADABLE ${record.artifactId}: failed exact vault read\n`);
        continue;
      }
      out.push({ record, attempt, workItemSubject: typeof workItem.subject === "string" ? workItem.subject : "",
        body, vaultSha256: artifact.contentHash.replace(/^sha256-/, ""),
        vaultCanonicalUrl: artifact.canonicalUrl, vaultRetrievalUrl: artifact.retrievalUrl,
        vaultWorkItemId: artifact.workItemId, vaultAttemptId: artifact.attemptId,
        vaultHttpStatus: artifact.httpStatus, vaultContentType: artifact.contentType,
        vaultMethodRouteId: artifact.methodRouteId, vaultPermission: artifact.permission });
    }
    return out;
  } catch (error) { return { unreadable: error instanceof Error ? error.message : String(error) }; }
}

async function main(): Promise<void> {
  const approvals = await readApprovals();
  const priorRead = await readDerivedCampaignSites({ store, bypassCache: true, now });
  const priorInput = priorRead.kind === "PROMOTED" ? promotedInputRef(DERIVED_CAMPAIGN_SITES_RECORD_CLASS,
    DERIVED_CAMPAIGN_SITES_SCOPE, priorRead.metadata.versionId, priorRead.value, priorRead.metadata.promotedAt) : null;
  const prior = priorRead.kind === "PROMOTED" && priorInput?.kind === "PROMOTED_VERSION"
    ? { input: priorInput, projection: priorRead.value } : priorRead.kind === "NOT_RECORDED" ? null
      : { unreadable: `${priorRead.kind}${"detail" in priorRead ? `: ${priorRead.detail}` : ": no exact promoted version reference"}` };
  const profilesRead = await readPromotedCivicData<{ readonly links?: { readonly links?: Readonly<Record<string, CandidateLinksShape>> } }>(
    PROFILES.recordClass, PROFILES.scope, { store, bypassCache: true, now },
  );
  const profilesInput = profilesRead.kind === "PROMOTED"
    ? promotedInputRef(PROFILES.recordClass, PROFILES.scope, profilesRead.metadata.versionId, profilesRead.value, profilesRead.metadata.promotedAt)
    : null;
  const profiles = profilesRead.kind === "PROMOTED" && profilesInput !== null && profilesInput.kind === "PROMOTED_VERSION"
    ? { input: profilesInput, links: profilesRead.value.links?.links ?? {} }
    : profilesRead.kind === "NOT_RECORDED"
      ? null
      : { unreadable: `${profilesRead.kind}${"detail" in profilesRead ? `: ${profilesRead.detail}` : ": the promoted version names no version or promotion time"}` };
  let held = new Map<string, HeldVerifyingRead>();
  let linkedPublications: readonly HeldLinkedPublicationRead[] = [];
  if (!("unreadable" in approvals) && approvals.length > 0) {
    try {
      const vaultRoot = join(process.cwd(), "data", "control-plane", "vault");
      const artifactIds = approvals.flatMap(row => [row.campaignSite.evidence.artifactId,
        ...(row.campaignSite.evidence.cycleSource ? [row.campaignSite.evidence.cycleSource.artifactId] : [])]);
      const capture = await heldArtifactCaptures(vaultRoot, artifactIds, process.env.WTP_CONTROL_PLANE_DATABASE_URL!);
      held = await heldCampaignSiteReads(capture, approvals);
      const linked = await linkedPublicationReads(vaultRoot, approvals);
      if ("unreadable" in linked) {
        await finish(derivedCampaignSitesFailedCandidate(now, `The linked candidate-publication record could not be read: ${linked.unreadable}`));
        return;
      }
      linkedPublications = linked;
    } catch (error) {
      await finish(derivedCampaignSitesFailedCandidate(now, `The evidence vault could not be read: ${error instanceof Error ? error.message : String(error)}`));
      return;
    }
  }
  const pass = derivedCampaignSitesPass({
    approvals,
    prior,
    held: (record) => held.get(record.recordId) ?? null,
    linkedPublications,
    profiles,
    gateOpen: classFieldOpen(ACTIVATION_GATE, "candidate-enrichment", "campaignSite"),
    now,
  });
  for (const p of pass.plan?.published ?? []) console.log(`  published ${p.key}: ${p.url} (${p.approvalRecordId})`);
  for (const h of pass.plan?.held ?? []) console.log(`  held ${h.key}: ${h.code}: ${h.detail}`);
  await finish(pass.candidate);
}

await main();
