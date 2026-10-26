import { SECTION_IDS } from '../../app/(admin)/_mw/admin-v6/contract.ts';
import assert from "node:assert/strict";
import test from "node:test";

import { buildLiveBundle, type LiveReference } from "../../app/(admin)/_mw/admin-v6/live-data.ts";
import { LiveSync, type SyncFetch } from "../../app/(admin)/_mw/admin-v6/live-sync.ts";
import type { WorkerStatus } from "../../app/(admin)/_mw/admin-v6/model.ts";

const at = "2026-09-28T19:00:00.000Z";
const ref: LiveReference = { states: [], definitions: [], profileVersion: "test", groupNames: {}, geo: null, observedAt: at };
const pulseStatus: WorkerStatus = { lastCheckIn: at, lastUsefulProgress: null, roundStartedAt: null,
  lastRoundFinishedAt: null, nextRoundDueAt: null, runnerState: "ALIVE", lanes: null, unread: [] };
const saved = { status: pulseStatus, jobs: [{ id: "scoped-job", placeKey: "st:az" }],
  waiting: [{ id: "scoped-wait" }], events: [{ id: "scoped-event" }], update: null, next: ["saved next"] };
type Reply = { readonly status: number; readonly body: unknown } | "network";

function harness() {
  const calls: { readonly url: string; readonly resolve: (reply: Reply) => void }[] = [];
  const fetch: SyncFetch = url => new Promise((resolve, reject) => {
    calls.push({ url, resolve: reply => reply === "network" ? reject(new Error("OFFLINE"))
      : resolve({ status: reply.status, json: async () => reply.body }) });
  });
  const sync = new LiveSync({ screen: "now", sections: SECTION_IDS, scope: "st:az", fetch, schedule: () => () => {} });
  const view = () => buildLiveBundle(sync.snapshot(), ref, pulseStatus).workers;
  const announce = (revision: string, contract = "admin-v6/workers@1") => sync.onPulse({
    revision, v6: { version: 1, sections: { workers: { contract, href: "/api/admin/v6/workers", revision } }, actions: {} },
  });
  const good = (scope: string, revision: string) => ({ status: 200, body: {
    contract: "admin-v6/workers@1", scope, revision, asOf: at, data: saved, missingParts: ["One field is unknown."],
  } });
  return { sync, calls, view, announce, good };
}
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

test("transient HTTP and network failures retain same-scope Workers lists with explicit stale state", async () => {
  const { calls, view, announce, good } = harness();
  announce("w1");
  calls[0].resolve(good("st:az", "w1"));
  await flush();
  announce("w2");
  calls[1].resolve({ status: 503, body: null });
  await flush();
  const stale = view();
  assert.equal(stale.state, "live");
  assert.equal(stale.load, "failed");
  assert.equal(stale.problem, "failed");
  assert.equal(stale.asOf, at);
  assert.deepEqual(stale.data?.jobs, saved.jobs);
  assert.deepEqual(stale.data?.waiting, saved.waiting);
  assert.deepEqual(stale.data?.events, saved.events);
  assert.match(stale.missingParts?.at(-1) ?? "", /last good reading/);
  announce("w3");
  calls[2].resolve("network");
  await flush();
  assert.equal(view().load, "failed");
  assert.deepEqual(view().data?.jobs, saved.jobs);
});

test("401 and 403 clear prior Workers detail and never replace denial with pulse-only live data", async () => {
  for (const status of [401, 403]) {
    const { calls, view, announce, good, sync } = harness();
    announce("w1"); calls[0].resolve(good("st:az", "w1")); await flush();
    announce("w2"); calls[1].resolve({ status, body: null }); await flush();
    assert.equal(sync.snapshot().workers.data, null);
    assert.equal(view().state, "not-connected");
    assert.equal(view().problem, "denied");
    assert.equal(view().data, null);
    assert.equal(view().asOf, null);
  }
});

test("a mismatched response contract clears prior detail instead of calling it a temporary stale read", async () => {
  const { calls, view, announce, good } = harness();
  announce("w1"); calls[0].resolve(good("st:az", "w1")); await flush();
  announce("w2"); calls[1].resolve({ status: 200, body: {
    contract: "admin-v6/workers@2", scope: "st:az", revision: "w2", asOf: at, data: saved,
  } }); await flush();
  assert.equal(view().state, "not-connected");
  assert.equal(view().problem, "incompatible");
  assert.equal(view().data, null);
});

test("an incompatible announcement invalidates an older in-flight 200, and corrected contract can recover", async () => {
  const { calls, view, announce, good, sync } = harness();
  announce("w1");
  announce("w2", "admin-v6/workers@2");
  calls[0].resolve(good("st:az", "w1"));
  await flush();
  assert.equal(sync.snapshot().workers.phase, "incompatible");
  assert.equal(view().data, null);
  announce("w2");
  assert.equal(calls.length, 2, "the corrected contract is read even with the same revision");
  calls[1].resolve(good("st:az", "w2")); await flush();
  assert.deepEqual(view().data?.jobs, saved.jobs);
});

test("scope change and out-of-order replies never carry Workers lists across scopes or revisions", async () => {
  const { calls, view, announce, good, sync } = harness();
  announce("w1"); calls[0].resolve(good("st:az", "w1")); await flush();
  announce("w2");
  sync.setScope("geo:az.zcta.85635");
  assert.equal(view().data?.jobs, null, "new scope has no old Workers list");
  calls[1].resolve(good("st:az", "w2")); await flush();
  assert.equal(view().data?.jobs, null);
  calls[2].resolve("network"); await flush();
  assert.equal(view().data, null, "new-scope failure cannot revive Arizona data");
  announce("w3");
  announce("w4");
  calls[4].resolve(good("geo:az.zcta.85635", "w4")); await flush();
  calls[3].resolve({ status: 403, body: null }); await flush();
  assert.deepEqual(view().data?.jobs, saved.jobs);
  assert.equal(view().problem, undefined);
});
