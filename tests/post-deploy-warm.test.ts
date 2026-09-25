import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { lookupZcta } from "../lib/geo/zcta.ts";
import { PUBLIC_SITE_ORIGIN } from "../lib/ops/origins.ts";
import {
  deployToWarm,
  PILOT_ZIP_POINTS,
  POST_DEPLOY_WARM_MARKER,
  readerMeetingsPath,
  warmAfterDeploy,
} from "../lib/ops/post-deploy-warm.ts";
import { handleDeploySucceeded } from "../netlify/functions/deploy-succeeded.mts";

/**
 * **A NEW DEPLOY IS WARMED AND ITS PILOT ANSWERS ARE IN THE CDN BEFORE A
 * READER ASKS.** (C21, 2026-09-25.) The plan is pure; no live calls.
 */

const COMMIT = "a".repeat(40);
const OLD = "b".repeat(40);

test("POST-DEPLOY · only a production deploy with a commit is warmed", () => {
  assert.deepEqual(deployToWarm({ payload: { context: "production", commit_ref: COMMIT, id: "d1" } }), { commit: COMMIT, deployId: "d1" });
  assert.deepEqual(deployToWarm({ deploy: { context: "production", commitRef: COMMIT, id: "d2" } }), { commit: COMMIT, deployId: "d2" }, "the typed-handler shape too");
  for (const body of [
    { payload: { context: "branch-deploy", commit_ref: COMMIT, id: "d" } },
    { payload: { context: "deploy-preview", commit_ref: COMMIT, id: "d" } },
    { payload: { context: "production", id: "d" } },
    { payload: { context: "production", commit_ref: "HEAD; rm -rf", id: "d" } },
    null,
    "production",
  ]) assert.equal(deployToWarm(body), null, JSON.stringify(body));
});

test("POST-DEPLOY · each pilot fill asks exactly what the map asks, so it fills the object a reader will hit", () => {
  for (const point of PILOT_ZIP_POINTS) {
    const centroid = lookupZcta(point.zip);
    assert.deepEqual([point.lat, point.lng], [centroid?.lat, centroid?.lng], `${point.zip} is not the centroid the map sends`);
  }
  assert.deepEqual(PILOT_ZIP_POINTS.map((p) => p.zip), ["85701", "85201", "07866", "03255", "86001"]);
  // The map's own request, whose query the CDN keys on exactly (`Netlify-Vary: query`).
  const map = readFileSync("components/map/map-entry.tsx", "utf8");
  assert.ok(map.includes("`/api/meetings?lat=${lat}&lng=${lng}${zipParam}${radiusParam}`"), "the map's request shape changed; change readerMeetingsPath with it");
  assert.ok(map.includes('const zipParam = zip ? `&zip=${zip}` : "";'));
  assert.equal(readerMeetingsPath(PILOT_ZIP_POINTS[0]), "/api/meetings?lat=32.21696&lng=-110.971&zip=85701");
});

/** A fake production: `/api/build` serves `served()`, every other request answers 200 and is recorded. */
function fakeProduction(served: () => string) {
  const calls: { url: string; marker: string | null }[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, marker: new Headers(init?.headers).get("x-wtp-synthetic-run") });
    if (url.endsWith("/api/build")) return Response.json({ commit: served() });
    const hits = calls.filter((call) => call.url === url).length;
    return new Response("{}", { status: 200, headers: { "cache-status": hits > 1 ? '"Netlify Edge"; hit' : '"Netlify Edge"; fwd=miss' } });
  }) as typeof fetch;
  return { calls, fetchImpl };
}

test("POST-DEPLOY · it waits for production to serve the commit, then warms the instances and fills and rereads every pilot", async () => {
  let clock = 0;
  let builds = 0;
  const production = fakeProduction(() => (++builds < 3 ? OLD : COMMIT));
  let warmCalls = 0;
  const result = await warmAfterDeploy({ commit: COMMIT, deployId: "d1" }, {
    fetchImpl: production.fetchImpl,
    now: () => clock,
    sleep: async (ms) => { clock += ms; },
    warmCalls: async () => { warmCalls += 1; return { answered: 14, ms: 900 }; },
  });
  assert.equal(result.outcome, "WARMED");
  if (result.outcome !== "WARMED") return;
  assert.equal(builds, 3, "it asked /api/build until the new commit was served");
  assert.equal(result.waitedMs, 4_000);
  assert.equal(warmCalls, 1, "the pinger's fourteen marked calls, once");
  const pilots = PILOT_ZIP_POINTS.map((point) => `${PUBLIC_SITE_ORIGIN}${readerMeetingsPath(point)}`);
  const meetingsCalls = production.calls.filter((call) => call.url.includes("/api/meetings"));
  assert.deepEqual(meetingsCalls.map((call) => call.url), [...pilots, ...pilots], "each pilot filled, then read back");
  assert.ok(production.calls.every((call) => call.marker === POST_DEPLOY_WARM_MARKER), "every request is marked synthetic");
  assert.deepEqual(result.fills.map((read) => read.status), [200, 200, 200, 200, 200]);
  assert.ok(result.rereads.every((read) => read.cacheStatus?.includes("hit")), "the reread records whether the CDN answered");
});

test("POST-DEPLOY · a deploy that never becomes the served one is reported, and nothing is warmed for it", async () => {
  let clock = 0;
  const production = fakeProduction(() => OLD);
  let warmCalls = 0;
  const result = await warmAfterDeploy({ commit: COMMIT, deployId: "d1" }, {
    fetchImpl: production.fetchImpl,
    now: () => clock,
    sleep: async (ms) => { clock += ms; },
    serveDeadlineMs: 10_000,
    warmCalls: async () => { warmCalls += 1; return { answered: 14, ms: 1 }; },
  });
  assert.equal(result.outcome, "NOT_SERVED");
  assert.ok(result.waitedMs <= 10_000);
  assert.equal(warmCalls, 0);
  assert.ok(production.calls.every((call) => call.url.endsWith("/api/build")), "no fill for a deploy that is not serving");
});

test("POST-DEPLOY · the deploy-succeeded function acts once per production commit and ignores every other event", async () => {
  const warmed: string[] = [];
  const warm = async (deploy: { commit: string }) => {
    warmed.push(deploy.commit);
    return { outcome: "NOT_SERVED" as const, commit: deploy.commit, waitedMs: 0 };
  };
  const event = (context: string, commit: string) =>
    new Request("https://example.test/.netlify/functions/deploy-succeeded", { method: "POST", body: JSON.stringify({ payload: { context, commit_ref: commit, id: "d" } }) });
  assert.equal((await handleDeploySucceeded(event("branch-deploy", COMMIT), warm)).acted, false);
  assert.equal((await handleDeploySucceeded(new Request("https://example.test/", { method: "POST", body: "not json" }), warm)).acted, false);
  assert.equal((await handleDeploySucceeded(event("production", COMMIT), warm)).acted, true);
  assert.equal((await handleDeploySucceeded(event("production", COMMIT), warm)).acted, false, "a repeated or forged event for the same commit does nothing");
  assert.deepEqual(warmed, [COMMIT]);
});
