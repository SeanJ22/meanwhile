import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { build } from "esbuild";
import handler, { config } from "../netlify/functions/reader-election-results.mts";
import { nativeResultFeedScope, nativeResultFeedStore } from "../lib/election-results/feed-store.ts";
import type { StateResultFeed } from "../lib/election-results/feed-types.ts";
import { ADMIN_ORIGIN, PUBLIC_SITE_ORIGIN } from "../lib/ops/origins.ts";
import { electionFeedFixture, preserveFeedEnvironment } from "./helpers/election-feed-fixture.ts";

const at = "2026-11-08T02:00:00.000Z";
const nation = { checkedAt: at, states: {}, sources: [] };
const state: StateResultFeed = { formatVersion: 1, state: "AZ", ballotVersion: "test-copy-v1", checkedAt: at, fingerprint: "test-copy-result-v1",
  facts: { contest: { status: "called" }, candidate: { votes: 120, won: true }, unrelated: { status: "counting" } },
  contestIds: { contest: ["contest", "candidate"] } };

test("the native results Function serves GET and POST from one prepared blob and never serves the Admin host", async context => {
  const { store, reads } = electionFeedFixture(context);
  await store.writeNation(nation); await store.writeState("AZ", state);
  const deployment = { deploy: { context: "production" } };
  assert.deepEqual(config, { path: "/api/election-results", method: ["GET", "POST"] });
  const national = await handler(new Request(`${PUBLIC_SITE_ORIGIN}/api/election-results`), deployment);
  assert.equal(national.status, 200);
  assert.equal(national.headers.get("x-wtp-reader-runtime"), "native");
  assert.equal(national.headers.get("x-robots-tag"), "noindex, nofollow, noarchive");
  assert.deepEqual(await national.json(), { available: true, ...nation });
  assert.deepEqual(reads, ["nation.json"]);
  const get = await handler(new Request(`${PUBLIC_SITE_ORIGIN}/api/election-results?state=AZ&contests=contest`), deployment);
  const selected = await get.json();
  assert.deepEqual(Object.keys(selected.facts).sort(), ["candidate", "contest"]);
  const post = await handler(new Request(`${PUBLIC_SITE_ORIGIN}/api/election-results`, { method: "POST", body: JSON.stringify({ state: "AZ", contests: ["contest"] }) }), deployment);
  assert.deepEqual(await post.json(), selected);
  assert.equal(post.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(reads, ["nation.json", "states/AZ.json", "states/AZ.json"]);
  const count = reads.length;
  assert.equal((await handler(new Request(`${PUBLIC_SITE_ORIGIN}/api/election-results?state=bad`), deployment)).status, 400);
  assert.equal((await handler(new Request(`${PUBLIC_SITE_ORIGIN}/api/election-results`, { method: "DELETE" }), deployment)).status, 405);
  const admin = await handler(new Request(`${ADMIN_ORIGIN}/api/election-results`, { headers: { host: new URL(ADMIN_ORIGIN).host } }), deployment);
  assert.equal(admin.status, 404); assert.equal(await admin.text(), "");
  assert.equal(reads.length, count, "invalid selections, unsupported methods and the Admin host do not open a blob");
});

test("the native Function selects scope only from the platform's deploy context and uses strong automatic blob IO", async context => {
  preserveFeedEnvironment(context, ["CONTEXT", "WTP_BUILD_CONTEXT", "WTP_RUNTIME_MODE", "WTP_ELECTION_RESULTS_TEST_FEED_DIR"]);
  delete process.env.WTP_ELECTION_RESULTS_TEST_FEED_DIR;
  process.env.CONTEXT = "deploy-preview"; process.env.WTP_BUILD_CONTEXT = "production"; process.env.WTP_RUNTIME_MODE = "production";
  for (const [context, expected] of [["production", "site"], ["deploy-preview", "deploy"], ["branch-deploy", "deploy"], [undefined, "deploy"]] as const) {
    const scopes: string[] = [];
    assert.equal(nativeResultFeedScope(context), expected);
    const store = nativeResultFeedStore(context, async scope => {
      scopes.push(scope);
      return { get: async (key, options) => {
        assert.equal(key, "nation.json"); assert.deepEqual(options, { type: "json", consistency: "strong" }); return nation;
      }, setJSON: async () => {} };
    });
    assert.deepEqual(await store.readNation(), nation);
    assert.deepEqual(scopes, [expected]);
  }
});

test("a native blob failure is visible without a database fallback", async context => {
  electionFeedFixture(context, "Synthetic blob outage");
  const response = await handler(new Request(`${PUBLIC_SITE_ORIGIN}/api/election-results`), { deploy: { context: "production" } });
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal((await response.json()).available, false);
});

test("the native cold-start graph contains neither Next nor database/key bootstrap code", async () => {
  const result = await build({ entryPoints: ["netlify/functions/reader-election-results.mts"], bundle: true, write: false,
    metafile: true, platform: "node", format: "esm", target: "node24", logLevel: "silent" });
  const inputs = Object.keys(result.metafile!.inputs);
  for (const forbidden of ["instrumentation.ts", "middleware.ts", "core/keys-native.ts", "core/keys-runtime.ts", "core/keys-cache.ts",
    "reader/database", "db/client", "@neondatabase", "/next/"]) {
    assert.ok(!inputs.some(input => input.includes(forbidden)), `${forbidden} must not initialize on a cold results request`);
  }
  const code = result.outputFiles.map(file => file.text).join("\n");
  assert.doesNotMatch(code, /loadNativeSavedKeys|loadWebsiteSavedKeys|refreshSavedKeys|warmReaderConnections|readerDatabaseQuery/);
  const configuration = readFileSync(new URL("../netlify.toml", import.meta.url), "utf8");
  assert.match(configuration, /\[functions\."reader-election-results"\]\s*node_bundler\s*=\s*"esbuild"/);
});
