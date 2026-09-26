/**
 * The standing runner's campaign-site pass and the automatic door, end to end
 * on an isolated plane: held fixture results go through the complete chain as
 * the research cycle runs it (robots-first, bounded, no model), the approval
 * publishes through the DERIVED routine contract `candidate-campaign-sites-derived`
 * with no owner step, and the profile Reader (/ballot's links and Ask) shows
 * the site exactly as it shows a reviewed campaign link. A refused lead
 * publishes nothing and keeps its typed reason; a year-less site stays refused
 * however often it is read; the pass's bounds hold; and the paid lane stays
 * closed under the owner's pause while the pass runs.
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import type { ControlPlaneRepositories } from "../lib/control-plane/repository/types.ts";
import { appendTransition, contextFromRepositories, readPipelineStates } from "../lib/control-plane/promotion/pipeline.ts";
import { readActivationGate } from "../lib/control-plane/promotion/activation-gate.ts";
import { discoveryPointerItemId, type CampaignSiteApprovedRecord } from "../lib/control-plane/promotion/campaign-site-chain.ts";
import {
  CAMPAIGN_SITE_BUDGET_MS,
  CAMPAIGN_SITE_MAX_READS,
  campaignSiteCycleLine,
  campaignSiteSubjectsFromHoldings,
  heldMarginaliaFromManifest,
  runCampaignSiteCycle,
  type CampaignSiteCycleInput,
} from "../lib/control-plane/promotion/campaign-site-cycle.ts";
import { indexVault, readHeldBytes } from "../lib/control-plane/evidence/read-only-vault.ts";
import { DurableEvidenceStore } from "../lib/control-plane/evidence/durable-store.ts";
import { recordAcquisition } from "../lib/control-plane/evidence/artifact.ts";
import { putArtifact } from "../lib/control-plane/evidence/store.ts";
import type { StagingManifest } from "../lib/control-plane/scheduler/promotion-tail.ts";
import { modelLaneClosure } from "../lib/control-plane/scheduler/model-lane.ts";
import { scoutedFromHeldFinding } from "../lib/candidates/research-findings-replay.ts";
import { heldPageRead, verifyCampaignSitePage } from "../lib/candidates/campaign-site-verifier.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { manualProjectionCandidate, type CandidateProfilesProjection, type ManualProjectionPackage } from "../lib/civic-data/manual-projections.ts";
import { processRegisteredManualCandidate, processRegisteredRoutineCandidate } from "../lib/civic-data/promotion.ts";
import { readPromotedCivicData } from "../lib/civic-data/read-model.ts";
import { promotedInputRef } from "../lib/civic-data/derived-authority.ts";
import { derivedAuthorityFor } from "../lib/civic-data/derived-door.ts";
import { refreshCandidateProfilesFromPromoted } from "../lib/civic-data/manual-read-models.ts";
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
  planDerivedCampaignSites,
  type HeldVerifyingRead,
  type PublishableCampaignSiteApproval,
} from "../lib/civic-data/derived-campaign-site-writer.ts";
import { allCandidateLinks, campaignLinkIsDerived, linksForCandidacy } from "../lib/ballot/candidate-sites.ts";
import { candidateProfileEvidenceFor } from "../lib/ask/candidate-profile.ts";
import { installRegistryRuntimeFirstSeeds } from "./helpers/registry-runtime-first-seed.ts";
import { KAPNER, MAYES, TANG_WILLIAMS, committedSubjects, fixture, servedRuntime, sha256, subject } from "./helpers/campaign-sites.ts";

await installRegistryRuntimeFirstSeeds();

const ROOT = process.cwd();
/* Past instants: the store refuses a candidate event later than its own clock. */
const T0 = "2026-09-20T12:00:00.000Z";
const T1 = "2026-09-24T21:00:00.000Z";
const T2 = "2026-09-24T23:00:00.000Z";
/* The routine runner's next pass after the approval: when the publication child runs. */
const PUBLISH = "2026-09-24T23:05:00.000Z";
const LILY = "https://www.lilytangwilliams.com/congress/endorsements/";
const LILY_PRESS = "https://www.lilytangwilliams.com/congress/press-releases/";
const KAPNER_ROOT = "https://www.kapner4mendhamtwp.com/";
const MARGINALIA_URL = "https://api.marginalia.nu/public/search/Lily%20Tang%20Williams";
const MAYES_KEY = "ballot-az-pima:attorney-general:mayes-kris";

