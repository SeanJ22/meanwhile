import assert from "node:assert/strict";
import test from "node:test";
import { readGateHealth, summarizeGateHealth, type GateHealthReadings } from "../lib/control-plane/admin-view/gate-health.ts";
import type { RunnerHeartbeat } from "../lib/control-plane/owner-surface.ts";

const now = "2026-10-04T12:00:00Z";
const beat = (over: Partial<RunnerHeartbeat> = {}): RunnerHeartbeat => ({
  formatVersion: 1,
  beatAt: "2026-10-04T11:30:00Z",
  lastCycleStartedAt: "2026-10-04T11:00:00Z",
  lastCycleFinishedAt: "2026-10-04T11:30:00Z",
  nextCycleDueAt: "2026-10-04T12:30:00Z",
  lastCycleOk: true,
  testedSha: "abc",
  host: "h",
  codeIdentity: { verdict: "CONSISTENT", detail: "ok" } as RunnerHeartbeat["codeIdentity"],
  ...over,
});
const base: GateHealthReadings = {
  nowIso: now,
  heartbeat: beat(),
  databaseReachable: true,
  lastDispatch: { finishedAt: "2026-10-04T11:20:00Z", durableResult: true },
  spend: { rolling24HoursUsd: 4, effectiveCeilingUsd: 20, worstCaseCharges: 0 },
};
const byId = (r: GateHealthReadings, id: string) => readGateHealth(r).find((g) => g.id === id)!;

test("GATE-02 to GATE-12 each appear once, in order, and none is a pass without a reading", () => {
  const rows = readGateHealth(base);
  assert.deepEqual(rows.map((r) => r.id), ["GATE-02", "GATE-03", "GATE-04", "GATE-05", "GATE-06", "GATE-07", "GATE-08", "GATE-09", "GATE-10", "GATE-11", "GATE-12"]);
  assert.deepEqual(summarizeGateHealth(rows), { pass: 6, attention: 0, notMeasured: 5, total: 11 });
  for (const id of ["GATE-05", "GATE-08", "GATE-09", "GATE-10", "GATE-11"]) assert.equal(byId(base, id).state, "not_measured");
});

test("with no readings at all every gate is not measured, never pass", () => {
  const rows = readGateHealth({ nowIso: now, heartbeat: null, databaseReachable: null, lastDispatch: null, spend: null });
  assert.ok(rows.every((r) => r.state === "not_measured"));
});

test("a silent runner raises attention on release and overnight gates", () => {
  const r = { ...base, heartbeat: beat({ beatAt: "2026-10-04T03:00:00Z" }) };
  assert.equal(byId(r, "GATE-02").state, "attention");
  assert.equal(byId(r, "GATE-12").state, "attention");
});

test("a runner behind the released code is attention and quotes the reason", () => {
  const r = { ...base, heartbeat: beat({ codeIdentity: { verdict: "RUNNER_BEHIND_EXECUTABLE", detail: "behind by two" } as RunnerHeartbeat["codeIdentity"] }) };
  assert.equal(byId(r, "GATE-02").state, "attention");
  assert.equal(byId(r, "GATE-02").sentence, "behind by two");
});

test("spend over the ceiling or counted at worst case is attention", () => {
  assert.equal(byId({ ...base, spend: { rolling24HoursUsd: 25, effectiveCeilingUsd: 20, worstCaseCharges: 0 } }, "GATE-06").state, "attention");
  const w = byId({ ...base, spend: { rolling24HoursUsd: 4, effectiveCeilingUsd: 20, worstCaseCharges: 2 } }, "GATE-06");
  assert.equal(w.state, "attention");
  assert.match(w.sentence, /2 charges were counted at the worst case/);
  assert.equal(byId({ ...base, spend: { rolling24HoursUsd: null, effectiveCeilingUsd: 20, worstCaseCharges: 0 } }, "GATE-06").state, "not_measured");
});

test("a paused runner or an overdue next cycle is attention on the schedule gate", () => {
  assert.equal(byId({ ...base, heartbeat: beat({ pause: { intentId: "i", since: now, note: null } }) }, "GATE-07").state, "attention");
  assert.equal(byId({ ...base, heartbeat: beat({ nextCycleDueAt: "2026-10-04T10:00:00Z" }) }, "GATE-07").state, "attention");
});

test("database and dispatch gates report unreached and unsaved results", () => {
  assert.equal(byId({ ...base, databaseReachable: false }, "GATE-03").state, "attention");
  assert.equal(byId({ ...base, lastDispatch: { finishedAt: now, durableResult: false } }, "GATE-04").state, "attention");
});
