import { requireBallotState, stateBallotScope } from "../lib/civic-data/state-scopes.ts";
import { assignment } from "./cli-args.mts";
import type { GenericBallotProjection } from "../lib/ballot/generic-projection.ts";
import { deriveCandidateUniverse } from "../lib/hunt/candidate-universe.ts";
import { campaignSiteSubjects } from "../lib/candidates/campaign-site-subjects.ts";
import type { BallotSet } from "../lib/ballot/types.ts";
import { publishCandidatePortraits } from "../lib/ballot/portrait-refresh.ts";
import { campaignSiteHostRefusal } from "../lib/candidates/campaign-site-verifier.ts";
import { join } from "node:path";

import { neon } from "../lib/db/client.ts";

import { promotedInputRef, type DerivedInputRef } from "../lib/civic-data/derived-authority.ts";
import { confirmDerivedSourceUnchanged, withDerivedSourceContent } from "../lib/civic-data/derived-source-hash.ts";
import { readCampaignSourceInputs, readCampaignProfileLinks } from "../lib/civic-data/campaign-source-inputs.ts";
import { sourceHashReceiptFields } from "../lib/civic-data/source-hash.ts";
import { ZERO_RELEASE_EVENTS } from "../lib/civic-data/release.ts";
import { passDeadlineFromEnv } from "../lib/ops/independent-runtime-pass.ts";
import { factClocks } from "../lib/facts/clocks.ts";
import { ADMIN_CONFIG_ID, defaultAdminConfig } from "../lib/control-plane/gateway/admin-config.ts";
import { settingDefinition } from "../lib/control-plane/settings.ts";
import { derivedCampaignSitesContractId, DERIVED_CAMPAIGN_SITES_RECORD_CLASS, derivedCampaignSitesScope,
  type DerivedCampaignSitesProjection } from "../lib/civic-data/derived-campaign-sites.ts";
import {
  deriveCampaignSitesFromCaptures,
  derivedCampaignSitesCandidate,
  derivedCampaignSitesFailedCandidate,
  DERIVED_CAMPAIGN_SITES_PARSER,
  isPublishableCampaignSiteApproval,
  heldCampaignSiteReads,
  type HeldVerifyingRead,
  type DerivedCampaignSitesPlan,
  type HeldLinkedPublicationRead,
  type PublishableCampaignSiteApproval,
  type CampaignPortraitWork,
} from "../lib/civic-data/derived-campaign-site-writer.ts";
import { promoteDerivedCandidate } from "../lib/civic-data/derived-child-receipt.ts";
import { readPromotedCivicData } from "../lib/civic-data/read-model.ts";
import { PostgresRoutineDataStore } from "../lib/civic-data/store.ts";
import type { RoutineCandidate } from "../lib/civic-data/types.ts";
import { findHeldCapture, heldVaultIndex } from "../lib/control-plane/evidence/read-only-vault.ts";
import { candidatePublicationLinks, candidatePublicationCaptureUrls,
  heldCandidatePublicationRead } from "../lib/control-plane/promotion/campaign-publication-links.ts";
import { prepareProductionCivicDataWrite } from "../lib/civic-data/production-write.ts";
import { installNeonRequestDeadline } from "../lib/ops/neon-request-deadline.ts";
import { heldArtifactCaptures } from "../lib/civic-data/held-artifact-captures.ts";
import { rememberStatePublicationPrior } from "../lib/civic-data/state-publication.ts";

if (!process.argv.includes("--promote")) {
  throw new Error("usage: scripts/derive-candidate-campaign-sites.mts --promote (the standing runner's child; there is no dry mode against production)");
}
installNeonRequestDeadline();
prepareProductionCivicDataWrite();

const store = new PostgresRoutineDataStore();
const now = new Date().toISOString();
const state = requireBallotState(assignment(process.argv, "state") ?? "");
let sourceInputs: readonly DerivedInputRef[] | null = null;

async function finish(candidate: RoutineCandidate): Promise<void> {
  await promoteDerivedCandidate(store, derivedCampaignSitesContractId(state),
    sourceInputs ? withDerivedSourceContent(candidate, sourceInputs) : candidate, now,
    // A completed or stopped portrait pass saves its progress even when it found no new image.
    { confirmUnchanged: false });
}

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

