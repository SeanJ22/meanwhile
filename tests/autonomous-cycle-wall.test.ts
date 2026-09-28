import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { appendFreshnessCycleDigest, readLatestFreshnessCycleOutcome } from "../lib/control-plane/freshness-cycle-outcome.ts";
import type { FreshnessCycleOutcome } from "../lib/control-plane/owner-surface.ts";
import { ControlPlaneRequestTimeout, currentStoreBudget, withStoreBudget } from "../lib/control-plane/repository/request-bounds.ts";
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

test("the original instruction starts before independent lanes and joins before finalization", async () => {
  const source = readFileSync(new URL("../scripts/freshness-shadow.mts", import.meta.url), "utf8");
  const early = source.indexOf("const earlyOriginal =");
  const meetings = source.indexOf('finishPhase("meetings-discovery");', early);
  const campaign = source.indexOf('finishPhase("campaign-sites");', meetings);
  const candidate = source.indexOf('finishPhase("candidate-publications");', campaign);
  const join = source.indexOf("earlyAutonomous = earlyOriginal === null ? null : await earlyOriginal;", candidate);
  const final = source.indexOf('finalStep("research-state:final"', join);
  assert.ok(early >= 0 && early < meetings && meetings < campaign && campaign < candidate && candidate < join && join < final);
  assert.match(source.slice(early, meetings), /exactInstructionAutonomousWorkIds\([\s\S]*?assignmentKey: ORIGINAL_LIFETIME_HUNT\.key, receiptId: ORIGINAL_LIFETIME_HUNT\.receiptId/);
  assert.match(source.slice(early, meetings), /acceptsWorkItem: item => lifetimeHuntSubjects\.has\(item\.subject\) && exactWorkIds\.has\(item\.id\)/);
  assert.doesNotMatch(source.slice(early, meetings), /maximum:/, "the original hunt has no discretionary dispatch count cap");
  assert.match(source.slice(source.indexOf("const autonomousCycleOpen ="), meetings), /const autonomousCycleOpen = autonomousCycleAllowed\(\{ dry, canary, only: ONLY, ids: IDS,[\s\S]*?runnerPaused: intents\.runnerPause\.paused/);
  assert.match(source.slice(join, final), /if \(autonomousCycleOpen && Date\.now\(\) \+ 150_000 < autonomousDeadlineMs\)/);
  assert.match(source.slice(join, final), /scheduledBlackout \? \{ acceptsWorkItem:[\s\S]*?earlyExactWorkIds\?\.has\(item\.id\) === true/);

  // Measured old cycles reached the late block at 566 s; its 150 s admission
  // cannot fit before 690 s. Starting after debt commit at 400 s can fit.
  const cycleStart = Date.now() - 400_000;
  const deadline = cycleStart + 690_000;
  assert.ok(Date.now() + 150_000 < deadline);
  assert.ok(cycleStart + 566_000 + 150_000 >= deadline);
  const h = await autonomousHarness({ plan: plan => ({ ...plan, ownerInstructions: ["original-receipt"] }) });
  const list = h.repos.workItems.list.bind(h.repos.workItems);
  let releaseSelection!: () => void;
  const heldSelection = new Promise<void>(resolve => { releaseSelection = resolve; });
  h.repos.workItems.list = async () => { await heldSelection; return list(); };
  const earlyPass = runAutonomousCoordinator(h.runtime, { concurrency: 1, deadlineMs: deadline,
    acceptsWorkItem: item => item.autonomousPlan?.ownerInstructions?.includes("original-receipt") === true });
  let ordinaryLaneRan = false;
  await Promise.resolve().then(() => { ordinaryLaneRan = true; });
  releaseSelection();
  const pass = await earlyPass;
  assert.equal(ordinaryLaneRan, true, "independent lanes can run while the original slice selects work");
  assert.equal(pass.dispatches.length, 1);
  assert.equal(pass.dispatches[0].outcome, "WORKED");
  await appendFreshnessCycleDigest(h.repos, { outcome: completedCycle(0), lines: ["normal original slice settled before finalization"] });
  assert.equal((await readLatestFreshnessCycleOutcome(h.repos))?.outcome.state, "SUCCEEDED");
});

test("the early slice's store deadline does not leak into independent cycle lanes", async () => {
  let release!: () => void;
  const hold = new Promise<void>(resolve => { release = resolve; });
  const original = withStoreBudget("original-hunt-early-workers", 10, async () => {
    assert.equal(currentStoreBudget()?.label, "original-hunt-early-workers");
    await hold;
    assert.equal(currentStoreBudget()?.label, "original-hunt-early-workers");
  });
  const independent = await withStoreBudget("independent-publication", 1_000, async () => currentStoreBudget());
  assert.equal(independent?.label, "independent-publication");
  release();
  await original;
  assert.equal(currentStoreBudget(), undefined);
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
