/**
 * Every due row a lane holds is accounted for by
 * reason, the reasons add up (or a MISMATCH line says they do not), the
 * coordinator's silent non-dispatches are counted, and the pulse carries the
 * lane gauges from the one research-state read it already makes.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { readPulse } from "../lib/control-plane/gateway/pulse-read.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import {
  coordinatorLane,
  laneGauges,
  lanesAtCycleEnd,
  lanesInFlight,
  pulseLanesOf,
  queueLanesOf,
  skippedWork,
  type QueueLanes,
} from "../lib/control-plane/scheduler/lane-reading.ts";
import { isScheduled, scheduleObligation, type FreshnessObligation } from "../lib/control-plane/scheduler/obligation.ts";
import { RESEARCH_STATE_ID } from "../lib/control-plane/scheduler/research-policy.ts";
import { runCycle } from "../lib/control-plane/scheduler/shadow-loop.ts";

const NOW = "2026-09-25T12:00:00.000Z";
const NOW_MS = Date.parse(NOW);

function obligation(id: string, hoursAgo: number): FreshnessObligation {
  return {
    id,
    recordClass: "meetings",
    subjectId: "ocd-division/country:us/state:az/place:test",
    routeId: `route-${id}`,
    active: true,
    readerImpactAt: null,
    observedChangeRateHours: null,
    lastWorkedAt: new Date(NOW_MS - hoursAgo * 3_600_000).toISOString(),
  };
}

function nextDue(o: FreshnessObligation): string {
  const row = scheduleObligation(o, NOW_MS);
  if (!isScheduled(row)) throw new Error("fixture did not schedule");
  return row.nextDueAt;
}

/** Six due rows, none of which may reach a worker: each lane holds all three, under different codes. */
async function heldEverywhereCycle() {
  const obligations = [
    obligation("det-open", 90),
    obligation("det-a", 80),
    obligation("det-b", 70),
    obligation("m-ceiling", 60),
    obligation("m-freewalk", 50),
    obligation("m-blackout", 40),
  ];
  return {
    obligations,
    cycle: await runCycle({
      repos: createMemoryRepositories(),
      obligations,
      debts: [],
      requireOpenOccurrence: true,
      // The first plain-code row has no open slot; every other row has one.
      routeTaskFor: (id) => (id === "det-open" ? null : `task-${id}`),
      maturity: () => "UNGRADUATED",
      holder: "lane-accounting",
      now: NOW,
      leaseTtlMs: 60_000,
      maxDispatches: 0,
      executor: { lane: "DETERMINISTIC", run: async () => { throw new Error("no plain-code row may start"); } },
      admitDispatch: () => ({ admit: false, code: "SCHEDULED_BLACKOUT", why: "fixture blackout" }),
      research: {
        decide: (row) => ({ kind: row.obligation.id.startsWith("det-") ? "DETERMINISTIC" : "BOUNDED_MODEL_WORKER", why: "fixture", disagreement: null }),
        admitScout: (row) =>
          row.obligation.id === "m-ceiling"
            ? { admit: false, code: "CEILING", why: "fixture ceiling" }
            : row.obligation.id === "m-freewalk"
              ? { admit: false, code: "FREE_WALK_FIRST", why: "fixture free walk" }
              : { admit: true },
        modelExecutor: { lane: "BOUNDED_MODEL_WORKER", run: async () => { throw new Error("no Scout may start"); } },
        workerCapacity: 2,
        scoutLeaseTtlMs: 420_000,
      },
    }),
  };
}

test("MW-014: each lane accounts for every due row by reason — dispatched + reasons = due", async () => {
  const { obligations, cycle } = await heldEverywhereCycle();
  const lanes = cycle.lanes!;
  assert.equal(lanes.deterministic.due, 3);
  assert.equal(lanes.deterministic.dispatched, 0);
  assert.deepEqual(lanes.deterministic.deferredBy, { NO_OPEN_OCCURRENCE: 1, DISPATCH_CEILING: 2 }, "the plain-code lane names its reasons too");
  assert.equal(lanes.model.due, 3);
  assert.deepEqual(lanes.model.deferredBy, { CEILING: 1, FREE_WALK_FIRST: 1, SCHEDULED_BLACKOUT: 1 }, "an aggregate refusal counts under its own code, not AGGREGATE");
  for (const lane of [lanes.deterministic, lanes.model]) {
    const reasons = Object.values(lane.deferredBy).reduce((n, v) => n + v, 0);
    assert.equal(lane.dispatched + reasons + lane.recovered, lane.due);
  }
  // The oldest waiting row is the earliest next-due among the rows the lane did not reach.
  assert.equal(lanes.deterministic.oldestWaitingDueAt, nextDue(obligations[0]!));
  assert.equal(lanes.model.oldestWaitingDueAt, nextDue(obligations[3]!));
});

