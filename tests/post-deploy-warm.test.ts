import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { PUBLIC_SITE_ORIGIN } from "../lib/ops/origins.ts";
import {
  deployToWarm,
  type WarmPlace,
  POST_DEPLOY_WARM_MARKER,
  readerMeetingsPath,
  warmAfterDeploy,
} from "../lib/ops/post-deploy-warm.ts";
import { handleDeploySucceeded } from "../netlify/functions/deploy-succeeded.mts";

/** A new deploy is warmed and its place answers are in the CDN before a reader asks. The plan is pure. */

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

/** Places as the live site's manifest would name them: none of them a pilot, none listed in code. */
const PLACES: readonly WarmPlace[] = [
  { zip: "85635", lat: 31.4, lng: -110.3 },
  { zip: "43015", lat: 40.3, lng: -83.1 },
  { zip: "59701", lat: 46.0, lng: -112.5 },
];

test("POST-DEPLOY · each fill asks exactly what the map asks, so it fills the object a reader will hit", () => {
  // The map's own request, whose query the CDN keys on exactly (`Netlify-Vary: query`).
  const map = readFileSync("components/map/map-entry.tsx", "utf8");
  assert.ok(map.includes("`/api/meetings?lat=${lat}&lng=${lng}${zipParam}${radiusParam}`"), "the map's request shape changed; change readerMeetingsPath with it");
  assert.ok(map.includes('const zipParam = zip ? `&zip=${zip}` : "";'));
  assert.equal(readerMeetingsPath(PLACES[0]), "/api/meetings?lat=31.4&lng=-110.3&zip=85635");
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

test("POST-DEPLOY · it waits for production to serve the commit, then warms the instances and fills and rereads every published place", async () => {
  let clock = 0;
  let builds = 0;
  const production = fakeProduction(() => (++builds < 3 ? OLD : COMMIT));
  let warmCalls = 0;
  const result = await warmAfterDeploy({ commit: COMMIT, deployId: "d1" }, {
    fetchImpl: production.fetchImpl,
    now: () => clock,
    sleep: async (ms) => { clock += ms; },
    warmCalls: async () => { warmCalls += 1; return { answered: 14, ms: 900 }; },
    places: async () => PLACES,
  });
  assert.equal(result.outcome, "WARMED");
  if (result.outcome !== "WARMED") return;
  assert.equal(builds, 3, "it asked /api/build until the new commit was served");
  assert.equal(result.waitedMs, 4_000);
  assert.equal(warmCalls, 1, "the pinger's fourteen marked calls, once");
  const pilots = PLACES.map((point) => `${PUBLIC_SITE_ORIGIN}${readerMeetingsPath(point)}`);
  const meetingsCalls = production.calls.filter((call) => call.url.includes("/api/meetings"));
  assert.deepEqual(meetingsCalls.map((call) => call.url).sort(), [...pilots, ...pilots].sort(), "each place filled, then read back");
  assert.equal(result.places, PLACES.length);
  assert.ok(production.calls.every((call) => call.marker === POST_DEPLOY_WARM_MARKER), "every request is marked synthetic");
  assert.deepEqual(result.fills.map((read) => read.status), [200, 200, 200]);
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
    places: async () => PLACES,
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

test("POST-DEPLOY · without a places list it asks the live site for one per published county, and a place past the budget is skipped, not read", async () => {
  let clock = 0;
  const production = fakeProduction(() => COMMIT);
  const asked: string[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    asked.push(url);
    if (url.includes("/api/warm?places=1")) {
      assert.equal(new Headers(init?.headers).get("x-wtp-synthetic-run"), "keep-warm");
      return Response.json({ places: PLACES, skipped: 0 });
    }
    return production.fetchImpl(input, init);
  }) as typeof fetch;
  const result = await warmAfterDeploy({ commit: COMMIT, deployId: "d1" }, {
    fetchImpl, now: () => clock, sleep: async (ms) => { clock += ms; }, warmCalls: async () => ({ answered: 14, ms: 1 }) });
  assert.equal(result.outcome, "WARMED");
  if (result.outcome !== "WARMED") return;
  assert.equal(result.places, PLACES.length);
  assert.ok(asked.some((url) => url.includes("zip=43015")), "a ZIP that is in no list in code is filled");

  const late = await warmAfterDeploy({ commit: COMMIT, deployId: "d1" }, {
    fetchImpl: production.fetchImpl, now: () => clock, sleep: async (ms) => { clock += ms; }, warmCalls: async () => ({ answered: 14, ms: 1 }),
    places: async () => PLACES, fillBudgetMs: -1 });
  assert.equal(late.outcome, "WARMED");
  if (late.outcome === "WARMED") assert.ok(late.fills.every((read) => read.status === "SKIPPED"));
});
