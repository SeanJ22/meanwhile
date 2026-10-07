import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import type { ControlPlaneRepositories } from "../lib/control-plane/repository/types.ts";
import { appendTransition, contextFromRepositories, readPipelineStates, scoutResultItemId } from "../lib/control-plane/promotion/pipeline.ts";
import { PROMOTION_PIPELINE_FORMAT_VERSION, type ScoutedRecord } from "../lib/control-plane/promotion/types.ts";
import { CAMPAIGN_SITE_RECORD_CLASS, discoveryPointerItemId, profileCampaignSiteLeads, type CampaignSiteApprovedRecord } from "../lib/control-plane/promotion/campaign-site-chain.ts";
import type { ScoutResult } from "../lib/control-plane/scheduler/scout-result.ts";
import {
  CAMPAIGN_SITE_MAX_READS,
  campaignSiteCycleLine,
  campaignSiteSubjectsFromHoldings,
  heldMarginaliaFromManifest,
  runCampaignSiteCycle,
  withinWallTime,
  type CampaignSiteCycleInput,
} from "../lib/control-plane/promotion/campaign-site-cycle.ts";
import { indexVault, readHeldBytes } from "../lib/control-plane/evidence/read-only-vault.ts";
import { runCandidatePublicationCycle } from "../lib/control-plane/promotion/campaign-publication-cycle.ts";
import { candidatePublicationLinks, candidatePublicationCaptureIssue, candidatePublicationCaptureUrls,
  heldCandidatePublicationRead } from "../lib/control-plane/promotion/campaign-publication-links.ts";
import { campaignSiteReadRecorder } from "../lib/control-plane/promotion/campaign-site-reads.ts";
import { DurableEvidenceStore } from "../lib/control-plane/evidence/durable-store.ts";
import { recordAcquisition } from "../lib/control-plane/evidence/artifact.ts";
import { putArtifact } from "../lib/control-plane/evidence/store.ts";
import type { StagingManifest } from "../lib/control-plane/scheduler/promotion-tail.ts";
import { modelLaneClosure } from "../lib/control-plane/scheduler/model-lane.ts";
import { heldPageRead, verifyCampaignSitePage } from "../lib/candidates/campaign-site-verifier.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { campaignPublicationInputsDue, CAMPAIGN_PUBLICATION_TASK } from "../lib/civic-data/campaign-publication-due.ts";
import { ROUTINE_SOURCE_TASKS, routineTaskDue, routineFailureDomainFrontier } from "../lib/civic-data/runner.ts";
import { manualProjectionCandidate, type CandidateProfilesProjection, type ManualProjectionPackage } from "../lib/civic-data/manual-projections.ts";
import { processRegisteredManualCandidate, processRegisteredRoutineCandidate } from "../lib/civic-data/promotion.ts";
import { readPromotedCivicData } from "../lib/civic-data/read-model.ts";
import { promotedInputRef } from "../lib/civic-data/derived-authority.ts";
import { derivedAuthorityFor } from "../lib/civic-data/derived-door.ts";
import { refreshCandidateProfilesFromPromoted, refreshCandidateCorpusFromPromoted } from "../lib/civic-data/manual-read-models.ts";
import { documentsFor } from "../lib/candidates/positions.ts";
import { answerFor } from "../lib/candidates/corpus.ts";
import { derivedCampaignSitesProjectionIssue } from "../lib/civic-data/derived-campaign-sites.ts";
import {
  CAMPAIGN_SITE_VERIFICATION_TEMPLATE,
  composeCampaignLinks,
  derivedCampaignSiteHoldingPath,
  readDerivedCampaignSites,
  type DerivedCampaignSiteRecord,
} from "../lib/civic-data/derived-campaign-sites.ts";
import {
  derivedCampaignSitesCandidate,
  derivedCampaignSitesPass,
  isPublishableCampaignSiteApproval,
  reverifyApprovedSite,
  heldCampaignSiteReads,
  planDerivedCampaignSites,
  type HeldVerifyingRead,
  type HeldLinkedPublicationRead,
  type PublishableCampaignSiteApproval,
} from "../lib/civic-data/derived-campaign-site-writer.ts";
import { allCandidateLinks, campaignLinkIsDerived, linksForCandidacy } from "../lib/ballot/candidate-sites.ts";
import { candidateProfileEvidenceFor } from "../lib/ask/candidate-profile.ts";
import { preloadCandidateEnrichmentAuthorities, candidateEnrichmentHoldings } from "../lib/control-plane/scheduler/providers/candidate-enrichment.ts";
import { DUARTE, KAPNER, MAYES, TANG_WILLIAMS, committedSubjects, fixture, servedRuntime, sha256, subject } from "./helpers/campaign-sites.ts";

const ROOT = process.cwd();
/* Past instants: the store refuses a candidate event later than its own clock. */
const T0 = "2026-09-20T12:00:00.000Z";
const T1 = "2026-09-24T21:00:00.000Z";
const T2 = "2026-09-24T23:00:00.000Z";
const PUBLISH = "2026-09-24T23:05:00.000Z";
const LILY = "https://www.lilytangwilliams.com/congress/endorsements/";
const LILY_PRESS = "https://www.lilytangwilliams.com/congress/press-releases/";
const KAPNER_ROOT = "https://www.kapner4mendhamtwp.com/";
const MARGINALIA_URL = "https://api.marginalia.nu/public/search/Lily%20Tang%20Williams";
const MAYES_KEY = "ballot-az-pima:attorney-general:mayes-kris";

const GATE = { promotionEnabled: true, openRecordClasses: ["candidate-enrichment"], openFields: {} };

function scoutedSite(f: { attemptId: string; obligationId: string; subjectId: string; outcome: "ROUTE_CANDIDATE"; routeId: string;
  canonicalUrl: string; artifactIds: string[]; recordedAt: string; summary: string }): ScoutedRecord {
  const itemId = scoutResultItemId({ attemptId: f.attemptId }, f.routeId);
  return {
    formatVersion: PROMOTION_PIPELINE_FORMAT_VERSION, recordId: `${itemId}:scouted`, itemId, at: f.recordedAt,
    actor: { role: "SCOUT", lane: "BOUNDED_MODEL_WORKER", instance: f.attemptId }, stage: "SCOUTED",
    source: { kind: "SCOUT_RESULT", attemptId: f.attemptId, obligationId: f.obligationId, outcome: f.outcome, routeId: f.routeId },
    recordClass: CAMPAIGN_SITE_RECORD_CLASS, subjectId: f.subjectId, canonicalUrl: f.canonicalUrl,
    artifactIds: f.artifactIds, scoutAttemptId: f.attemptId, summary: f.summary,
  };
}

const PROFILE = "https://www.ballotready.org/people/lily-tang-williams";
const PROFILE_HTML = `<title>Lily Tang Williams | Candidate profile</title><h1>Lily Tang Williams</h1>
  <p>Candidate for Representative in Congress - District 2 in the 2026 General Election. New Hampshire.</p>
  <a href="https://www.ballotready.org/about">About us</a><a href="https://unrelated.example/">Donate</a>
  <a href="${LILY}"><svg aria-hidden="true"></svg><span>Website</span></a>
  <a href="${LILY_PRESS}">Learn more</a><a href="${LILY_PRESS}">Learn more</a>
  <a href="https://unrelated.example/issues">Learn more</a><a href="https://facebook.com/lily">Facebook</a>`;

test("captured candidate profiles supply only observed campaign links tied to their candidate and office", () => {
  const page = heldPageRead({ requestedUrl: PROFILE, finalUrl: PROFILE, httpStatus: 200,
    contentType: "text/html", body: PROFILE_HTML, sha256: sha256(PROFILE_HTML), retrievedAt: T1 });
  assert.deepEqual(profileCampaignSiteLeads(page, subject(TANG_WILLIAMS), "profile").map(lead => lead.url), [LILY, LILY_PRESS]);
  for (const body of [PROFILE_HTML.replaceAll("Lily Tang Williams", "Someone Else"),
    PROFILE_HTML.replace("Representative in Congress - District 2", "Governor"),
    PROFILE_HTML.replace("<span>Website</span>", "<span>Support BallotReady</span>")]) {
    assert.deepEqual(profileCampaignSiteLeads({ ...page, body }, subject(TANG_WILLIAMS), "profile"), []);
  }
  assert.deepEqual(profileCampaignSiteLeads({ ...page, body: PROFILE_HTML.replace("2026", "2022") }, subject(TANG_WILLIAMS), "profile")
    .map(lead => lead.url), [LILY, LILY_PRESS], "discovery does not certify a cycle; the primary campaign verifier checks it");
});

test("a persisted facts-only Scout with no parser reaches the existing campaign-site publication door through saved profile hrefs", async t => {
  const p = await plane(t);
  const artifact = await captureProfile(p);
  const scout: ScoutResult = { formatVersion: 1, attemptId: "at-profile", obligationId: "ob-profile", routeTaskId: "rt-profile",
    workItemId: "wi-profile", subjectId: TANG_WILLIAMS, routeId: "candidate-wikipedia-api", recordClass: "candidate-enrichment",
    providerId: "candidate-enrichment", reason: "novelty", outcome: "EVIDENCE_FOUND", stoppedBy: "MODEL", rungs: [],
    distinctEvidenceRungs: 1, candidates: [], findings: [{ kind: "RECORD", field: "candidate.office",
      value: "Representative in Congress - District 2", exactQuote: "Candidate for Representative in Congress - District 2 in the 2026 General Election.",
      sourceUrl: PROFILE, artifactIds: [artifact.id], summary: "Office sought" }], nextRungs: [], unverified: [], narrative: "Saved profile",
    worker: { provider: "anthropic", model: "fixture", modelReported: null }, usage: { inputTokens: null, outputTokens: null,
      cacheReadInputTokens: null, cacheCreationInputTokens: null, turns: 1, toolCalls: 1 }, usd: null, elapsedMs: 1,
    artifactIds: [artifact.id], methodCandidateIds: [], refusal: null, startedAt: T1, recordedAt: T1 };
  await p.repos.scoutResults.append(scout.obligationId, scout.attemptId, scout, T1);
  assert.equal((await p.repos.workerResults.readAll()).length, 0);
  const first = await cycle(p, T1, { marginalia: [] }, { ...served(), [LILY]: { status: 200,
    body: "<title>Lily Tang Williams for Congress</title><h1>Lily Tang Williams</h1><p>I am running for Congress in New Hampshire District 2.</p><p>Paid for by Lily Tang Williams.</p>" } });
  assert.ok(p.requests.includes(LILY));
  assert.ok(!p.requests.includes(PROFILE), "the profile's captured bytes are reused without a new request");
  assert.equal(first.report.chain.approved.length, 1, "independent saved profile and primary campaign page publish in the same pass");
  const approval = first.report.chain.approved[0]!;
  assert.equal(approval.campaignSite.audit, undefined, "identity evidence is enough; no independent audit record is manufactured");
  assert.equal(first.report.chain.rereadsUsed, 0);
  assert.equal(approval.campaignSite.evidence.cycleSource?.artifactId, artifact.id);
  assert.match(approval.campaignSite.verification, /; https:\/\/www.ballotready.org\/people\/lily-tang-williams identifies the 2026 election/);
  const { store, profiles } = await profilesStore();
  const inputs = await doorInputs(p);
  assert.equal(inputs.approvals.length, 1);
  const bytes = inputs.held(inputs.approvals[0]!)!;
  assert.equal(reverifyApprovedSite(inputs.approvals[0]!, bytes).ok, true);
  assert.equal(reverifyApprovedSite(inputs.approvals[0]!, { ...bytes, cycleSource: undefined }).ok, false);
  const supporting = bytes.cycleSource!;
  assert.equal(reverifyApprovedSite(inputs.approvals[0]!, { ...bytes, cycleSource: { ...supporting,
    page: { ...supporting.page, body: supporting.page.body.replace("2026", "2022") } } }).ok, false,
    "the writer verifies raw supporting bytes rather than trusting the approved audit string");
  assert.equal(reverifyApprovedSite(inputs.approvals[0]!, { ...bytes, cycleSource: { ...supporting,
    source: { ...supporting.source, artifactId: "ar-other-profile" } } }).ok, false);
  const publishNow = "2026-09-24T21:05:00.000Z";
  const pass = derivedCampaignSitesPass({ approvals: inputs.approvals, held: inputs.held, profiles, gateOpen: true, now: publishNow });
  const published = await processRegisteredRoutineCandidate(store, "candidate-campaign-sites-derived", pass.candidate, publishNow);
  assert.equal(published.candidate.state, "PROMOTED", published.candidate.failureDetail ?? undefined);
  assert.equal(published.readerReadback?.status, "PASS");
  const reader = await readDerivedCampaignSites({ store, bypassCache: true, now: publishNow });
  assert.equal(reader.kind, "PROMOTED");
  if (reader.kind === "PROMOTED") {
    assert.deepEqual(reader.value.records[0]!.campaign.evidence.cycleSource, approval.campaignSite.evidence.cycleSource,
      "published Reader evidence retains the actual supporting source ID, hash, URL and capture date");
  }
  await refreshCandidateProfilesFromPromoted({ store, bypassCache: true, now: publishNow });
  assert.equal(linksForCandidacy(subject(TANG_WILLIAMS).readerKeys[0]!)?.campaign?.url, LILY);
  const laterAt = "2026-09-24T21:01:00.000Z";
  const later = await captureProfile(p, `${PROFILE_HTML}<p>Updated campaign profile.</p>`, laterAt);
  const sourceRef = { ...approval.campaignSite.evidence.cycleSource!, artifactId: later.id,
    sha256: later.contentHash.slice(7), readAt: laterAt };
  const revised = { ...approval, recordId: `${approval.recordId}:source-revision`, campaignSite: { ...approval.campaignSite,
    evidence: { ...approval.campaignSite.evidence, cycleSource: sourceRef } } };
  const vault = await indexVault(p.vaultRoot);
  const paired = await heldCampaignSiteReads(async artifactId => vault.byId.get(artifactId) ?? null, [approval, revised]);
  assert.equal(paired.size, 2);
  assert.equal(paired.get(approval.recordId)!.cycleSource!.source.artifactId, artifact.id);
  assert.equal(paired.get(revised.recordId)!.cycleSource!.source.artifactId, later.id);
  assert.equal(reverifyApprovedSite(approval, paired.get(approval.recordId)!).ok, true);
  assert.equal(reverifyApprovedSite(revised, paired.get(revised.recordId)!).ok, true);
});

