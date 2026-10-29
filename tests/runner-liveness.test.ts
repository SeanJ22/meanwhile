import assert from "node:assert/strict";
import test from "node:test";

import { hangShouldTerminate } from "../lib/control-plane/runner-liveness.ts";
import { liveCycleHeartbeat } from "../lib/control-plane/runner-standing.ts";
import { OWNER_SURFACE_FORMAT_VERSION, type RunnerHeartbeat } from "../lib/control-plane/owner-surface.ts";

const prev: RunnerHeartbeat = {
  formatVersion: OWNER_SURFACE_FORMAT_VERSION,
  beatAt: "2026-09-18T19:16:55.000Z",
  lastCycleStartedAt: "2026-09-18T19:08:00.000Z",
  lastCycleFinishedAt: "2026-09-18T19:16:55.000Z",
  nextCycleDueAt: "2026-09-18T20:16:55.000Z",
  lastCycleOk: true,
  testedSha: "d72f5fc1",
  host: "SeanLenovo",
  intakeRuntime: { observedAt: "2026-09-18T19:15:00.000Z", outcome: "ATTENTION", detail: "1 flag" } as RunnerHeartbeat["intakeRuntime"],
};

test("a live long-running cycle beats without inventing a finish or new work", () => {
  const beat = liveCycleHeartbeat(prev, { at: "2026-10-02T01:42:00.000Z", startedAt: "2026-10-02T01:02:00.000Z",
    testedSha: "a".repeat(40), host: "meanwhile-runner" });
  assert.equal(beat.beatAt, "2026-10-02T01:42:00.000Z");
  assert.equal(beat.lastCycleStartedAt, "2026-10-02T01:02:00.000Z");
  assert.equal(beat.lastCycleFinishedAt, prev.lastCycleFinishedAt);
  assert.equal(beat.lastCycleOk, prev.lastCycleOk);
  assert.equal(beat.cycle.finishedAt, null);
  assert.equal(beat.cycle.exitCode, null);
  assert.equal(beat.nextCycleDueAt, null);
  assert.equal(beat.intakeRuntime, prev.intakeRuntime);
});

test("a child exit records its actual code, signal and error independently of prior success", () => {
  const beat = liveCycleHeartbeat(prev, { at: "2026-10-02T01:42:00.000Z", startedAt: "2026-10-02T01:02:00.000Z",
    finishedAt: "2026-10-02T01:42:00.000Z", exitCode: null, signal: "SIGTERM", lastError: "child stopped",
    nextCycleDueAt: "2026-10-02T01:52:00.000Z", testedSha: "a".repeat(40), host: "meanwhile-runner" });
  assert.equal(beat.lastCycleOk, false);
  assert.equal(beat.nextCycleDueAt, "2026-10-02T01:52:00.000Z");
  assert.equal(beat.lastCycleFinishedAt, beat.cycle.finishedAt);
  assert.equal(beat.cycle.exitCode, null);
  assert.equal(beat.cycle.signal, "SIGTERM");
  assert.equal(beat.cycle.lastError, "child stopped");
});

test("the first cycle can beat before any finished history exists", () => {
  const beat = liveCycleHeartbeat(null, { at: "2026-10-02T01:02:00.000Z", startedAt: "2026-10-02T01:02:00.000Z",
    testedSha: "a".repeat(40), host: "meanwhile-runner" });
  assert.equal(beat.lastCycleFinishedAt, null);
  assert.equal(beat.lastCycleOk, null);
});

test("the hang watchdog terminates only when the ping is stale past the threshold", () => {
  const t0 = 1_000_000;
  const KILL = 15 * 60_000;
  assert.equal(hangShouldTerminate(t0, t0 + 60_000, KILL), false); // 1 min stale
  assert.equal(hangShouldTerminate(t0, t0 + KILL, KILL), false); // exactly at threshold, not yet
  assert.equal(hangShouldTerminate(t0, t0 + KILL + 1, KILL), true); // just past
  assert.equal(hangShouldTerminate(t0, t0 + 90 * 60_000, KILL), true); // long hang
  assert.equal(hangShouldTerminate(Number.NaN, t0, KILL), false); // no reading never kills
  assert.equal(hangShouldTerminate(0, t0, KILL), false); // uninitialized ping never kills
  assert.equal(hangShouldTerminate(t0, t0 + 90 * 60_000, 0), false); // disabled never kills
});
