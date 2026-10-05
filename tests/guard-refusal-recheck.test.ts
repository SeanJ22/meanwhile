import assert from "node:assert/strict";
import test from "node:test";
import { ZERO_COST } from "../lib/control-plane/attempt.ts";
import { guardRecheckAt, refusedByOurOwnGuard, scoutTaskAdmission, GUARD_RECHECK_MINUTES } from "../lib/control-plane/workers/scout-scheduling.ts";
import { nextAutonomousOperation, runAutonomousCoordinator, type AutonomousCoordinatorRuntime } from "../lib/control-plane/workers/coordinator.ts";
import { autonomousHarness } from "./helpers/autonomous-fleet.ts";

const GUARD_DETAIL = "SCOUT_RESULT_REFUSED after 0 turn(s), 0 tool call(s), 0 rung(s): SCOUT_POLICY_DENIED — request refused before sending by the spending or execution policy: UNMEASURED_MODEL_SPEND: one charge has no price";

test("CH-29: the words our own guard refuses with are recognised, and nothing else is", () => {
  assert.equal(refusedByOurOwnGuard(GUARD_DETAIL), true);
  assert.equal(refusedByOurOwnGuard("SCOUT_RESULT_REFUSED: SCOUT_TRANSPORT_FAILED — the provider did not answer"), false);
  assert.equal(refusedByOurOwnGuard(null), false);
});

test("CH-29: an item our own guard refused goes back in line on a fixed pace, adds no failure, and keeps its case file", async () => {
  const h = await autonomousHarness({ plan: plan => ({ ...plan, sources: [], acquisition: [] }) });
  let guardOpen = false;
  const runtime: AutonomousCoordinatorRuntime = {
    ...h.runtime,
    rollingCeilingUsd: 1,
    scoutFor: () => ({
      lane: "BOUNDED_MODEL_WORKER",
      workerFor: ({ holder }) => ({ role: "SCOUT", provider: "offline-bounded-control", version: "1", instance: holder }),
      run: async () => ({
        kind: "ABORTED", ranAs: "BOUNDED_MODEL_WORKER", failureOutcome: "DENIED_BY_POLICY", endedAt: h.now(),
        cost: { ...ZERO_COST, requestCount: 0, inputTokens: 0, outputTokens: 0, usd: 0 },
        detail: guardOpen ? "unreachable" : GUARD_DETAIL,
      }),
    }),
  };
  const run = await runAutonomousCoordinator(runtime, { maximum: 1, concurrency: 1 });
  const taskId = run.dispatches[0].routeTaskId!;
  const attempt = (await h.repos.attempts.mustRead(run.dispatches[0].attemptId!)).value;
  assert.equal(attempt.outcome, "DENIED_BY_POLICY");
  const tasks = (await h.repos.routeTasks.list()).map((row) => row.value);
  const attempts = (await h.repos.attempts.list()).map((row) => row.value);
  const task = tasks.find((t) => t.id === taskId)!;
  assert.equal(task.state, "POLICY_DENIED");

  const recheckAt = guardRecheckAt(attempt)!;
  assert.equal(recheckAt, new Date(Date.parse(attempt.endedAt!) + GUARD_RECHECK_MINUTES * 60_000).toISOString());
  const waiting = scoutTaskAdmission(task, tasks, attempts, h.now());
  assert.equal(waiting?.state, "BACKOFF");
  assert.equal(waiting?.retryAt, recheckAt);
  assert.equal(waiting?.debt, null, "a refusal before anything was sent is no failed attempt on the source");
  assert.equal((await nextAutonomousOperation(runtime, h.item.id)).action, "BLOCKED", "not before its pace");

  h.advanceTo(recheckAt);
  const due = scoutTaskAdmission(task, tasks, attempts, h.now());
  assert.equal(due?.state, "POLICY_RECHECK");
  assert.equal((await nextAutonomousOperation(runtime, h.item.id)).action, "SCOUT", "back in line once the pace has passed");
  assert.equal((await h.repos.routeTasks.mustRead(taskId)).value.state, "RECLAIMABLE");
});
