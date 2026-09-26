import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { acquireWindowLease, WindowLockHeld } from "../lib/control-plane/promotion/window.ts";
import { ControlPlaneRequestTimeout } from "../lib/control-plane/repository/request-bounds.ts";

const now = "2026-09-26T17:32:54.288Z";
const timeout = (kind: "REQUEST" | "DEADLINE" = "REQUEST") => new ControlPlaneRequestTimeout({ operation: "cp_leases.read", callClass: "POINT", timeoutMs: 10_000, kind, budget: null });
const retry = { circuitLatched: () => false, sleep: async () => {}, random: () => 0, maxAttempts: 3 };

test("a transient startup lease read recovers before one confirmed claim, without another cycle", async () => {
  const repos = createMemoryRepositories();
  const read = repos.leases.read.bind(repos.leases);
  const put = repos.leases.put.bind(repos.leases);
  let reads = 0, writes = 0;
  repos.leases.read = async id => { if (++reads === 1) throw timeout(); return read(id); };
  repos.leases.put = async (...args) => { writes++; return put(...args); };
  const claimed = await acquireWindowLease(repos, "cycle@host#1", now, 60_000, retry);
  assert.equal(claimed.lease.holder, "cycle@host#1");
  assert.equal(reads, 2);
  assert.equal(writes, 1);
  await assert.rejects(acquireWindowLease(repos, "cycle@host#2", now, 60_000, retry), WindowLockHeld);
  assert.equal(writes, 1, "an existing lease remains exclusive");
});

test("persistent read failure is bounded; spent deadlines and latched circuits do not retry", async () => {
  for (const [kind, latched, expected] of [["REQUEST", false, 3], ["DEADLINE", false, 1], ["REQUEST", true, 1]] as const) {
    const repos = createMemoryRepositories();
    let calls = 0;
    repos.leases.read = async () => { calls++; throw timeout(kind); };
    repos.leases.put = async () => { throw Error("must not write after a failed read"); };
    await assert.rejects(acquireWindowLease(repos, "cycle@host#1", now, 60_000, { ...retry, circuitLatched: () => latched }), ControlPlaneRequestTimeout);
    assert.equal(calls, expected);
  }
});

test("an uncertain lease write is never retried or treated as a successful claim", async () => {
  const repos = createMemoryRepositories();
  let writes = 0;
  repos.leases.put = async () => { writes++; throw timeout(); };
  await assert.rejects(acquireWindowLease(repos, "cycle@host#1", now, 60_000, retry), ControlPlaneRequestTimeout);
  assert.equal(writes, 1);
});
