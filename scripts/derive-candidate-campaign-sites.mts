import { requireBallotState, stateBallotScope, stateBallotContractId } from "../lib/ballot/state-scopes.ts";
import { assignment } from "./cli-args.mts";
import { readGenericBallotProjection } from "../lib/ballot/generic-projection.ts";
import { deriveCandidateUniverse } from "../lib/hunt/candidate-universe.ts";
import { campaignSiteSubjects } from "../lib/candidates/campaign-site-subjects.ts";
import { publishCandidateFindings } from "../lib/civic-data/candidate-profile-findings.ts";
import { ADMIN_CONFIG_ID } from "../lib/control-plane/gateway/admin-config.ts";
import type { CampaignSiteSubject } from "../lib/control-plane/promotion/campaign-site-chain.ts";
import { createPgRepositories } from "../lib/control-plane/repository/pg-store.ts";
import { factClocks } from "../lib/facts/clocks.ts";
import { CANDIDATE_PROFILE_LEAD } from "../lib/facts/finding-slots.ts";
import type { BallotSet } from "../lib/ballot/types.ts";
import { publishCampaignSitePortraits } from "../lib/control-plane/promotion/campaign-site-portraits.ts";
import { join } from "node:path";

import { neon } from "@neondatabase/serverless";

import { promotedInputRef } from "../lib/civic-data/derived-authority.ts";
import { derivedCampaignSitesContractId, DERIVED_CAMPAIGN_SITES_RECORD_CLASS, derivedCampaignSitesScope,
  readDerivedCampaignSites, type CandidateLinksShape } from "../lib/civic-data/derived-campaign-sites.ts";
import {
  derivedCampaignSitesFailedCandidate,
  derivedCampaignSitesPass,
  derivedCampaignSitesCandidate,
  isPublishableCampaignSiteApproval,
  heldCampaignSiteReads,
  type HeldVerifyingRead,
  type DerivedCampaignSitesPlan,
  type HeldLinkedPublicationRead,
  type PublishableCampaignSiteApproval,
} from "../lib/civic-data/derived-campaign-site-writer.ts";
import { promoteDerivedCandidate } from "../lib/civic-data/derived-child-receipt.ts";
import { requiredManualProductionContract } from "../lib/civic-data/manual-contracts.ts";
import { readPromotedCivicData } from "../lib/civic-data/read-model.ts";
import { PostgresRoutineDataStore } from "../lib/civic-data/store.ts";
import type { RoutineCandidate } from "../lib/civic-data/types.ts";
import { findHeldCapture, type HeldVaultArtifact, type VaultIndex } from "../lib/control-plane/evidence/read-only-vault.ts";
import { heldArtifactCaptures } from "../lib/civic-data/held-artifact-captures.ts";
import { candidatePublicationLinks, candidatePublicationCaptureUrls,
  heldCandidatePublicationRead } from "../lib/control-plane/promotion/campaign-publication-links.ts";
import { prepareProductionCivicDataWrite } from "../lib/civic-data/production-write.ts";
import { installNeonRequestDeadline } from "../lib/ops/neon-request-deadline.ts";

if (!process.argv.includes("--promote")) {
  throw new Error("usage: scripts/derive-candidate-campaign-sites.mts --promote (the standing runner's child; there is no dry mode against production)");
}
installNeonRequestDeadline();
prepareProductionCivicDataWrite();

const store = new PostgresRoutineDataStore();
const now = new Date().toISOString();
const state = requireBallotState(assignment(process.argv, "state") ?? "");
const PROFILES = requiredManualProductionContract(stateBallotContractId("candidate-profiles", state));

/* An unchanged pass (the same approvals, the same bytes, the same profiles) is receipted on the pointed version, never re-promoted. */
async function finish(candidate: RoutineCandidate): Promise<void> {
  await promoteDerivedCandidate(store, derivedCampaignSitesContractId(state), candidate, now);
}

/** Every APPROVED campaign-site record in the pipeline log, narrowed in the database to approvals only. */
async function readApprovals(): Promise<PublishableCampaignSiteApproval[] | { readonly unreadable: string }> {
  const controlPlane = process.env.WTP_CONTROL_PLANE_DATABASE_URL;
  if (!controlPlane) return { unreadable: "the control plane's pipeline log is not configured (WTP_CONTROL_PLANE_DATABASE_URL)" };
  try {
    const sql = neon(controlPlane);
    const rows = await sql.query(
      "SELECT record FROM cp_log_promotion_pipeline WHERE record->>'stage' = 'APPROVED_FOR_PROMOTION' AND upper(record#>>'{campaignSite,identity,stateCode}')=$1 ORDER BY log_key, position",
      [state],
    ) as { record: unknown }[];
    return rows.map((row) => (typeof row.record === "string" ? JSON.parse(row.record) as unknown : row.record)).filter(isPublishableCampaignSiteApproval);
  } catch (error) {
    return { unreadable: error instanceof Error ? error.message : String(error) };
  }
}

