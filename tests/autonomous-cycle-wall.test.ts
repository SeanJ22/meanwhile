import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { appendFreshnessCycleDigest, readLatestFreshnessCycleOutcome } from "../lib/control-plane/freshness-cycle-outcome.ts";
import type { FreshnessCycleOutcome } from "../lib/control-plane/owner-surface.ts";
import { ControlPlaneRequestTimeout, withStoreBudget } from "../lib/control-plane/repository/request-bounds.ts";
import { WORKER_MAX_WALL_MS } from "../lib/control-plane/workers/runtime.ts";
import { runAutonomousCoordinator } from "../lib/control-plane/workers/coordinator.ts";
import { runHeldWorkerFleetCycle } from "../lib/control-plane/workers/standing.ts";
import { autonomousHarness } from "./helpers/autonomous-fleet.ts";

test("the normal cycle wires its autonomous store and dispatch deadlines ahead of finalization", () => {
  const source = readFileSync(new URL("../scripts/freshness-shadow.mts", import.meta.url), "utf8");
  const store = source.indexOf("const autonomousStoreDeadlineMs = lateWorkDeadlineMs(CLOCK) - 15_000;");
  const dispatch = source.indexOf("const autonomousDeadlineMs = Math.min(DISPATCH_DEADLINE_MS - 60_000, autonomousStoreDeadlineMs - 30_000);");
  const bounded = source.indexOf('await withStoreBudget("autonomous-workers", Math.max(0, autonomousStoreDeadlineMs - Date.now())');
  const coordinator = source.indexOf("await runAutonomousCoordinator(fleet, {", bounded);
  const final = source.indexOf('finalStep("research-state:final"', coordinator);
  assert.ok(store >= 0 && store < dispatch && dispatch < bounded && bounded < coordinator && coordinator < final);
  assert.match(source.slice(bounded, final), /runHeldWorkerFleetCycle\(ROOT, fleet, true, \{[\s\S]*?deadlineMs: autonomousDeadlineMs/);
  assert.match(source.slice(bounded, final), /onDeferred: reason => runtimeConditions\.push/);
});

function completedCycle(deferred: number): FreshnessCycleOutcome {
  return {
    kind: "FRESHNESS_CYCLE", state: "SUCCEEDED", cycleId: "freshness-cycle:fixture:wall-slice",
    startedAt: "2026-09-28T13:21:13.000Z", finishedAt: "2026-09-28T13:33:30.000Z",
    testedSha: "a".repeat(40), host: "fixture", provider: "memory", durable: true,
    executor: "route-aware + scout", registry: null, obligations: 1, occurrencesOpened: 0,
    debtInherited: 0, debtPersisted: 0, debtCleared: 0, scheduled: 1, unscheduled: [],
    dueCount: 1, dispatched: 0, worked: [], dispositions: [], dispatchDetails: [],
    research: null, deferred, debts: 0, incidents: [], risk: null, health: null,
    promotedToReaderTruth: false, failure: null,
  };
}

test("a slow repository selection yields owed autonomous work and permits a durable completed cycle", async () => {
  const h = await autonomousHarness({ plan: plan => ({ ...plan, sources: [], acquisition: [] }) });
  const original = h.repos.workItems.mustRead.bind(h.repos.workItems);
  h.repos.workItems.mustRead = async id => {
    if (id === h.item.id) {
      await new Promise(resolve => setTimeout(resolve, 25));
      throw new ControlPlaneRequestTimeout({ operation: "workItems.mustRead", callClass: "POINT",
        timeoutMs: 0, kind: "DEADLINE", budget: "autonomous-workers" });
    }
    return original(id);
  };
  const before = (await h.repos.attempts.list()).length;
  const slice = await withStoreBudget("autonomous-workers", 100, () => runAutonomousCoordinator(h.runtime, {
    maximum: 1, concurrency: 1, deadlineMs: Date.now() + WORKER_MAX_WALL_MS + 60_000,
  }));
  assert.equal(slice.dispatches.length, 0);
  assert.equal(slice.deferred.find(row => row.workItemId === h.item.id)?.reason, "WALL_CLOCK_CEILING");
  assert.equal((await h.repos.attempts.list()).length, before, "no worker or paid attempt was abandoned");
  assert.equal((await h.repos.workItems.read(h.item.id))?.value.state, "OPEN");
  await appendFreshnessCycleDigest(h.repos, { outcome: completedCycle(1), lines: ["autonomous selection yielded; work remains owed"] });
  assert.equal((await readLatestFreshnessCycleOutcome(h.repos))?.outcome.state, "SUCCEEDED");
});

test("held selection that consumes the remaining dispatch window leaves the worker queued without starting an attempt", async () => {
  const h = await autonomousHarness();
  let clock = 0;
  const original = h.repos.artifacts.readAll.bind(h.repos.artifacts);
  h.repos.artifacts.readAll = async () => {
    const rows = await original();
    clock = 20;
    return rows;
  };
  const deferred: string[] = [];
  const before = (await h.repos.attempts.list()).length;
  const result = await runHeldWorkerFleetCycle(process.cwd(), h.runtime, false, {
    maximumDispatches: 1, deadlineMs: WORKER_MAX_WALL_MS + 10,
    nowMs: () => clock, onDeferred: reason => deferred.push(reason),
  });
  assert.deepEqual(result, []);
  assert.match(deferred[0] ?? "", /work remains owed|enqueued work remains owed/);
  assert.equal((await h.repos.attempts.list()).length, before);
  assert.equal((await h.repos.workItems.read(h.item.id))?.value.state, "OPEN");
  await appendFreshnessCycleDigest(h.repos, { outcome: completedCycle(1), lines: ["held drain yielded; queued work remains owed"] });
  assert.equal((await readLatestFreshnessCycleOutcome(h.repos))?.outcome.state, "SUCCEEDED");
});
