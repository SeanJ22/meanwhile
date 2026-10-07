/**
 * A cycle that runs into the wall says what it was waiting on. The worker thread must write the diagnostic to stderr
 * and the cycle's record even while the main thread is blocked in a synchronous call.
 */
import assert from "node:assert/strict";
import { closeSync, existsSync, mkdtempSync, openSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import {
  PendingOperations,
  describePending,
  startCycleStallDiagnostic,
  trackStoreCalls,
} from "../lib/control-plane/scheduler/cycle-stall.ts";
import {
  RECORD_CLAIM,
  readPendingSnapshot,
  recordClaim,
  stallDiagnosticLines,
  type PendingSnapshot,
} from "../lib/control-plane/scheduler/cycle-stall-report.ts";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Busy-wait: the main thread's event loop cannot turn while this runs. It ends
 * when `done` reads true (a synchronous check) or at `maxMs`, so a slow worker
 * start on a loaded machine still fires inside the block.
 */
function blockMainThread(maxMs: number, done: () => boolean): void {
  const until = Date.now() + maxMs;
  while (Date.now() < until && !done()) {
    /* deliberately synchronous */
  }
}

async function waitFor(predicate: () => boolean, ms: number): Promise<boolean> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (predicate()) return true;
    await sleep(20);
  }
  return predicate();
}

function scratch(): { readonly dir: string; readonly out: number; readonly err: number; readonly close: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "wtp-cycle-stall-"));
  const out = openSync(join(dir, "stdout.txt"), "w");
  const err = openSync(join(dir, "stderr.txt"), "w");
  return {
    dir,
    out,
    err,
    close: () => {
      closeSync(out);
      closeSync(err);
      rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    },
  };
}

test("the account is published for another thread: last phase, nested labelled awaits, store calls in flight", () => {
  const pending = new PendingOperations({ now: () => Date.parse("2026-09-23T17:43:10.000Z") });
  pending.phaseFinished("metrics-and-finalization");
  const leaveHeartbeat = pending.enter("heartbeat");
  const leaveRead = pending.enter("heartbeat:read");
  const endCall = pending.storeCallStarted("runnerHeartbeat.read");
  const published = readPendingSnapshot(pending.sab);
  assert.deepEqual(published, pending.snapshot(), "the worker reads what the main thread holds");
  assert.equal(published?.lastPhase, "metrics-and-finalization");
  assert.deepEqual(published?.steps.map((s) => s.label), ["heartbeat", "heartbeat:read"]);
  assert.deepEqual(published?.store.map((c) => c.call), ["runnerHeartbeat.read"]);
  assert.equal(describePending(published!), "pending: heartbeat:read; store call in flight: runnerHeartbeat.read; last phase: metrics-and-finalization");

  endCall();
  leaveRead();
  leaveRead();
  const after = readPendingSnapshot(pending.sab);
  assert.deepEqual(after?.steps.map((s) => s.label), ["heartbeat"], "leaving is idempotent and removes only its own label");
  assert.equal(after?.storeInFlight, 0);
  leaveHeartbeat();
  assert.deepEqual(readPendingSnapshot(pending.sab)?.steps, []);
});

test("trackStoreCalls names each repository call while it is in flight and clears it however it settles", async () => {
  const pending = new PendingOperations();
  const repos = trackStoreCalls(createMemoryRepositories(), pending);
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const held = repos.locks.withLock("probe", async () => {
    await gate;
    return "done";
  });
  assert.deepEqual(pending.snapshot().store.map((c) => c.call), ["locks.withLock"]);
  release?.();
  assert.equal(await held, "done");
  assert.equal(pending.snapshot().storeInFlight, 0);

  await assert.rejects(repos.researchState.mustRead("absent"));
  assert.equal(pending.snapshot().storeInFlight, 0, "a rejected call is cleared too");
  assert.equal(await repos.runnerHeartbeat.read("pilot-runner"), null);
  assert.equal(repos.durable, false, "plain properties pass through");
});