/** Distinct completed publication acquisitions. The child never infers
 * article authority from a URL in prose or from uncommitted vault bytes. */
async function linkedPublicationReads(vaultRoot: string, vault: VaultIndex, approvals: readonly PublishableCampaignSiteApproval[],
  held: ReadonlyMap<string, HeldVerifyingRead>): Promise<readonly HeldLinkedPublicationRead[] | { readonly unreadable: string }> {
  const controlPlane = process.env.WTP_CONTROL_PLANE_DATABASE_URL;
  if (!controlPlane) return { unreadable: "the control plane's publication attempts are not configured" };
  const links = approvals.flatMap(approval => {
    const page = held.get(approval.recordId), site = approval.campaignSite;
    return page ? candidatePublicationLinks({ html: page.body, sourceUrl: site.evidence.finalUrl,
      sourceArtifactId: site.evidence.artifactId, sourceContentHash: `sha256-${site.evidence.sha256}`,
      approvalRecordId: approval.recordId, candidacyId: site.candidacyId }) : [];
  });
  const urls = candidatePublicationCaptureUrls(links, vault);
  if (!urls.length) return [];
  try {
    const rows = await neon(controlPlane).query(
      `SELECT a.record, t.value AS attempt, w.value AS work_item
       FROM unnest($1::text[]) AS sources(url)
       JOIN cp_log_artifacts a ON md5(a.record->>'canonicalUrl') = md5(sources.url) AND a.record->>'canonicalUrl' = sources.url
       JOIN cp_attempts t ON t.id = a.record->>'attemptId'
       JOIN cp_work_items w ON w.id = a.record->>'workItemId'
       ORDER BY a.record->>'canonicalUrl', a.record->>'recordedAt', a.record->>'artifactId'`, [urls],
    ) as { record: unknown; attempt: unknown; work_item: unknown }[];
    const out: HeldLinkedPublicationRead[] = [];
    for (const row of rows) {
      const record = (typeof row.record === "string" ? JSON.parse(row.record) : row.record) as HeldLinkedPublicationRead["record"];
      const attempt = (typeof row.attempt === "string" ? JSON.parse(row.attempt) : row.attempt) as HeldLinkedPublicationRead["attempt"];
      const workItem = (typeof row.work_item === "string" ? JSON.parse(row.work_item) : row.work_item) as { subject?: unknown };
      // One unreadable capture holds only its own publication (it stays unverified, owed work);
      // it never blocks every other approved campaign link from reaching readers.
      let capture;
      try {
        const exact = await findHeldCapture(vaultRoot, record);
        capture = exact ? await heldCandidatePublicationRead(record, attempt, {
          byId: new Map([[exact.id, exact]]), byHash: new Map([[exact.contentHash.slice(7), exact]]),
          byWorkItem: new Map([[record.workItemId, [exact]]]),
        }, typeof workItem.subject === "string" ? workItem.subject : "") : null;
      }
      catch {
        process.stderr.write(`LINKED_PUBLICATION_CAPTURE_UNREADABLE ${record.artifactId}: failed exact vault read\n`);
        continue;
      }
      if (capture) out.push(capture);
      else process.stderr.write(`LINKED_PUBLICATION_CAPTURE_UNREADABLE ${record.artifactId}: missing or restricted in this vault\n`);
    }
    return out;
  } catch (error) { return { unreadable: error instanceof Error ? error.message : String(error) }; }
}

