import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createElectionResultFeedStore, localElectionResultFeedStore, resultFeedScope } from "../lib/election-results/feed-store.ts";
import type { StateResultFeed } from "../lib/election-results/feed-types.ts";
import { electionFeedFixture, preserveFeedEnvironment } from "./helpers/election-feed-fixture.ts";

const state: StateResultFeed = { formatVersion: 1, state: "AZ", ballotVersion: "v1", checkedAt: "2026-11-08T02:00:00Z", fingerprint: "f1", facts: {} };
const nation = { checkedAt: state.checkedAt, states: {}, sources: [] };

test("preview stores are isolated even when a production build or site credentials exist", () => {
  assert.equal(resultFeedScope({ CONTEXT: "production" }), "site");
  assert.equal(resultFeedScope({ WTP_BUILD_CONTEXT: "production" }), "site");
  assert.equal(resultFeedScope({ WTP_RUNTIME_MODE: "production" }), "site", "the production fleet inherits its existing runtime mode");
  assert.equal(resultFeedScope({ CONTEXT: "deploy-preview", WTP_BUILD_CONTEXT: "production", WTP_BLOBS_SITE_ID: "production-site" }), "deploy");
  assert.equal(resultFeedScope({ CONTEXT: "branch-deploy" }), "deploy");
  assert.equal(resultFeedScope({ CONTEXT: "deploy-preview", WTP_RUNTIME_MODE: "production", WTP_BLOBS_SITE_ID: "production-site" }), "deploy");
  assert.equal(resultFeedScope({ WTP_BUILD_CONTEXT: "production", WTP_RUNTIME_MODE: "staging" }), "deploy");
  assert.equal(resultFeedScope({ CONTEXT: "production", WTP_DB_ROLE: "local" }), "deploy");
  assert.equal(resultFeedScope({ WTP_RUNTIME_MODE: "production", WTP_DB_ROLE: "test-copy" }), "deploy");
  assert.equal(resultFeedScope({ WTP_BLOBS_SITE_ID: "production-site", WTP_BLOBS_TOKEN: "synthetic-token" }), "deploy", "credentials alone never select production");
  assert.equal(resultFeedScope({}), "deploy");
});

test("a feed publication failure propagates to the job instead of pretending it published", async () => {
  const store = createElectionResultFeedStore({ read: async () => null, write: async () => { throw new Error("Synthetic blob outage"); } });
  await assert.rejects(store.writeState("AZ", state), /Synthetic blob outage/);
  await assert.rejects(store.writeNation(nation), /Synthetic blob outage/);
  await assert.rejects(store.writeState("TX", state), /STATE_FEED_INVALID/);
});

test("feed storage carries only its published contract rather than accidental source or ballot copies", async context => {
  const { documents, store } = electionFeedFixture(context);
  await store.writeState("AZ", { ...state, sourceBody: "Transient source body", ballot: { contests: [] } } as StateResultFeed);
  assert.deepEqual(await store.readState("AZ"), state);
  assert.equal(JSON.stringify([...documents.values()]).includes("Transient source body"), false);
});

test("the native test-copy server uses its own temporary feed directory and refuses production", async context => {
  const root = await mkdtemp(join(tmpdir(), "cx-results-feed-test-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  preserveFeedEnvironment(context, ["CONTEXT", "WTP_BUILD_CONTEXT", "WTP_RUNTIME_MODE", "WTP_DB_ROLE"]);
  process.env.CONTEXT = "deploy-preview";
  const store = localElectionResultFeedStore(root);
  await store.writeState("AZ", state); await store.writeNation(nation);
  assert.deepEqual(await store.readState("AZ"), state);
  assert.deepEqual(await store.readNation(), nation);
  assert.equal(await store.readState("TX"), null);
  process.env.CONTEXT = "production";
  process.env.WTP_BUILD_CONTEXT = "production";
  process.env.WTP_RUNTIME_MODE = "production";
  delete process.env.WTP_DB_ROLE;
  assert.throws(() => localElectionResultFeedStore(root), /FORBIDDEN_IN_PRODUCTION/);
});