test("the lines name the pending await, the store call, the last phase, and whether the event loop is blocked", () => {
  const snapshot: PendingSnapshot = {
    lastPhase: "metrics-and-finalization",
    lastPhaseAt: "2026-09-23T17:43:10.000Z",
    steps: [
      { label: "heartbeat", since: "2026-09-23T17:44:00.000Z" },
      { label: "heartbeat:write", since: "2026-09-23T17:44:02.000Z" },
    ],
    lastFailed: { label: "research-state:final", since: "2026-09-23T17:43:59.000Z" },
    store: [{ call: "runnerHeartbeat.compareAndSet", since: "2026-09-23T17:44:02.000Z" }],
    storeInFlight: 1,
    updatedAt: "2026-09-23T17:44:02.000Z",
  };
  const started = Date.parse("2026-09-23T17:32:59.000Z");
  const reading = { snapshot, processStartedMs: started, wallAtMs: started + 15 * 60_000, nowMs: started + 15 * 60_000 - 90_000 };
  const waiting = stallDiagnosticLines({ ...reading, mainThreadPingMs: reading.nowMs - 2_000 });
  assert.match(waiting[0]!, /STALL DIAGNOSTIC: the cycle is still running 13m30s into its 15m00s wall, 1m30s before the supervisor ends it/);
  assert.match(waiting.join("\n"), /last phase finished: metrics-and-finalization at 2026-09-23T17:43:10\.000Z \(3m19s ago\)/);
  assert.match(waiting.join("\n"), /pending await: heartbeat:write since 2026-09-23T17:44:02\.000Z \(2m27s\), inside heartbeat/);
  assert.match(waiting.join("\n"), /store calls in flight: 1 — runnerHeartbeat\.compareAndSet since/);
  assert.match(waiting.join("\n"), /last failed await: research-state:final at 2026-09-23T17:43:59\.000Z/);
  assert.match(waiting.at(-1)!, /event loop turned 2s ago, so it is waiting on the pending await above/);

  const blocked = stallDiagnosticLines({ ...reading, mainThreadPingMs: reading.nowMs - 177_000 });
  assert.match(blocked.at(-1)!, /event loop has not turned for 2m57s; a synchronous call is blocking it/);
  assert.match(stallDiagnosticLines({ ...reading, snapshot: null, mainThreadPingMs: null }).join("\n"), /nothing was published/);
});

test("WORKER, blocked main thread: near the wall it writes the pending label to stderr and the cycle's record while the event loop cannot turn", async () => {
  const io = scratch();
  try {
    const pending = new PendingOperations();
    pending.phaseFinished("metrics-and-finalization");
    const recordPath = join(io.dir, "runs", "2026-09-23-07.json");
    const now = Date.now();
    const diagnostic = startCycleStallDiagnostic({
      pending,
      fireAtMs: now + 700,
      processStartedMs: now - 13 * 60_000,
      wallAtMs: now + 700 + 90_000,
      recordPath,
      startedAt: new Date(now - 13 * 60_000).toISOString(),
      cycleId: "freshness-cycle:test:blocked",
      testedSha: "a".repeat(40),
      stdoutFd: io.out,
      stderrFd: io.err,
      pingMs: 50,
      blockedAfterMs: 400,
    });
    await sleep(150);
    /* A synchronous call, like the git walk in readCodeIdentity, holds the main thread past the diagnostic's moment. */
    pending.sync("code-identity", () => blockMainThread(15_000, () => recordClaim(pending.sab) === RECORD_CLAIM.STALL_WRITTEN));
    assert.equal(recordClaim(pending.sab), RECORD_CLAIM.STALL_WRITTEN, "the worker finished its record while the main thread was blocked");
    assert.ok(existsSync(recordPath));
    const record = JSON.parse(readFileSync(recordPath, "utf8"));
    assert.equal(record.stalled, true);
    assert.equal(record.cycleId, "freshness-cycle:test:blocked");
    assert.equal(record.stallDiagnostic.pending.at(-1).label, "code-identity");
    assert.equal(record.stallDiagnostic.lastPhase, "metrics-and-finalization");
    assert.equal(record.stallDiagnostic.mainThreadBlocked, true);
    assert.match(record.error, /^CYCLE_STALLED: \d+ s before the wall the cycle was waiting on code-identity; its event loop was blocked/);
    assert.ok(Array.isArray(record.digest) && record.digest[0] === "PILOT HEALTH");
    assert.ok(await waitFor(() => readFileSync(join(io.dir, "stderr.txt"), "utf8").includes("pending await: code-identity"), 2_000));
    const stderr = readFileSync(join(io.dir, "stderr.txt"), "utf8");
    assert.match(stderr, /STALL DIAGNOSTIC/);
    assert.match(stderr, /has not turned for/);
    assert.match(readFileSync(join(io.dir, "stdout.txt"), "utf8"), /stall diagnostic: .*2026-09-23-07\.json/);
    assert.doesNotMatch(readFileSync(join(io.dir, "stdout.txt"), "utf8"), /local diagnostic:/, "the runner's record line stays the cycle's own");

    /* The cycle then finished: it carries the stall block forward into its record at the same path. */
    const carried = diagnostic.claimRecord();
    assert.equal(carried?.pending.at(-1)?.label, "code-identity");
    await diagnostic.stop();
  } finally {
    io.close();
  }
});