/** Found campaign pages feed portraits as soon as their own saved page verifies. */
async function foundPortraitSites(subjectIds:readonly string[]):Promise<Map<string,string[]>> {
  const sites=new Map<string,string[]>(),connection=process.env.WTP_CONTROL_PLANE_DATABASE_URL;
  if(!connection || !subjectIds.length)return sites;
  const sql=neon(connection);
  const rows=await sql.query(`SELECT record->>'subjectId' AS subject_id,
    coalesce(record->>'canonicalUrl',record#>>'{source,websiteUrl}',record#>>'{source,pointerUrl}') AS url
    FROM cp_log_promotion_pipeline WHERE record->>'stage'='SCOUTED' AND record->>'recordClass'='candidate-enrichment'
      AND record->>'subjectId'=ANY($1::text[])`,[subjectIds]);
  for(const row of rows)if(typeof row.url === "string" && campaignSiteHostRefusal(row.url) === null)
    sites.set(row.subject_id,[...sites.get(row.subject_id) ?? [],row.url]);
  return sites;
}

function wwwAlias(url: string): string {
  const alias = new URL(url);
  alias.hostname = alias.hostname.startsWith("www.") ? alias.hostname.slice(4) : `www.${alias.hostname}`;
  return alias.href;
}

async function linkedPublicationReads(vaultRoot: string, approvals: readonly PublishableCampaignSiteApproval[],
  held: ReadonlyMap<string, HeldVerifyingRead>): Promise<HeldLinkedPublicationRead[] | { readonly unreadable: string }> {
  const controlPlane = process.env.WTP_CONTROL_PLANE_DATABASE_URL;
  if (!controlPlane) return { unreadable: "the control plane's publication attempts are not configured" };
  const links = approvals.flatMap(approval => {
    const page = held.get(approval.recordId), site = approval.campaignSite;
    return page ? candidatePublicationLinks({ html: page.body, sourceUrl: site.evidence.finalUrl,
      sourceArtifactId: site.evidence.artifactId, sourceContentHash: `sha256-${site.evidence.sha256}`,
      approvalRecordId: approval.recordId, candidacyId: site.candidacyId }) : [];
  });
  if (!links.length) return [];
  try {
    const rows = await neon(controlPlane).query(
      `WITH found AS (
         SELECT a.record FROM unnest($1::text[]) AS sources(url)
         JOIN cp_log_artifacts a ON md5(a.record->>'canonicalUrl') = md5(sources.url) AND a.record->>'canonicalUrl' = sources.url
         UNION
         SELECT a.record FROM cp_work_items_history w JOIN cp_log_artifacts a ON a.record #>> '{workItemId}' = w.id
         WHERE w.value #>> '{subject}' = ANY($2::text[]))
       SELECT f.record, t.value AS attempt, w.value AS work_item FROM found f
       JOIN cp_attempts t ON t.id = f.record->>'attemptId'
       JOIN cp_work_items_history w ON w.id = f.record->>'workItemId'
       ORDER BY f.record->>'canonicalUrl', f.record->>'recordedAt', f.record->>'artifactId'`,
      [[...new Set(links.flatMap(link => [link.url, wwwAlias(link.url)]))], [...new Set(links.map(link => `candidate-publication:${link.source.candidacyId}`))]],
    ) as { record: unknown; attempt: unknown; work_item: unknown }[];
    const parsed = rows.map(row => ({
      record: (typeof row.record === "string" ? JSON.parse(row.record) : row.record) as HeldLinkedPublicationRead["record"],
      attempt: (typeof row.attempt === "string" ? JSON.parse(row.attempt) : row.attempt) as HeldLinkedPublicationRead["attempt"],
      workItem: (typeof row.work_item === "string" ? JSON.parse(row.work_item) : row.work_item) as { subject?: unknown },
    }));
    const located = await Promise.all(parsed.map(row => findHeldCapture(vaultRoot, row.record).catch(() => null)));
    const vault = heldVaultIndex(located.flatMap(row => row ? [row] : []));
    const captureUrls = new Set(candidatePublicationCaptureUrls(links, vault));
    const out: HeldLinkedPublicationRead[] = [];
    for (const { record, attempt, workItem } of parsed.filter(row => captureUrls.has(row.record.canonicalUrl))) {
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

async function readPrior() {
  const priorRead = await readPromotedCivicData<DerivedCampaignSitesProjection>(DERIVED_CAMPAIGN_SITES_RECORD_CLASS, derivedCampaignSitesScope(state), { store,  now });
  if (priorRead.kind === "PROMOTED") rememberStatePublicationPrior(store, priorRead.projection);
  const priorInput = priorRead.kind === "PROMOTED" ? promotedInputRef(DERIVED_CAMPAIGN_SITES_RECORD_CLASS,
    derivedCampaignSitesScope(state), priorRead.metadata.versionId, priorRead.value, priorRead.metadata.promotedAt) : null;
  return priorRead.kind === "PROMOTED" && priorInput?.kind === "PROMOTED_VERSION"
    ? { input: priorInput, projection: priorRead.value } : priorRead.kind === "NOT_RECORDED" ? null
      : { unreadable: `${priorRead.kind}${"detail" in priorRead ? `: ${priorRead.detail}` : ": no exact promoted version reference"}` };
}

async function readApprovedPages(approvals: readonly PublishableCampaignSiteApproval[]) {
  const artifactIds = approvals.flatMap(row => [row.campaignSite.evidence.artifactId,
    ...(row.campaignSite.evidence.cycleSource ? [row.campaignSite.evidence.cycleSource.artifactId] : [])]);
  const capture = await heldArtifactCaptures(join(process.cwd(), "data", "control-plane", "vault"), artifactIds,
    process.env.WTP_CONTROL_PLANE_DATABASE_URL!);
  return heldCampaignSiteReads(capture, approvals);
}

async function readCaptures(approvals: readonly PublishableCampaignSiteApproval[]) {
  const held = await readApprovedPages(approvals);
  try {
    const linked = await linkedPublicationReads(join(process.cwd(), "data", "control-plane", "vault"), approvals, held);
    if ("unreadable" in linked) throw new Error(`The linked candidate-publication record could not be read: ${linked.unreadable}`);
    return { held, linkedPublications: linked };
  } catch (error) {
    held.clear();
    throw error;
  }
}

async function main(): Promise<void> {
  const controlPlane = process.env.WTP_CONTROL_PLANE_DATABASE_URL;
  let progress: CampaignPortraitWork | undefined;
  let retryMinutes = factClocks(null).retryMinutes("portrait");
  if (controlPlane) {
    try {
    const sql = neon(controlPlane);
    sourceInputs = await readCampaignSourceInputs(store, state, async (text, params = []) => await sql.query(text, [...params]));
    const [config] = await sql.query("SELECT value #> '{settings,facts.retryMinutes}' AS retry FROM cp_admin_config WHERE id=$1", [ADMIN_CONFIG_ID]);
    if (settingDefinition("facts.retryMinutes")?.validate(config?.retry)) retryMinutes = factClocks({
      ...defaultAdminConfig(), settings: { "facts.retryMinutes": config!.retry },
    }).retryMinutes("portrait");
    const head = await store.readSourceHead(DERIVED_CAMPAIGN_SITES_RECORD_CLASS, derivedCampaignSitesScope(state));
    progress = head ? await store.readCandidateField(head.versionId, ["normalizedPayload", "portraitWork"]) as CampaignPortraitWork | undefined : undefined;
    const confirmed = await confirmDerivedSourceUnchanged({ store, sourceId: "candidate-campaign-site-chain",
      recordClass: DERIVED_CAMPAIGN_SITES_RECORD_CLASS, scope: derivedCampaignSitesScope(state), parserVersion: DERIVED_CAMPAIGN_SITES_PARSER,
      sourceContentInputs: sourceInputs, now,
      complete: Boolean(progress?.inputsComplete && progress.retryMinutes === retryMinutes && !progress.pending.length &&
        (progress.nextDueAt === null || Date.parse(progress.nextDueAt) > Date.parse(now))) });
    if (confirmed) {
      console.log("RCD_RECEIPT=" + JSON.stringify({ source: derivedCampaignSitesContractId(state), ...sourceHashReceiptFields(confirmed), structuralReleaseContract: ZERO_RELEASE_EVENTS }));
      return;
    }
    } catch (error) {
      await finish(derivedCampaignSitesFailedCandidate(state, now,
        `The campaign source inputs could not be read: ${error instanceof Error ? error.message : String(error)}`));
      return;
    }
  }
  const profiles = await readCampaignProfileLinks(store, state);
  let prior = await readPrior();
  const approvals = await readApprovals();
  const pass = await deriveCampaignSitesFromCaptures({ state, approvals, prior, profiles, now, readCaptures });
  for (const p of pass.plan?.published ?? []) console.log(`  published ${p.key}: ${p.url} (${p.approvalRecordId})`);
  for (const h of pass.plan?.held ?? []) console.log(`  held ${h.key}: ${h.code}: ${h.detail}`);
  let plan: DerivedCampaignSitesPlan | null = pass.plan;
  if (!plan && !(prior && "unreadable" in prior)) plan = (await deriveCampaignSitesFromCaptures({
    state, approvals: [], prior, profiles: null, now, readCaptures,
  })).plan;
  if (plan && progress) plan = { ...plan, portraitWork: progress };
  prior = null;
  let subjects: ReturnType<typeof campaignSiteSubjects> = new Map();
  let subjectsComplete = false;
  try {
    const ballotRead = await readPromotedCivicData<GenericBallotProjection>("BALLOT_CANDIDACY", stateBallotScope("ballot-contests", state), { store,  now });
    if (ballotRead.kind === "PROMOTED") {
      subjectsComplete = pass.plan !== null;
      const groups = new Map<string, BallotSet[]>();
      for (const ballot of Object.values(ballotRead.value.ballots)) {
        const key = `${ballot.election.state}:${ballot.election.date.slice(0, 4)}`;
        groups.set(key, [...(groups.get(key) ?? []), ballot]);
      }
      subjects = campaignSiteSubjects({ universes: [...groups.values()].map(ballots => deriveCandidateUniverse({
        stateCode: ballots[0].election.state, cycle: Number(ballots[0].election.date.slice(0, 4)),
        generatedBy: "published state ballots", generatedOn: now.slice(0, 10),
        documents: ballots.map(ballot => ({ path: ballot.election.id, contests: ballot.contests, candidacies: ballot.candidacies })),
        stores: { huntState: {}, cards: {}, links: {}, linkHunts: [] } })) });
      const reference = promotedInputRef("BALLOT_CANDIDACY", stateBallotScope("ballot-contests", state), ballotRead.metadata.versionId,
        ballotRead.value, ballotRead.metadata.promotedAt);
      if (reference && plan) plan = { ...plan, inputs: [...plan.inputs, reference] };
    }
  } catch (error) { console.error(`State candidate portrait subjects could not be read: ${error instanceof Error ? error.message : String(error)}`); }
  let sites=new Map<string,string[]>();
  try {sites=await foundPortraitSites([...subjects.keys()]);} catch(error){subjectsComplete=false;console.error(`Found campaign portrait pages could not be read: ${error instanceof Error ? error.message : String(error)}`);}
  if(profiles && !("unreadable" in profiles)) for(const subject of subjects.values())
    sites.set(subject.candidacyId,[...sites.get(subject.candidacyId) ?? [],...subject.readerKeys.flatMap(key=>profiles.links[key]?.campaign?.url ? [profiles.links[key].campaign!.url] : [])]);
  for(const record of plan?.records ?? [])sites.set(record.candidacyId,[...sites.get(record.candidacyId) ?? [],record.campaign.url]);
  let publishedPortrait=false;
  const stop = new AbortController(), deadline = passDeadlineFromEnv();
  const timer = Number.isFinite(deadline) ? setTimeout(() => stop.abort(Error("PASS_TIME_BUDGET")), Math.max(0, deadline - 45_000 - Date.now())) : undefined;
  timer?.unref();
  process.once("SIGTERM", () => stop.abort(Error("PASS_TIME_BUDGET")));
  if (plan) plan = await publishCandidatePortraits({
    plan, sites, subjects: [...subjects.values()], now, signal: stop.signal, retryMinutes, subjectsComplete,
    onPublished: async published => {
      await finish(derivedCampaignSitesCandidate(state, published, now));
      publishedPortrait=true;
    },
  });
  clearTimeout(timer);
  // A portrait publication already includes the site's held facts. A failed
  // campaign-link pass cannot replace that result or mark its child as failed.
  await finish(plan && (pass.plan || publishedPortrait) ? derivedCampaignSitesCandidate(state, plan, now) : pass.candidate);
}


await main();