async function captureProfile(p: Plane, body = PROFILE_HTML, now = T1, sourceUrl = PROFILE) {
  const { artifact } = recordAcquisition({ canonicalUrl: sourceUrl, retrievedAt: now, httpStatus: 200,
    contentType: "text/html", sourceId: "ballotready.org", methodRouteId: "scout:profile",
    workItemId: "wi-profile", attemptId: "at-profile", permission: "ALLOWED", transport: "REACHABLE" }, body);
  await putArtifact(new DurableEvidenceStore(p.vaultRoot), "freshness", artifact, Buffer.from(body));
  await p.repos.artifacts.append("wi-profile", artifact.id, { artifactId: artifact.id, workItemId: "wi-profile",
    routeTaskId: "rt-profile", attemptId: "at-profile", tier: artifact.tier, contentHash: artifact.contentHash,
    byteLength: artifact.byteLength, contentType: artifact.contentType, canonicalUrl: sourceUrl, partial: false, recordedAt: now }, now);
  return artifact;
}

test("conflicting supplemental profiles cannot hold a campaign page that independently identifies its own candidate", async t => {
  for (const { body, sourceUrl = PROFILE, at = T1 } of [
    { body: PROFILE_HTML.replaceAll("Lily Tang Williams", "Someone Else") },
    { body: PROFILE_HTML.replace("Representative in Congress - District 2", "Governor") },
    { body: PROFILE_HTML.replaceAll("District 2", "District 20") },
    { body: PROFILE_HTML.replace("New Hampshire", "Arizona") },
    { body: PROFILE_HTML.replace("2026", "2022") },
    { body: PROFILE_HTML.replaceAll("https://www.lilytangwilliams.com", "https://othercandidate.example") },
    { body: PROFILE_HTML, sourceUrl: "https://profile.lilytangwilliams.com/" },
    { body: PROFILE_HTML, at: "2026-08-01T12:00:00.000Z" },
  ]) {
    const p = await plane(t);
    await captureProfile(p, body, at, sourceUrl);
    const report = await cycle(p, T1);
    const state = (await readPipelineStates(p.repos)).find(s => s.itemId === discoveryPointerItemId(TANG_WILLIAMS, LILY))!;
    assert.equal(state.stage, "APPROVED_FOR_PROMOTION");
    assert.equal(report.report.chain.approved.length, 1);
    assert.equal(report.report.chain.approved[0].campaignSite.evidence.cycleSource, undefined, "an unrelated profile never becomes the source of the cycle");
  }
});

function served() {
  return {
    "https://www.lilytangwilliams.com/robots.txt": { status: 200, body: fixture("lilytangwilliams.robots.txt") },
    [LILY]: { status: 200, body: fixture("lilytangwilliams-endorsements.live.html") },
    [LILY_PRESS]: { status: 200, body: "<html><head><title>Press releases</title></head><body>Press releases.</body></html>" },
    "https://www.kapner4mendhamtwp.com/robots.txt": { status: 200, body: fixture("kapner4mendhamtwp.robots.txt") },
    [KAPNER_ROOT]: { status: 200, body: fixture("kapner4mendhamtwp-root.live.html") },
  };
}

interface Plane {
  readonly repos: ControlPlaneRepositories;
  readonly vaultRoot: string;
  readonly manifest: StagingManifest;
  readonly requests: string[];
}

async function plane(t: { after: (fn: () => void) => void }): Promise<Plane> {
  const repos = createMemoryRepositories();
  const vaultRoot = mkdtempSync(join(tmpdir(), "wtp-campaign-site-runner-"));
  t.after(() => rmSync(vaultRoot, { recursive: true, force: true, maxRetries: 3 }));
  const body = fixture("marginalia-tang-williams-lily.json");
  const { artifact } = recordAcquisition({
    canonicalUrl: MARGINALIA_URL, retrievedAt: "2026-09-24T12:00:00.000Z", httpStatus: 200, contentType: "application/json",
    sourceId: "api.marginalia.nu", methodRouteId: "candidate-marginalia-index", workItemId: "wi-marginalia-tang-williams",
    attemptId: "at-marginalia-tang-williams", permission: "ALLOWED", transport: "REACHABLE",
  }, body);
  await putArtifact(new DurableEvidenceStore(vaultRoot), "freshness", artifact, Buffer.from(body, "utf8"));
  const manifest: StagingManifest = {
    stagedOn: "2026-09-24", promotionEnabled: false,
    entries: [{
      obligationId: `freshness:candidate-enrichment:${TANG_WILLIAMS}#candidate-marginalia-index`, providerId: "candidate-enrichment",
      recordClass: "candidate-enrichment", subjectId: TANG_WILLIAMS, routeId: "candidate-marginalia-index", state: "STAGED_GAP",
      stagedOn: "2026-09-24", nextDueAt: null, disposition: "INGESTED", rowCount: 0, declaredTotal: null, complete: false, snapshotPath: null,
      readerSentence: "held", unresolved: ["NORMALIZER MISSING for route candidate-marginalia-index.", `artifact(s): ${artifact.id}`],
    }],
  };
  const ctx = await contextFromRepositories(repos);
  const kapner = scoutedSite({ attemptId: "at-scout-kapner", obligationId: `freshness:candidate-enrichment:${KAPNER}#candidate-marginalia-index`, subjectId: KAPNER,
    outcome: "ROUTE_CANDIDATE", routeId: "kapner-campaign-site", canonicalUrl: KAPNER_ROOT, artifactIds: [], recordedAt: "2026-09-21T02:23:09.992Z", summary: "Kapner campaign site" });
  const news = scoutedSite({ attemptId: "at-scout-news", obligationId: `freshness:candidate-enrichment:${KAPNER}#candidate-news`, subjectId: KAPNER,
    outcome: "ROUTE_CANDIDATE", routeId: "kapner-news", canonicalUrl: "https://patch.com/new-jersey/mendham/kapner-runs", artifactIds: [], recordedAt: "2026-09-21T02:24:00.000Z", summary: "a news story" });
  await appendTransition(repos, kapner, ctx, T0);
  await appendTransition(repos, news, ctx, T0);
  return { repos, vaultRoot, manifest, requests: [] };
}

async function cycle(p: Plane, now: string, extra: Partial<CampaignSiteCycleInput> = {}, pages: Record<string, { status: number; body: string }> = served()) {
  let ms = Date.parse(now);
  const runtime = servedRuntime(pages, now);
  const vault = await indexVault(p.vaultRoot);
  const held = await heldMarginaliaFromManifest(p.vaultRoot, p.manifest, vault, now);
  const report = await runCampaignSiteCycle({
    repos: p.repos, subjects: committedSubjects(), marginalia: held.responses, gate: GATE, now,
    clock: () => (ms += 5), sleep: async (wait) => { ms += wait; },
    open: async (request) => { p.requests.push(request.url); return runtime.get(request); },
    vaultRoot: p.vaultRoot, heldVault: vault, methodVersion: 1,
    ...extra,
  });
  return { report, held };
}

async function doorInputs(p: Plane) {
  const approvals = (await readPipelineStates(p.repos))
    .flatMap((s) => (s.stage === "APPROVED_FOR_PROMOTION" ? [s.byStage.APPROVED_FOR_PROMOTION as unknown] : []))
    .filter(isPublishableCampaignSiteApproval);
  const vault = await indexVault(p.vaultRoot);
  const held = await heldCampaignSiteReads(vault, approvals);
  return { approvals, held: (r: PublishableCampaignSiteApproval) => held.get(r.recordId) ?? null };
}

async function profilesStore() {
  const store = new MemoryRoutineDataStore();
  const payload: CandidateProfilesProjection = {
    cards: { curatedAt: "2026-09-08", note: "reviewed cards", cards: { [MAYES_KEY]: { bio: "Kris Mayes is the Attorney General.", bioSourceUrl: "https://www.krismayes.com" } as never }, hunts: [] },
    links: {
      curatedAt: "2026-09-08", note: "reviewed links",
      links: { [MAYES_KEY]: { official: null, campaign: { url: "https://www.krismayes.com", verification: "Fetched 2026-08-13: 'Kris Mayes for Arizona Attorney General'.", attemptedAt: "2026-08-13" } } },
      hunts: [],
    },
  };
  const pkg: ManualProjectionPackage = {
    contractId: "candidate-profiles", version: T0, sourceThrough: T0,
    sourceReceipt: { contractVersion: 1, reviewedAt: T0, reviewedBy: "owner-test", sources: [{
      requestedUrl: "https://www.krismayes.com", finalUrl: "https://www.krismayes.com", publisher: "www.krismayes.com", sourceClass: "CANDIDATE_CONTROLLED",
      retrievedAt: T0, httpStatus: 200, rawHash: "a".repeat(64), reviewedEvidence: "Exact response bytes reviewed by the owner.",
    }] },
    payload,
  };
  const outcome = await processRegisteredManualCandidate(store, "candidate-profiles", manualProjectionCandidate(pkg), T0, null);
  assert.equal(outcome.candidate.state, "PROMOTED");
  const read = await readPromotedCivicData<CandidateProfilesProjection>("CANDIDATE_PROFILE", "US-AZ+US-NH+US-NJ:2026-supported-candidates", { store, bypassCache: true, now: T2 });
  assert.equal(read.kind, "PROMOTED");
  if (read.kind !== "PROMOTED") throw new Error("unreachable");
  const input = promotedInputRef("CANDIDATE_PROFILE", "US-AZ+US-NH+US-NJ:2026-supported-candidates", read.metadata.versionId, read.value, read.metadata.promotedAt);
  assert.equal(input?.kind, "PROMOTED_VERSION");
  if (input?.kind !== "PROMOTED_VERSION") throw new Error("unreachable");
  return { store, profiles: { input, links: read.value.links.links } };
}