function served() {
  return {
    "https://www.lilytangwilliams.com/robots.txt": { status: 200, body: fixture("lilytangwilliams.robots.txt") },
    [LILY]: { status: 200, body: fixture("lilytangwilliams-endorsements.live.html") },
    /* The index's second lead on her host: read, and refused (it names no one). */
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

/**
 * The runner's own held state, as a cycle finds it: a Marginalia answer the
 * tail staged INGESTED and the vault holds, a held Scout finding that named
 * the year-less Kapner site, and one that named a news story.
 */
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
  const kapner = scoutedFromHeldFinding({ attemptId: "at-scout-kapner", obligationId: `freshness:candidate-enrichment:${KAPNER}#candidate-marginalia-index`, subjectId: KAPNER,
    outcome: "ROUTE_CANDIDATE", routeId: "kapner-campaign-site", canonicalUrl: KAPNER_ROOT, artifactIds: [], recordedAt: "2026-09-21T02:23:09.992Z", summary: "Kapner campaign site" });
  const news = scoutedFromHeldFinding({ attemptId: "at-scout-news", obligationId: `freshness:candidate-enrichment:${KAPNER}#candidate-news`, subjectId: KAPNER,
    outcome: "ROUTE_CANDIDATE", routeId: "kapner-news", canonicalUrl: "https://patch.com/new-jersey/mendham/kapner-runs", artifactIds: [], recordedAt: "2026-09-21T02:24:00.000Z", summary: "a news story" });
  await appendTransition(repos, kapner, ctx, T0);
  await appendTransition(repos, news, ctx, T0);
  return { repos, vaultRoot, manifest, requests: [] };
}

/** One research cycle's pass, as the runner calls it, on a fake clock that starts at the cycle's instant. */
async function cycle(p: Plane, now: string, extra: Partial<CampaignSiteCycleInput> = {}, pages: Record<string, { status: number; body: string }> = served()) {
  let ms = Date.parse(now);
  const runtime = servedRuntime(pages, now);
  const vault = await indexVault(p.vaultRoot);
  const held = await heldMarginaliaFromManifest(p.vaultRoot, p.manifest, vault, now);
  const report = await runCampaignSiteCycle({
    repos: p.repos, subjects: committedSubjects(), marginalia: held.responses, gate: readActivationGate(ROOT), now,
    clock: () => (ms += 5), sleep: async (wait) => { ms += wait; },
    open: async (request) => { p.requests.push(request.url); return runtime.get(request); },
    vaultRoot: p.vaultRoot, heldVault: vault, methodVersion: 1,
    ...extra,
  });
  return { report, held };
}

/** What the runner's publication child reads: every APPROVED record in the log, and each one's vaulted bytes. */
async function doorInputs(p: Plane) {
  const approvals = (await readPipelineStates(p.repos))
    .flatMap((s) => (s.stage === "APPROVED_FOR_PROMOTION" ? [s.byStage.APPROVED_FOR_PROMOTION as unknown] : []))
    .filter(isPublishableCampaignSiteApproval);
  const vault = await indexVault(p.vaultRoot);
  const held = new Map<string, HeldVerifyingRead>();
  for (const a of approvals) {
    const artifact = vault.byId.get(a.campaignSite.evidence.artifactId);
    if (artifact === undefined || artifact.tier === "RESTRICTED_RAW") continue;
    held.set(artifact.id, { body: new TextDecoder().decode(await readHeldBytes(artifact)), sha256: artifact.contentHash.slice(7), tier: artifact.tier, permission: artifact.permission });
  }
  return { approvals, held: (r: PublishableCampaignSiteApproval) => held.get(r.campaignSite.evidence.artifactId) ?? null };
}

/** The owner's reviewed profiles, promoted through the manual door: Mayes carries a reviewed campaign link; Tang Williams carries none. */
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

  /* Cycle 1: the Marginalia pointer is read robots-first and verified; it waits for an independent second read. */
  const first = await cycle(p, T1);
  assert.equal(first.held.responses.length, 1, "the held answer is found through the manifest and read back from the vault");
  const pointer = discoveryPointerItemId(TANG_WILLIAMS, LILY);
  let state = (await readPipelineStates(p.repos)).find((s) => s.itemId === pointer)!;
  assert.equal(state.stage, "VERIFIED");
  assert.equal(first.report.chain.approved.length, 0);
  assert.ok(p.requests.includes("https://www.lilytangwilliams.com/robots.txt") &&
    p.requests.indexOf("https://www.lilytangwilliams.com/robots.txt") < p.requests.indexOf(LILY), "robots.txt is read before the page");

  /* Cycle 2, two hours later: the audit's second read, then the approval. */
  const second = await cycle(p, T2);
  state = (await readPipelineStates(p.repos)).find((s) => s.itemId === pointer)!;
  assert.equal(state.stage, "APPROVED_FOR_PROMOTION", JSON.stringify(second.report.chain.offers.filter((o) => o.itemId === pointer)));
  assert.equal(second.report.chain.rereadsUsed, 1);
  assert.match(campaignSiteCycleLine(second.report), /1 approved for the derived door/);

  /* The routine child's pass: no owner step, the routine door. */
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
  const derived = pass.candidate.retrieval.derived!.inputs;
  assert.ok(derived.some((i) => i.kind === "PIPELINE_APPROVAL") && derived.some((i) => i.kind === "VAULTED_EVIDENCE") && derived.some((i) => i.kind === "PROMOTED_VERSION"));

  /* The next hourly pass finds nothing new: it is receipted on the pointed version (R23), never re-promoted. */
  const nextPass = derivedCampaignSitesPass({ approvals: inputs.approvals, held: inputs.held, profiles, gateOpen: true, now: "2026-09-25T00:05:00.000Z" });
  const unchanged = await processRegisteredRoutineCandidate(store, "candidate-campaign-sites-derived", nextPass.candidate, "2026-09-25T00:05:00.000Z", undefined, { confirmUnchanged: true });
  assert.equal(unchanged.confirmed?.versionId, outcome.promoted!.versionId, `${unchanged.candidate.state}`);

  /* The Reader: the profile preload reads the derived store beside the profiles, and the campaign slot shows the site. */
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

  /* Ask: the same record kind, text and source a reviewed campaign link gives, held at the derived pointer. */
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

  /* The Kapner page names her and was refused: the durable refusal on its item is the typed reason Admin's delivery trail reads. */
  const kapner = (await readPipelineStates(p.repos)).find((s) => s.byStage.SCOUTED?.canonicalUrl === KAPNER_ROOT)!;
  assert.equal(kapner.refused?.atStage, "CONFIRMED");
  assert.match(kapner.refused!.reasons[0]!.detail, /CYCLE_NOT_EVIDENCED/);

  /* The door publishes nothing, by name, and the Reader shows no derived link. */
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

test("per-cycle bounds hold: at most 12 lead reads, second reads counted apart, a budget-cut read deferred, never refused, and the next cycle reads the rest", async (t) => {
  const p = await plane(t);
  /* Twenty more held findings, each naming its own readable page for its own candidacy. */
  const ids = [...committedSubjects().keys()].filter((id) => id !== KAPNER && id !== TANG_WILLIAMS).slice(0, 20);
  const pages: Record<string, { status: number; body: string }> = { ...served() };
  const ctx = await contextFromRepositories(p.repos);
  for (const [n, id] of ids.entries()) {
    const url = `https://site-${n}.example/`;
    pages[`https://site-${n}.example/robots.txt`] = { status: 200, body: "User-agent: *\nAllow: /\n" };
    pages[url] = { status: 200, body: `<html><title>Site ${n}</title><body>An unrelated page.</body></html>` };
    await appendTransition(p.repos, scoutedFromHeldFinding({ attemptId: `at-scout-${n}`, obligationId: `freshness:candidate-enrichment:${id}#x`, subjectId: id,
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

  /* The next hourly cycle judges what it read from the vault and reads what it did not. */
  const next = await cycle(p, "2026-09-24T22:00:00.000Z", {}, pages);
  const readNext = next.report.chain.leads.filter((l) => l.via === "READ").map((l) => l.lead.url);
  assert.equal(readNext.length, 11);
  assert.ok(readNext.every((url) => !readFirst.has(url)), "no lead is read twice while unread leads wait");
  /* Every lead read before is judged from its vaulted bytes (the verified one has moved past SCOUTED). */
  assert.ok(next.report.chain.judgedFromVault >= 11);

  /* Second reads are bounded apart: none allowed, none made; one allowed, the waiting item is read again and approved. */
  const held = await cycle(p, T2, { maxReads: 0, maxRereads: 0 }, pages);
  assert.equal(held.report.chain.rereadsUsed, 0);
  assert.equal(held.report.chain.approved.length, 0);
  const reread = await cycle(p, "2026-09-24T23:30:00.000Z", { maxReads: 0, maxRereads: 1 }, pages);
  assert.equal(reread.report.chain.readsUsed, 1, "a spent lead bound never starves the audit's second read");
  assert.equal(reread.report.chain.approved.length, 1);

  /*
   * A pass whose time runs out defers the read it was in (its robots.txt took the whole budget, so the page is never
   * asked) and every later one: NOT_READ, never TRANSPORT_FAILED or ROBOTS_REFUSED, and none of them counts as a read.
   */
  const slow = await createSlow(t, pages);
  assert.ok(slow.report.budgetSpent);
  assert.equal(slow.report.chain.readsUsed, 0);
  assert.deepEqual(Object.keys(slow.report.byCode).filter((code) => code !== "NEWS_OUTLET"), ["NOT_READ"], JSON.stringify(slow.report.byCode));
  assert.equal(slow.report.byCode.NOT_READ, 21, "20 sites and Kapner, every one still owed");
  assert.equal(slow.requests, 1, "one request, the robots.txt the budget ran out on");
});

/** A fresh plane whose every request takes 61 s of the pass's 60 s. */
async function createSlow(t: { after: (fn: () => void) => void }, pages: Record<string, { status: number; body: string }>) {
  const p = await plane(t);
  const ctx = await contextFromRepositories(p.repos);
  const ids = [...committedSubjects().keys()].filter((id) => id !== KAPNER && id !== TANG_WILLIAMS).slice(0, 20);
  for (const [n, id] of ids.entries()) {
    await appendTransition(p.repos, scoutedFromHeldFinding({ attemptId: `at-scout-${n}`, obligationId: `freshness:candidate-enrichment:${id}#x`, subjectId: id,
      outcome: "ROUTE_CANDIDATE", routeId: `route-${n}`, canonicalUrl: `https://site-${n}.example/`, artifactIds: [], recordedAt: T0, summary: "a site" }), ctx, T0);
  }
  let ms = Date.parse(T1);
  let requests = 0;
  const runtime = servedRuntime(pages, T1);
  const vault = await indexVault(p.vaultRoot);
  const report = await runCampaignSiteCycle({
    repos: p.repos, subjects: committedSubjects(), marginalia: [], gate: readActivationGate(ROOT), now: T1,
    clock: () => ms, sleep: async (wait) => { ms += wait; },
    open: async (request) => { requests += 1; ms += 61_000; return runtime.get(request); },
    vaultRoot: p.vaultRoot, heldVault: vault, methodVersion: 1,
  });
  assert.equal(CAMPAIGN_SITE_BUDGET_MS, 60_000);
  return { report, requests };
}

/** Twenty more held Scout findings, each naming its own readable page for its own candidacy (none of them Kapner or Tang Williams). */
async function backlog(p: Plane): Promise<{ readonly ids: readonly string[]; readonly pages: Record<string, { status: number; body: string }>; readonly urlOf: (id: string) => string }> {
  const ids = [...committedSubjects().keys()].filter((id) => id !== KAPNER && id !== TANG_WILLIAMS).slice(0, 20);
  const pages: Record<string, { status: number; body: string }> = { ...served() };
  const ctx = await contextFromRepositories(p.repos);
  for (const [n, id] of ids.entries()) {
    const url = `https://site-${n}.example/`;
    pages[`https://site-${n}.example/robots.txt`] = { status: 200, body: "User-agent: *\nAllow: /\n" };
    pages[url] = { status: 200, body: `<html><title>Site ${n}</title><body>An unrelated page.</body></html>` };
    await appendTransition(p.repos, scoutedFromHeldFinding({ attemptId: `at-scout-${n}`, obligationId: `freshness:candidate-enrichment:${id}#x`, subjectId: id,
      outcome: "ROUTE_CANDIDATE", routeId: `route-${n}`, canonicalUrl: url, artifactIds: [], recordedAt: T0, summary: "a site" }), ctx, T0);
  }
  return { ids, pages, urlOf: (id) => `https://site-${ids.indexOf(id)}.example/` };
}

test("the pass reads the leads of candidates with no campaign link first; a linked candidate's leads wait, deferred and never refused, and are read once the others are", async (t) => {
  const p = await plane(t);
  const { ids, pages, urlOf } = await backlog(p);
  /* Half the backlog's candidates already carry a reviewed campaign link: a site approved for them would be held (PRIOR_CAMPAIGN_LINK_HELD). */
  const linked = new Set(ids.slice(0, 10));
  const first = await cycle(p, T1, { linkedCandidacies: linked }, pages);
  assert.equal(first.report.chain.readsUsed, CAMPAIGN_SITE_MAX_READS, "the read bound is unchanged");
  const read = first.report.chain.leads.filter((l) => l.via === "READ");
  assert.ok(read.length > 0 && read.every((l) => !linked.has(l.subjectId)), `every read goes to a candidate with no link: ${read.map((l) => l.subjectId).join(", ")}`);
  const waiting = first.report.chain.leads.filter((l) => linked.has(l.subjectId));
  assert.equal(waiting.length, 10);
  assert.ok(waiting.every((l) => l.outcome === "DEFERRED" && l.refusals[0]?.code === "NOT_READ"), "a linked candidate's lead is owed, never refused");
  /* 13 readable leads have no link behind them (10 sites, Kapner, Lily's two): 12 are read, one waits with the linked ones. */
  const unlinkedOwed = first.report.chain.leads.filter((l) => l.outcome === "DEFERRED" && !linked.has(l.subjectId));
  assert.equal(unlinkedOwed.length, 1);

  /* The next hourly cycle reads the last unlinked lead before any linked one, then the linked ones: every lead is still read. */
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

test("the audit's second read comes before new leads: an item one read from approval is approved even when the backlog spends the pass's whole time budget", async (t) => {
  const p = await plane(t);
  const pointer = discoveryPointerItemId(TANG_WILLIAMS, LILY);
  await cycle(p, T1);
  assert.equal((await readPipelineStates(p.repos)).find((s) => s.itemId === pointer)?.stage, "VERIFIED", "the Marginalia site waits for a second read an hour later");
  const { pages } = await backlog(p);

  /* Two hours later every request takes 5 s: the 60 s budget holds a dozen requests, far fewer than the backlog's forty. */
  let ms = Date.parse(T2);
  const runtime = servedRuntime(pages, T2);
  const vault = await indexVault(p.vaultRoot);
  const held = await heldMarginaliaFromManifest(p.vaultRoot, p.manifest, vault, T2);
  const requests: string[] = [];
  const report = await runCampaignSiteCycle({
    repos: p.repos, subjects: committedSubjects(), marginalia: held.responses, gate: readActivationGate(ROOT), now: T2,
    clock: () => ms, sleep: async (wait) => { ms += wait; },
    open: async (request) => { requests.push(request.url); ms += 5_000; return runtime.get(request); },
    vaultRoot: p.vaultRoot, heldVault: vault, methodVersion: 1,
  });
  assert.equal(CAMPAIGN_SITE_BUDGET_MS, 60_000);
  assert.ok(report.budgetSpent, "the backlog outlasts the pass's time");
  assert.ok(report.chain.leads.some((l) => l.outcome === "DEFERRED" && l.refusals[0]?.code === "NOT_READ"), "new leads stay owed for the next cycle");
  assert.deepEqual(requests.slice(0, 2), ["https://www.lilytangwilliams.com/robots.txt", LILY], "the second read is the pass's first read");
  assert.equal(report.chain.rereadsUsed, 1);
  assert.equal((await readPipelineStates(p.repos)).find((s) => s.itemId === pointer)?.stage, "APPROVED_FOR_PROMOTION");
  assert.ok(report.chain.approved.some((a) => a.campaignSite.candidacyId === TANG_WILLIAMS));
});

test("who already carries a campaign link is read by the door's own rule: a reviewed campaign link on one of the candidacy's Reader keys", () => {
  const az = JSON.parse(readFileSync(join(ROOT, "data", "states", "az", "ballot", "az-pima-2026.json"), "utf8")) as unknown;
  const link = { url: "https://www.krismayes.com", verification: "Fetched 2026-08-13: 'Kris Mayes for Arizona Attorney General'.", attemptedAt: "2026-08-13" };
  const official = { url: "https://azgovernor.gov/", verification: "Fetched 2026-08-13: the Governor's office.", attemptedAt: "2026-08-13" };
  const { subjects, linked } = campaignSiteSubjectsFromHoldings({
    az: { ballot: az } as never, nh: null, nj: null,
    profiles: {
      cards: { curatedAt: "2026-09-08", note: "reviewed cards", cards: {}, hunts: [] },
      /* Mayes carries a reviewed campaign link; Hobbs carries only an official link, which holds no campaign slot. */
      links: { curatedAt: "2026-09-08", note: "reviewed links", links: { [MAYES_KEY]: { official: null, campaign: link }, "ballot-az-pima:governor:hobbs-katie": { official, campaign: null } }, hunts: [] },
    } as never,
    corpus: { documents: [] } as never,
    failures: [],
  }, T1);
  assert.ok(subjects.has(MAYES) && subjects.has("az:2026:state-az:governor:hobbs-katie"));
  assert.deepEqual([...linked], [MAYES]);
});

test("the paid lane stays closed under the owner's pause, and the pass is plain code that never consults it", () => {
  const gate = readActivationGate(ROOT);
  const base = { scheduledBlackout: false, dry: false, noModel: false, credentialConfigured: true, credentialVar: "WTP_WORKERS_ANTHROPIC_API_KEY", activation: gate, runnerPaused: false, runnerPauseIntentId: null, unreadableControls: [] };
  assert.deepEqual(modelLaneClosure({ ...base, paused: true, pauseIntentId: "ri-owner-pause" }), { code: "PAUSED", reason: "paused by owner intent ri-owner-pause" });
  for (const file of [
    "lib/control-plane/promotion/campaign-site-cycle.ts",
    "lib/civic-data/derived-campaign-site-writer.ts",
    "lib/civic-data/derived-campaign-sites.ts",
    "scripts/derive-candidate-campaign-sites.mts",
  ]) {
    assert.doesNotMatch(readFileSync(join(ROOT, file), "utf8"), /model-lane|scout-executor|scout-search|scout-tools|model-routing|@anthropic-ai|anthropic|BRAVE_SEARCH|EXA_API/i, file);
  }
  /* The runner's pass: after meetings discovery, gated on the cycle kind, the runner pause and the time left, never on the paid lane. */
  const runner = readFileSync(join(ROOT, "scripts", "freshness-shadow.mts"), "utf8");
  const start = runner.indexOf("let campaignSites: CampaignSiteCycleReport | null = null;");
  const end = runner.indexOf('finishPhase("campaign-sites");');
  assert.ok(start > runner.indexOf('finishPhase("meetings-discovery");') && end > start, "the pass is its own phase, after meetings discovery");
  const block = runner.slice(start, end);
  assert.doesNotMatch(block, /modelLaneEnabled|laneClosure|guardedModelTransport|scoutFor|workerKey/);
  assert.match(block, /intents\.runnerPause\.paused/);
  assert.match(block, /CAMPAIGN_SITE_BUDGET_MS > DISPATCH_DEADLINE_MS/);
  assert.match(block, /guardedOpenBytes\("discovery-web", "campaign-site-chain", fetch, \{ followRedirects: false \}\)/);
  assert.match(block, /spaceOut: spacer/);
  assert.match(runner, /campaignSiteCycleLine\(campaignSites\)/, "the pass reaches the cycle's digest");
});

/* ------------------------------------------------------------- the door */

function approvalFor(url: string, body: string, readAt: string): CampaignSiteApprovedRecord {
  const s = subject(TANG_WILLIAMS);
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
      field: "campaignSite", candidacyId: s.candidacyId, candidateName: "Lily Tang Williams",
      identity: { candidacyId: s.candidacyId, givenName: s.givenName, familyName: s.familyName, officeTitle: s.officeTitle, ocdId: s.ocdId, stateCode: s.stateCode, cycle: s.cycle },
      readerKeys: s.readerKeys, url, host: new URL(url).hostname.replace(/^www\./, ""),
      verification: verdict.verdict === "VERIFIED" ? verdict.verification : "",
      evidence: { verifierId: "campaign-site-verifier/1", artifactId: `ar-${sha.slice(0, 8)}`, attemptId: "at-reader", sha256: sha, requestedUrl: url, finalUrl: url,
        httpStatus: 200, contentType: "text/html; charset=utf-8", readAt },
      audit: { startedFrom: ["EVIDENCE_VAULT", "CANONICAL_SUBJECT_IDENTITY", "INDEPENDENT_FIRST_PARTY_ACQUISITION"], secondSignal: "SECOND_READ: test" },
      publicationDoor: "CANDIDATE_CAMPAIGN_SITES_DERIVED_CONTRACT",
    },
  };
}

test("the door verifies the vault again and holds by name what it cannot prove; a reviewed link always wins", () => {
  const body = fixture("lilytangwilliams-endorsements.live.html");
  const approval = approvalFor(LILY, body, "2026-09-25T21:00:05.000Z");
  /* The chain's record is the writer's structural approval: assignable as it is (tsc checks this line), and recognized at runtime. */
  const structural: PublishableCampaignSiteApproval = approval;
  assert.equal(isPublishableCampaignSiteApproval(structural), true);
  assert.equal(isPublishableCampaignSiteApproval({ ...approval, campaignSite: { ...approval.campaignSite, publicationDoor: "CANDIDATE_PROFILES_MANUAL_CONTRACT" } }), false);
  const heldBytes: HeldVerifyingRead = { body, sha256: sha256(body), tier: "RAW", permission: "ALLOWED" };
  const plan = (held: HeldVerifyingRead | null, links: Record<string, { official: null; campaign: { url: string; verification: string; attemptedAt: string } | null }> = {}) =>
    planDerivedCampaignSites({ approvals: [structural], held: () => held, profiles: { input: { kind: "PROMOTED_VERSION", recordClass: "CANDIDATE_PROFILE", scope: "s", versionId: "v", readModelSha256: "b".repeat(64), promotedAt: T0 }, links } });

  assert.equal(plan(heldBytes).records.length, subject(TANG_WILLIAMS).readerKeys.length);
  /* Whatever robots verdict the sidecar recorded is evidence carried with the read, never a hold (owner decision 2026-09-25). */
  for (const permission of ["DISALLOWED", "CANNOT_TELL", "NOT_APPLICABLE", null]) {
    const again = plan({ ...heldBytes, permission });
    assert.deepEqual(again.held, [], `a sidecar recording ${permission} holds nothing`);
    assert.equal(again.records.length, subject(TANG_WILLIAMS).readerKeys.length);
  }
  assert.deepEqual(plan(null).held.map((h) => h.code), ["EVIDENCE_NOT_HELD"]);
  assert.deepEqual(plan({ ...heldBytes, sha256: "c".repeat(64) }).held.map((h) => h.code), ["REVERIFICATION_FAILED"]);
  /* Bytes that are the approved bytes but do not verify for the approval's own identity: the vault does not prove the claim, so nothing publishes. */
  const kapner = subject(KAPNER);
  const misjoined: PublishableCampaignSiteApproval = { ...structural, campaignSite: { ...structural.campaignSite, identity: { ...structural.campaignSite.identity, givenName: kapner.givenName, familyName: kapner.familyName } } };
  const refused = planDerivedCampaignSites({ approvals: [misjoined], held: () => heldBytes, profiles: null });
  assert.deepEqual(refused.held.map((h) => h.code), ["REVERIFICATION_FAILED"]);
  assert.match(refused.held[0]!.detail, /CANDIDATE_NOT_NAMED/);
  const key = subject(TANG_WILLIAMS).readerKeys[0]!;
  const reviewed = plan(heldBytes, { [key]: { official: null, campaign: { url: "https://reviewed.example/", verification: "Fetched 2026-08-13: reviewed.", attemptedAt: "2026-08-13" } } });
  assert.deepEqual(reviewed.held.map((h) => h.code), ["PRIOR_CAMPAIGN_LINK_HELD"]);
  assert.equal(reviewed.records.length, 0);
  /* Two hosts for one person are never chosen between. */
  const other: PublishableCampaignSiteApproval = approvalFor("https://www.lilytangwilliamsforcongress.example/", body, "2026-09-25T21:00:06.000Z");
  const two = planDerivedCampaignSites({ approvals: [structural, other], held: () => heldBytes, profiles: null });
  assert.deepEqual(two.held.map((h) => h.code), ["MULTIPLE_VERIFIED_SITES"]);

  /* The candidate names every input, and the validator refuses one it cannot read. */
  const candidate = derivedCampaignSitesCandidate(plan(heldBytes), T2);
  assert.deepEqual(candidate.semantics.violations, []);
  assert.equal(derivedAuthorityFor(candidate).ok, true);
  const tampered = { ...candidate, retrieval: { ...candidate.retrieval, derived: { inputs: candidate.retrieval.derived!.inputs.map((i) => (i.kind === "PIPELINE_APPROVAL" ? { ...i, recordId: "" } : i)) } } };
  assert.deepEqual(derivedAuthorityFor(tampered), { ok: false, code: "DERIVED_INPUT_MALFORMED", detail: "a pipeline-approval input lacks its item, record or approval time" });
  /* A closed gate publishes nothing new. */
  assert.match(derivedCampaignSitesPass({ approvals: [structural], held: () => heldBytes, profiles: null, gateOpen: false, now: T2 }).candidate.retrieval.failureDetail ?? "", /^GATE_CLOSED/);
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
