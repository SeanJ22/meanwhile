/**
 * The complete campaign-site chain on an isolated in-memory plane, over real
 * held and freshly read pages: a held paid-research finding reaches
 * APPROVED_FOR_PROMOTION with all five checks MEASURED (the generic worker
 * offer left three NOT_IMPLEMENTED), the audit's controls measured and an
 * independent saved profile; a refused page holds its item with the typed
 * reason; a Marginalia pointer stays VERIFIED without an independent source;
 * and with the gate closed nothing is approved.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import type { ArtifactRecord } from "../lib/control-plane/repository/types.ts";
import { appendTransition, contextFromRepositories, readPipelineStates } from "../lib/control-plane/promotion/pipeline.ts";
import { readActivationGate } from "../lib/control-plane/promotion/activation-gate.ts";
import { VERIFICATION_CHECKS, type ActivationGateReading } from "../lib/control-plane/promotion/types.ts";
import {
  CAMPAIGN_SITE_FIELD,
  campaignSiteChecks,
  discoveryPointerItemId,
  projectCampaignSiteChains,
  type HeldMarginaliaResponse,
} from "../lib/control-plane/promotion/campaign-site-chain.ts";
import { indexVault } from "../lib/control-plane/evidence/read-only-vault.ts";
import { campaignSiteReadRecorder } from "../lib/control-plane/promotion/campaign-site-reads.ts";
import { heldArtifactRecord, scoutedFromHeldFinding, type HeldRead } from "../lib/candidates/research-findings-replay.ts";
import { districtForms, heldPageRead, readCampaignSiteLead, verifyCampaignSitePage } from "../lib/candidates/campaign-site-verifier.ts";
import { DUARTE, KAPNER, TANG_WILLIAMS, committedSubjects, fixture, servedRuntime, sha256 } from "./helpers/campaign-sites.ts";

const MEET = "https://www.duarte4mendham.com/meet-amalia";
const KAPNER_ROOT = "https://www.kapner4mendhamtwp.com/";
const LILY = "https://www.lilytangwilliams.com/congress/endorsements/";
const SCOUT_ATTEMPT = "at-scout-duarte-2026-09-21";

/** The paid Scout's own vaulted read of the Duarte page (tests/fixtures/campaign-sites/provenance.json). */
const heldScoutPage: HeldRead = {
  artifactId: "ar-held-duarte-meet-amalia", attemptId: SCOUT_ATTEMPT, canonicalUrl: MEET, contentType: "text/html; charset=utf-8",
  httpStatus: 200, retrievedAt: "2026-09-21T02:23:01.279Z", body: fixture("duarte4mendham-meet-amalia.held.html"),
  sha256: sha256(fixture("duarte4mendham-meet-amalia.held.html")), methodRouteId: "scout:fetch_public", permission: "ALLOWED",
};

function profilePage(subjectId: string, campaignUrl: string, artifactId: string): HeldRead {
  const subject = committedSubjects().get(subjectId)!;
  const body = `<title>${subject.givenName} ${subject.familyName} | Candidate profile</title><h1>${subject.givenName} ${subject.familyName}</h1>
    <p>Candidate for ${subject.officeTitle} in the 2026 General Election. ${subject.stateCode} ${districtForms(subject).join(" ")}</p><a href="${campaignUrl}">Website</a>`;
  return { ...heldScoutPage, artifactId, attemptId: `at-${artifactId}`, canonicalUrl: `https://independent.example/${artifactId}`,
    body, sha256: sha256(body), retrievedAt: "2026-09-25T20:30:00.000Z" };
}
const duarteProfile = profilePage(DUARTE, MEET, "ar-profile-duarte");
const lilyProfile = profilePage(TANG_WILLIAMS, LILY, "ar-profile-lily");