test("a runner cycle over held results publishes a verified site through the derived door with no owner step, and /ballot and Ask show it", async (t) => {
  const p = await plane(t);
  await captureProfile(p);

  const first = await cycle(p, T1);
  assert.equal(first.held.responses.length, 1, "the held answer is found through the manifest and read back from the vault");
  const pointer = discoveryPointerItemId(TANG_WILLIAMS, LILY);
  let state = (await readPipelineStates(p.repos)).find((s) => s.itemId === pointer)!;
  assert.equal(state.stage, "APPROVED_FOR_PROMOTION");
  assert.equal(first.report.chain.approved.length, 1);
  assert.ok(p.requests.includes("https://www.lilytangwilliams.com/robots.txt") &&
    p.requests.indexOf("https://www.lilytangwilliams.com/robots.txt") < p.requests.indexOf(LILY), "robots.txt is read before the page");

  const second = first;
  state = (await readPipelineStates(p.repos)).find((s) => s.itemId === pointer)!;
  assert.equal(state.stage, "APPROVED_FOR_PROMOTION", JSON.stringify(second.report.chain.offers.filter((o) => o.itemId === pointer)));
  assert.equal(second.report.chain.rereadsUsed, 0);
  assert.match(campaignSiteCycleLine(second.report), /1 approved for the derived door/);

  const task = ROUTINE_SOURCE_TASKS.find(row => row.id === CAMPAIGN_PUBLICATION_TASK)!;
  const clock = { lastAttemptedAt: "2026-09-24T22:55:00.000Z", lastSucceededAt: "2026-09-24T22:55:00.000Z" };
  assert.equal(routineTaskDue(task, clock, Date.parse(PUBLISH)), false);
  assert.equal(campaignPublicationInputsDue(task.id, { approvals: second.report.chain.approved.length, attemptedApprovals: 0 }), true);
  assert.deepEqual(routineFailureDomainFrontier([{ task, lastConsideredAt: clock.lastAttemptedAt }]).map(row => row.task.id), [task.id]);

  const { store, profiles } = await profilesStore();
  const inputs = await doorInputs(p);
  assert.equal(inputs.approvals.length, 1);
  const pass = derivedCampaignSitesPass({ approvals: inputs.approvals, held: inputs.held, profiles, gateOpen: true, now: PUBLISH });
  const tangKeys = subject(TANG_WILLIAMS).readerKeys;
  assert.deepEqual(pass.plan?.published.map((row) => row.key), [...tangKeys].sort());
  const outcome = await processRegisteredRoutineCandidate(store, "candidate-campaign-sites-derived", pass.candidate, PUBLISH);
  assert.equal(outcome.candidate.state, "PROMOTED", `${outcome.candidate.failureCode ?? ""} ${outcome.candidate.failureDetail ?? ""} ${JSON.stringify(outcome.candidate.receipt?.checks.filter((c) => c.verdict !== "PASS"))}`);
  assert.equal(outcome.candidate.receipt?.decision, "GOOD");
  assert.equal(outcome.readerReadback?.status, "PASS");
  const oldText = "Kris Mayes is the Attorney General.";
  const oldHash = sha256(oldText);
  const corpus = manualProjectionCandidate({ contractId: "candidate-corpus", version: T0, sourceThrough: T0,
    sourceReceipt: { contractVersion: 1, reviewedAt: T0, reviewedBy: "fixture-review", sources: [{
      requestedUrl: "https://www.krismayes.com", finalUrl: "https://www.krismayes.com", publisher: "Kris Mayes campaign",
      sourceClass: "CANDIDATE_CONTROLLED", retrievedAt: T0, httpStatus: 200, rawHash: oldHash, reviewedEvidence: "Retained prior publication fixture" }] },
    payload: { formatVersion: 1, fetchedAt: T0, attempted: 1, failures: [], documents: [{ id: `${MAYES_KEY}@${oldHash}`, candidateKey: MAYES_KEY,
      sourceClass: "CAMPAIGN_SITE", basis: "HUNTED_AND_VERIFIED", metaDescription: null, documentUrl: "https://www.krismayes.com", contentHash: oldHash,
      retrievedAt: T0, contentType: "text/html", text: oldText, extraction: "html", extractionNote: null }] } });
  assert.ok((await processRegisteredManualCandidate(store, "candidate-corpus", corpus, T0, null)).promoted);
  await refreshCandidateCorpusFromPromoted({ store, bypassCache: true, now: PUBLISH });
  assert.ok(documentsFor(tangKeys[0]).some(doc => doc.documentUrl === LILY && doc.text?.length && doc.sourceContentHash), "normal candidate Reader receives verified page text");
  assert.ok(documentsFor(MAYES_KEY).some(doc => doc.contentHash === oldHash), "prior GOOD publications survive");
  await preloadCandidateEnrichmentAuthorities({ store, bypassCache: true, now: PUBLISH });
  const inherited = candidateEnrichmentHoldings()!;
  assert.equal(inherited.profiles?.links.links[tangKeys[0]].campaign?.url, LILY, "the next normal worker inherits the delivered campaign link");
  assert.ok(inherited.corpus?.documents.some(document => document.candidateKey === tangKeys[0] && document.documentUrl === LILY && document.sourceContentHash),
    "the next worker inherits the same verified text and captured-byte identity as the Reader");
  assert.ok(inherited.corpus?.documents.some(document => document.contentHash === oldHash), "reuse preserves prior publication evidence");
  assert.equal(new Set(inherited.corpus?.documents.map(document => document.id)).size, inherited.corpus?.documents.length, "no duplicate publication versions");
  const goodProjection = pass.candidate.readModel as import("../lib/civic-data/derived-campaign-sites.ts").DerivedCampaignSitesProjection;
  const broken = structuredClone(goodProjection);
  const doc = broken.records[0].publications![0].document;
  doc.text = "A fabricated position was substituted";
  assert.match(derivedCampaignSitesProjectionIssue(broken) ?? "", /exact text/);
  const derived = pass.candidate.retrieval.derived!.inputs;
  assert.ok(derived.some((i) => i.kind === "PIPELINE_APPROVAL") && derived.some((i) => i.kind === "VAULTED_EVIDENCE") && derived.some((i) => i.kind === "PROMOTED_VERSION"));

  const nextPass = derivedCampaignSitesPass({ approvals: inputs.approvals, held: inputs.held, profiles, gateOpen: true, now: "2026-09-25T00:05:00.000Z" });
  const unchanged = await processRegisteredRoutineCandidate(store, "candidate-campaign-sites-derived", nextPass.candidate, "2026-09-25T00:05:00.000Z", undefined, { confirmUnchanged: true });
  assert.equal(unchanged.confirmed?.versionId, outcome.promoted!.versionId, `${unchanged.candidate.state}`);

  await refreshCandidateProfilesFromPromoted({ store, bypassCache: true, now: PUBLISH });
  for (const key of tangKeys) {
    const links = linksForCandidacy(key);
    assert.equal(links?.campaign?.url, LILY, key);
    assert.match(links!.campaign!.verification, CAMPAIGN_SITE_VERIFICATION_TEMPLATE);
    assert.equal(links!.campaign!.attemptedAt, "2026-09-24");
    assert.equal(links!.campaign!.label, undefined, "rendered as the campaign's own site, like every verified campaign link");
    assert.equal(campaignLinkIsDerived(key), true);
  }
  assert.equal(allCandidateLinks().links[MAYES_KEY]?.campaign?.url, "https://www.krismayes.com", "the reviewed links are unchanged");
  assert.equal(campaignLinkIsDerived(MAYES_KEY), false);

  const key = tangKeys[0]!;
  const answer = candidateProfileEvidenceFor({ kind: "PERSON", id: key, name: "Lily Tang Williams" });
  const record = answer.records.find((r) => r.id === `candidate-link:${key}:campaign`);
  assert.ok(record, JSON.stringify(answer));
  assert.equal(record.kind, "CANDIDATE_LINK");
  assert.equal(record.text, `Campaign site: ${LILY}`);
  assert.equal(record.sourceUrl, LILY);
  assert.equal(record.retrievedAt, "2026-09-24");
  assert.equal(record.candidateProfile?.holdingPath, derivedCampaignSiteHoldingPath(key));
});

