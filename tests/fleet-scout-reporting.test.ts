import assert from "node:assert/strict";
import test from "node:test";
import { ZERO_COST } from "../lib/control-plane/attempt.ts";
import { readFleetOperations } from "../lib/control-plane/fleet-operations.ts";
import { FIRST_BACKOFF_MINUTES } from "../lib/control-plane/scheduler/debt.ts";
import { nextAutonomousOperation, runAutonomousCoordinator, type AutonomousCoordinatorRuntime } from "../lib/control-plane/workers/coordinator.ts";
import { scoutTaskAdmission } from "../lib/control-plane/workers/scout-scheduling.ts";
import { autonomousHarness } from "./helpers/autonomous-fleet.ts";

test("Admin joins the exact Scout denial backoff without authorizing the missing transport", async () => {
  const h = await autonomousHarness({ plan: plan => ({ ...plan, sources: [], acquisition: [] }) });
  const run = await runAutonomousCoordinator(h.runtime, { maximum: 1, concurrency: 1 });
  const taskId = run.dispatches[0].routeTaskId!;
  const attempt = (await h.repos.attempts.mustRead(run.dispatches[0].attemptId!)).value;
  assert.equal(attempt.outcome, "DENIED_BY_POLICY");
  const retryAt = new Date(Date.parse(attempt.endedAt!) + FIRST_BACKOFF_MINUTES * 60_000).toISOString();
  const before = await h.repos.routeTasks.list();
  const report = await readFleetOperations(h.repos, { observedAt: h.now() });
  assert.equal(report.operations.kind, "HELD");
  if (report.operations.kind !== "HELD") throw new Error("Fixture report unavailable");
  const row = report.operations.value[0].tasks.find(task => task.taskId === taskId)!;
  assert.equal(row.admission, null);
  assert.equal(row.scoutAdmission?.state, "BACKOFF");
  assert.deepEqual(row.scoutAdmission?.attemptIds, [attempt.id], "Unrelated seed-observation Scout is outside this retry family");
  assert.equal(row.retryAt, retryAt);
  assert.equal(row.nextAutomaticAction, "WAIT_FOR_BACKOFF");
  assert.deepEqual(await h.repos.routeTasks.list(), before, "The reporting join has no reauthorization side effect");
  h.advanceTo(retryAt);
  const dueReport = await readFleetOperations(h.repos, { observedAt: h.now() });
  if (dueReport.operations.kind !== "HELD") throw new Error("Fixture report unavailable");
  const dueRow = dueReport.operations.value[0].tasks.find(task => task.taskId === taskId)!;
  assert.equal(dueRow.scoutAdmission?.state, "POLICY_RECHECK");
  assert.equal(dueRow.scoutAdmission?.requiresPolicyRecheck, true);
  assert.equal(dueRow.nextAutomaticAction, "POLICY_RECHECK");
  assert.equal((await nextAutonomousOperation(h.runtime, h.item.id)).action, "BLOCKED");
  assert.equal((await h.repos.routeTasks.mustRead(taskId)).value.state, "POLICY_DENIED");
});

test("Scout continuation reporting uses the coordinator's family backoff and actual continuation identity", async () => {
  const h = await autonomousHarness({ plan: plan => ({ ...plan, sources: [], acquisition: [] }) });
  const runtime: AutonomousCoordinatorRuntime = { ...h.runtime, scoutFor: () => ({ lane: "BOUNDED_MODEL_WORKER",
    workerFor: ({ holder }) => ({ role: "SCOUT", provider: "offline-bounded-control", version: "1", instance: holder }),
    run: async () => ({ kind: "DISPOSED", ranAs: "BOUNDED_MODEL_WORKER", endedAt: h.now(),
      cost: { ...ZERO_COST, requestCount: 0, inputTokens: 0, outputTokens: 0, usd: 0 }, artifacts: [],
      disposition: { disposition: "BLOCKED_CURRENTLY", observation: null, permission: "ALLOWED", transport: "OTHER_NAMED_FAILURE",
        note: "Offline bounded search stopped without settling its obligation." }, detail: "Unresolved fixture search; no civic source claim." }) }) };
  const first = await runAutonomousCoordinator(runtime, { maximum: 1, concurrency: 1 });
  assert.equal(first.dispatches[0].outcome, "WORKED");
  const task = (await h.repos.routeTasks.mustRead(first.dispatches[0].routeTaskId!)).value;
  async function reading() {
    return scoutTaskAdmission(task, (await h.repos.routeTasks.list()).map(row => row.value),
      (await h.repos.attempts.list()).map(row => row.value), h.now())!;
  }
  const waiting = await reading();
  assert.equal(waiting.state, "BACKOFF");
  assert.match((await nextAutonomousOperation(runtime, h.item.id)).reason, new RegExp(waiting.retryAt!.replaceAll(".", "\\.")));
  h.advanceTo(waiting.retryAt!);
  assert.equal((await reading()).state, "CONTINUATION_CANDIDATE");
  const continuation = await nextAutonomousOperation(runtime, h.item.id);
  assert.equal(continuation.action, "SCOUT");
  const continued = await reading();
  assert.equal(continued.state, "CONTINUED");
  assert.equal(continued.nextTaskId, continuation.task?.id);
  const second = await runAutonomousCoordinator(runtime, { maximum: 1, concurrency: 1 });
  assert.equal(second.dispatches[0].routeTaskId, continuation.task!.id);
  const child = (await h.repos.routeTasks.mustRead(continuation.task!.id)).value;
  const attempts = (await h.repos.attempts.list()).map(row => row.value);
  const childReading = scoutTaskAdmission(child, (await h.repos.routeTasks.list()).map(row => row.value), attempts, h.now())!;
  const childAttempt = attempts.find(attempt => attempt.id === second.dispatches[0].attemptId)!;
  assert.equal(childReading.debt?.consecutiveFailures, 2);
  assert.equal(childReading.retryAt, new Date(Date.parse(childAttempt.endedAt!) + 2 * FIRST_BACKOFF_MINUTES * 60_000).toISOString());
  assert.equal((await nextAutonomousOperation(runtime, h.item.id)).action, "BLOCKED");
});

test("Scout-shaped prose and unrelated route tasks do not earn autonomous admission evidence", async () => {
  const h = await autonomousHarness();
  const tasks = (await h.repos.routeTasks.list()).map(row => row.value);
  const attempts = (await h.repos.attempts.list()).map(row => row.value);
  assert.equal(attempts[0].worker.role, "SCOUT");
  assert.equal(scoutTaskAdmission(tasks[0], tasks, attempts, h.now()), null);
  assert.equal(scoutTaskAdmission({ ...tasks[0], routeId: "autonomous:scout:unknown-root:continue:fixture" }, tasks, attempts, h.now()), null);
});
