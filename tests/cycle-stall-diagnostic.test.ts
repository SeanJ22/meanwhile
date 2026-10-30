/**
 * A cycle that runs into the wall says what it was waiting on. The worker thread must write the diagnostic to stderr
 * and the cycle's record even while the main thread is blocked in a synchronous call.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { PendingOperations, describePending, trackStoreCalls } from "../lib/control-plane/scheduler/cycle-stall.ts";
import { readPendingSnapshot, stallDiagnosticLines, type PendingSnapshot } from "../lib/control-plane/scheduler/cycle-stall-report.ts";

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