test("a bounded linked publication capture reaches the existing derived corpus with distinct approval, href and child Attempt", async (t) => {
  const p = await plane(t);
  await captureProfile(p);
  await cycle(p, T1);
  await cycle(p, T2);
  const articleUrl = "https://www.lilytangwilliams.com/congress/issues/";
  const article = "<html><!-- <meta property=\"article:published_time\" content=\"2026-09-01\"> --><head><script>const old = '<meta property=\"article:published_time\" content=\"2026-09-02\">';</script><meta property=\"article:published_time\" content=\"2026-09-22\"></head><main><h1>Priorities</h1><p>Our campaign supports accessible health care.</p></main></html>";
  const pages = { ...served(),
    "https://www.lilytangwilliams.com/robots.txt": { status: 200, body: "User-agent: *\nDisallow: /congress/issues/\n" },
    [articleUrl]: { status: 200, body: article } };
  const clock = { ms: Date.parse(PUBLISH) };
  const web = servedRuntime(pages, PUBLISH);
  const scoped = await runCandidatePublicationCycle({ repos: p.repos, eligibleCandidacyIds: new Set([TANG_WILLIAMS]),
    heldVault: await indexVault(p.vaultRoot), vaultRoot: p.vaultRoot, methodVersion: 1,
    clock: () => (clock.ms += 45_000), sleep: async ms => { clock.ms += ms; },
    openFor: () => web.get, maxReads: 100 });
  assert.ok(clock.ms - Date.parse(PUBLISH) > 30_000, "slow store and source work continue beyond the former publication pass wall");
  assert.equal(scoped.outcomes.some(row => row.url === articleUrl && row.code === "ACQUIRED"), true, JSON.stringify(scoped.outcomes));
  assert.equal(scoped.outcomes.some(row => row.candidacyId !== TANG_WILLIAMS), false,
    "Only candidacies in the supplied owner receipt may acquire linked pages.");
  const capture = (await p.repos.artifacts.readAll()).find(row => row.canonicalUrl === articleUrl && row.publicationLink);
  assert.ok(capture?.publicationLink);
  const vault = await indexVault(p.vaultRoot), held = vault.byId.get(capture.artifactId);
  assert.ok(held);
  assert.equal(held.retrievalUrl, articleUrl, "the child's final URL survives the vault sidecar round trip");
  assert.equal(held.permission, "DISALLOWED", "a robots-only reading is recorded, not treated as an access-control refusal");
  const linked: HeldLinkedPublicationRead = { record: capture, attempt: (await p.repos.attempts.mustRead(capture.attemptId)).value,
    workItemSubject: (await p.repos.workItems.mustRead(capture.workItemId)).value.subject,
    body: new TextDecoder().decode(await readHeldBytes(held)), vaultSha256: held.contentHash.slice(7),
    vaultCanonicalUrl: held.canonicalUrl, vaultRetrievalUrl: held.retrievalUrl, vaultRetrievedAt: held.retrievedAt, vaultTier: held.tier,
    vaultWorkItemId: held.workItemId, vaultAttemptId: held.attemptId, vaultHttpStatus: held.httpStatus,
    vaultContentType: held.contentType, vaultMethodRouteId: held.methodRouteId, vaultPermission: held.permission };
  const inputs = await doorInputs(p), { store, profiles } = await profilesStore();
  const pass = derivedCampaignSitesPass({ approvals: inputs.approvals, held: inputs.held,
    linkedPublications: [linked], profiles, gateOpen: true, now: new Date(clock.ms + 1000).toISOString() });
  const key = subject(TANG_WILLIAMS).readerKeys[0]!;
  const published = pass.plan?.records.find(row => row.id === key)?.publications?.find(row => row.document.documentUrl === articleUrl);
  assert.equal(published?.evidence && "kind" in published.evidence ? published.evidence.kind : null, "LINKED_PAGE");
  assert.equal(published?.document.text?.includes("accessible health care"), true);
  assert.equal(published?.evidence && "kind" in published.evidence && published.evidence.kind === "LINKED_PAGE" &&
    published.evidence.sourceArtifactId === capture.publicationLink.sourceArtifactId, true);
  const promoted = await processRegisteredRoutineCandidate(store, "candidate-campaign-sites-derived", pass.candidate,
    new Date(clock.ms + 1000).toISOString());
  assert.equal(promoted.candidate.state, "PROMOTED", JSON.stringify(promoted.candidate.receipt?.checks.filter(row => row.verdict !== "PASS")));
  await refreshCandidateCorpusFromPromoted({ store, bypassCache: true, now: new Date(clock.ms + 2000).toISOString() });
  assert.ok(documentsFor(key).some(row => row.documentUrl === articleUrl && row.text?.includes("accessible health care")));
  const firstDocument = documentsFor(key).find(row => row.documentUrl === articleUrl)!;
  assert.equal(firstDocument.publicationDate?.date, "2026-09-22");
  assert.equal(article.slice(firstDocument.publicationDate!.start, firstDocument.publicationDate!.end), firstDocument.publicationDate!.quote);
  assert.notEqual(firstDocument.publicationDate?.date, firstDocument.retrievedAt.slice(0, 10), "source publication date is not a retrieval date");

  const corrupted = { ...linked, body: linked.body.replace("health care", "fabricated claim") };
  const refused = derivedCampaignSitesPass({ approvals: inputs.approvals, held: inputs.held,
    linkedPublications: [corrupted], profiles, gateOpen: true, now: new Date(clock.ms + 3000).toISOString() });
  assert.equal(refused.plan?.held.some(row => row.code === "LINKED_PUBLICATION_UNVERIFIED"), true);
  assert.equal(refused.plan?.records.flatMap(row => row.publications ?? []).some(row => row.document.documentUrl === articleUrl), false);
  assert.ok(documentsFor(key).some(row => row.documentUrl === articleUrl), "An invalid later read does not replace the previously promoted document.");

  clock.ms += 60 * 60 * 1000;
  const revisedArticle = article.replace("2026-09-22", "2026-09-23");
  const revisedWeb = servedRuntime({ ...pages, [articleUrl]: { status: 200, body: revisedArticle } }, new Date(clock.ms).toISOString());
  const revisedRun = await runCandidatePublicationCycle({ repos: p.repos, eligibleCandidacyIds: new Set([TANG_WILLIAMS]),
    heldVault: await indexVault(p.vaultRoot), vaultRoot: p.vaultRoot, methodVersion: 1,
    clock: () => (clock.ms += 5), sleep: async ms => { clock.ms += ms; }, openFor: () => revisedWeb.get,
    maxReads: 100, recheckMs: 30 * 60 * 1000 });
  assert.equal(revisedRun.outcomes.some(row => row.url === articleUrl && row.code === "ACQUIRED"), true, JSON.stringify(revisedRun.outcomes));
  const second = (await p.repos.artifacts.readAll()).find(row => row.canonicalUrl === articleUrl && row.publicationLink && row.artifactId !== capture.artifactId)!;
  assert.ok(second);
  const secondVault = (await indexVault(p.vaultRoot)).byId.get(second.artifactId)!;
  assert.ok(secondVault);
  const revisedLinked: HeldLinkedPublicationRead = { record: second, attempt: (await p.repos.attempts.mustRead(second.attemptId)).value,
    workItemSubject: (await p.repos.workItems.mustRead(second.workItemId)).value.subject,
    body: new TextDecoder().decode(await readHeldBytes(secondVault)), vaultSha256: secondVault.contentHash.slice(7),
    vaultCanonicalUrl: secondVault.canonicalUrl, vaultRetrievalUrl: secondVault.retrievalUrl, vaultRetrievedAt: secondVault.retrievedAt, vaultTier: secondVault.tier,
    vaultWorkItemId: secondVault.workItemId, vaultAttemptId: secondVault.attemptId, vaultHttpStatus: secondVault.httpStatus,
    vaultContentType: secondVault.contentType, vaultMethodRouteId: secondVault.methodRouteId, vaultPermission: secondVault.permission };
  const revisionPass = derivedCampaignSitesPass({ approvals: inputs.approvals, held: inputs.held,
    linkedPublications: [linked, revisedLinked], profiles, gateOpen: true, now: new Date(clock.ms + 1000).toISOString() });
  const revisions = revisionPass.plan!.records.find(row => row.id === key)!.publications!.filter(row => row.document.documentUrl === articleUrl);
  assert.equal(revisions.length, 2);
  assert.equal(revisions[0]!.document.contentHash, revisions[1]!.document.contentHash, "visible text is unchanged");
  assert.notEqual(revisions[0]!.document.id, revisions[1]!.document.id, "raw revisions retain distinct identity");
  assert.equal(revisions[1]!.document.sourceRevision?.supersedesRevisionId, revisions[0]!.document.sourceRevision?.revisionId);
  assert.equal(revisions[1]!.document.publicationDate?.date, "2026-09-23");
  const revisedPromotion = await processRegisteredRoutineCandidate(store, "candidate-campaign-sites-derived", revisionPass.candidate,
    new Date(clock.ms + 1000).toISOString());
  assert.equal(revisedPromotion.candidate.state, "PROMOTED");
  await refreshCandidateCorpusFromPromoted({ store, bypassCache: true, now: new Date(clock.ms + 2000).toISOString() });
  const answer = answerFor(documentsFor(key), ["health care"]);
  assert.equal(answer.kind, "MATCHED");
  if (answer.kind === "MATCHED") {
    assert.equal(answer.passages.length, 1, "unchanged source text is not counted twice");
    const passage = answer.passages[0]!;
    assert.equal(passage.revisionStatus, "CURRENT");
    assert.equal(passage.publicationDate?.date, "2026-09-23");
    assert.equal(revisions[1]!.document.text!.slice(passage.textStart, passage.textEnd), passage.textQuote);
    assert.equal(passage.sourceRevisionId, revisions[1]!.document.sourceRevision?.revisionId);
  }
});

test("already captured linked pages from another job reach the corpus without a replacement acquisition", async t => {
  const p = await plane(t);
  await captureProfile(p);
  const primaryUrl = LILY.replace("www.", "");
  const primary = `<html><head><title>Lily Tang Williams for Congress</title></head><main><h1>Lily Tang Williams</h1>
    <p>2026 candidate for Congress in New Hampshire District 2.</p>
    <a href="/congress/about/">About</a><a href="/congress/issues/">Priorities</a></main></html>`;
  const pages = { ...served(), [LILY]: { status: 302, body: "", location: primaryUrl },
    [primaryUrl]: { status: 200, body: primary },
    "https://lilytangwilliams.com/robots.txt": { status: 200, body: "User-agent: *\nAllow: /" } };
  await cycle(p, T1, {}, pages);
  await cycle(p, T2, {}, pages);
  const inputs = await doorInputs(p);
  assert.equal(inputs.approvals.length, 1);
  const approval = inputs.approvals[0]!;
  assert.equal(approval.campaignSite.evidence.finalUrl, primaryUrl);
  const links = candidatePublicationLinks({ html: primary, sourceUrl: primaryUrl,
    sourceArtifactId: approval.campaignSite.evidence.artifactId, sourceContentHash: `sha256-${approval.campaignSite.evidence.sha256}`,
    approvalRecordId: approval.recordId, candidacyId: TANG_WILLIAMS });
  assert.equal(links.length, 2);
  const captureAt = "2026-09-24T23:01:00.000Z";
  const recorder = campaignSiteReadRecorder({ repos: p.repos, vaultRoot: p.vaultRoot, methodVersion: 1, now: () => captureAt });
  const bodies = ["<html><main><h1>About Lily</h1><p>I grew up in a small town and became a business owner.</p></main></html>",
    "<html><main><h1>Priorities</h1><p>Our campaign supports accessible health care.</p></main></html>"];
  const records = [];
  for (const [index, link] of links.entries()) {
    const requestedUrl = link.url.replace("https://", "https://www.");
    records.push(await recorder.recordRead(TANG_WILLIAMS, { url: requestedUrl, origin: "SCOUT_FINDING", ref: "existing-job" },
      heldPageRead({ requestedUrl, finalUrl: link.url, httpStatus: 200, contentType: "text/html; charset=utf-8",
        body: bodies[index]!, retrievedAt: captureAt })));
  }
  const vault = await indexVault(p.vaultRoot);
  const before = (await p.repos.artifacts.readAll()).length;
  const sourceUrls: string[] = [];
  const cycleRepos = { ...p.repos, artifacts: { ...p.repos.artifacts,
    readAll: async () => { throw new Error("No artifact history scan is allowed"); } },
    artifactsByCanonicalUrl: async (url: string, limit: number) => {
      sourceUrls.push(url); return p.repos.artifactsByCanonicalUrl!(url, limit);
    } };
  const reused = await runCandidatePublicationCycle({ repos: cycleRepos, eligibleCandidacyIds: new Set([TANG_WILLIAMS]),
    heldVault: vault, vaultRoot: p.vaultRoot, methodVersion: 1, clock: () => Date.parse(PUBLISH), sleep: async () => {},
    openFor: () => { throw new Error("Valid held pages must not start a new HTTP acquisition"); } });
  assert.equal(reused.acquired, 0);
  assert.equal(reused.due, 0);
  assert.equal(reused.outcomes.filter(row => row.code === "HELD_REUSED").length, 2);
  assert.equal((await p.repos.artifacts.readAll()).length, before, "no synthetic acquisition or publicationLink record was created");
  assert.ok(records.every(row => !row.publicationLink));
  assert.ok(sourceUrls.every(url => url === LILY || candidatePublicationCaptureUrls(links, vault).includes(url)));
  const captures: HeldLinkedPublicationRead[] = [];
  for (const record of records) captures.push((await heldCandidatePublicationRead(record,
    (await p.repos.attempts.mustRead(record.attemptId)).value, vault))!);
  const { store, profiles } = await profilesStore();
  const pass = derivedCampaignSitesPass({ approvals: inputs.approvals, held: inputs.held,
    linkedPublications: captures, profiles, gateOpen: true, now: PUBLISH });
  assert.deepEqual(pass.candidate.semantics.violations, []);
  const promoted = await processRegisteredRoutineCandidate(store, "candidate-campaign-sites-derived", pass.candidate, PUBLISH);
  assert.equal(promoted.candidate.state, "PROMOTED", promoted.candidate.failureDetail ?? undefined);
  await refreshCandidateCorpusFromPromoted({ store, bypassCache: true, now: PUBLISH });
  const key = subject(TANG_WILLIAMS).readerKeys[0]!;
  for (const capture of captures) {
    const publication = pass.plan!.records.find(row => row.id === key)!.publications!.find(row =>
      row.document.documentUrl === capture.vaultRetrievalUrl)!;
    assert.equal(publication.document.retrievedAt, captureAt);
    assert.equal(publication.evidence.attemptId, capture.attempt.id);
    assert.equal(publication.evidence.requestedUrl, capture.record.canonicalUrl);
    assert.equal(publication.evidence.finalUrl, capture.vaultRetrievalUrl);
    assert.ok(documentsFor(key).some(row => row.id === publication.document.id));
  }

  const link = links[0]!, capture = captures[0]!;
  assert.equal(candidatePublicationCaptureIssue(link, primary, { ...capture,
    attempt: { ...capture.attempt, worker: { ...capture.attempt.worker, role: "SCOUT", provider: "held-scout" } } }), null,
  "an existing provider's role is not a second acquisition requirement for a quoted linked document");
  for (const bad of [
    { ...capture, body: `${capture.body}<p>Uncaptured claim</p>` },
    { ...capture, record: { ...capture.record, partial: true } },
    { ...capture, record: { ...capture.record, tier: "RESTRICTED_RAW" as const }, vaultTier: "RESTRICTED_RAW" as const },
    { ...capture, record: { ...capture.record, contentType: "application/json" }, vaultContentType: "application/json" },
    { ...capture, attempt: { ...capture.attempt, outcome: null } },
    { ...capture, attempt: { ...capture.attempt, artifactIds: [] } },
    { ...capture, vaultRetrievedAt: PUBLISH },
    { ...capture, vaultRetrievalUrl: "https://unrelated.example/about/" },
    { ...capture, record: { ...capture.record, publicationLink: { ...link.source, sourceArtifactId: "unrelated-source" } } },
  ]) {
    const refused = derivedCampaignSitesPass({ approvals: inputs.approvals, held: inputs.held,
      linkedPublications: [bad], profiles, gateOpen: true, now: PUBLISH });
    assert.ok(refused.plan!.held.some(row => row.code === "LINKED_PUBLICATION_UNVERIFIED"), JSON.stringify(bad.record));
    assert.equal(refused.plan!.records.some(row => row.publications?.some(publication => publication.evidence.artifactId === bad.record.artifactId)), false);
  }
  assert.notEqual(candidatePublicationCaptureIssue({ ...link, source: { ...link.source, quote: "forged href" } }, primary, capture), null);
});