test("MW-014: the persisted reading's reasons sum to the skipped count on the runner card", async () => {
  const { cycle } = await heldEverywhereCycle();
  const lanes = lanesAtCycleEnd(cycle.lanes!, null, NOW);
  const skipped = skippedWork(lanes)!;
  assert.equal(skipped.skipped, 6);
  assert.deepEqual(skipped.mismatches, []);
  for (const l of skipped.lanes) assert.equal(l.reasons!.reduce((n, r) => n + r.count, 0), l.skipped);
  assert.match(skipped.says, /^6 of 6 due items were not started this cycle\. The reasons below add up to that number\./);
});

test("MW-014: reasons that do not add up produce a MISMATCH line naming the lane", () => {
  const lanes: QueueLanes = {
    at: NOW,
    final: true,
    deterministic: { due: 10, dispatched: 4, active: 0, waiting: 6, skippedBy: { BUDGET: 4 }, oldestWaitingDueAt: null },
    model: { due: 2, dispatched: 2, active: 0, waiting: 0, skippedBy: {}, oldestWaitingDueAt: null },
    autonomous: null,
  };
  const skipped = skippedWork(lanes)!;
  assert.equal(skipped.mismatches.length, 1);
  assert.match(skipped.mismatches[0]!, /^MISMATCH in plain-code reads: 6 of 10 due were not started, and the recorded reasons account for 4 — 2 skipped without a recorded reason\.$/);
  assert.match(skipped.says, /do not add up for 1 lane/);
});

test("MW-014: the coordinator's BLOCKED and STAGED decisions are counted, not silent", () => {
  const lane = coordinatorLane({
    considered: 5,
    decisions: [
      { workItemId: "a", action: "BLOCKED", task: null, reason: "REPAIR_WAITING_ON_SUCCESSOR:x: original obligation and blockers remain open" },
      { workItemId: "b", action: "STAGED", task: null, reason: "Scoped reviewed results are retained." },
      { workItemId: "c", action: "BLOCKED", task: {}, reason: "Scout has no accepted grounded route; preserve its next rungs and retry state." },
      { workItemId: "d", action: "WORKER", task: {}, reason: "due" },
    ],
    dispatches: [{}],
    deferred: [{ workItemId: "e", reason: "COORDINATOR_CYCLE_MAX" }],
  });
  assert.deepEqual(lane.skippedBy, { COORDINATOR_CYCLE_MAX: 1, REPAIR_WAITING_ON_SUCCESSOR: 1, COORDINATOR_STAGED: 1, COORDINATOR_BLOCKED: 1 });
  assert.equal(lane.due - lane.dispatched, Object.values(lane.skippedBy!).reduce((n, v) => n + v, 0));
});

test("MW-071: mid-cycle lanes count running Scouts as active and the oldest row neither started nor running", () => {
  const rows = (ids: readonly [string, string][]) => ids.map(([id, nextDueAt]) => ({ obligation: { id }, nextDueAt }));
  const lanes = lanesInFlight({
    at: NOW,
    deterministicRows: rows([["d1", "2026-09-20T00:00:00.000Z"], ["d2", "2026-09-21T00:00:00.000Z"]]),
    modelRows: rows([["m1", "2026-09-19T00:00:00.000Z"], ["m2", "2026-09-22T00:00:00.000Z"], ["m3", "2026-09-23T00:00:00.000Z"]]),
    deterministicDispatched: 1,
    modelDispatched: 1,
    startedIds: new Set(["d1", "m1"]),
    runningIds: new Set(["m2"]),
  });
  assert.deepEqual(lanes.model, { due: 3, dispatched: 1, active: 1, waiting: 1, skippedBy: null, oldestWaitingDueAt: "2026-09-23T00:00:00.000Z" });
  assert.equal(lanes.deterministic.active, null, "the serial lane records no in-flight row; unknown, not zero");
  assert.equal(lanes.deterministic.oldestWaitingDueAt, "2026-09-21T00:00:00.000Z");
  const gauges = laneGauges(lanes)!;
  assert.equal(gauges[1]!.blockedBy, null, "no reason is claimed before the cycle counts them");
  assert.equal(skippedWork(lanes)!.lanes[1]!.reasons, null);
});

test("MW-071: the pulse carries the lane gauges from the research state it already reads", async () => {
  const repos = createMemoryRepositories();
  assert.equal((await readPulse(repos, NOW)).lanes, null, "no research state: no lanes, never an empty strip");
  const { cycle } = await heldEverywhereCycle();
  const lanes = lanesAtCycleEnd(cycle.lanes!, null, NOW);
  await repos.researchState.put(RESEARCH_STATE_ID, { queue: { lanes } } as never, NOW);
  const pulse = await readPulse(repos, NOW);
  assert.deepEqual(pulse.lanes, pulseLanesOf({ queue: { lanes } }));
  const model = pulse.lanes!.gauges.find((g) => g.lane === "model")!;
  assert.equal(model.waiting, 3);
  assert.match(model.blockedBy ?? "", /^1 held because /);
  assert.equal(queueLanesOf({ queue: { lanes: { at: NOW } } }), null, "a malformed reading is not read as lanes");
});
