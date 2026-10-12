import assert from "node:assert/strict";
import test from "node:test";

import type { ArtifactRecord } from "../lib/control-plane/repository/types.ts";
import { VERIFICATION_CHECKS } from "../lib/control-plane/promotion/types.ts";
import { campaignSiteChecks } from "../lib/control-plane/promotion/campaign-site-chain.ts";
import {
  readCampaignSiteLead,
  verifyCampaignSitePage,
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

function checksFor(read: CampaignSitePageRead, subjects = committedSubjects()) {
  const subject = subjects.get(DUARTE)!;
  const verdict = verifyCampaignSitePage(subject, { url: MEET, origin: "RECORDED_SITE", ref: "test" }, read);
  return campaignSiteChecks({ subject, verdict, read, artifact: artifactFor(read), subjects, now: "2026-09-25T21:30:00.000Z" });
}

test("a candidate's own campaign page passes every measured campaign-site check", async () => {
  const { read } = await readMeet(served());
  assert.equal(read.sha256, sha256(fixture("duarte4mendham-meet-amalia.live.html")));
  const checks = checksFor(read);
  assert.deepEqual(checks.map((c) => c.name).sort(), [...VERIFICATION_CHECKS].sort());
  assert.ok(checks.every((c) => c.result === "PASS"), JSON.stringify(checks));
});

test("omitting a middle given name never resolves a collision between full canonical names", async () => {
  const { read } = await readMeet(served());
  const subjects = committedSubjects();
  const original = subjects.get(DUARTE)!;
  const other = { ...original, candidacyId: "nj:2026:mendham:duarte-amalia-marie", givenName: "Amalia Marie" };
  subjects.set(other.candidacyId, other);
  const unique = checksFor(read, subjects).find((c) => c.name === "CANONICAL_IDENTITY_UNIQUE")!;
  assert.equal(unique.result, "FAIL");
});

test("robots.txt is recorded, not a burden; an access control or an unread robots.txt still fails the class burden", async () => {
  const pages = { ...served(), "https://www.duarte4mendham.com/robots.txt": { status: 200, body: "User-agent: *\nDisallow: /\n" } };
  const { runtime, read } = await readMeet(pages);
  assert.ok(runtime.requests.indexOf("https://www.duarte4mendham.com/robots.txt") < runtime.requests.indexOf(MEET), "robots.txt is read before the page");
  const burdenOf = (page: CampaignSitePageRead) => checksFor(page).find((c) => c.name === "ASSERTION_CLASS_BURDENS")!;
  const burdens = burdenOf(read);
  assert.equal(burdens.result, "PASS");
  assert.match(burdens.detail, /robots\.txt read first and recorded \(https:\/\/www\.duarte4mendham\.com DISALLOWED; evidence, not a gate\)/);

  assert.match(burdenOf({ ...read, permissions: [] }).detail, /no robots reading is recorded for the read/);
  const challengedBody = `<html><head><title>Just a moment...</title></head>${read.body}</html>`;
  const challenged = burdenOf({ ...read, body: challengedBody, sha256: sha256(challengedBody) });
  assert.equal(challenged.result, "FAIL");
  assert.match(challenged.detail, /an access control answered in place of the page \(a bot challenge/);
});