test("a blocked first linked page records a route Attempt and yields the next page on the next bounded pass", async (t) => {
  const p = await plane(t);
  await captureProfile(p);
  await cycle(p, T1);
  await cycle(p, T2);
  const links = candidatePublicationLinks({ html: fixture("lilytangwilliams-endorsements.live.html"), sourceUrl: LILY,
    sourceArtifactId: "test-inventory", sourceContentHash: "test-inventory", approvalRecordId: "test-inventory",
    candidacyId: TANG_WILLIAMS });
  assert.ok(links.length >= 2, "the approved page offers a backlog wider than one bounded read");
  const pages = { ...served(), ...Object.fromEntries(links.map(link => [link.url, { status: 404, body: "<html>not found</html>" }])) };
  const web = servedRuntime(pages, PUBLISH);
  let ms = Date.parse(PUBLISH);
  const run = async () => runCandidatePublicationCycle({ repos: p.repos, eligibleCandidacyIds: new Set([TANG_WILLIAMS]),
    heldVault: await indexVault(p.vaultRoot), vaultRoot: p.vaultRoot, methodVersion: 1,
    clock: () => (ms += 5), sleep: async wait => { ms += wait; }, openFor: () => web.get,
    maxReads: 1 });
  const first = await run();
  const firstAttempted = first.outcomes.find(row => row.code === "UNUSABLE_RESPONSE");
  assert.ok(firstAttempted);
  assert.equal(first.deferred, first.due - 1);
  const blocked = (await p.repos.routeTasks.list()).find(row => row.value.target === firstAttempted.url &&
    row.value.disposition?.disposition === "BLOCKED_CURRENTLY");
  assert.ok(blocked, "the failed route stays owed with its own completed Attempt");
  const second = await run();
  const attempted = second.outcomes.find(row => row.code === "UNUSABLE_RESPONSE");
  assert.ok(attempted);
  assert.notEqual(attempted.url, firstAttempted.url, "an earlier failing URL cannot starve the next due link");
});

test("a refused lead publishes nothing and keeps its typed reason where Admin reads it", async (t) => {
  const p = await plane(t);
  const { report } = await cycle(p, T1, {}, { ...served(), [LILY]: { status: 404, body: "<html><title>Not found</title></html>" } });
  assert.ok(!p.requests.some((url) => url.includes("patch.com")), "a news host is refused before any request, robots.txt included");
  const news = report.chain.leads.find((l) => l.lead.url.includes("patch.com"))!;
  assert.deepEqual([news.outcome, news.refusals[0]?.code, news.via], ["REFUSED", "NEWS_OUTLET", "NONE"]);
  assert.ok((report.byCode.SITE_NOT_CANDIDATE_BRANDED ?? 0) + (report.byCode.AGGREGATOR ?? 0) > 0, "the index's other hits are refused by type");
  const lily = report.chain.leads.find((l) => l.lead.url === LILY)!;
  assert.deepEqual([lily.outcome, lily.via], ["REFUSED", "READ"]);
  assert.ok(lily.refusals.some((r) => r.code === "HTTP_NOT_OK"));
  assert.equal(report.chain.approved.length, 0);
  assert.match(campaignSiteCycleLine(report), /NEWS_OUTLET \d+/);

  const kapner = (await readPipelineStates(p.repos)).find((s) => s.byStage.SCOUTED?.canonicalUrl === KAPNER_ROOT)!;
  assert.equal(kapner.refused?.atStage, "CONFIRMED");
  assert.match(kapner.refused!.reasons[0]!.detail, /CYCLE_NOT_EVIDENCED/);

  const { store, profiles } = await profilesStore();
  const inputs = await doorInputs(p);
  const pass = derivedCampaignSitesPass({ approvals: inputs.approvals, held: inputs.held, profiles, gateOpen: true, now: T2 });
  assert.match(pass.candidate.retrieval.failureDetail ?? "", /^NO_APPROVED_SITE_YET/);
  const outcome = await processRegisteredRoutineCandidate(store, "candidate-campaign-sites-derived", pass.candidate, T2);
  assert.equal(outcome.promoted, null);
  assert.equal((await readDerivedCampaignSites({ store, bypassCache: true, now: T2 })).kind, "NOT_RECORDED");
});

test("a year-less site stays refused however often it is read: judged again from its vaulted read, re-read after the recheck, never approved", async (t) => {
  const p = await plane(t);
  await cycle(p, T1);
  const kapnerReads = () => p.requests.filter((url) => url === KAPNER_ROOT).length;
  assert.equal(kapnerReads(), 1);
  const again = await cycle(p, T2);
  assert.equal(kapnerReads(), 1, "within the recheck window the lead is judged from the vault, with no request");
  const judged = again.report.chain.leads.find((l) => l.lead.url === KAPNER_ROOT)!;
  assert.deepEqual([judged.outcome, judged.via], ["REFUSED", "VAULT"]);
  assert.ok(judged.refusals.some((r) => r.code === "CYCLE_NOT_EVIDENCED"));
  assert.equal(again.report.chain.offers.filter((o) => o.itemId === (judged.itemId ?? "") && o.stage === "CONFIRMED").every((o) => !o.accepted), true);
  const later = await cycle(p, "2026-10-03T21:00:00.000Z");
  assert.equal(kapnerReads(), 2, "past the recheck window it is read again");
  assert.equal(later.report.chain.leads.find((l) => l.lead.url === KAPNER_ROOT)?.outcome, "REFUSED");
  const kapner = (await readPipelineStates(p.repos)).find((s) => s.byStage.SCOUTED?.canonicalUrl === KAPNER_ROOT)!;
  assert.equal(kapner.stage, "SCOUTED");
  assert.ok(!later.report.chain.approved.some((a) => a.campaignSite.candidacyId === KAPNER));
});

test("read bounds hold without a pass deadline; held independent sources publish without extra reads", async (t) => {
  const p = await plane(t);
  const ids = [...committedSubjects().keys()].filter((id) => id !== KAPNER && id !== TANG_WILLIAMS).slice(0, 20);
  const pages: Record<string, { status: number; body: string }> = { ...served() };
  const ctx = await contextFromRepositories(p.repos);
  for (const [n, id] of ids.entries()) {
    const url = `https://site-${n}.example/`;
    pages[`https://site-${n}.example/robots.txt`] = { status: 200, body: "User-agent: *\nAllow: /\n" };
    pages[url] = { status: 200, body: `<html><title>Site ${n}</title><body>An unrelated page.</body></html>` };
    await appendTransition(p.repos, scoutedSite({ attemptId: `at-scout-${n}`, obligationId: `freshness:candidate-enrichment:${id}#x`, subjectId: id,
      outcome: "ROUTE_CANDIDATE", routeId: `route-${n}`, canonicalUrl: url, artifactIds: [], recordedAt: T0, summary: "a site" }), ctx, T0);
  }
  const first = await cycle(p, T1, {}, pages);
  assert.equal(CAMPAIGN_SITE_MAX_READS, 12);
  assert.equal(first.report.chain.readsUsed, 12);
  const deferred = first.report.chain.leads.filter((l) => l.outcome === "DEFERRED");
  assert.equal(deferred.length, 23 - 12, "23 readable leads (20 sites, Kapner, Lily's two): the rest stay owed");
  assert.ok(deferred.every((l) => l.refusals[0]?.code === "NOT_READ"));
  assert.ok(p.requests.length <= 2 * 12, "a lead read is its robots.txt and its page");
  const readFirst = new Set(first.report.chain.leads.filter((l) => l.via === "READ").map((l) => l.lead.url));

  const next = await cycle(p, "2026-09-24T22:00:00.000Z", {}, pages);
  const readNext = next.report.chain.leads.filter((l) => l.via === "READ").map((l) => l.lead.url);
  assert.equal(readNext.length, 11);
  assert.ok(readNext.every((url) => !readFirst.has(url)), "no lead is read twice while unread leads wait");
  assert.ok(next.report.chain.judgedFromVault >= 11);

  const held = await cycle(p, T2, { maxReads: 0 }, pages);
  assert.equal(held.report.chain.rereadsUsed, 0);
  assert.equal(held.report.chain.approved.length, 1);
  await captureProfile(p, PROFILE_HTML, T2);
  const reread = await cycle(p, "2026-09-24T23:30:00.000Z", { maxReads: 0 }, pages);
  assert.equal(reread.report.chain.readsUsed, 0, "held independent evidence does not need a new request");
  assert.equal(reread.report.chain.approved.length, 1);

  const slow = await createSlow(t, pages);
  assert.equal(slow.report.chain.readsUsed, 12, "slow successful reads continue beyond the former pass deadline");
  assert.equal(slow.requests, 24, "each admitted lead reads robots.txt and its page");
  assert.ok(slow.report.elapsedMs > 60_000);

});

async function createSlow(t: { after: (fn: () => void) => void }, pages: Record<string, { status: number; body: string }>) {
  const p = await plane(t);
  const ctx = await contextFromRepositories(p.repos);
  const ids = [...committedSubjects().keys()].filter((id) => id !== KAPNER && id !== TANG_WILLIAMS).slice(0, 20);
  for (const [n, id] of ids.entries()) {
    await appendTransition(p.repos, scoutedSite({ attemptId: `at-scout-${n}`, obligationId: `freshness:candidate-enrichment:${id}#x`, subjectId: id,
      outcome: "ROUTE_CANDIDATE", routeId: `route-${n}`, canonicalUrl: `https://site-${n}.example/`, artifactIds: [], recordedAt: T0, summary: "a site" }), ctx, T0);
  }
  let ms = Date.parse(T1);
  let requests = 0;
  const runtime = servedRuntime(pages, T1);
  const vault = await indexVault(p.vaultRoot);
  const report = await runCampaignSiteCycle({
    repos: p.repos, subjects: committedSubjects(), marginalia: [], gate: GATE, now: T1,
    clock: () => ms, sleep: async (wait) => { ms += wait; },
    open: async (request) => { requests += 1; ms += 61_000; return runtime.get(request); },
    vaultRoot: p.vaultRoot, heldVault: vault, methodVersion: 1,
  });
  return { report, requests };
}