const lily: HeldMarginaliaResponse = {
  subjectId: TANG_WILLIAMS, artifactId: "ar-held-marginalia-tang-williams", attemptId: "at-marginalia-tang-williams",
  retrievedAt: "2026-09-24T12:00:00.000Z", body: fixture("marginalia-tang-williams-lily.json"),
};

function served() {
  return {
    "https://www.duarte4mendham.com/robots.txt": { status: 200, body: fixture("duarte4mendham.robots.txt") },
    [MEET]: { status: 200, body: fixture("duarte4mendham-meet-amalia.live.html") },
    "https://www.kapner4mendhamtwp.com/robots.txt": { status: 200, body: fixture("kapner4mendhamtwp.robots.txt") },
    [KAPNER_ROOT]: { status: 200, body: fixture("kapner4mendhamtwp-root.live.html") },
    "https://www.lilytangwilliams.com/robots.txt": { status: 200, body: fixture("lilytangwilliams.robots.txt") },
    [LILY]: { status: 200, body: fixture("lilytangwilliams-endorsements.live.html") },
  };
}

async function plane(t: { after: (fn: () => void) => void }) {
  const repos = createMemoryRepositories();
  const vaultRoot = mkdtempSync(join(tmpdir(), "wtp-campaign-site-chain-"));
  t.after(() => rmSync(vaultRoot, { recursive: true, force: true, maxRetries: 3 }));
  await repos.artifacts.append(`held:${SCOUT_ATTEMPT}`, heldScoutPage.artifactId, heldArtifactRecord(heldScoutPage), heldScoutPage.retrievedAt);
  await repos.artifacts.append(`held:${duarteProfile.attemptId}`, duarteProfile.artifactId, heldArtifactRecord(duarteProfile), duarteProfile.retrievedAt);
  const ctx = await contextFromRepositories(repos);
  /* Two held paid-research findings: an EVIDENCE_FOUND that named no URL (only pages), and a ROUTE_CANDIDATE that named one. */
  const duarte = scoutedFromHeldFinding({ attemptId: SCOUT_ATTEMPT, obligationId: `freshness:candidate-enrichment:${DUARTE}#candidate-authored-awaits-site`, subjectId: DUARTE,
    outcome: "EVIDENCE_FOUND", routeId: null, canonicalUrl: null, artifactIds: [heldScoutPage.artifactId], recordedAt: heldScoutPage.retrievedAt, summary: "RECORD: campaign site" });
  const kapner = scoutedFromHeldFinding({ attemptId: "at-scout-kapner", obligationId: `freshness:candidate-enrichment:${KAPNER}#candidate-marginalia-index`, subjectId: KAPNER,
    outcome: "ROUTE_CANDIDATE", routeId: "kapner-campaign-site", canonicalUrl: KAPNER_ROOT, artifactIds: [], recordedAt: "2026-09-21T02:23:09.992Z", summary: "Kapner campaign site" });
  await appendTransition(repos, duarte, ctx, heldScoutPage.retrievedAt);
  await appendTransition(repos, kapner, ctx, heldScoutPage.retrievedAt);
  return { repos, vaultRoot, duarte, kapner };
}

async function options(repos: ReturnType<typeof createMemoryRepositories>, vaultRoot: string, now: string, gate: Pick<ActivationGateReading, "promotionEnabled" | "openRecordClasses" | "openFields"> = readActivationGate("."), pages = served()) {
  let clock = Date.parse(now);
  const runtime = servedRuntime(pages, now);
  const heldVault = await indexVault(vaultRoot);
  const recorder = campaignSiteReadRecorder({ repos, vaultRoot, methodVersion: 1, now: () => new Date(clock += 1_000).toISOString(), heldVault });
  return {
    runtime,
    heldVault,
    options: {
      subjects: committedSubjects(), marginalia: [lily], gate, now,
      readLead: async (lead: { url: string; origin: "SCOUT_FINDING" | "MARGINALIA_POINTER" | "RECORDED_SITE"; ref: string }) => {
        const out = await readCampaignSiteLead(lead, runtime);
        return out.ok ? { ok: true as const, read: out.read } : { ok: false as const, refusal: out.refusal };
      },
      recordRead: recorder.recordRead,
      heldPage: async (artifact: ArtifactRecord) => {
        const held = [heldScoutPage, duarteProfile, lilyProfile].find(page => page.artifactId === artifact.artifactId);
        return held ? { ...heldPageRead({ requestedUrl: held.canonicalUrl, httpStatus: 200, contentType: held.contentType,
          body: held.body, retrievedAt: held.retrievedAt, sha256: held.sha256 }),
          permissions: [{ origin: new URL(held.canonicalUrl).origin, verdict: "ALLOWED" as const, detail: "held sidecar" }] }
          : recorder.heldPage(artifact);
      },
    },
  };
}

