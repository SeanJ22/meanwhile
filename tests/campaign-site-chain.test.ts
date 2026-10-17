import assert from "node:assert/strict";
import test from "node:test";

import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import type { ArtifactRecord } from "../lib/control-plane/repository/types.ts";
import { VERIFICATION_CHECKS, PROMOTION_PIPELINE_FORMAT_VERSION, type ScoutedRecord } from "../lib/control-plane/promotion/types.ts";
import { projectCampaignSiteChains, CAMPAIGN_SITE_RECORD_CLASS } from "../lib/control-plane/promotion/campaign-site-chain.ts";
import {
  readCampaignSiteLead,
  type CampaignSitePageRead,
} from "../lib/candidates/campaign-site-verifier.ts";
import { DUARTE, committedSubjects, fixture, servedRuntime, sha256 } from "./helpers/campaign-sites.ts";

const MEET = "https://www.duarte4mendham.com/meet-amalia";
const NOW = "2026-09-25T21:00:00.000Z";

function served() {
  return {
    "https://www.duarte4mendham.com/robots.txt": { status: 200, body: fixture("duarte4mendham.robots.txt") },
    [MEET]: { status: 200, body: fixture("duarte4mendham-meet-amalia.live.html") },
  };
}

function artifactFor(read: CampaignSitePageRead): ArtifactRecord {
  return {
    artifactId: "ar-duarte-meet-amalia", workItemId: "campaign-site:duarte", routeTaskId: null, attemptId: "at-duarte", tier: "RAW",
    contentHash: `sha256-${read.sha256}`, byteLength: Buffer.byteLength(read.body, "utf8"), contentType: read.contentType,
    canonicalUrl: read.finalUrl, partial: false, recordedAt: read.retrievedAt,
  };
}

async function readMeet(pages: ReturnType<typeof served>) {
  const runtime = servedRuntime(pages, NOW);
  const out = await readCampaignSiteLead({ url: MEET, origin: "RECORDED_SITE", ref: "test" }, runtime);
  assert.ok(out.ok, JSON.stringify(out));
  return { runtime, read: out.read };
}

async function checksFor(read: CampaignSitePageRead, subjects = new Map(committedSubjects())) {
  const repos = createMemoryRepositories(), itemId = "campaign-site-check:duarte";
  const scouted: ScoutedRecord = {
    formatVersion: PROMOTION_PIPELINE_FORMAT_VERSION, recordId: `${itemId}:scouted`, itemId, at: NOW,
    actor: { role: "SCOUT", lane: "BOUNDED_MODEL_WORKER", instance: "held-scout" }, stage: "SCOUTED",
    source: { kind: "SCOUT_RESULT", attemptId: "held-scout", obligationId: "campaign-site:duarte", outcome: "ROUTE_CANDIDATE", routeId: "campaign-page" },
    recordClass: CAMPAIGN_SITE_RECORD_CLASS, subjectId: DUARTE, canonicalUrl: MEET,
    artifactIds: [], scoutAttemptId: "held-scout", summary: "Campaign page lead",
  };
  await repos.promotionPipeline.append(itemId, scouted.recordId, scouted, NOW);
  await projectCampaignSiteChains(repos, { subjects, now: "2026-09-25T21:30:00.000Z", readLead: async () => ({ ok: true, read }),
    recordRead: async () => artifactFor(read), heldPage: async () => read });
  const records = await repos.promotionPipeline.read(itemId);
  const verified = records.map(row => row.stage === "REFUSED" ? row.offered : row).filter(row => row.stage === "VERIFIED");
  assert.equal(verified.length, 1);
  return verified[0].checks;
}

test("a candidate's own campaign page passes every measured campaign-site check", async () => {
  const { read } = await readMeet(served());
  assert.equal(read.sha256, sha256(fixture("duarte4mendham-meet-amalia.live.html")));
  const checks = await checksFor(read);
  assert.deepEqual(checks.map((c) => c.name).sort(), [...VERIFICATION_CHECKS].sort());
  assert.ok(checks.every((c) => c.result === "PASS"), JSON.stringify(checks));
});

test("omitting a middle given name never resolves a collision between full canonical names", async () => {
  const { read } = await readMeet(served());
  const subjects = new Map(committedSubjects());
  const original = subjects.get(DUARTE)!;
  const other = { ...original, candidacyId: "nj:2026:mendham:duarte-amalia-marie", givenName: "Amalia Marie" };
  subjects.set(other.candidacyId, other);
  const unique = (await checksFor(read, subjects)).find((c) => c.name === "CANONICAL_IDENTITY_UNIQUE")!;
  assert.equal(unique.result, "FAIL");
});

test("robots.txt is recorded, not a burden; an access control or an unread robots.txt still fails the class burden", async () => {
  const pages = { ...served(), "https://www.duarte4mendham.com/robots.txt": { status: 200, body: "User-agent: *\nDisallow: /\n" } };
  const { runtime, read } = await readMeet(pages);
  assert.ok(runtime.requests.indexOf("https://www.duarte4mendham.com/robots.txt") < runtime.requests.indexOf(MEET), "robots.txt is read before the page");
  const burdenOf = async (page: CampaignSitePageRead) => (await checksFor(page)).find((c) => c.name === "ASSERTION_CLASS_BURDENS")!;
  const burdens = await burdenOf(read);
  assert.equal(burdens.result, "PASS");
  assert.match(burdens.detail, /robots\.txt read first and recorded \(https:\/\/www\.duarte4mendham\.com DISALLOWED; evidence, not a gate\)/);

  assert.match((await burdenOf({ ...read, permissions: [] })).detail, /no robots reading is recorded for the read/);
  const challengedBody = `<html><head><title>Just a moment...</title></head>${read.body}</html>`;
  const challenged = await burdenOf({ ...read, body: challengedBody, sha256: sha256(challengedBody) });
  assert.equal(challenged.result, "FAIL");
  assert.match(challenged.detail, /an access control answered in place of the page \(a bot challenge/);
});