async function backlog(p: Plane): Promise<{ readonly ids: readonly string[]; readonly pages: Record<string, { status: number; body: string }>; readonly urlOf: (id: string) => string }> {
  const ids = [...committedSubjects().keys()].filter((id) => id !== KAPNER && id !== TANG_WILLIAMS).slice(0, 20);
  const pages: Record<string, { status: number; body: string }> = { ...served() };
  const ctx = await contextFromRepositories(p.repos);
  for (const [n, id] of ids.entries()) {
    const url = `https://site-${n}.example/`;
    pages[`https://site-${n}.example/robots.txt`] = { status: 200, body: "User-agent: *\nAllow: /\n" };
    pages[url] = { status: 200, body: `<html><title>Site ${n}</title><body>An unrelated page.</body></html>` };
    await appendTransition(p.repos, scoutedSite({ attemptId: `at-scout-${n}`, obligationId: `freshness:candidate-enrichment:${id}#x`, subjectId: id,
      outcome: "ROUTE_CANDIDATE", routeId: `route-${n}`, canonicalUrl: url, artifactIds: [], recordedAt: T0, summary: "a site" }), ctx, T0);
  }
  return { ids, pages, urlOf: (id) => `https://site-${ids.indexOf(id)}.example/` };
}

test("the pass reads the leads of candidates with no campaign link first; a linked candidate's leads wait, deferred and never refused, and are read once the others are", async (t) => {
  const p = await plane(t);
  const { ids, pages, urlOf } = await backlog(p);
  const linked = new Set(ids.slice(0, 10));
  const first = await cycle(p, T1, { linkedCandidacies: linked }, pages);
  assert.equal(first.report.chain.readsUsed, CAMPAIGN_SITE_MAX_READS, "the read bound is unchanged");
  const read = first.report.chain.leads.filter((l) => l.via === "READ");
  assert.ok(read.length > 0 && read.every((l) => !linked.has(l.subjectId)), `every read goes to a candidate with no link: ${read.map((l) => l.subjectId).join(", ")}`);
  const waiting = first.report.chain.leads.filter((l) => linked.has(l.subjectId));
  assert.equal(waiting.length, 10);
  assert.ok(waiting.every((l) => l.outcome === "DEFERRED" && l.refusals[0]?.code === "NOT_READ"), "a linked candidate's lead is owed, never refused");
  const unlinkedOwed = first.report.chain.leads.filter((l) => l.outcome === "DEFERRED" && !linked.has(l.subjectId));
  assert.equal(unlinkedOwed.length, 1);

  const before = p.requests.length;
  const next = await cycle(p, "2026-09-24T22:00:00.000Z", { linkedCandidacies: linked }, pages);
  assert.equal(next.report.chain.readsUsed, 11);
  const asked = p.requests.slice(before);
  const lastUnlinked = asked.indexOf(unlinkedOwed[0]!.lead.url);
  assert.ok(lastUnlinked >= 0, `the owed unlinked lead is read: ${asked.join(" ")}`);
  for (const id of linked) {
    const at = asked.indexOf(urlOf(id));
    assert.ok(at > lastUnlinked, `${id}'s lead is read after the unlinked one`);
  }
});

test("held independent evidence advances before new leads and slow backlog reads continue without a pass deadline", async (t) => {
  const p = await plane(t);
  const pointer = discoveryPointerItemId(TANG_WILLIAMS, LILY);
  await cycle(p, T1);
  assert.equal((await readPipelineStates(p.repos)).find((s) => s.itemId === pointer)?.stage, "APPROVED_FOR_PROMOTION", "its own identity published in the first pass");
  await captureProfile(p, PROFILE_HTML, T2);
  const { pages } = await backlog(p);

  let ms = Date.parse(T2);
  const runtime = servedRuntime(pages, T2);
  const vault = await indexVault(p.vaultRoot);
  const held = await heldMarginaliaFromManifest(p.vaultRoot, p.manifest, vault, T2);
  const requests: string[] = [];
  const report = await runCampaignSiteCycle({
    repos: p.repos, subjects: committedSubjects(), marginalia: held.responses, gate: GATE, now: T2,
    clock: () => ms, sleep: async (wait) => { ms += wait; },
    open: async (request) => { requests.push(request.url); ms += 5_000; return runtime.get(request); },
    vaultRoot: p.vaultRoot, heldVault: vault, methodVersion: 1,
  });
  assert.ok(report.elapsedMs > 60_000, "the backlog continues past the former pass deadline");
  assert.ok(report.chain.leads.some((l) => l.outcome === "DEFERRED" && l.refusals[0]?.code === "NOT_READ"), "new leads stay owed for the next cycle");
  assert.ok(!requests.includes(LILY), "the independent held source advances the item without re-reading its campaign page");
  assert.equal(report.chain.rereadsUsed, 0);
  assert.equal((await readPipelineStates(p.repos)).find((s) => s.itemId === pointer)?.stage, "APPROVED_FOR_PROMOTION");
  assert.ok(report.chain.approved.some((a) => a.campaignSite.candidacyId === TANG_WILLIAMS));
});

const HANG = <T>(): Promise<T> => new Promise<T>(() => undefined);

test("slow loading and store work complete before the pass reports, without a pass deadline", async t => {
  const p = await plane(t);
  let ms = Date.parse(T1);
  let reads = 0;
  const delayed = new Proxy(p.repos.artifacts, {
    get(target, key) {
      if (key === "readAll") return async () => { ms += 300_000; reads++; return target.readAll(); };
      const value = (target as unknown as Record<string | symbol, unknown>)[key];
      return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(target) : value;
    },
  });
  const { report } = await cycle({ ...p, repos: { ...p.repos, artifacts: delayed } }, T1,
    { startedAtMs: ms - 300_000, clock: () => ms });
  assert.ok(reads > 0);
  assert.ok(report.elapsedMs >= 600_000, "loading and store time are measured, never used to abandon the pass");
  assert.ok(report.chain.readsUsed > 0, "HTTP reads still start after slow loading");
  assert.doesNotMatch(campaignSiteCycleLine(report), /STOPPED|time budget/);
});

test("at the round's dispatch cutoff both candidate lanes stop starting reads; every unread lead and page stays owed", async (t) => {
  const p = await plane(t);
  await captureProfile(p);
  const { pages } = await backlog(p);
  const before = p.requests.length;
  const { report } = await cycle(p, T1, { deadlineMs: Date.parse(T1) }, pages);
  assert.equal(p.requests.length, before, "no lead read starts after the cutoff");
  assert.equal(report.chain.readsUsed, 0);
  const deferred = report.chain.leads.filter((l) => l.outcome === "DEFERRED");
  assert.ok(deferred.length > 0 && deferred.every((l) => l.refusals[0]?.code === "NOT_READ"), "deferred, never refused");
  assert.ok(deferred.some((l) => /dispatch time ended/.test(l.refusals[0]?.detail ?? "")));

  await cycle(p, T1, {}, pages);
  await cycle(p, T2, {}, pages);
  const deadlineMs = Date.parse(PUBLISH);
  const opened: string[] = [];
  const web = servedRuntime(served(), PUBLISH);
  let late = true;
  const pass = async (repos: typeof p.repos) => runCandidatePublicationCycle({ repos, eligibleCandidacyIds: new Set([TANG_WILLIAMS]),
    heldVault: await indexVault(p.vaultRoot), vaultRoot: p.vaultRoot, methodVersion: 1,
    clock: () => (late ? deadlineMs : deadlineMs - 60_000), sleep: async () => undefined,
    openFor: () => async request => { opened.push(request.url); return web.get(request); }, maxReads: 100, deadlineMs });
  const atCutoff = await pass(p.repos);
  assert.equal(opened.length, 0, "no linked page read starts after the cutoff");
  assert.equal(atCutoff.acquired + atCutoff.failed + atCutoff.due, 0);
  assert.equal(atCutoff.stoppedLoading, "the approved campaign sites", "the stopped step is named");

  late = false;
  const turning = { ...p.repos, artifactsByCanonicalUrl: async (url: string, limit: number) => {
    late = true;
    return p.repos.artifactsByCanonicalUrl!(url, limit);
  } };
  const midway = await pass(turning);
  assert.equal(opened.length, 0, "no linked page read starts after the cutoff");
  assert.equal(midway.acquired + midway.failed, 0);
  assert.ok(midway.due > 0, "the approved site offers linked pages");
  assert.equal(midway.deferred, midway.due);
  assert.ok(midway.outcomes.filter(row => row.code === "NOT_READ_DEADLINE").length === midway.due);
});

test("the linked-publication pass reads rows in proportion to its candidacies, never whole tables", async (t) => {
  const p = await plane(t);
  await captureProfile(p);
  await cycle(p, T1);
  const { report: held } = await cycle(p, T2);
  const reads = { rows: 0 };
  const forbid = (name: string) => async () => { throw new Error(`${name} read whole`); };
  const counted = <R extends object>(repo: R, whole: readonly string[], scoped: readonly string[]): R => new Proxy(repo, { get(target, key, receiver) {
    const value = Reflect.get(target, key, receiver);
    if (typeof key === "string" && whole.includes(key)) return forbid(key);
    if (typeof key !== "string" || !scoped.includes(key) || typeof value !== "function") return value;
    return async (...args: unknown[]) => {
      const out = await (value as (...a: unknown[]) => Promise<unknown>).apply(target, args);
      reads.rows += Array.isArray(out) ? out.length : out instanceof Map ? [...out.values()].reduce((n, v) => n + (v as unknown[]).length, 0)
        : out === null ? 0 : 1;
      return out;
    };
  } });
  const scopedRepos = (): typeof p.repos => ({ ...p.repos,
    workItems: counted(p.repos.workItems, ["list", "listNarrowed"], ["listWhere", "readMany", "read"]),
    routeTasks: counted(p.repos.routeTasks, ["list", "listNarrowed"], ["listWhere", "readMany", "read"]),
    attempts: counted(p.repos.attempts, ["list", "listNarrowed"], ["listWhere", "readMany", "read"]),
    promotionPipeline: counted(p.repos.promotionPipeline, ["readAll", "keys"], ["keysWhere", "read", "readKeys"]) });
  const web = servedRuntime(served(), PUBLISH);
  const pass = async () => {
    reads.rows = 0;
    const out = await runCandidatePublicationCycle({ repos: scopedRepos(), eligibleCandidacyIds: new Set([TANG_WILLIAMS]),
      heldVault: await indexVault(p.vaultRoot), vaultRoot: p.vaultRoot, methodVersion: 1,
      clock: () => Date.parse(PUBLISH), sleep: async () => undefined, openFor: () => web.get, maxReads: 0 });
    return { out, rows: reads.rows };
  };
  const small = await pass();
  assert.ok(small.out.due > 0, "the approved site offers linked pages");

  const at = "2026-09-24T22:00:00.000Z";
  for (let i = 0; i < 3_000; i++) {
    await p.repos.workItems.put(`wi-noise-${i}`, { id: `wi-noise-${i}`, subject: `candidate-publication:other-${i}` } as never, at);
    await p.repos.routeTasks.put(`rt-noise-${i}`, { id: `rt-noise-${i}`, workItemId: `wi-noise-${i}`, routeId: "candidate-publication-linked:x",
      target: "https://example.org/", attemptIds: [`at-noise-${i}`] } as never, at);
    await p.repos.attempts.put(`at-noise-${i}`, { id: `at-noise-${i}`, startedAt: at, worker: { role: "SCOUT" }, outcome: "ABORTED", artifactIds: [] } as never, at);
    await p.repos.promotionPipeline.append(`pp-noise-${i}`, `pp-noise-${i}:approved`, { itemId: `pp-noise-${i}`,
      recordId: `pp-noise-${i}:approved`, stage: "APPROVED_FOR_PROMOTION", recordClass: "official-fact" } as never, at);
  }
  const large = await pass();
  assert.deepEqual(large.out, small.out, "the same answer");
  assert.equal(large.rows, small.rows, `rows read do not grow with the tables (${small.rows} on the small store)`);

  reads.rows = 0;
  const { report: again } = await cycle(p, T2, { repos: { ...p.repos, promotionPipeline: scopedRepos().promotionPipeline } });
  assert.deepEqual(again.chain.byStage, held.chain.byStage);
  assert.deepEqual(again.chain.approved.map(row => row.recordId), held.chain.approved.map(row => row.recordId));
  assert.ok(reads.rows < 100, `the chain read ${reads.rows} pipeline records beside 3,000 other approved items`);
});

