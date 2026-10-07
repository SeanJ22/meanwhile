/** A shut door goes to a detective, and its plain re-read keeps running, paid lane open or closed. */
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

import { DETECTIVE_SHUT_THRESHOLD, plainRereadSlot, PLAIN_REREAD_SLOT_MS, shutThresholdFrom, sourceFailureRecovery } from "../lib/control-plane/workers/detective.ts";
import { DETECTIVE_SHUT_THRESHOLD_SETTING } from "../lib/control-plane/settings.ts";
import type { AdminConfig } from "../lib/control-plane/gateway/admin-config.ts";
import type { FreshnessDebt } from "../lib/control-plane/scheduler/debt.ts";

test("an admitted detective alternates with the plain re-read by hourly slot; a fresh refusal goes to the detective at once", () => {
  const debt = { obligationId: "o", cause: "UPSTREAM_ERROR", target: "h", detail: "", lastFailedAt: NOW, consecutiveFailures: 3, retryAt: NOW } as FreshnessDebt;
  const even = 10 * 2 * PLAIN_REREAD_SLOT_MS;
  const odd = even + PLAIN_REREAD_SLOT_MS;
  assert.equal(plainRereadSlot(debt, even), false);
  assert.equal(plainRereadSlot(debt, odd), true);
  assert.equal(plainRereadSlot({ ...debt, consecutiveFailures: 1 }, odd), false, "a passing outage is never sent to a detective");
  assert.equal(plainRereadSlot({ ...debt, cause: "REFUSED_BY_HOST", consecutiveFailures: 1 }, odd), false);
  assert.equal(plainRereadSlot({ ...debt, cause: "REFUSED_BY_HOST", consecutiveFailures: 2 }, odd), true);
  assert.equal(plainRereadSlot(null, odd), false);
});

test("the shut threshold is Admin's setting; unset or invalid reads the code default of 3", () => {
  const config = (value: unknown) => ({ settings: { [DETECTIVE_SHUT_THRESHOLD_SETTING]: value } }) as unknown as AdminConfig;
  assert.equal(shutThresholdFrom(null), DETECTIVE_SHUT_THRESHOLD);
  assert.equal(shutThresholdFrom(config(5)), 5);
  assert.equal(shutThresholdFrom(config(0)), DETECTIVE_SHUT_THRESHOLD, "an invalid stored value reads the default");
  const debt = { obligationId: "o", cause: "UPSTREAM_ERROR", target: "h", detail: "", lastFailedAt: NOW, consecutiveFailures: 3, retryAt: NOW } as FreshnessDebt;
  const plain = { kind: "DETERMINISTIC", why: "plain", disagreement: null } as const;
  assert.equal(sourceFailureRecovery(plain, debt, shutThresholdFrom(config(5))), plain, "three failures under a threshold of five stay a free retry");
  assert.equal(sourceFailureRecovery(plain, { ...debt, consecutiveFailures: 5 }, shutThresholdFrom(config(5))).kind, "BOUNDED_MODEL_WORKER");
});
