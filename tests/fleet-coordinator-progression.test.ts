import assert from "node:assert/strict";
import test from "node:test";
import { createWorkItem } from "../lib/control-plane/work-item.ts";
import { registerWorkItem } from "../lib/control-plane/repository/coordinator.ts";
import { registerAutonomousPlan, runAutonomousCoordinator } from "../lib/control-plane/workers/coordinator.ts";
import { autonomousHarness } from "./helpers/autonomous-fleet.ts";

async function addWork(h: Awaited<ReturnType<typeof autonomousHarness>>, index: number, ownerInstructions: readonly string[] = [], known = false) {
  const item = createWorkItem({ project: h.item.project, subject: `fixture:waiting:${index}`,
    obligation: "Find the authoritative fixture roster", why: "Offline scheduling control",
    contract: { requiresValidation: true, requiresAudit: true }, now: h.now() });
  await registerWorkItem(h.repos, item, h.now());
  const plan = h.item.autonomousPlan!;
  await registerAutonomousPlan(h.repos, item.id, { ...plan,
    contract: { ...plan.contract, subjectId: item.subject }, ...(known ? {} : { sources: [], acquisition: [] }), ownerInstructions }, h.now());
  return item;
}

test("a directed Send takes the normal worker slot ahead of unrelated older work", async () => {
  const h = await autonomousHarness();
  await addWork(h, 1, [], true);
  const directed = await addWork(h, 2, ["owner-send-1"], true);
  const cycle = await runAutonomousCoordinator(h.runtime, { maximum: 1, concurrency: 1,
    prioritizedInstructions: [{ receiptId: "owner-send-1", priority: 1 }] });
  assert.equal(cycle.decisions[0].workItemId, directed.id);
  assert.equal(cycle.dispatches.length, 1);
  assert.equal(cycle.dispatches[0].routeTaskId, cycle.decisions[0].task?.id);
});

test("unserved obligations receive a turn before an earlier item consumes another stage", async () => {
  const h = await autonomousHarness();
  const waiting = await addWork(h, 1, [], true);
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

test("a short legacy deadline does not stop planning or dispatch within the stated diagnostic count", async () => {
  const h = await autonomousHarness();
  for (let i = 0; i < 24; i++) await addWork(h, i, [], true);
  let resultReads = 0;
  // Histories may arrive per item or as the cycle's one joined read (#701);
  // either counts, as long as the coordinator actually consulted them.
  const read = h.repos.workerResults.read.bind(h.repos.workerResults);
  h.repos.workerResults.read = async key => { resultReads++; return read(key); };
  const readAll = h.repos.workerResults.readAll.bind(h.repos.workerResults);
  h.repos.workerResults.readAll = async () => { resultReads++; return readAll(); };
  const beforeTasks = await h.repos.routeTasks.list();
  const beforeAttempts = await h.repos.attempts.list();
  const cycle = await runAutonomousCoordinator(h.runtime, {
    maximum: 3, concurrency: 2, deadlineMs: Date.now() + 60_000,
  });
  assert.equal(cycle.dispatches.length, 3);
  assert.ok(resultReads > 0, "Worker histories still inform admission");
  assert.ok(cycle.deferred.every(row => row.reason !== "WALL_CLOCK_CEILING"));
  assert.ok((await h.repos.routeTasks.list()).length > beforeTasks.length);
  assert.equal((await h.repos.attempts.list()).length, beforeAttempts.length + 3);
});

test("an already elapsed legacy deadline does not hold free work", async () => {
  const h = await autonomousHarness();
  const cycle = await runAutonomousCoordinator(h.runtime, { deadlineMs: Date.now() - 1 });
  assert.equal(cycle.deferred.length, 0);
  assert.equal(cycle.decisions.length, 1);
  assert.equal(cycle.dispatches.length, 1);
});
