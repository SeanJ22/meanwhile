import assert from "node:assert/strict";
import test from "node:test";

import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import type { FreshnessObligation } from "../lib/control-plane/scheduler/obligation.ts";
import { runCycle } from "../lib/control-plane/scheduler/shadow-loop.ts";

/**
 * **THE DISPATCH BUDGET — a cycle ends on its own clock, never on a kill.**
 * (Autonomy-recovery session, 2026-09-01.)
 *
 * The runner kills a child cycle at a hard ceiling. A kill lands mid-dispatch
 * and leaves open occurrences the next cycle must resume and pay for again — a
 * cycle over the real backlog can outlive the ceiling on latency alone. So the
 * shared cycle takes an INJECTED wall-clock budget: once the clock passes the
 * deadline, every remaining due item is deferred by name and the cycle finishes
 * cleanly. These tests move the clock, which is the only honest way to test a
 * budget — a test that waited would be measuring the machine, not the rule.
 */

const NOW = "2026-09-02T00:00:00.000Z";

function obligation(id: string): FreshnessObligation {
  return {
    id,
    recordClass: "meetings",
    subjectId: `body:${id}`,
    routeId: `route:${id}`,
    active: true,
    readerImpactAt: null,
    observedChangeRateHours: null,
    /* Never worked, so it is owed NOW — every one of these is due this cycle. */
    lastWorkedAt: null,
  };
}

function cycleWith(budget: { deadlineMs: number; now: () => number } | undefined, onRun: () => void) {
  return runCycle({
    repos: createMemoryRepositories(),
    obligations: [obligation("a"), obligation("b"), obligation("c")],
    debts: [],
    /* No RouteTask is registered, so a dispatch reaches the loop and records
       NO_ROUTE_TASK without touching a store — the budget is what is under
       test, not the executor. */
    routeTaskFor: () => null,
    maturity: () => "GRADUATED",
    executor: {
      lane: "DETERMINISTIC",
      run: async () => {
        onRun();
        return { ranAs: "DETERMINISTIC", kind: "ABORTED", detail: "not reached" };
      },
    },
    holder: "test",
    now: NOW,
    leaseTtlMs: 1000,
    reader: { contract: "READER", state: "NOT_READY", reason: "test" },
    truth: { contract: "TRUTH", state: "NOT_READY", reason: "test" },
    ...(budget ? { budget } : {}),
  });
}

test("SEEDED: a budget already spent defers EVERY due item by name and dispatches none", async () => {
  const deadlineMs = Date.parse(NOW);
  const cycle = await cycleWith({ deadlineMs, now: () => deadlineMs + 1 }, () => {});
  assert.equal(cycle.dueCount, 3, "three obligations were due");
  assert.equal(cycle.dispatched.length, 0, "and none was started past the deadline");
  assert.equal(cycle.deferred.length, 3, "every one is DEFERRED, none dropped");
  for (const d of cycle.deferred) {
    assert.match(d.why, /dispatch budget was spent/, `deferral names the budget: ${d.why}`);
    assert.match(d.why, /keeps its next-due/, "and says the item is not lost");
  }
});

test("a budget still in the future changes nothing — dispatch proceeds as without one", async () => {
  const deadlineMs = Date.parse(NOW) + 60_000;
  const withBudget = await cycleWith({ deadlineMs, now: () => Date.parse(NOW) }, () => {});
  const without = await cycleWith(undefined, () => {});
  assert.equal(withBudget.dispatched.length, without.dispatched.length, "same dispatch count");
  assert.equal(withBudget.dispatched.length, 3, "all three reached the dispatcher");
  assert.equal(withBudget.deferred.length, 0, "nothing deferred for budget");
});

test("the clock is INJECTED — the budget is decided by the caller's clock, not the wall", async () => {
  let ticks = 0;
  const deadlineMs = Date.parse(NOW) + 10;
  /* The clock advances one unit per read: the first item is inside the budget,
     the second read lands on the deadline, so the last two are deferred. */
  const cycle = await cycleWith({ deadlineMs, now: () => Date.parse(NOW) + 9 + ticks++ }, () => {});
  assert.equal(cycle.dispatched.length, 1, "exactly one item started before the clock passed the deadline");
  assert.equal(cycle.deferred.length, 2, "the two behind it are deferred by the budget");
});