test("withinWallTime ends a promise that never settles and clears its timer when one does", async () => {
  const started = Date.now();
  assert.deepEqual(await withinWallTime(HANG<number>(), 50), { done: false });
  assert.ok(Date.now() - started < 1_000);
  assert.deepEqual(await withinWallTime(Promise.resolve(7), 60_000), { done: true, value: 7 });
  assert.deepEqual(await withinWallTime(Promise.resolve(7), 0), { done: false }, "no time left: nothing is awaited");
  await assert.rejects(withinWallTime(Promise.reject(new Error("store down")), 1_000), /store down/);
});

test("who already carries a campaign link is read by the door's own rule: a reviewed campaign link on one of the candidacy's Reader keys", () => {
  const az = JSON.parse(readFileSync(join(ROOT, "data", "states", "az", "ballot", "az-pima-2026.json"), "utf8")) as unknown;
  const link = { url: "https://www.krismayes.com", verification: "Fetched 2026-08-13: 'Kris Mayes for Arizona Attorney General'.", attemptedAt: "2026-08-13" };
  const official = { url: "https://azgovernor.gov/", verification: "Fetched 2026-08-13: the Governor's office.", attemptedAt: "2026-08-13" };
  const { subjects, linked } = campaignSiteSubjectsFromHoldings({
    az: { ballot: az } as never, nh: null, nj: null,
    profiles: {
      cards: { curatedAt: "2026-09-08", note: "reviewed cards", cards: {}, hunts: [] },
      links: { curatedAt: "2026-09-08", note: "reviewed links", links: { [MAYES_KEY]: { official: null, campaign: link }, "ballot-az-pima:governor:hobbs-katie": { official, campaign: null } }, hunts: [] },
    } as never,
    corpus: { documents: [] } as never,
    failures: [],
  }, T1);
  assert.ok(subjects.has(MAYES) && subjects.has("az:2026:state-az:governor:hobbs-katie"));
  assert.deepEqual([...linked], [MAYES]);
});

