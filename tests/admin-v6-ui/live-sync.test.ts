/**
 * Admin v6 automatic pickup (AUTOMATIC-INTEGRATION.md, required acceptance):
 * backend unavailable → backend available → the SAME open page displays real
 * data → later changes appear automatically. Also: disconnect/reconnect,
 * access denied, incompatible version, out-of-order responses, one read in
 * flight per section, and no automatic mutation.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { LiveSync, RETRY_DELAYS_MS, toSourced, type SyncFetch } from "../../app/(admin)/_mw/admin-v6/live-sync.ts";
import { SECTION_DEP } from "../../app/(admin)/_mw/admin-v6/dependencies.ts";

type Reply = { status: number; body: unknown } | "network";

function harness() {
  const calls: { url: string; resolve: (r: Reply) => void }[] = [];
  const timers: { fn: () => void; ms: number; cancelled: boolean }[] = [];
  const fetch: SyncFetch = (url) => new Promise((resolve, reject) => {
    calls.push({ url, resolve: (r) => (r === "network" ? reject(new Error("offline")) : resolve({ status: r.status, json: async () => r.body })) });
  });
  const sync = new LiveSync({
    scope: "st:az",
    fetch,
    schedule: (fn, ms) => { const t = { fn, ms, cancelled: false }; timers.push(t); return () => { t.cancelled = true; }; },
  });
  return { sync, calls, timers };
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const pulse = (sections: Record<string, unknown> = {}, actions: Record<string, unknown> = {}) => ({
  revision: "r", at: "2026-09-28T19:00:00.000Z", runner: {}, counts: {}, lanes: null, unread: [],
  v6: { version: 1, sections, actions },
});
const stuckAnn = (revision: string, contract = "admin-v6/stuck@1") => ({ stuck: { contract, href: "/api/admin/v6/stuck", revision } });
const ok = (scope: string, revision: string, data: unknown) => ({ status: 200, body: { contract: "admin-v6/stuck@1", scope, revision, asOf: "2026-09-28T19:00:00.000Z", data } });

test("changing the account period clears old figures and names an unavailable period", async () => {
  const { sync, calls } = harness();
  sync.onPulse(pulse({ money: { contract: "admin-v6/money@1", href: "/api/admin/v6/money", revision: "m1" } }));
  calls[0].resolve({ status: 200, body: { contract: "admin-v6/money@1", scope: "st:az", revision: "m1",
    asOf: "2026-09-28T19:00:00.000Z", data: { accountMonth: "September 2026" } } });
  await flush();
  assert.equal(sync.snapshot().money.phase, "live");
  sync.setParams("money", { period: "last-24h" });
  assert.equal(sync.snapshot().money.data, null, "monthly figures must disappear before the last-24h answer");
  assert.match(calls[1].url, /period=last-24h/);
  calls[1].resolve({ status: 409, body: { code: "PERIOD_NOT_AVAILABLE", dependency: "DEP-PERIOD",
    says: "A complete last-24h account reading is unavailable." } });
  await flush();
  const unavailable = toSourced(sync.snapshot().money, SECTION_DEP.money);
  assert.equal(unavailable.data, null);
  assert.equal(unavailable.dependency?.id, "DEP-PERIOD");
  sync.setParams("money", { period: "2026-09" });
  calls[2].resolve({ status: 200, body: { contract: "admin-v6/money@1", scope: "st:az", revision: "m1",
    asOf: "2026-09-28T19:01:00.000Z", data: { accountMonth: "September 2026" } } });
  await flush();
  assert.equal(sync.snapshot().money.phase, "live");
});

test("unavailable → available → the same open page shows real data → later changes appear", async () => {
  const { sync, calls } = harness();
  const seen: string[] = [];
  sync.subscribe(() => seen.push(sync.snapshot().stuck.phase));

  // 1. The deployed pulse has no v6 announcement: the section waits, and nothing is fetched.
  sync.onPulse({ revision: "r0", at: "2026-09-28T19:00:00.000Z" });
  assert.equal(sync.snapshot().stuck.phase, "waiting");
  assert.equal(calls.length, 0, "no guessed endpoint is polled");
  const waiting = toSourced(sync.snapshot().stuck, SECTION_DEP.stuck);
  assert.equal(waiting.state, "not-connected");
  assert.equal(waiting.problem, "waiting");
  assert.equal(waiting.data, null, "waiting is never shown as zero");

  // 2. The backend starts announcing the section. The next pulse is enough.
  sync.onPulse(pulse(stuckAnn("v1")));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/api/admin/v6/stuck?scope=st%3Aaz", "reads the announced path for the current scope");
  assert.equal(sync.snapshot().stuck.phase, "loading");
  calls[0].resolve(ok("st:az", "v1", [{ id: "real-1" }]));
  await flush();
  const first = toSourced<{ id: string }[]>(sync.snapshot().stuck, SECTION_DEP.stuck);
  assert.equal(first.state, "live");
  assert.deepEqual(first.data, [{ id: "real-1" }]);

  // 3. A pulse with the same revision does not re-read.
  sync.onPulse(pulse(stuckAnn("v1")));
  assert.equal(calls.length, 1);

  // 4. The data changes: the revision moves, the page re-reads and replaces.
  sync.onPulse(pulse(stuckAnn("v2")));
  assert.equal(calls.length, 2);
  calls[1].resolve(ok("st:az", "v2", [{ id: "real-1" }, { id: "real-2" }]));
  await flush();
  assert.deepEqual(sync.snapshot().stuck.data, [{ id: "real-1" }, { id: "real-2" }], "replaced, not appended: nothing double counts");
  assert.ok(seen.includes("live"));
});

test("only one read per section is in flight, and an out-of-order answer is dropped", async () => {
  const { sync, calls } = harness();
  sync.onPulse(pulse(stuckAnn("v1")));
  sync.onPulse(pulse(stuckAnn("v2")));
  assert.equal(sync.inFlight(), 1, "the newer request supersedes the older one");
  // The newer one answers first, then the stale one arrives late.
  calls[1].resolve(ok("st:az", "v2", ["new"]));
  await flush();
  calls[0].resolve(ok("st:az", "v1", ["old"]));
  await flush();
  assert.deepEqual(sync.snapshot().stuck.data, ["new"]);
});

test("a scoped reply retains its content revision separately from pulse invalidation", async () => {
  const { sync, calls } = harness();
  sync.onPulse(pulse(stuckAnn("source-v1")));
  calls[0].resolve(ok("st:az", "scope-content-v1", ["previous"]));
  await flush();
  assert.equal(sync.snapshot().stuck.phase, "live");
  assert.equal(sync.snapshot().stuck.revision, "scope-content-v1");
  sync.onPulse(pulse(stuckAnn("source-v2")));
  calls[1].resolve(ok("st:az", "scope-content-v2", ["current"]));
  await flush();
  assert.equal(sync.snapshot().stuck.revision, "scope-content-v2");
  assert.deepEqual(sync.snapshot().stuck.data, ["current"]);
});

test("a withdrawn capability invalidates an in-flight answer and its retry", async () => {
  const { sync, calls, timers } = harness();
  sync.onPulse(pulse(stuckAnn("v1")));
  sync.onPulse(pulse());
  calls[0].resolve(ok("st:az", "v1", ["not available"]));
  await flush();
  assert.equal(sync.snapshot().stuck.phase, "waiting");
  assert.equal(sync.snapshot().stuck.data, null);
  assert.equal(timers.filter(t => !t.cancelled).length, 0);
  sync.onPulse(pulse(stuckAnn("v1")));
  assert.equal(calls.length, 2, "the returned capability starts one fresh read");
});

test("changing scope clears the old scope's data and drops its late answer", async () => {
  const { sync, calls } = harness();
  sync.onPulse(pulse(stuckAnn("v1")));
  sync.setScope("geo:az.zcta.85635");
  assert.equal(sync.snapshot().stuck.phase, "loading");
  assert.equal(calls[1].url, "/api/admin/v6/stuck?scope=geo%3Aaz.zcta.85635");
  calls[0].resolve(ok("st:az", "v1", ["arizona"]));
  await flush();
  assert.equal(sync.snapshot().stuck.data, null, "Arizona's rows never appear under the ZIP");
  calls[1].resolve(ok("geo:az.zcta.85635", "v1", ["zip"]));
  await flush();
  assert.deepEqual(sync.snapshot().stuck.data, ["zip"]);
});

test("a response labelled for another scope is ignored", async () => {
  const { sync, calls } = harness();
  sync.onPulse(pulse(stuckAnn("v1")));
  calls[0].resolve(ok("us", "v1", ["country"]));
  await flush();
  assert.notEqual(sync.snapshot().stuck.phase, "live");
});

test("temporary failures keep the last good data and retry a bounded number of times", async () => {
  const { sync, calls, timers } = harness();
  sync.onPulse(pulse(stuckAnn("v1")));
  calls[0].resolve(ok("st:az", "v1", ["good"]));
  await flush();
  sync.onPulse(pulse(stuckAnn("v2")));
  calls[1].resolve({ status: 503, body: null });
  await flush();
  const stale = toSourced(sync.snapshot().stuck, SECTION_DEP.stuck);
  assert.equal(stale.load, "failed");
  assert.deepEqual(stale.data, ["good"], "last good data stays on screen");
  // Exhaust the bounded retries.
  for (let i = 0; i < RETRY_DELAYS_MS.length; i++) {
    const t = timers.filter((x) => !x.cancelled).at(-1)!;
    assert.equal(t.ms, RETRY_DELAYS_MS[i]);
    t.cancelled = true;
    t.fn();
    calls.at(-1)!.resolve("network");
    await flush();
  }
  const pendingTimers = timers.filter((x) => !x.cancelled).length;
  assert.equal(pendingTimers, 0, "no unbounded retry loop");
  assert.equal(calls.length, 2 + RETRY_DELAYS_MS.length);
  // A later revision change tries again.
  sync.onPulse(pulse(stuckAnn("v3")));
  assert.equal(calls.length, 3 + RETRY_DELAYS_MS.length);
});

test("disconnect and reconnect: catching up re-reads once and replaces", async () => {
  const { sync, calls } = harness();
  sync.onPulse(pulse(stuckAnn("v1")));
  calls[0].resolve(ok("st:az", "v1", ["a"]));
  await flush();
  sync.catchUp();
  assert.equal(calls.length, 2);
  calls[1].resolve(ok("st:az", "v1", ["a", "b"]));
  await flush();
  assert.deepEqual(sync.snapshot().stuck.data, ["a", "b"]);
});

test("access denied is shown and not retried", async () => {
  const { sync, calls, timers } = harness();
  sync.onPulse(pulse(stuckAnn("v1")));
  calls[0].resolve({ status: 403, body: null });
  await flush();
  assert.equal(sync.snapshot().stuck.phase, "denied");
  assert.equal(timers.length, 0);
  sync.onPulse(pulse(stuckAnn("v1")));
  assert.equal(calls.length, 1, "no repeated reads against a denial");
  assert.equal(toSourced(sync.snapshot().stuck, SECTION_DEP.stuck).problem, "denied");
});

test("an incompatible contract version is shown, not read", async () => {
  const { sync, calls } = harness();
  sync.onPulse(pulse(stuckAnn("v1", "admin-v6/stuck@2")));
  assert.equal(calls.length, 0);
  assert.equal(sync.snapshot().stuck.phase, "incompatible");
  // A body with a mismatched contract is also incompatible.
  sync.onPulse(pulse(stuckAnn("v2")));
  calls[0].resolve({ status: 200, body: { contract: "admin-v6/stuck@2", scope: "st:az", revision: "v2", asOf: "x", data: [] } });
  await flush();
  assert.equal(sync.snapshot().stuck.phase, "incompatible");
});

test("an announced href outside /api/admin is ignored", () => {
  const { sync, calls } = harness();
  sync.onPulse(pulse({ stuck: { contract: "admin-v6/stuck@1", href: "https://example.com/steal", revision: "v1" } }));
  assert.equal(calls.length, 0);
  assert.equal(sync.snapshot().stuck.phase, "waiting");
});

test("capability readiness never sends an action", async () => {
  const { sync, calls } = harness();
  const posted: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: unknown) => { posted.push(String(input)); return new Response("{}"); }) as typeof fetch;
  try {
    sync.onPulse(pulse(stuckAnn("v1"), { recheck: { contract: "admin-v6/action/recheck@1", type: "reader.recheck" } }));
    calls[0].resolve(ok("st:az", "v1", []));
    await flush();
    assert.equal(sync.capabilities()?.actions.recheck?.type, "reader.recheck");
    assert.deepEqual(posted, [], "an announced action is never submitted by the page");
    assert.ok(calls.every((c) => !c.url.includes("/api/admin/action")));
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("paged sections read one bounded window; search and cursors go to the server", async () => {
  const { sync, calls } = harness();
  sync.onPulse(pulse({ history: { contract: "admin-v6/history@1", href: "/api/admin/v6/history", revision: "h1" } }));
  assert.equal(calls[0].url, "/api/admin/v6/history?scope=st%3Aaz&limit=50", "never the whole history");
  calls[0].resolve({ status: 200, body: { contract: "admin-v6/history@1", scope: "st:az", revision: "h1", asOf: "t", data: [1, 2], page: { total: 3000, nextCursor: "c2", prevCursor: null } } });
  await flush();
  const src = toSourced(sync.snapshot().history, SECTION_DEP.history);
  assert.deepEqual(src.page, { total: 3000, nextCursor: "c2", prevCursor: null });
  sync.setParams("history", { status: "unknown", cursor: "c2", q: "" });
  assert.equal(calls[1].url, "/api/admin/v6/history?scope=st%3Aaz&limit=50&status=unknown&cursor=c2");
  sync.setParams("history", { status: "unknown", cursor: "c2" });
  assert.equal(calls.length, 2, "the same query is not read twice");
  sync.onPulse(pulse({ history: { contract: "admin-v6/history@1", href: "/api/admin/v6/history", revision: "h2" } }));
  assert.match(calls[2].url, /status=unknown&cursor=c2/, "a revision re-read keeps the owner's filters");
  sync.setScope("us");
  assert.equal(calls[3].url, "/api/admin/v6/history?scope=us&limit=50", "a new place starts from the first window");
});

test("an unpaged section reads without a limit", () => {
  const { sync, calls } = harness();
  sync.onPulse(pulse(stuckAnn("v1")));
  assert.doesNotMatch(calls[0].url, /limit=/);
});