test("a held paid-research finding reaches APPROVED with measured checks, clean controls and an independent saved profile", async (t) => {
  const { repos, vaultRoot, duarte, kapner } = await plane(t);
  let workerResultReads = 0, workItemLists = 0;
  const results = repos.workerResults.readAll.bind(repos.workerResults);
  const workItems = repos.workItems.list.bind(repos.workItems);
  t.mock.method(repos.workerResults, "readAll", async () => { workerResultReads++; return results(); });
  t.mock.method(repos.workItems, "list", async () => { workItemLists++; return workItems(); });
  const run = await options(repos, vaultRoot, "2026-09-25T21:00:00.000Z");
  const report = await projectCampaignSiteChains(repos, run.options);
  const laterRecorder = campaignSiteReadRecorder({ repos, vaultRoot, methodVersion: 1,
    now: () => "2026-09-25T22:00:00.000Z", heldVault: run.heldVault });
  const rescannedRecorder = campaignSiteReadRecorder({ repos, vaultRoot, methodVersion: 1,
    now: () => "2026-09-25T22:00:00.000Z", heldVault: await indexVault(vaultRoot) });
  const newRecords = (await repos.artifacts.readAll())
    .filter(artifact => run.heldVault.byId.has(artifact.artifactId));
  assert.ok(newRecords.length > 0, "this round's captures are visible without rescanning");
  for (const artifact of newRecords) {
    assert.deepEqual(await laterRecorder.heldPage(artifact), await rescannedRecorder.heldPage(artifact),
      "a subsequent publication reader sees the original saved page through the shared index");
  }
  console.log(`CAMPAIGN_CONTEXT workerResultReads=${workerResultReads} workItemLists=${workItemLists}`);
  assert.equal(workerResultReads, 1, "recording campaign acquisitions changes no worker result");
  assert.equal(workItemLists, 1, "campaign acquisition owners have no worker audit result to refresh");
  const states = new Map((await readPipelineStates(repos)).map((s) => [s.itemId, s]));

  const d = states.get(duarte.itemId)!;
  assert.equal(d.stage, "APPROVED_FOR_PROMOTION", JSON.stringify(report.offers.filter((o) => o.itemId === duarte.itemId)));
  assert.equal(d.byStage.CONFIRMED!.basis, "SECOND_ROUTE", "the finding named no URL, so our read confirms it as a second route");
  assert.notEqual(d.byStage.CONFIRMED!.actor.instance, SCOUT_ATTEMPT);
  assert.equal(d.byStage.VERIFIED!.checks.length, VERIFICATION_CHECKS.length);
  assert.ok(d.byStage.VERIFIED!.checks.every((c) => c.result === "PASS"), JSON.stringify(d.byStage.VERIFIED!.checks));
  assert.equal(d.byStage.AUDITED, undefined, "CP-11: publication writes no planted-control audit stage");
  const approved = d.byStage.APPROVED_FOR_PROMOTION!;
  assert.equal(approved.field, CAMPAIGN_SITE_FIELD);
  assert.ok(approved.burdens!.every((b) => b.result === "PASS"), JSON.stringify(approved.burdens));
  const site = report.approved.find((a) => a.itemId === duarte.itemId)!.campaignSite;
  assert.equal(site.url, MEET);
  assert.deepEqual(site.readerKeys, ["ballot-nj-morris:mendham-township-member-of-the-township-committee-place-mendham-township:duarte-amalia"]);
  assert.equal(site.evidence.sha256, sha256(fixture("duarte4mendham-meet-amalia.live.html")));

  /* A page that names the candidate but carries no year: the item holds, with the typed reason on the durable refusal. */
  const k = states.get(kapner.itemId)!;
  assert.equal(k.stage, "SCOUTED");
  assert.equal(k.refused?.atStage, "CONFIRMED");
  assert.deepEqual(k.refused?.reasons.map((r) => r.code), ["CONFIRMATION_FACT_CONFLICT"]);
  assert.match(k.refused!.reasons[0]!.detail, /CYCLE_NOT_EVIDENCED/);

  /* CP-12: its own candidate, office and cycle publish without a second signal. */
  const pointer = states.get(discoveryPointerItemId(TANG_WILLIAMS, LILY))!;
  assert.equal(pointer.byStage.SCOUTED!.source.kind, "DISCOVERY_POINTER");
  assert.equal(pointer.byStage.CONFIRMED!.basis, "SECOND_ACQUISITION");
  assert.equal(pointer.stage, "APPROVED_FOR_PROMOTION");
  assert.equal(pointer.byStage.AUDITED, undefined);
  assert.ok(report.leads.some((l) => l.lead.origin === "MARGINALIA_POINTER" && l.outcome === "REFUSED" && l.refusals[0]?.code === "AGGREGATOR"));

  /* Later supporting sources do not delay or duplicate the existing approval. */
  const later = await options(repos, vaultRoot, "2026-09-25T23:00:00.000Z");
  const noSource = await projectCampaignSiteChains(repos, later.options);
  assert.equal((await readPipelineStates(repos)).find(s => s.itemId === pointer.itemId)!.stage, "APPROVED_FOR_PROMOTION");
  assert.equal(noSource.rereadsUsed, 0);
  await repos.artifacts.append(`held:${lilyProfile.attemptId}`, lilyProfile.artifactId, heldArtifactRecord(lilyProfile), lilyProfile.retrievedAt);
  const second = await projectCampaignSiteChains(repos, later.options);
  const after = (await readPipelineStates(repos)).find((s) => s.itemId === pointer.itemId)!;
  assert.equal(after.stage, "APPROVED_FOR_PROMOTION", JSON.stringify(second.offers.filter((o) => o.itemId === pointer.itemId)));
  assert.equal(after.byStage.AUDITED, undefined);
  assert.equal(second.approved.length, 2);
  /* Re-running offers nothing new for an approved item. */
  const third = await projectCampaignSiteChains(repos, (await options(repos, vaultRoot, "2026-09-25T23:30:00.000Z")).options);
  assert.ok(third.offers.filter((o) => o.itemId === duarte.itemId).length === 0);
});

