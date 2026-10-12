/** Scouts are admitted by funding and provider availability. */
import assert from "node:assert/strict";
import test from "node:test";

import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import type { DeclaredExecutor, ExecutorDecision } from "../lib/control-plane/scheduler/dispatch.ts";
import type { FreshnessObligation } from "../lib/control-plane/scheduler/obligation.ts";
import { runCycle } from "../lib/control-plane/scheduler/shadow-loop.ts";

const NOW = "2026-09-02T00:00:00.000Z";

function modelObligation(id: string): FreshnessObligation {
  return { id, recordClass: "meetings", subjectId: `body:${id}`, routeId: `route:${id}`, active: true, readerImpactAt: null, observedChangeRateHours: null, lastWorkedAt: null };
}

const modelExecutor: DeclaredExecutor = {
  lane: "BOUNDED_MODEL_WORKER",
  run: async () => ({ ranAs: "BOUNDED_MODEL_WORKER", kind: "ABORTED", detail: "test scout — admission is what's under test" }),
};
const modelDecision: ExecutorDecision = { kind: "BOUNDED_MODEL_WORKER", why: "test model row", disagreement: null };

async function runScoutCycle() {
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
    requireOpenOccurrence: true,
    research: {
      decide: () => modelDecision,
      admitScout: () => ({ admit: true }),
      modelExecutor,
      workerCapacity: 2,
      scoutLeaseTtlMs: 1000,
    },
  });
}

test("a funded Scout is dispatched without a cycle wall", async () => {
  const cycle = await runScoutCycle();
  assert.equal(cycle.lanes?.model.dispatched, 1);
  assert.ok(!cycle.lanes?.model.deferredBy.BUDGET);
});
