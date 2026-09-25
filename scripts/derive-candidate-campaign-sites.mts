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
 * - the promoted `candidate-profiles` version, so a candidate who already
 *   carries a reviewed campaign link is held, never doubled.
 *
 * `derivedCampaignSitesPass` (lib/civic-data/derived-campaign-site-writer.ts)
 * verifies each approval's vaulted bytes again for its own canonical identity
 * and plans the version; it promotes through
 * `processRegisteredRoutineCandidate`, whose door checks the promoted input
 * against the store. Anything it cannot read refuses the pass by name and
 * leaves the last known good sites live. The profile Reader composes the
 * published sites with `candidate-profiles` on its next read.
 */
import { createHash } from "node:crypto";
import { join } from "node:path";

import { neon } from "@neondatabase/serverless";

import { canonicalCivicDataJson } from "../lib/civic-data/changes.ts";
import { DERIVED_CAMPAIGN_SITES_CONTRACT_ID, type CandidateLinksShape } from "../lib/civic-data/derived-campaign-sites.ts";
import {
  derivedCampaignSitesFailedCandidate,
  derivedCampaignSitesPass,
  isPublishableCampaignSiteApproval,
  type HeldVerifyingRead,
  type PublishableCampaignSiteApproval,
} from "../lib/civic-data/derived-campaign-site-writer.ts";
import { requiredManualProductionContract } from "../lib/civic-data/manual-contracts.ts";
import { processRegisteredRoutineCandidate } from "../lib/civic-data/promotion.ts";
import { readPromotedCivicData } from "../lib/civic-data/read-model.ts";
import { ZERO_RELEASE_EVENTS } from "../lib/civic-data/release.ts";
import { PostgresRoutineDataStore } from "../lib/civic-data/store.ts";
import type { RoutineCandidate } from "../lib/civic-data/types.ts";
import { indexVault, readHeldBytes, type VaultIndex } from "../lib/control-plane/evidence/read-only-vault.ts";
import { ACTIVATION_GATE, classFieldOpen } from "../lib/control-plane/promotion/activation-policy.ts";
import { assertWriteAllowed } from "../lib/db/write-guard.ts";
import { resolveProductionWriteHandle } from "../lib/db/write-handle.ts";
import { installNeonRequestDeadline } from "../lib/ops/neon-request-deadline.ts";

if (!process.argv.includes("--promote")) {
  throw new Error("usage: scripts/derive-candidate-campaign-sites.mts --promote (the standing runner's child; there is no dry mode against production)");
}
installNeonRequestDeadline();
const handle = resolveProductionWriteHandle();
process.env.DATABASE_URL = handle.connection;
process.env.WTP_DB_ROLE = "production";
process.env.WTP_SANCTIONED_WRITE = "routine-civic-data-promotion";
assertWriteAllowed("a routine civic data candidate/version promotion");

const store = new PostgresRoutineDataStore();
const now = new Date().toISOString();
const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");
const PROFILES = requiredManualProductionContract("candidate-profiles");

async function finish(candidate: RoutineCandidate): Promise<void> {
  const outcome = await processRegisteredRoutineCandidate(store, DERIVED_CAMPAIGN_SITES_CONTRACT_ID, candidate, now);
  console.log("RCD_RECEIPT=" + JSON.stringify({
    source: DERIVED_CAMPAIGN_SITES_CONTRACT_ID,
    candidateId: candidate.id,
    acquisitionSucceeded: outcome.candidate.acquisitionSucceeded,
    state: outcome.candidate.state,
    decision: outcome.candidate.receipt?.decision ?? null,
    promotedVersion: outcome.promoted?.versionId ?? null,
    lastKnownGoodVersion: outcome.candidate.lastKnownGoodVersion,
    structuralReleaseContract: ZERO_RELEASE_EVENTS,
  }));
  if (!outcome.promoted) process.exitCode = 2;
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

/** Each approval's verifying read, read back from the vault and proved against its sidecar; a body it cannot produce is not held. */
async function heldReads(vault: VaultIndex, approvals: readonly PublishableCampaignSiteApproval[]): Promise<Map<string, HeldVerifyingRead>> {
  const held = new Map<string, HeldVerifyingRead>();
  for (const approval of approvals) {
    const artifact = vault.byId.get(approval.campaignSite.evidence.artifactId);
    if (artifact === undefined || artifact.tier === "RESTRICTED_RAW" || held.has(artifact.id)) continue;
    try {
      held.set(artifact.id, {
        body: new TextDecoder().decode(await readHeldBytes(artifact)),
        sha256: artifact.contentHash.slice("sha256-".length),
        tier: artifact.tier === "SANITIZED_DERIVED" ? "SANITIZED_DERIVED" : "RAW",
        permission: artifact.permission,
      });
    } catch {
      /* A body that does not hash to its commitment is not held: the writer holds its site as not vaulted. */
    }
  }
  return held;
}

async function main(): Promise<void> {
  const approvals = await readApprovals();
  const profilesRead = await readPromotedCivicData<{ readonly links?: { readonly links?: Readonly<Record<string, CandidateLinksShape>> } }>(
    PROFILES.recordClass, PROFILES.scope, { store, bypassCache: true, now },
  );
  const profiles = profilesRead.kind === "PROMOTED" && profilesRead.metadata.versionId !== null && profilesRead.metadata.promotedAt !== null
    ? {
        input: {
          kind: "PROMOTED_VERSION" as const, recordClass: PROFILES.recordClass, scope: PROFILES.scope, versionId: profilesRead.metadata.versionId,
          readModelSha256: sha256(canonicalCivicDataJson(profilesRead.value)), promotedAt: profilesRead.metadata.promotedAt,
        },
        links: profilesRead.value.links?.links ?? {},
      }
    : profilesRead.kind === "NOT_RECORDED"
      ? null
      : { unreadable: `${profilesRead.kind}${"detail" in profilesRead ? `: ${profilesRead.detail}` : ""}` };
  let held = new Map<string, HeldVerifyingRead>();
  if (!("unreadable" in approvals) && approvals.length > 0) {
    try {
      held = await heldReads(await indexVault(join(process.cwd(), "data", "control-plane", "vault")), approvals);
    } catch (error) {
      await finish(derivedCampaignSitesFailedCandidate(now, `The evidence vault could not be read: ${error instanceof Error ? error.message : String(error)}`));
      return;
    }
  }
  const pass = derivedCampaignSitesPass({
    approvals,
    held: (record) => held.get(record.campaignSite.evidence.artifactId) ?? null,
    profiles,
    gateOpen: classFieldOpen(ACTIVATION_GATE, "candidate-enrichment", "campaignSite"),
    now,
  });
  for (const p of pass.plan?.published ?? []) console.log(`  published ${p.key}: ${p.url} (${p.approvalRecordId})`);
  for (const h of pass.plan?.held ?? []) console.log(`  held ${h.key}: ${h.code}: ${h.detail}`);
  await finish(pass.candidate);
}

await main();
