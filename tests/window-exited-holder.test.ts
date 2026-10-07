import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import {
  WINDOW_LEASE_ID,
  WindowLockHeld,
  acquireWindowLease,
  releaseWindowLeaseOfExitedLocalHolder,
  windowLeaseHolderProcess,
} from "../lib/control-plane/promotion/window.ts";

const CLAIMED = "2026-09-23T00:07:44.616Z";
const TTL_MS = 25 * 60_000;
const RELAUNCH = "2026-09-23T00:25:07.553Z";

test("a holder id names its process: role, host and pid", () => {
  assert.deepEqual(windowLeaseHolderProcess("cycle@SeanLenovo#36252"), { role: "cycle", host: "SeanLenovo", pid: 36252 });
  assert.deepEqual(windowLeaseHolderProcess("nightly-window@SeanLenovo#12"), { role: "nightly-window", host: "SeanLenovo", pid: 12 });
  assert.equal(windowLeaseHolderProcess("autonomous-fleet-cutover:4242"), null);
  assert.equal(windowLeaseHolderProcess("window-a"), null);
  assert.equal(windowLeaseHolderProcess("cycle@SeanLenovo#0"), null);
});

test("the relaunched runner's cycle is no longer refused under an exited cycle's lease", async () => {
  const repos = createMemoryRepositories();
  await acquireWindowLease(repos, "cycle@SeanLenovo#36252", CLAIMED, TTL_MS);
  // Before: the relaunched cycle is refused for the rest of the TTL.
  await assert.rejects(() => acquireWindowLease(repos, "cycle@SeanLenovo#30708", RELAUNCH, TTL_MS), (e: unknown) => e instanceof WindowLockHeld);

  const probed: number[] = [];
  const outcome = await releaseWindowLeaseOfExitedLocalHolder(repos, {
    host: "seanlenovo",
    now: RELAUNCH,
    processExists: (pid) => { probed.push(pid); return false; },
  });
  assert.deepEqual(probed, [36252]);
  assert.equal(outcome.state, "RELEASED");
  assert.equal(outcome.holder, "cycle@SeanLenovo#36252");
  assert.equal(outcome.state === "RELEASED" ? outcome.expiresAt : null, "2026-09-23T00:32:44.616Z");

  const held = await repos.leases.read(WINDOW_LEASE_ID);
  assert.equal(held?.value.released, true);
  assert.equal(held?.value.expiresAt, "2026-09-23T00:32:44.616Z", "release changes neither clock nor expiry");

  const next = await acquireWindowLease(repos, "cycle@SeanLenovo#30708", RELAUNCH, TTL_MS);
  assert.equal(next.lease.holder, "cycle@SeanLenovo#30708");
});

test("a live pid, another host's process, or a holder that names no process keeps the lease", async () => {
  for (const [holder, host, exists, reason] of [
    ["cycle@SeanLenovo#36252", "SeanLenovo", true, /still exists/],
    ["cycle@OtherHost#36252", "SeanLenovo", false, /another|cannot see/],
    ["window-a", "SeanLenovo", false, /names no process|does not name a process/],
  ] as const) {
    const repos = createMemoryRepositories();
    await acquireWindowLease(repos, holder, CLAIMED, TTL_MS);
    const outcome = await releaseWindowLeaseOfExitedLocalHolder(repos, { host, now: RELAUNCH, processExists: () => exists });
    assert.equal(outcome.state, "KEPT", holder);
    assert.match(outcome.state === "KEPT" ? outcome.reason : "", reason);
    await assert.rejects(() => acquireWindowLease(repos, "cycle@SeanLenovo#30708", RELAUNCH, TTL_MS), (e: unknown) => e instanceof WindowLockHeld);
  }
});

test("an absent, released or expired lease needs nothing and probes no process", async () => {
  const repos = createMemoryRepositories();
  const never = () => { throw new Error("no process may be probed"); };
  assert.equal((await releaseWindowLeaseOfExitedLocalHolder(repos, { host: "SeanLenovo", now: RELAUNCH, processExists: never })).state, "NOT_NEEDED");
  await acquireWindowLease(repos, "cycle@SeanLenovo#36252", CLAIMED, TTL_MS);
  const later = "2026-09-23T00:40:00.000Z";
  assert.equal((await releaseWindowLeaseOfExitedLocalHolder(repos, { host: "SeanLenovo", now: later, processExists: never })).state, "NOT_NEEDED");
});

test("the runner checks for an exited holder before every research cycle", () => {
  const src = readFileSync("scripts/pilot-runner.mts", "utf8");
  const recover = src.indexOf('await recoverExitedWindowHolder("research cycle")');
  const cycle = src.indexOf("const result = await runOneCycle(owner)");
  assert.ok(recover > 0 && cycle > recover, "the check runs immediately before runOneCycle");
  assert.match(src, /process\.kill\(pid, 0\)/);
  assert.match(src, /code !== "ESRCH"/, "only a definite ESRCH counts as exited");
  assert.match(src, /## BEFORE THE CYCLE/, "a release is carried in the cycle's digest");
});
