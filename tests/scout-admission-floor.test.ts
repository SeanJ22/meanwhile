/**
 * **THE SCOUT LANE'S ADMISSION TIME HAS A FLOOR THE DOWNSTREAM RESERVE CANNOT ZERO.**
 * (2026-09-18. Measured live: two clean runner cycles deferred every Scout for
 * BUDGET while the cycle finished at ~half the hard wall.)
 *
 * `fleetReserveMs` reduces the SHARED `budget.deadlineMs` to keep the always-full
 * deterministic refresh queue from starving the fleet. Applied to the Scout lane
 * too, it did the opposite: the model lane starts after the pre-dispatch phases,
 * and `reducedDeadline - scoutWallMs` left no window, so a Scout WITH an open
 * occurrence still deferred BUDGET. The Scout lane now admits against its own
 * `scoutDeadlineMs` (the hard dispatch wall). These tests move an injected clock
 * to prove the floor holds and that the pre-fix behaviour is the control.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import type { DeclaredExecutor, ExecutorDecision } from "../lib/control-plane/scheduler/dispatch.ts";
import type { FreshnessObligation } from "../lib/control-plane/scheduler/obligation.ts";
import { runCycle } from "../lib/control-plane/scheduler/shadow-loop.ts";

const NOW = "2026-09-02T00:00:00.000Z";
const NOW_MS = Date.parse(NOW);
const SCOUT_WALL_MS = 300_000; // 5 min
/* The injected clock reads 100s into the cycle — after the pre-dispatch phases. */
const CLOCK_MS = NOW_MS + 100_000;
/* The deterministic lane's deadline AFTER the downstream reserve: too tight for a
   5-min Scout (100s + 300s = 400s > 350s). This is what starved the Scouts. */
const RESERVED_DEADLINE = NOW_MS + 350_000;
/* The hard dispatch wall the Scout lane should admit against: 13 min, room to spare. */
const HARD_DEADLINE = NOW_MS + 780_000;

function modelObligation(id: string): FreshnessObligation {
  return { id, recordClass: "meetings", subjectId: `body:${id}`, routeId: `route:${id}`, active: true, readerImpactAt: null, observedChangeRateHours: null, lastWorkedAt: null };
}

const modelExecutor: DeclaredExecutor = {
  lane: "BOUNDED_MODEL_WORKER",
  run: async () => ({ ranAs: "BOUNDED_MODEL_WORKER", kind: "ABORTED", detail: "test scout — admission is what's under test" }),
};
const modelDecision: ExecutorDecision = { kind: "BOUNDED_MODEL_WORKER", why: "test model row", disagreement: null };

async function runScoutCycle(scoutDeadlineMs: number | undefined) {
  return runCycle({
    repos: createMemoryRepositories(),
    obligations: [modelObligation("m")],
    debts: [],
    /* A non-null RouteTask id => the row has an open occurrence this cycle, so it
       reaches the budget check rather than deferring NO_OPEN_OCCURRENCE. The task
       is absent from the empty repo, so the dispatch records NOT_CLAIMED after
       admission — admission, not the executor, is under test. */
    routeTaskFor: (id) => `rt-${id}`,
    maturity: () => "UNGRADUATED",
    executor: { lane: "DETERMINISTIC", run: async () => ({ ranAs: "DETERMINISTIC", kind: "ABORTED", detail: "no deterministic rows" }) },
    holder: "test",
    now: NOW,
    leaseTtlMs: 1000,
    reader: { contract: "READER", state: "NOT_READY", reason: "test" },
    truth: { contract: "TRUTH", state: "NOT_READY", reason: "test" },
    requireOpenOccurrence: true,
    budget: { deadlineMs: RESERVED_DEADLINE, now: () => CLOCK_MS },
    research: {
      decide: () => modelDecision,
      admitScout: () => ({ admit: true }),
      modelExecutor,
      workerCapacity: 2,
      scoutLeaseTtlMs: 1000,
      scoutWallMs: SCOUT_WALL_MS,
      ...(scoutDeadlineMs !== undefined ? { scoutDeadlineMs } : {}),
    },
  });
}

test("CONTROL: without a scout floor, the reduced deterministic deadline defers the Scout for BUDGET", async () => {
  const cycle = await runScoutCycle(undefined);
  assert.equal(cycle.lanes?.model.dispatched, 0, "the Scout was NOT started — the reserve zeroed its window");
  assert.equal(cycle.lanes?.model.deferredBy.BUDGET, 1, "and it deferred for BUDGET by name");
  assert.ok(
    cycle.deferred.some((d) => d.obligationId === "m" && /dispatch budget was spent/.test(d.why)),
    "the deferral names the budget",
  );
});

test("FIX: scoutDeadlineMs floors admission to the hard wall, so the same Scout is admitted", async () => {
  const cycle = await runScoutCycle(HARD_DEADLINE);
  assert.equal(cycle.lanes?.model.dispatched, 1, "the Scout was admitted against the hard wall despite the reduced deterministic deadline");
  assert.ok(!cycle.lanes?.model.deferredBy.BUDGET, "nothing deferred for BUDGET in the model lane");
  assert.ok(
    !cycle.deferred.some((d) => d.obligationId === "m" && /dispatch budget was spent/.test(d.why)),
    "the Scout is not on the budget-deferred list",
  );
});

test("the floor still stops a Scout that genuinely cannot finish before the hard wall", async () => {
  /* A hard deadline only 100s ahead of the clock: 100s + 300s wall > it, so even
     with the floor the Scout is correctly deferred — the fix restores the window,
     it does not remove the wall (a Scout killed mid-walk leaves an orphan Attempt). */
  const cycle = await runScoutCycle(CLOCK_MS + 100_000);
  assert.equal(cycle.lanes?.model.dispatched, 0, "no Scout is started when it cannot finish before the wall");
  assert.equal(cycle.lanes?.model.deferredBy.BUDGET, 1, "deferred for BUDGET, honestly");
});
