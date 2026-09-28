import assert from "node:assert/strict";
import test from "node:test";
import { createWorkItem } from "../lib/control-plane/work-item.ts";
import { registerWorkItem } from "../lib/control-plane/repository/coordinator.ts";
import { registerAutonomousPlan, runAutonomousCoordinator } from "../lib/control-plane/workers/coordinator.ts";
import { autonomousHarness } from "./helpers/autonomous-fleet.ts";

async function addUnknownSource(h: Awaited<ReturnType<typeof autonomousHarness>>, index: number, ownerInstructions: readonly string[] = []) {
  const item = createWorkItem({ project: h.item.project, subject: `fixture:waiting:${index}`,
    obligation: "Find the authoritative fixture roster", why: "Offline scheduling control",
    contract: { requiresValidation: true, requiresAudit: true }, now: h.now() });
  await registerWorkItem(h.repos, item, h.now());
  const plan = h.item.autonomousPlan!;
  await registerAutonomousPlan(h.repos, item.id, { ...plan,
    contract: { ...plan.contract, subjectId: item.subject }, sources: [], acquisition: [], ownerInstructions }, h.now());
  return item;
}

test("a directed Send takes the normal worker slot ahead of unrelated older work", async () => {
  const h = await autonomousHarness();
  await addUnknownSource(h, 1);
  const directed = await addUnknownSource(h, 2, ["owner-send-1"]);
  const cycle = await runAutonomousCoordinator(h.runtime, { maximum: 1, concurrency: 1,
    prioritizedInstructions: [{ receiptId: "owner-send-1", priority: 1 }] });
  assert.equal(cycle.decisions[0].workItemId, directed.id);
  assert.equal(cycle.dispatches.length, 1);
});

test("unserved obligations receive a turn before an earlier item consumes another stage", async () => {
  const h = await autonomousHarness();
  const waiting = await addUnknownSource(h, 1);
  // Deliberately keep the already served item first, regardless of hashed ids.
  const list = h.repos.workItems.list.bind(h.repos.workItems);
  h.repos.workItems.list = async () => [...await list()].sort((a, b) =>
    Number(b.id === h.item.id) - Number(a.id === h.item.id));
  const prior = (await h.repos.attempts.list()).length;
  const cycle = await runAutonomousCoordinator(h.runtime, { maximum: 1, concurrency: 1 });
  assert.equal(cycle.decisions[0].workItemId, waiting.id);
  assert.equal(cycle.dispatches.length, 1);
  assert.equal((await h.repos.attempts.list()).length, prior + 1);
  assert.equal((await h.repos.workItems.mustRead(waiting.id)).value.state, "OPEN");
  assert.equal(cycle.deferred.find(row => row.workItemId === h.item.id)?.reason, "COORDINATOR_CYCLE_MAX");
  const nextCycle = await runAutonomousCoordinator(h.runtime, { maximum: 1, concurrency: 1 });
  assert.equal(nextCycle.decisions[0].workItemId, h.item.id, "The least recently served item gets the next turn");
  assert.equal(nextCycle.dispatches[0].outcome, "WORKED");
});

test("insufficient dispatch time stops expensive planning and reports the actual ceiling", async () => {
  const h = await autonomousHarness({ plan: plan => ({ ...plan, sources: [], acquisition: [] }) });
  for (let i = 0; i < 24; i++) await addUnknownSource(h, i);
  let resultReads = 0;
  const read = h.repos.workerResults.read.bind(h.repos.workerResults);
  h.repos.workerResults.read = async key => { resultReads++; return read(key); };
  const beforeTasks = await h.repos.routeTasks.list();
  const beforeAttempts = await h.repos.attempts.list();
  const cycle = await runAutonomousCoordinator(h.runtime, {
    maximum: 3, concurrency: 2, deadlineMs: Date.now() + 60_000,
  });
  assert.equal(cycle.dispatches.length, 0);
  assert.equal(resultReads, 0, "No worker result histories are read when no existing dispatch bound fits");
  assert.equal(cycle.deferred.length, 25);
  assert.ok(cycle.deferred.every(row => row.reason === "WALL_CLOCK_CEILING"));
  assert.deepEqual(await h.repos.routeTasks.list(), beforeTasks);
  assert.deepEqual(await h.repos.attempts.list(), beforeAttempts);
});

test("an already elapsed deadline is never described as a dispatch count limit", async () => {
  const h = await autonomousHarness();
  const cycle = await runAutonomousCoordinator(h.runtime, { deadlineMs: Date.now() - 1 });
  assert.equal(cycle.deferred.length, 1);
  assert.equal(cycle.deferred[0].reason, "WALL_CLOCK_CEILING");
  assert.equal(cycle.decisions.length, 0);
});