test("the paid lane stays closed under the owner's pause, and the pass is plain code that never consults it", () => {
  const base = { dry: false, noModel: false, credentialConfigured: true, credentialVar: "WTP_WORKERS_ANTHROPIC_API_KEY", runnerPaused: false, runnerPauseIntentId: null, unreadableControls: [] };
  assert.deepEqual(modelLaneClosure({ ...base, paused: true, pauseIntentId: "ri-owner-pause" }), { code: "PAUSED", reason: "paused by owner intent ri-owner-pause" });
  for (const file of [
    "lib/control-plane/promotion/campaign-site-cycle.ts",
    "lib/civic-data/derived-campaign-site-writer.ts",
    "lib/civic-data/derived-campaign-sites.ts",
    "scripts/derive-candidate-campaign-sites.mts",
  ]) {
    assert.doesNotMatch(readFileSync(join(ROOT, file), "utf8"), /model-lane|scout-executor|scout-search|scout-tools|model-routing|@anthropic-ai|anthropic|BRAVE_SEARCH|EXA_API/i, file);
  }
  const runner = readFileSync(join(ROOT, "scripts", "freshness-shadow.mts"), "utf8");
  const meetingsEnd = runner.indexOf("const runMeetingsDiscoveryPass");
  const start = runner.indexOf("const runCampaignSitesPass", meetingsEnd);
  const end = runner.indexOf("const runCandidatePublicationsPass", start);
  assert.ok(start > meetingsEnd && end > start, "the executable pass is its own lane, after meetings discovery");
  const block = runner.slice(start, end);
  assert.doesNotMatch(block, /modelLaneEnabled|laneClosure|guardedModelTransport|scoutFor|workerKey/);
  assert.match(block, /intents\.runnerPause\.paused/);
  assert.doesNotMatch(block, /DISPATCH_DEADLINE_MS|CAMPAIGN_SITE_BUDGET_MS|scheduledBlackout/, "nothing but the round's own cutoff bounds plain-code work");
  assert.match(block, /withinWallTime\(/);
  assert.match(block, /dispatchDeadlineMs \+ CAMPAIGN_SITES_SETTLE_MS - Date\.now\(\)/);
  assert.match(block, /deferred: still waiting on \$\{waitingOn\}/);
  assert.match(block, /guardedOpenBytes\("discovery-web", "campaign-site-chain", fetch, \{ followRedirects: false \}\)/);
  assert.match(block, /spaceOut: spacer/);
  assert.match(runner, /campaignSiteCycleLine\(campaignSites\)/, "the pass reaches the cycle's digest");
});

function approvalFor(url: string, body: string, readAt: string, candidacyId = TANG_WILLIAMS): CampaignSiteApprovedRecord {
  const s = subject(candidacyId);
  const read = { ...heldPageRead({ requestedUrl: url, httpStatus: 200, contentType: "text/html; charset=utf-8", body, retrievedAt: readAt }),
    permissions: [{ origin: new URL(url).origin, verdict: "ALLOWED" as const, detail: "test" }] };
  const verdict = verifyCampaignSitePage(s, { url, origin: "RECORDED_SITE", ref: "test" }, read);
  assert.equal(verdict.verdict, "VERIFIED");
  const sha = sha256(body);
  return {
    formatVersion: 1, recordId: `pp-${sha.slice(0, 8)}:approved:x`, itemId: `pp-${sha.slice(0, 8)}`, at: readAt,
    actor: { role: "RELEASE_ORCHESTRATOR", lane: "DETERMINISTIC", instance: "campaign-site-approver/1@test" }, stage: "APPROVED_FOR_PROMOTION",
    chain: { scouted: "s", confirmed: "c", verified: "v", audited: "a" }, recordClass: "candidate-enrichment", field: "campaignSite",
    campaignSite: {
      field: "campaignSite", candidacyId: s.candidacyId, candidateName: `${s.givenName} ${s.familyName}`,
      identity: { candidacyId: s.candidacyId, givenName: s.givenName, familyName: s.familyName, officeTitle: s.officeTitle, ocdId: s.ocdId, stateCode: s.stateCode, cycle: s.cycle },
      readerKeys: s.readerKeys, url, host: new URL(url).hostname.replace(/^www\./, ""),
      verification: verdict.verdict === "VERIFIED" ? verdict.verification : "",
      evidence: { verifierId: "campaign-site-verifier/1", artifactId: `ar-${sha.slice(0, 8)}`, attemptId: "at-reader", sha256: sha, requestedUrl: url, finalUrl: url,
        httpStatus: 200, contentType: "text/html; charset=utf-8", readAt },
      audit: { startedFrom: ["EVIDENCE_VAULT", "CANONICAL_SUBJECT_IDENTITY"], secondSignal: "INDEPENDENT_PROFILE: test" },
      publicationDoor: "CANDIDATE_CAMPAIGN_SITES_DERIVED_CONTRACT",
    },
  };
}

test("the door verifies the vault again and holds by name what it cannot prove; a reviewed link always wins", () => {
  const body = fixture("lilytangwilliams-endorsements.live.html");
  const approval = approvalFor(LILY, body, "2026-09-25T21:00:05.000Z");
  const structural: PublishableCampaignSiteApproval = approval;
  assert.equal(isPublishableCampaignSiteApproval(structural), true);
  assert.equal(isPublishableCampaignSiteApproval({ ...approval, campaignSite: { ...approval.campaignSite, publicationDoor: "CANDIDATE_PROFILES_MANUAL_CONTRACT" } }), false);
  const heldBytes: HeldVerifyingRead = { body, sha256: sha256(body), tier: "RAW", permission: "ALLOWED" };
  const plan = (held: HeldVerifyingRead | null, links: Record<string, { official: null; campaign: { url: string; verification: string; attemptedAt: string } | null }> = {}) =>
    planDerivedCampaignSites({ approvals: [structural], held: () => held, profiles: { input: { kind: "PROMOTED_VERSION", recordClass: "CANDIDATE_PROFILE", scope: "s", versionId: "v", readModelSha256: "b".repeat(64), promotedAt: T0 }, links } });

  assert.equal(plan(heldBytes).records.length, subject(TANG_WILLIAMS).readerKeys.length);
  for (const permission of ["DISALLOWED", "CANNOT_TELL", "NOT_APPLICABLE", null]) {
    const again = plan({ ...heldBytes, permission });
    assert.deepEqual(again.held, [], `a sidecar recording ${permission} holds nothing`);
    assert.equal(again.records.length, subject(TANG_WILLIAMS).readerKeys.length);
  }
  assert.deepEqual(plan(null).held.map((h) => h.code), ["EVIDENCE_NOT_HELD"]);
  assert.deepEqual(plan({ ...heldBytes, sha256: "c".repeat(64) }).held.map((h) => h.code), ["REVERIFICATION_FAILED"]);
  const kapner = subject(KAPNER);
  const misjoined: PublishableCampaignSiteApproval = { ...structural, campaignSite: { ...structural.campaignSite, identity: { ...structural.campaignSite.identity, givenName: kapner.givenName, familyName: kapner.familyName } } };
  const refused = planDerivedCampaignSites({ approvals: [misjoined], held: () => heldBytes, profiles: null });
  assert.deepEqual(refused.held.map((h) => h.code), ["REVERIFICATION_FAILED"]);
  assert.match(refused.held[0]!.detail, /CANDIDATE_NOT_NAMED/);
  const key = subject(TANG_WILLIAMS).readerKeys[0]!;
  const reviewed = plan(heldBytes, { [key]: { official: null, campaign: { url: "https://reviewed.example/", verification: "Fetched 2026-08-13: reviewed.", attemptedAt: "2026-08-13" } } });
  assert.deepEqual(reviewed.held.map((h) => h.code), ["PRIOR_CAMPAIGN_LINK_HELD"]);
  assert.equal(reviewed.records.length, 0);
  const other: PublishableCampaignSiteApproval = approvalFor("https://www.lilytangwilliamsforcongress.example/", body, "2026-09-25T21:00:06.000Z");
  const two = planDerivedCampaignSites({ approvals: [structural, other], held: () => heldBytes, profiles: null });
  assert.deepEqual(two.held.map((h) => h.code), ["MULTIPLE_VERIFIED_SITES"]);

  const candidate = derivedCampaignSitesCandidate(plan(heldBytes), T2);
  assert.deepEqual(candidate.semantics.violations, []);
  assert.equal(derivedAuthorityFor(candidate).ok, true);
  const tampered = { ...candidate, retrieval: { ...candidate.retrieval, derived: { inputs: candidate.retrieval.derived!.inputs.map((i) => (i.kind === "PIPELINE_APPROVAL" ? { ...i, recordId: "" } : i)) } } };
  assert.deepEqual(derivedAuthorityFor(tampered), { ok: false, code: "DERIVED_INPUT_MALFORMED", detail: "a pipeline-approval input lacks its item, record or approval time" });
  assert.ok(derivedCampaignSitesPass({ approvals: [structural], held: () => heldBytes, profiles: null, gateOpen: false, now: T2 }).plan);
});

test("newer fully verified campaign evidence refreshes the same reader URL automatically", () => {
  const body = fixture("lilytangwilliams-endorsements.live.html");
  const approval = approvalFor(LILY, body, "2026-09-25T21:00:05.000Z");
  const heldBytes: HeldVerifyingRead = { body, sha256: sha256(body), tier: "RAW", permission: "ALLOWED" };
  const key = subject(TANG_WILLIAMS).readerKeys[0]!;
  const previous = { [key]: { official: null, campaign: { url: LILY, verification: "Earlier verified read", attemptedAt: "2026-08-13" } } };
  const plan = (held: HeldVerifyingRead) => planDerivedCampaignSites({ approvals: [approval], held: () => held,
    profiles: { input: { kind: "PROMOTED_VERSION", recordClass: "CANDIDATE_PROFILE", scope: "s", versionId: "v", readModelSha256: "b".repeat(64), promotedAt: T0 }, links: previous } });
  const refreshed = plan(heldBytes);
  assert.deepEqual(refreshed.held, []);
  assert.equal(refreshed.records.length, subject(TANG_WILLIAMS).readerKeys.length);
  const rendered = composeCampaignLinks(previous, refreshed.records);
  assert.equal(rendered.links[key]?.campaign?.attemptedAt, "2026-09-25");
  assert.ok(rendered.derivedKeys.has(key));
  assert.deepEqual(plan({ ...heldBytes, sha256: "c".repeat(64) }).records, [], "a failed refresh never replaces working evidence");
  const older = approvalFor(LILY, body, "2026-09-23T21:00:05.000Z");
  const latest = planDerivedCampaignSites({ approvals: [older, approval], held: () => heldBytes, profiles: null });
  assert.ok(latest.records.every(record => record.campaign.evidence.approvalRecordId === approval.recordId), "same-URL evidence chooses the newest verified read, not the first approval id");
});

test("new campaign facts publish without dropping prior GOOD links or quoted history whose raw captures are unavailable", async () => {
  const store = new MemoryRoutineDataStore();
  const oldBody = fixture("lilytangwilliams-endorsements.live.html");
  const oldApproval = approvalFor(LILY, oldBody, T1);
  const held = (body: string): HeldVerifyingRead => ({ body, sha256: sha256(body), tier: "RAW", permission: "ALLOWED" });
  const initial = derivedCampaignSitesPass({ approvals: [oldApproval], held: () => held(oldBody), profiles: null, gateOpen: true, now: T1 });
  const first = await processRegisteredRoutineCandidate(store, "candidate-campaign-sites-derived", initial.candidate, T1);
  assert.equal(first.candidate.state, "PROMOTED", first.candidate.failureDetail ?? undefined);
  const priorAt = async (now: string) => {
    const reader = await readDerivedCampaignSites({ store, bypassCache: true, now });
    assert.equal(reader.kind, "PROMOTED");
    if (reader.kind !== "PROMOTED") throw new Error("No promoted campaign prior");
    const reference = promotedInputRef("CURATED_READER_RECORD", "US:candidate-campaign-sites-derived",
      reader.metadata.versionId, reader.value, reader.metadata.promotedAt);
    assert.ok(reference?.kind === "PROMOTED_VERSION");
    return { input: reference, projection: reader.value };
  };
  const prior = await priorAt(T2);
  const oldRecord = prior.projection.records[0]!;
  const newBody = fixture("duarte4mendham-meet-amalia.live.html");
  const newApproval = approvalFor("https://www.duarte4mendham.com/meet-amalia", newBody, T2, DUARTE);
  const pass = derivedCampaignSitesPass({ approvals: [oldApproval, newApproval],
    held: row => row.recordId === newApproval.recordId ? held(newBody) : null, profiles: null, prior, gateOpen: true, now: PUBLISH });
  assert.ok(pass.plan?.held.some(row => row.code === "EVIDENCE_NOT_HELD"));
  assert.deepEqual(pass.candidate.semantics.violations, []);
  assert.deepEqual(pass.plan!.records.find(row => row.id === oldRecord.id), oldRecord,
    "previously GOOD evidence retains its source dates, hashes, full quotes and publication metadata exactly");
  const successor = await processRegisteredRoutineCandidate(store, "candidate-campaign-sites-derived", pass.candidate, PUBLISH);
  assert.equal(successor.candidate.state, "PROMOTED", successor.candidate.failureDetail ?? undefined);
  assert.equal(successor.candidate.candidate.changeSet?.removed.length, 0);
  const refreshed = await priorAt(PUBLISH);
  assert.deepEqual(refreshed.projection.records.find(row => row.id === oldRecord.id), oldRecord);
  assert.ok(refreshed.projection.records.some(row => row.candidacyId === DUARTE));

  const repeatAt = "2026-09-24T23:10:00.000Z";
  const repeat = derivedCampaignSitesPass({ approvals: [oldApproval, newApproval],
    held: row => row.recordId === newApproval.recordId ? held(newBody) : null,
    profiles: null, prior: refreshed, gateOpen: true, now: repeatAt });
  const unchanged = await processRegisteredRoutineCandidate(store, "candidate-campaign-sites-derived", repeat.candidate,
    repeatAt, undefined, { confirmUnchanged: true });
  assert.equal(unchanged.confirmed?.versionId, refreshed.input.versionId,
    "citing the prior GOOD version confirms unchanged facts without manufacturing a newer source or version");
  const afterRepeat = await priorAt(repeatAt);
  assert.equal(afterRepeat.input.versionId, refreshed.input.versionId);
  assert.deepEqual(afterRepeat.projection, refreshed.projection);

  const newerBody = oldBody.replace(/<\/main>/i, "<p>Additional independently captured campaign statement.</p></main>");
  const newerAt = "2026-09-25T21:00:00.000Z";
  const newer = approvalFor(LILY, newerBody, newerAt);
  const withHistory = planDerivedCampaignSites({ approvals: [newer], held: () => held(newerBody), profiles: null, prior: refreshed });
  const updated = withHistory.records.find(row => row.id === oldRecord.id)!;
  assert.deepEqual(updated.publications!.find(row => row.document.id === oldRecord.publications![0]!.document.id), oldRecord.publications![0]);
  assert.ok(updated.publications!.some(row => row.document.text!.includes("Additional independently captured campaign statement.")));
  assert.equal(updated.campaign.evidence.readAt, newerAt);
  assert.deepEqual(derivedCampaignSitesCandidate(withHistory, newerAt).semantics.violations, []);

  const tampered = { ...pass.plan!, records: pass.plan!.records.map(row => row.id === oldRecord.id
    ? { ...row, campaign: { ...row.campaign, evidence: { ...row.campaign.evidence, readAt: T0 } } } : row) };
  assert.ok(derivedCampaignSitesCandidate(tampered, PUBLISH).semantics.violations.some(detail => /does not name as an input/.test(detail)));
  const tamperedPublication = { ...pass.plan!, records: pass.plan!.records.map(row => row.id === oldRecord.id
    ? { ...row, publications: row.publications!.map(publication => ({ ...publication,
      evidence: { ...publication.evidence, readAt: T0 } })) } : row) };
  assert.ok(derivedCampaignSitesCandidate(tamperedPublication, PUBLISH).semantics.violations.some(detail => /lack their exact approved capture input/.test(detail)));
  const forgedPrior = { ...pass.plan!, prior: { ...prior, input: { ...prior.input, readModelSha256: "a".repeat(64) } } };
  assert.ok(derivedCampaignSitesCandidate(forgedPrior, PUBLISH).semantics.violations.some(detail => /referenced promoted version/.test(detail)));

  const conflicting = approvalFor("https://lilytangwilliamsforcongress.example/", newerBody, newerAt);
  const conflict = planDerivedCampaignSites({ approvals: [conflicting], held: () => held(newerBody), profiles: null, prior });
  assert.deepEqual(conflict.records.find(row => row.id === oldRecord.id), oldRecord);
  assert.ok(conflict.held.some(row => row.code === "PRIOR_CAMPAIGN_LINK_HELD"));
  const failed = planDerivedCampaignSites({ approvals: [newer], held: () => ({ ...held(newerBody), sha256: "c".repeat(64) }), profiles: null, prior });
  assert.deepEqual(failed.records.find(row => row.id === oldRecord.id), oldRecord);
  assert.ok(failed.held.some(row => row.code === "REVERIFICATION_FAILED"));

  const sameDayAt = "2026-09-24T21:05:00.000Z";
  const sameDay = approvalFor(LILY, newerBody, sameDayAt);
  const sameDayPlan = planDerivedCampaignSites({ approvals: [sameDay], held: () => held(newerBody), profiles: null, prior });
  const sameDayRecord = sameDayPlan.records.find(row => row.id === oldRecord.id)!;
  assert.deepEqual(sameDayRecord.campaign, oldRecord.campaign, "day-only evidence does not establish a newer working link");
  assert.ok(sameDayRecord.publications!.some(row => row.document.text!.includes("Additional independently captured campaign statement.")),
    "independent captured revisions attach even when a campaign link cannot refresh on the same day");
  assert.deepEqual(derivedCampaignSitesCandidate(sameDayPlan, PUBLISH).semantics.violations, []);

  const reviewedLinks = { [oldRecord.id]: { official: null, campaign: oldRecord.campaign } };
  const besideReviewed = planDerivedCampaignSites({ approvals: [sameDay], held: () => held(newerBody),
    profiles: { input: { kind: "PROMOTED_VERSION", recordClass: "CANDIDATE_PROFILE", scope: "s", versionId: "v",
      readModelSha256: "b".repeat(64), promotedAt: T1 }, links: reviewedLinks } });
  assert.ok(besideReviewed.records.find(row => row.id === oldRecord.id)?.publications?.some(row =>
    row.document.text!.includes("Additional independently captured campaign statement.")),
  "an equally recent reviewed profile link does not suppress independently verified documents");
  assert.deepEqual(composeCampaignLinks(reviewedLinks, besideReviewed.records).links[oldRecord.id]?.campaign, oldRecord.campaign);
  assert.deepEqual(derivedCampaignSitesCandidate(besideReviewed, PUBLISH).semantics.violations, []);
  assert.equal(derivedCampaignSitesPass({ approvals: [newApproval], held: () => held(newBody), profiles: null,
    prior: { unreadable: "source projection could not be read" }, gateOpen: true, now: PUBLISH }).plan, null,
  "an unreadable prior cannot be treated as an empty full-replacement version");
});

test("the Reader composes: a derived link fills an empty campaign slot beside the reviewed official link; any reviewed campaign link of that person wins on every key", () => {
  const link = (url: string) => ({ url, verification: "Fetched 2026-09-25 (campaign-site-verifier/1): 'x' — names A B, the office (\"mayor\"), and the 2026 election.", attemptedAt: "2026-09-25" });
  const record = (id: string, candidacyId: string, url: string): DerivedCampaignSiteRecord => ({ id, candidacyId, candidateName: "A B",
    campaign: { ...link(url), evidence: { verifierId: "v", artifactId: "a", attemptId: "t", sha256: "d".repeat(64), requestedUrl: url, finalUrl: url, httpStatus: 200, readAt: "2026-09-25T21:00:00.000Z", approvalItemId: "i", approvalRecordId: "r", approvedAt: "2026-09-25T23:00:00.000Z", secondSignal: "s" } } });
  const official = { url: "https://town.example.gov/council", verification: "Fetched 2026-08-13: roster.", attemptedAt: "2026-08-13" };
  const composed = composeCampaignLinks(
    { k1: { official, campaign: null }, r2: { official: null, campaign: link("https://reviewed.example/") } },
    [record("k1", "c1", "https://derived.example/"), record("k2", "c1", "https://derived.example/"), record("r1", "c2", "https://derived-2.example/"), record("r2", "c2", "https://derived-2.example/")],
  );
  assert.deepEqual(composed.links.k1, { official, campaign: record("k1", "c1", "https://derived.example/").campaign });
  assert.equal(composed.links.k2?.campaign?.url, "https://derived.example/");
  assert.equal(composed.links.r1, undefined, "the person's reviewed link under another key holds this key too");
  assert.equal(composed.links.r2?.campaign?.url, "https://reviewed.example/");
  assert.deepEqual([...composed.derivedKeys].sort(), ["k1", "k2"]);
});