async function main(): Promise<void> {
  const approvals = await readApprovals();
  const priorRead = await readDerivedCampaignSites(state, { store, bypassCache: true, now });
  const priorInput = priorRead.kind === "PROMOTED" ? promotedInputRef(DERIVED_CAMPAIGN_SITES_RECORD_CLASS,
    derivedCampaignSitesScope(state), priorRead.metadata.versionId, priorRead.value, priorRead.metadata.promotedAt) : null;
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
      const priorPublications = prior && !("unreadable" in prior) ? prior.projection.records.flatMap(record =>
        (record.publications ?? []).map(publication => publication.evidence.artifactId)) : [];
      const priorCapture = await heldArtifactCaptures(vaultRoot, priorPublications, process.env.WTP_CONTROL_PLANE_DATABASE_URL!);
      const priorHeld = (await Promise.all([...new Set(priorPublications)].map(id => priorCapture(id)))).filter((row): row is HeldVaultArtifact => row !== null);
      const priorByWorkItem = new Map<string, HeldVaultArtifact[]>();
      for (const row of priorHeld) if (row.workItemId) {
        const group = priorByWorkItem.get(row.workItemId) ?? []; group.push(row); priorByWorkItem.set(row.workItemId, group);
      }
      const priorVault: VaultIndex = { byId: new Map(priorHeld.map(row => [row.id, row])),
        byHash: new Map(priorHeld.map(row => [row.contentHash.slice(7), row])), byWorkItem: priorByWorkItem };
      const linked = await linkedPublicationReads(vaultRoot, priorVault, approvals, held);
      if ("unreadable" in linked) {
        await finish(derivedCampaignSitesFailedCandidate(state, now, `The linked candidate-publication record could not be read: ${linked.unreadable}`));
        return;
      }
      linkedPublications = linked;
    } catch (error) {
      await finish(derivedCampaignSitesFailedCandidate(state, now, `The evidence vault could not be read: ${error instanceof Error ? error.message : String(error)}`));
      return;
    }
  }
  const pass = derivedCampaignSitesPass({
    state, approvals,
    prior,
    held: (record) => held.get(record.recordId) ?? null,
    linkedPublications,
    profiles,
    now,
  });
  for (const p of pass.plan?.published ?? []) console.log(`  published ${p.key}: ${p.url} (${p.approvalRecordId})`);
  for (const h of pass.plan?.held ?? []) console.log(`  held ${h.key}: ${h.code}: ${h.detail}`);
  await finish(pass.candidate);
  const readablePrior = prior && !("unreadable" in prior) ? prior : null;
  let plan: DerivedCampaignSitesPlan | null = pass.plan ?? (prior && "unreadable" in prior ? null : {
    records: readablePrior?.projection.records ?? [], portraits: readablePrior?.projection.portraits ?? [],
    inputs: readablePrior ? [readablePrior.input] : [], published: [], held: [],
    ...(readablePrior ? { prior: readablePrior } : {}),
  });
  let subjects: ReturnType<typeof campaignSiteSubjects> = new Map();
  try {
    const national = await readGenericBallotProjection(state, { store, bypassCache: true, now });
    if (national.kind === "PROMOTED") {
      const groups = new Map<string, BallotSet[]>();
      for (const ballot of Object.values(national.value.ballots)) {
        const key = `${ballot.election.state}:${ballot.election.date.slice(0, 4)}`;
        groups.set(key, [...(groups.get(key) ?? []), ballot]);
      }
      subjects = campaignSiteSubjects({ universes: [...groups.values()].map(ballots => deriveCandidateUniverse({
        stateCode: ballots[0].election.state, cycle: Number(ballots[0].election.date.slice(0, 4)),
        generatedBy: "published national ballots", generatedOn: now.slice(0, 10),
        documents: ballots.map(ballot => ({ path: ballot.election.id, contests: ballot.contests, candidacies: ballot.candidacies })),
        stores: { huntState: {}, cards: {}, links: {}, linkHunts: [] } })) });
      const reference = promotedInputRef("BALLOT_CANDIDACY", stateBallotScope("ballot-contests", state), national.metadata.versionId,
        national.value, national.metadata.promotedAt);
      if (reference && plan) plan = { ...plan, inputs: [...plan.inputs, reference] };
    }
  } catch (error) { console.error(`National candidate portrait subjects could not be read: ${error instanceof Error ? error.message : String(error)}`); }
  if (plan) await publishCampaignSitePortraits({
    plan, approvals: "unreadable" in approvals ? [] : approvals, subjects: [...subjects.values()], held: record => held.get(record.recordId) ?? null, now,
    onPublished: published => finish(derivedCampaignSitesCandidate(state, published, now)),
  });
  await publishHuntedCandidateFields([...subjects.values()], "unreadable" in approvals ? [] : approvals);
}

/** Hunters' candidate bios, campaign contacts and portraits from the Box, published on profile cards once each holds on its saved page. */
async function publishHuntedCandidateFields(subjects: readonly CampaignSiteSubject[], approvals: readonly PublishableCampaignSiteApproval[]): Promise<void> {
  const controlPlane = process.env.WTP_CONTROL_PLANE_DATABASE_URL;
  if (!controlPlane || !subjects.length) return;
  const repos = await createPgRepositories(controlPlane, now, { skipBootstrap: true });
  const subjectIds = [...new Set(subjects.flatMap(subject => [subject.candidacyId, ...subject.readerKeys]))];
  const waiting = (await Promise.all(subjectIds.map(id => repos.boxFindings.listWhere(["subjectId"], id)))).flat().filter(row => row.value.state === "waiting" && row.value.waitingFor?.reason === CANDIDATE_PROFILE_LEAD);
  if (!waiting.length) return;
  const held = await heldArtifactCaptures(join(process.cwd(), "data", "control-plane", "vault"),
    waiting.flatMap(row => row.value.origins.flatMap(origin => origin.artifactIds)), controlPlane);
  const campaignHosts = new Map<string, string[]>();
  for (const approval of approvals) campaignHosts.set(approval.campaignSite.candidacyId,
    [...campaignHosts.get(approval.campaignSite.candidacyId) ?? [], approval.campaignSite.host]);
  const report = await publishCandidateFindings({ boxFindings: repos.boxFindings, scoutResults: repos.scoutResults, held, store, subjects, campaignHosts,
    clocks: factClocks((await repos.adminConfig.read(ADMIN_CONFIG_ID))?.value ?? null), now });
  console.log(`RCD_CANDIDATE_FINDINGS=${JSON.stringify(report)}`);
}

await main();
