import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { recordFailedCycle, type FailedCycleInput } from "../lib/control-plane/scheduler/cycle-finalization.ts";
import { PendingOperations } from "../lib/control-plane/scheduler/cycle-stall.ts";

function input(repos: FailedCycleInput["repos"], write: FailedCycleInput["writeLocalRecord"]): FailedCycleInput {
  const pending = new PendingOperations();
  pending.phaseFinished("worker-dispatch");
  pending.enter("worker-result");
  return { repos, error: new Error("worker result failed"), cycleId: "freshness-cycle:test:2026-09-30",
    startedAt: "2026-09-30T00:00:00.000Z", finishedAt: "2026-09-30T01:00:00.000Z",
    testedSha: null, host: "test", pending: pending.snapshot(), writeLocalRecord: write, log: () => {} };
}

test("a failed cycle appends its canonical outcome and preserves the pending operation", async () => {
  const repos = createMemoryRepositories();
  const records: Record<string, unknown>[] = [];
  const result = await recordFailedCycle(input(repos, record => { records.push(record); return "local-record"; }));
  assert.equal(result.canonical, "APPENDED");
  assert.equal(result.recordPath, "local-record");
  assert.equal(records[0].crashed, true);
  const digests = await repos.ownerDigests.readAll();
  assert.equal(digests.length, 1);
  assert.equal(digests[0].runtimeOutcome?.state, "FAILED");
  assert.match(JSON.stringify(records[0].pending), /worker-result/);
});

test("an append failure retains the local failed-cycle record without an attempt clock", async () => {
  const repos = createMemoryRepositories();
  repos.ownerDigests.append = async () => { throw new Error("store unavailable"); };
  const records: Record<string, unknown>[] = [];
  const result = await recordFailedCycle(input(repos, record => { records.push(record); return "local-record"; }));
  assert.equal(result.canonical, "NOT_APPENDED");
  assert.equal(records[0].canonicalOutcome, "NOT_APPENDED");
  assert.match(String(records[0].error), /worker result failed/);
});

test("a crash before store connection still records its local failure", async () => {
  const result = await recordFailedCycle(input(null, record => {
    assert.equal(record.canonicalOutcome, "NO_STORE");
    return "local-record";
  }));
  assert.equal(result.canonical, "NO_STORE");
  assert.equal(result.recordPath, "local-record");
});