test("a self-identifying campaign publishes without relying on altered supplemental profile bytes", async t => {
  const { repos, vaultRoot, duarte } = await plane(t);
  const run = await options(repos, vaultRoot, "2026-09-25T21:00:00.000Z");
  const report = await projectCampaignSiteChains(repos, { ...run.options, heldPage: async artifact => {
    const page = await run.options.heldPage(artifact);
    return artifact.artifactId === duarteProfile.artifactId && page
      ? { ...page, body: `${page.body}<p>Altered bytes.</p>` } : page;
  } });
  assert.equal((await readPipelineStates(repos)).find(s => s.itemId === duarte.itemId)!.stage, "APPROVED_FOR_PROMOTION");
  assert.ok(report.approved.some(row => row.itemId === duarte.itemId));
});

test("omitting a middle given name never resolves a collision between full canonical names", async t => {
  const { repos, vaultRoot, duarte } = await plane(t);
  const run = await options(repos, vaultRoot, "2026-09-25T21:00:00.000Z");
  const subjects = new Map(run.options.subjects);
  const original = subjects.get(DUARTE)!;
  const other = { ...original, candidacyId: "nj:2026:mendham:duarte-amalia-marie", givenName: "Amalia Marie" };
  subjects.set(other.candidacyId, other);
  await projectCampaignSiteChains(repos, { ...run.options, subjects });
  const state = (await readPipelineStates(repos)).find(row => row.itemId === duarte.itemId)!;
  assert.equal(state.stage, "CONFIRMED");
  assert.match(state.refused!.reasons[0]!.detail, /CANONICAL_IDENTITY_UNIQUE/);
});