test("WORKER, awaiting a hung store call: it names the labelled await and the call, with the event loop turning", async () => {
  const io = scratch();
  try {
    const pending = new PendingOperations();
    pending.phaseFinished("metrics-and-finalization");
    const repos = trackStoreCalls(createMemoryRepositories(), pending);
    const recordPath = join(io.dir, "2026-09-23-08.json");
    const now = Date.now();
    const diagnostic = startCycleStallDiagnostic({
      pending,
      fireAtMs: now + 300,
      processStartedMs: now - 13 * 60_000,
      wallAtMs: now + 300 + 90_000,
      recordPath,
      startedAt: new Date(now).toISOString(),
      cycleId: "freshness-cycle:test:awaiting",
      testedSha: null,
      stdoutFd: io.out,
      stderrFd: io.err,
      pingMs: 50,
      blockedAfterMs: 400,
    });
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const heartbeat = pending.step("heartbeat:write", () => repos.locks.withLock("heartbeat", () => gate));
    assert.ok(await waitFor(() => recordClaim(pending.sab) === RECORD_CLAIM.STALL_WRITTEN, 15_000), "the worker finished its record");
    const record = JSON.parse(readFileSync(recordPath, "utf8"));
    assert.equal(record.stallDiagnostic.pending.at(-1).label, "heartbeat:write");
    assert.deepEqual(record.stallDiagnostic.storeInFlight.map((c: { call: string }) => c.call), ["locks.withLock"]);
    assert.equal(record.stallDiagnostic.mainThreadBlocked, false);
    assert.match(record.error, /waiting on heartbeat:write \(store call locks\.withLock\)$/);
    release?.();
    await heartbeat;
    await diagnostic.stop();
  } finally {
    io.close();
  }
});

test("WORKER: a cycle that writes its record first is never overwritten, and the diagnostic says nothing", async () => {
  const io = scratch();
  try {
    const pending = new PendingOperations();
    const recordPath = join(io.dir, "2026-09-23-09.json");
    const now = Date.now();
    const diagnostic = startCycleStallDiagnostic({
      pending,
      fireAtMs: now + 250,
      processStartedMs: now,
      wallAtMs: now + 250 + 90_000,
      recordPath,
      startedAt: new Date(now).toISOString(),
      cycleId: "freshness-cycle:test:finished",
      testedSha: null,
      stdoutFd: io.out,
      stderrFd: io.err,
    });
    assert.equal(diagnostic.claimRecord(), null, "the cycle claimed the record before the diagnostic fired");
    await sleep(600);
    assert.equal(existsSync(recordPath), false, "the diagnostic wrote no record over the cycle's claim");
    assert.equal(readFileSync(join(io.dir, "stderr.txt"), "utf8"), "");
    await diagnostic.stop();
  } finally {
    io.close();
  }
});
