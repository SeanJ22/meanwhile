/**
 * Held research findings, replayed read-only from real held records (see
 * tests/fixtures/campaign-sites/provenance.json): held finding → verified /
 * refused counts → the would-be published candidate-profiles version.
 * OFFLINE judges held bytes and never writes a door package; LIVE runs the
 * complete chain over robots-first reads (served here) and its package enters
 * the one civic-data door, carrying the prior version forward.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { replayResearchFindings, type HeldRead, type HeldScoutFinding } from "../lib/candidates/research-findings-replay.ts";
import type { HeldMarginaliaResponse } from "../lib/control-plane/promotion/campaign-site-chain.ts";
import { districtForms } from "../lib/candidates/campaign-site-verifier.ts";
import { readActivationGate } from "../lib/control-plane/promotion/activation-gate.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { manualProjectionCandidate, readManualProjectionPrior, type CandidateProfilesProjection } from "../lib/civic-data/manual-projections.ts";
import { prepareManualProjectionSuccessor } from "../lib/civic-data/manual-successor.ts";
import { processRegisteredManualCandidate } from "../lib/civic-data/promotion.ts";
import { CHIPPERSON, DUARTE, KAPNER, TANG_WILLIAMS, committedSubjects, fixture, servedRuntime, sha256 } from "./helpers/campaign-sites.ts";

const MEET = "https://www.duarte4mendham.com/meet-amalia";
const CHIP = "https://www.chippersonforharding.com/";
const KAPNER_ROOT = "https://www.kapner4mendhamtwp.com/";
const LILY = "https://www.lilytangwilliams.com/congress/endorsements/";
const ALTHOFF = "nj:2026:state-nj-place-mendham:member-of-the-borough-council:althoff-marilyn";
const DUARTE_KEY = "ballot-nj-morris:mendham-township-member-of-the-township-committee-place-mendham-township:duarte-amalia";
const CHIPPERSON_KEY = "ballot-nj-morris:harding-township-member-of-the-township-committee-place-harding-township:chipperson-rita-c";
const MAYES_KEY = "ballot-az-pima:attorney-general:mayes-kris";

function heldPage(artifactId: string, attemptId: string, url: string, file: string, at: string): HeldRead {
  const body = fixture(file);
  return { artifactId, attemptId, canonicalUrl: url, contentType: "text/html; charset=utf-8", httpStatus: 200, retrievedAt: at, body, sha256: sha256(body), methodRouteId: "scout:fetch_public", permission: "ALLOWED" };
}

const held: HeldRead[] = [
  heldPage("ar-held-duarte", "at-scout-duarte", MEET, "duarte4mendham-meet-amalia.held.html", "2026-09-21T02:23:01.279Z"),
  heldPage("ar-held-chipperson", "at-scout-chipperson", CHIP, "chippersonforharding-root.held.html", "2026-09-20T18:53:43.604Z"),
];
// Synthetic independent profiles exercise the source agreement; the campaign
// pages above remain the separately captured fixture bytes being verified.
const profiles = [[DUARTE, MEET], [CHIPPERSON, CHIP]].map(([id, url]): HeldRead => {
  const subject = committedSubjects().get(id!)!;
  const artifactId = `ar-profile-${subject.familyName.toLowerCase()}`;
  const body = `<title>${subject.givenName} ${subject.familyName} | Candidate profile</title><h1>${subject.givenName} ${subject.familyName}</h1>
    <p>Candidate for ${subject.officeTitle} in the 2026 General Election. ${districtForms(subject).join(" ")}</p><a href="${url}">Website</a>`;
  return { ...held[0]!, artifactId, attemptId: `at-${artifactId}`, canonicalUrl: `https://independent.example/${artifactId}`,
    body, sha256: sha256(body), retrievedAt: "2026-09-24T10:00:00.000Z" };
});
const finding = (attemptId: string, subjectId: string, artifactIds: string[], canonicalUrl: string | null, at: string): HeldScoutFinding => ({
  attemptId, obligationId: `freshness:candidate-enrichment:${subjectId}#candidate-authored-awaits-site`, subjectId,
  outcome: canonicalUrl === null ? "EVIDENCE_FOUND" : "ROUTE_CANDIDATE", routeId: canonicalUrl === null ? null : "campaign-site",
  canonicalUrl, artifactIds, recordedAt: at, summary: "held finding",
});
const findings: HeldScoutFinding[] = [
  finding("at-scout-duarte", DUARTE, ["ar-held-duarte"], null, "2026-09-21T02:23:01.279Z"),
  finding("at-scout-chipperson", CHIPPERSON, ["ar-held-chipperson"], null, "2026-09-20T18:53:43.604Z"),
  finding("at-scout-kapner", KAPNER, [], KAPNER_ROOT, "2026-09-21T02:23:09.992Z"),
];
const marginalia: HeldMarginaliaResponse[] = [
  { subjectId: TANG_WILLIAMS, artifactId: "ar-marginalia-lily", attemptId: "at-marginalia-lily", retrievedAt: "2026-09-24T01:00:00.000Z", body: fixture("marginalia-tang-williams-lily.json") },
  { subjectId: ALTHOFF, artifactId: "ar-marginalia-althoff", attemptId: "at-marginalia-althoff", retrievedAt: "2026-09-25T01:35:59.350Z", body: fixture("marginalia-althoff-marilyn.json") },
];

test("OFFLINE: held findings are judged on held bytes; unread leads stay owed; the would-be links are named, never packaged", async () => {
  const report = await replayResearchFindings({ subjects: committedSubjects(), findings, held, marginalia, prior: null, gate: readActivationGate("."), now: "2026-09-24T12:00:00.000Z" });
  assert.equal(report.mode, "OFFLINE");
  assert.equal(report.plan, null, "OFFLINE never writes a door-shaped package");
  assert.equal(report.counts.VERIFIED, 2);
  assert.ok(report.leads.some((l) => l.url === KAPNER_ROOT && l.outcome === "NOT_READ"), "a lead the vault holds no bytes for is owed, not refused");
  assert.ok(report.leads.filter((l) => l.origin === "MARGINALIA_POINTER" && l.outcome === "NOT_READ").every((l) => l.url.includes("lilytangwilliams.com")));
  assert.ok((report.counts.AGGREGATOR ?? 0) >= 1 && (report.counts.NOT_A_PAGE ?? 0) >= 1);
  assert.deepEqual(report.wouldPublish.map((w) => w.key).sort(), [CHIPPERSON_KEY, DUARTE_KEY].sort());
  const althoff = report.marginalia.find((m) => m.subjectId === ALTHOFF)!;
  assert.deepEqual([althoff.resultUrls, althoff.noHit, althoff.candidateBrandedLeads.length], [2, false, 0]);
  const lily = report.marginalia.find((m) => m.subjectId === TANG_WILLIAMS)!;
  assert.ok(lily.candidateBrandedLeads.includes(LILY));
});

test("LIVE: independent profiles and verified campaign bytes reach the door as a validated successor", async (t) => {
  const vaultRoot = mkdtempSync(join(tmpdir(), "wtp-replay-live-"));
  t.after(() => rmSync(vaultRoot, { recursive: true, force: true, maxRetries: 3 }));
  const store = new MemoryRoutineDataStore();
  const T0 = "2026-09-20T12:00:00.000Z";
  const first = manualProjectionCandidate({
    contractId: "candidate-profiles", version: T0, sourceThrough: T0,
    sourceReceipt: { contractVersion: 1, reviewedAt: T0, reviewedBy: "owner-test", sources: [{ requestedUrl: "https://www.krismayes.com", finalUrl: "https://www.krismayes.com",
      publisher: "krismayes.com", sourceClass: "CANDIDATE_CONTROLLED", retrievedAt: T0, httpStatus: 200, rawHash: "a".repeat(64), reviewedEvidence: "Exact bytes reviewed." }] },
    payload: { cards: { curatedAt: "2026-09-08", note: "cards", cards: {}, hunts: [] },
      links: { curatedAt: "2026-09-08", note: "links", hunts: [],
        links: { [MAYES_KEY]: { official: null, campaign: { url: "https://www.krismayes.com", verification: "Fetched 2026-08-13.", attemptedAt: "2026-08-13" } } } } } satisfies CandidateProfilesProjection,
  });
  await processRegisteredManualCandidate(store, "candidate-profiles", first, T0, null);
  const now = "2026-09-24T12:00:00.000Z";
  const prior = await readManualProjectionPrior("candidate-profiles", store, now);
  const runtime = servedRuntime({
    "https://www.duarte4mendham.com/robots.txt": { status: 200, body: fixture("duarte4mendham.robots.txt") },
    [MEET]: { status: 200, body: fixture("duarte4mendham-meet-amalia.live.html") },
    "https://www.chippersonforharding.com/robots.txt": { status: 200, body: fixture("chippersonforharding.robots.txt") },
    [CHIP]: { status: 200, body: fixture("chippersonforharding-root.live.html") },
    "https://www.kapner4mendhamtwp.com/robots.txt": { status: 200, body: fixture("kapner4mendhamtwp.robots.txt") },
    [KAPNER_ROOT]: { status: 200, body: fixture("kapner4mendhamtwp-root.live.html") },
    "https://www.lilytangwilliams.com/robots.txt": { status: 200, body: fixture("lilytangwilliams.robots.txt") },
    [LILY]: { status: 200, body: fixture("lilytangwilliams-endorsements.live.html") },
  }, "2026-09-24T11:00:00.000Z");
  const report = await replayResearchFindings({ subjects: committedSubjects(), findings, held: [...held, ...profiles], marginalia, prior, gate: readActivationGate("."), now,
    live: { runtime, vaultRoot, methodVersion: 1 } });
  assert.equal(report.mode, "LIVE");
  assert.deepEqual(report.chain!.approved.map((a) => a.campaignSite.candidacyId).sort(), [CHIPPERSON, DUARTE, TANG_WILLIAMS].sort());
  assert.equal(report.chain!.byStage.APPROVED_FOR_PROMOTION, 3, "CP-12: the campaign page proves identity without a second source");
  assert.ok(report.leads.some((l) => l.url === KAPNER_ROOT && l.codes.includes("CYCLE_NOT_EVIDENCED")));
  assert.ok(runtime.requests.every((url, i) => !url.endsWith("robots.txt") || runtime.requests.indexOf(url) === i), "each origin's robots.txt is read once");
  const lily = report.wouldPublish.find(w => w.candidacyId === TANG_WILLIAMS)!;
  assert.equal(lily.url, LILY);
  assert.deepEqual(report.wouldPublish.map((w) => w.key).sort(), [CHIPPERSON_KEY, DUARTE_KEY, lily.key].sort());

  const { candidate, expectedBaseVersionId } = await prepareManualProjectionSuccessor(report.plan!.package!, store, now);
  const outcome = await processRegisteredManualCandidate(store, "candidate-profiles", candidate, now, expectedBaseVersionId);
  assert.equal(outcome.candidate.state, "PROMOTED", JSON.stringify(outcome.candidate.receipt?.checks.filter((c) => c.verdict !== "PASS")));
  const payload = outcome.promoted!.payload as CandidateProfilesProjection;
  assert.equal(payload.links.links[DUARTE_KEY]?.campaign?.url, MEET);
  assert.equal(payload.links.links[CHIPPERSON_KEY]?.campaign?.url, CHIP);
  assert.equal(payload.links.links[MAYES_KEY]?.campaign?.url, "https://www.krismayes.com", "the prior version is carried forward");
  assert.equal(payload.links.links[lily.key]?.campaign?.url, LILY);
  assert.deepEqual(outcome.candidate.candidate.changeSet?.added.map((r) => r.key).sort(), [`links:${CHIPPERSON_KEY}`, `links:${DUARTE_KEY}`, `links:${lily.key}`].sort());
});

/* Owner decision 2026-09-25: "Robots.txt alone must not block acquisition." A robots verdict held with a read is evidence, never a refusal. */
test("ROBOTS IS RECORDED, NOT BLOCKING: held reads recorded under a disallowing robots.txt verify offline and approve live, exactly as allowed ones", async (t) => {
  const disallowed = held.map((h) => ({ ...h, permission: "DISALLOWED" }));
  const robots: HeldRead = { artifactId: "ar-held-duarte-robots", attemptId: "at-scout-duarte", canonicalUrl: "https://www.duarte4mendham.com/robots.txt", contentType: "text/plain",
    httpStatus: 200, retrievedAt: "2026-09-21T02:23:00.000Z", body: "User-agent: *\nDisallow: /\n", sha256: sha256("User-agent: *\nDisallow: /\n"), methodRouteId: "scout:fetch_public", permission: null };
  const offline = await replayResearchFindings({ subjects: committedSubjects(), findings, held: [...disallowed, robots], marginalia, prior: null, gate: readActivationGate("."), now: "2026-09-24T12:00:00.000Z" });
  assert.equal(offline.counts.VERIFIED, 2);
  assert.equal(offline.counts.ROBOTS_REFUSED ?? 0, 0);
  assert.deepEqual(offline.wouldPublish.map((w) => w.key).sort(), [CHIPPERSON_KEY, DUARTE_KEY].sort());

  const vaultRoot = mkdtempSync(join(tmpdir(), "wtp-replay-robots-"));
  t.after(() => rmSync(vaultRoot, { recursive: true, force: true, maxRetries: 3 }));
  const runtime = servedRuntime({
    "https://www.duarte4mendham.com/robots.txt": { status: 200, body: "User-agent: *\nDisallow: /\n" },
    [MEET]: { status: 200, body: fixture("duarte4mendham-meet-amalia.live.html") },
    "https://www.chippersonforharding.com/robots.txt": { status: 200, body: "User-agent: *\nDisallow: /\n" },
    [CHIP]: { status: 200, body: fixture("chippersonforharding-root.live.html") },
  }, "2026-09-24T11:00:00.000Z");
  const live = await replayResearchFindings({ subjects: committedSubjects(), findings, held: [...disallowed, ...profiles], marginalia: [], prior: null, gate: readActivationGate("."), now: "2026-09-24T12:00:00.000Z",
    live: { runtime, vaultRoot, methodVersion: 1 } });
  assert.ok(runtime.requests.includes(MEET) && runtime.requests.includes(CHIP), "the public pages are read over the robots.txt");
  assert.deepEqual(live.chain!.approved.map((a) => a.campaignSite.candidacyId).sort(), [CHIPPERSON, DUARTE].sort());
});
