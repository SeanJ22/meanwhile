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
  const states = new Map((await readPipelineStates(repos)).map((s) => [s.itemId, s]));

  const d = states.get(duarte.itemId)!;
  assert.equal(d.stage, "APPROVED_FOR_PROMOTION", JSON.stringify(report.offers.filter((o) => o.itemId === duarte.itemId)));
  assert.equal(d.byStage.CONFIRMED!.basis, "SECOND_ROUTE", "the finding named no URL, so our read confirms it as a second route");
  assert.notEqual(d.byStage.CONFIRMED!.actor.instance, SCOUT_ATTEMPT);
  assert.equal(d.byStage.VERIFIED!.checks.length, VERIFICATION_CHECKS.length);
  assert.ok(d.byStage.VERIFIED!.checks.every((c) => c.result === "PASS"), JSON.stringify(d.byStage.VERIFIED!.checks));
  const audited = d.byStage.AUDITED!;
  assert.ok(audited.survived && audited.startedFrom.includes("EVIDENCE_VAULT"));
  assert.ok(audited.findings.some((f) => f.startsWith("INDEPENDENT_PROFILE: ar-profile-duarte")), audited.findings.join(" | "));
  assert.ok(audited.controls !== null && audited.controls.recall === 1 && audited.controls.falsePresences === 0 && audited.controls.knownAbsenceCount === 2);
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

  /* A Marginalia pointer: read and verified, then held at VERIFIED — no second signal yet. */
  const pointer = states.get(discoveryPointerItemId(TANG_WILLIAMS, LILY))!;
  assert.equal(pointer.byStage.SCOUTED!.source.kind, "DISCOVERY_POINTER");
  assert.equal(pointer.byStage.CONFIRMED!.basis, "SECOND_ACQUISITION");
  assert.equal(pointer.stage, "VERIFIED");
  assert.deepEqual(pointer.refused?.reasons.map((r) => r.code), ["AUDIT_DID_NOT_SURVIVE"]);
  assert.match(pointer.refused!.reasons[0]!.detail, /NO_INDEPENDENT_SECOND_SIGNAL/);
  assert.ok(report.leads.some((l) => l.lead.origin === "MARGINALIA_POINTER" && l.outcome === "REFUSED" && l.refusals[0]?.code === "AGGREGATOR"));

  /* More clocks on the same page do not add an independent source. */
  const later = await options(repos, vaultRoot, "2026-09-25T23:00:00.000Z");
  const noSource = await projectCampaignSiteChains(repos, later.options);
  assert.equal((await readPipelineStates(repos)).find(s => s.itemId === pointer.itemId)!.stage, "VERIFIED");
  assert.equal(noSource.rereadsUsed, 0);
  await repos.artifacts.append(`held:${lilyProfile.attemptId}`, lilyProfile.artifactId, heldArtifactRecord(lilyProfile), lilyProfile.retrievedAt);
  const second = await projectCampaignSiteChains(repos, later.options);
  const after = (await readPipelineStates(repos)).find((s) => s.itemId === pointer.itemId)!;
  assert.equal(after.stage, "APPROVED_FOR_PROMOTION", JSON.stringify(second.offers.filter((o) => o.itemId === pointer.itemId)));
  assert.ok(after.byStage.AUDITED!.startedFrom.includes("EVIDENCE_VAULT"));
  assert.ok(after.byStage.AUDITED!.findings.some((f) => /^INDEPENDENT_PROFILE: ar-profile-lily/.test(f)));
  assert.equal(second.approved.length, 2);
  /* Re-running offers nothing new for an approved item. */
  const third = await projectCampaignSiteChains(repos, (await options(repos, vaultRoot, "2026-09-25T23:30:00.000Z")).options);
  assert.ok(third.offers.filter((o) => o.itemId === duarte.itemId).length === 0);
});

test("an unchanged digest label cannot certify profile bytes that do not match the saved artifact", async t => {
  const { repos, vaultRoot, duarte } = await plane(t);
  const run = await options(repos, vaultRoot, "2026-09-25T21:00:00.000Z");
  const report = await projectCampaignSiteChains(repos, { ...run.options, heldPage: async artifact => {
    const page = await run.options.heldPage(artifact);
    return artifact.artifactId === duarteProfile.artifactId && page
      ? { ...page, body: `${page.body}<p>Altered bytes.</p>` } : page;
  } });
  assert.equal((await readPipelineStates(repos)).find(s => s.itemId === duarte.itemId)!.stage, "VERIFIED");
  assert.equal(report.approved.length, 0);
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

test("with the gate closed (the state before this change) nothing is approved: the class burden refuses", async (t) => {
  const { repos, vaultRoot, duarte } = await plane(t);
  const run = await options(repos, vaultRoot, "2026-09-25T21:00:00.000Z", { promotionEnabled: false, openRecordClasses: [] });
  const report = await projectCampaignSiteChains(repos, run.options);
  const d = (await readPipelineStates(repos)).find((s) => s.itemId === duarte.itemId)!;
  assert.equal(d.stage, "AUDITED");
  assert.equal(d.refused?.atStage, "APPROVED_FOR_PROMOTION");
  assert.ok(d.refused!.reasons.some((r) => r.code === "APPROVAL_BURDEN_FAILED" && /RECORD_CLASS_CANDIDATE/.test(r.detail)));
  assert.equal(report.approved.length, 0);
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

test("a class opened for another field does not approve a campaign site", async (t) => {
  const { repos, vaultRoot, duarte } = await plane(t);
  const run = await options(repos, vaultRoot, "2026-09-25T21:00:00.000Z", { promotionEnabled: true, openRecordClasses: ["candidate-enrichment"], openFields: { "candidate-enrichment": ["photo"] } });
  await projectCampaignSiteChains(repos, run.options);
  const d = (await readPipelineStates(repos)).find((s) => s.itemId === duarte.itemId)!;
  assert.notEqual(d.stage, "APPROVED_FOR_PROMOTION");
  assert.ok(d.refused!.reasons.some((r) => /candidate-enrichment\.campaignSite is not open/.test(r.detail)));
});
