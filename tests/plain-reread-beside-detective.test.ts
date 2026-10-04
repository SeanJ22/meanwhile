/** DP-02: a shut door goes to a detective, and its plain re-read keeps running, paid lane open or closed. */
import assert from "node:assert/strict";
import test from "node:test";

import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import type { FreshnessObligation } from "../lib/control-plane/scheduler/obligation.ts";
import { runCycle } from "../lib/control-plane/scheduler/shadow-loop.ts";

const NOW = "2026-09-25T12:00:00.000Z";
const NOW_MS = Date.parse(NOW);

const shut: FreshnessObligation = {
  id: "shut-door", recordClass: "meetings", subjectId: "ocd-division/country:us/state:az/place:test",
  routeId: "route-shut", active: true, readerImpactAt: null, observedChangeRateHours: null,
  lastWorkedAt: new Date(NOW_MS - 90 * 3_600_000).toISOString(),
};

async function cycle(paidLaneOpen: boolean) {
  const run = (lane: string) => async () => ({ ranAs: lane, kind: "ABORTED", detail: "fixture" }) as never;
  const result = await runCycle({
    repos: createMemoryRepositories(), obligations: [shut], debts: [], requireOpenOccurrence: false,
    routeTaskFor: () => "task", maturity: () => "UNGRADUATED", holder: "dp-02", now: NOW, leaseTtlMs: 60_000, maxDispatches: 5,
    executor: { lane: "DETERMINISTIC", run: run("plain") as never },
    reader: { contract: "READER", state: "NOT_READY", reason: "fixture" },
    truth: { contract: "TRUTH", state: "NOT_READY", reason: "fixture" },
    research: {
      decide: () => ({ kind: "BOUNDED_MODEL_WORKER", why: "shut door", disagreement: null }),
      plainBesideDetective: () => ({ kind: "DETERMINISTIC", why: "plain re-read", disagreement: null }),
      admitScout: () => (paidLaneOpen ? { admit: true } : { admit: false, code: "LANE_DISABLED", why: "paid research paused" }),
      modelExecutor: { lane: "BOUNDED_MODEL_WORKER", run: run("detective") as never },
      workerCapacity: 1, scoutLeaseTtlMs: 420_000,
    },
  } as never);
  return { dispatched: result.dispatched.length, deferred: result.deferred.map((d) => d.why) };
}

test("paid research paused: the detective is deferred by code and the plain re-read still dispatches", async () => {
  const { dispatched, deferred } = await cycle(false);
  assert.equal(dispatched, 1);
  assert.match(deferred[0] ?? "", /LANE_DISABLED/);
});

test("paid research open: the detective dispatches and is not duplicated", async () => {
  const { dispatched, deferred } = await cycle(true);
  assert.equal(dispatched, 1);
  assert.deepEqual(deferred, []);
});