test("CP-14: an obsolete closed-gate reading cannot withhold a verified campaign", async (t) => {
  const { repos, vaultRoot, duarte } = await plane(t);
  const run = await options(repos, vaultRoot, "2026-09-25T21:00:00.000Z", { promotionEnabled: false, openRecordClasses: [] });
  const report = await projectCampaignSiteChains(repos, run.options);
  const d = (await readPipelineStates(repos)).find((s) => s.itemId === duarte.itemId)!;
  assert.equal(d.stage, "APPROVED_FOR_PROMOTION");
  assert.ok(report.approved.some(row => row.itemId === duarte.itemId));
  assert.ok(!d.byStage.APPROVED_FOR_PROMOTION?.burdens?.some(burden => burden.name === "RECORD_CLASS_CANDIDATE"));
});

/*
 * Owner decision 2026-09-25: "Robots.txt alone must not block acquisition." Robots.txt is still read first and its
 * verdict recorded on the read, the artifact and the VERIFIED check; it is never a class burden. An access control is.
 */
test("robots.txt is recorded, not a burden: a site whose robots.txt disallows every path is approved with the verdict on its record; an access control or an unread robots.txt still fails the class burden", async (t) => {
  const { repos, vaultRoot, duarte } = await plane(t);
  const pages = { ...served(), "https://www.duarte4mendham.com/robots.txt": { status: 200, body: "User-agent: *\nDisallow: /\n" } };
  const run = await options(repos, vaultRoot, "2026-09-25T21:00:00.000Z", readActivationGate("."), pages);
  const report = await projectCampaignSiteChains(repos, run.options);
  assert.ok(run.runtime.requests.indexOf("https://www.duarte4mendham.com/robots.txt") < run.runtime.requests.indexOf(MEET), "robots.txt is read before the page");
  const d = (await readPipelineStates(repos)).find((s) => s.itemId === duarte.itemId)!;
  assert.equal(d.stage, "APPROVED_FOR_PROMOTION", JSON.stringify(report.offers.filter((o) => o.itemId === duarte.itemId)));
  const burdens = d.byStage.VERIFIED!.checks.find((c) => c.name === "ASSERTION_CLASS_BURDENS")!;
  assert.equal(burdens.result, "PASS");
  assert.match(burdens.detail, /robots\.txt read first and recorded \(https:\/\/www\.duarte4mendham\.com DISALLOWED; evidence, not a gate\)/);
  const artifact = (await repos.artifacts.readAll()).find((a) => a.artifactId === d.byStage.CONFIRMED!.confirmingArtifactIds[0])!;
  const held = (await indexVault(vaultRoot)).byId.get(artifact.artifactId);
  assert.equal(held?.permission, "DISALLOWED", "the artifact records the verdict the read ran under, never ALLOWED by default");

  /* The class burden, measured on the bytes: an unread robots.txt and an access control each fail it. */
  const subjects = committedSubjects();
  const subject = subjects.get(DUARTE)!;
  const page = (await run.options.heldPage(artifact))!;
  const burdenOf = (read: typeof page) => {
    const verdict = verifyCampaignSitePage(subject, { url: MEET, origin: "RECORDED_SITE", ref: "test" }, read);
    return campaignSiteChecks({ subject, verdict, read, artifact, subjects, now: "2026-09-25T21:30:00.000Z" }).find((c) => c.name === "ASSERTION_CLASS_BURDENS")!;
  };
  assert.equal(burdenOf(page).result, "PASS");
  assert.match(burdenOf({ ...page, permissions: [] }).detail, /no robots reading is recorded for the read/);
  const challenged = burdenOf({ ...page, body: `<html><head><title>Just a moment...</title></head>${page.body}</html>` });
  assert.equal(challenged.result, "FAIL");
  assert.match(challenged.detail, /an access control answered in place of the page \(a bot challenge/);
});

test("CP-14: an obsolete field list cannot withhold a verified campaign site", async (t) => {
  const { repos, vaultRoot, duarte } = await plane(t);
  const run = await options(repos, vaultRoot, "2026-09-25T21:00:00.000Z", { promotionEnabled: true, openRecordClasses: ["candidate-enrichment"], openFields: { "candidate-enrichment": ["photo"] } });
  await projectCampaignSiteChains(repos, run.options);
  const d = (await readPipelineStates(repos)).find((s) => s.itemId === duarte.itemId)!;
  assert.equal(d.stage, "APPROVED_FOR_PROMOTION");
  assert.ok(!d.refused);
});

test("each saved page is read once per pass to find independent profiles; a page too old to count is never read", async t => {
  const { repos, vaultRoot, duarte } = await plane(t);
  /* Unrelated publishers: ten recent pages linking elsewhere, ten saved long before the read-age bound. */
  const unrelated: HeldRead[] = [];
  for (let i = 0; i < 20; i++) {
    const body = `<title>Directory ${i}</title><h1>Local listings</h1><a href="https://elsewhere-${i}.example/">Website</a>`;
    const retrievedAt = i < 10 ? "2026-09-24T12:00:00.000Z" : "2026-08-01T12:00:00.000Z";
    const page: HeldRead = { ...heldScoutPage, artifactId: `ar-unrelated-${i}`, attemptId: `at-unrelated-${i}`,
      canonicalUrl: `https://directory-${i}.example/listing`, body, sha256: sha256(body), retrievedAt };
    unrelated.push(page);
    await repos.artifacts.append(`held:${page.attemptId}`, page.artifactId, heldArtifactRecord(page), page.retrievedAt);
  }
  const run = await options(repos, vaultRoot, "2026-09-25T21:00:00.000Z");
  const reads = new Map<string, number>();
  const report = await projectCampaignSiteChains(repos, { ...run.options, heldPage: async artifact => {
    reads.set(artifact.artifactId, (reads.get(artifact.artifactId) ?? 0) + 1);
    const held = unrelated.find(page => page.artifactId === artifact.artifactId);
    return held ? { ...heldPageRead({ requestedUrl: held.canonicalUrl, httpStatus: 200, contentType: held.contentType,
      body: held.body, retrievedAt: held.retrievedAt, sha256: held.sha256 }), permissions: [] } : run.options.heldPage(artifact);
  } });
  assert.equal((await readPipelineStates(repos)).find(s => s.itemId === duarte.itemId)!.stage, "APPROVED_FOR_PROMOTION",
    JSON.stringify(report.offers.filter(o => o.itemId === duarte.itemId)));
  for (const page of unrelated.slice(0, 10)) assert.equal(reads.get(page.artifactId), 1, `${page.artifactId} is read once to index its links`);
  for (const page of unrelated.slice(10)) assert.equal(reads.get(page.artifactId), undefined, `${page.artifactId} is older than any read that can count`);
  assert.ok((reads.get(duarteProfile.artifactId) ?? 0) >= 2, "the profile linking to the campaign is indexed, then read again as support");
});
