import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { recordFailure } from "../lib/control-plane/scheduler/debt.ts";
import { persistDebts, syncObligations } from "../lib/control-plane/scheduler/durable.ts";
import { observeCyclePhases } from "../lib/control-plane/scheduler/cycle-phases.ts";
import { scheduleObligation, isScheduled } from "../lib/control-plane/scheduler/obligation.ts";

const NOW = "2026-09-15T15:00:00.000Z";

test("2454 never-worked obligations retain their owed time instead of causing 4908 preparation round trips", () => {
  const now = Date.parse(NOW);
  let rewrites = 0;
  for (let i = 0; i < 2454; i += 1) {
    const obligation = { id: `due-${i}`, recordClass: "meetings", subjectId: `body-${i}`, routeId: null,
      active: true, readerImpactAt: null, observedChangeRateHours: null, lastWorkedAt: null,
      nextDueAt: "2026-09-14T15:00:00.000Z" };
    const scheduled = scheduleObligation(obligation, now);
    assert.ok(isScheduled(scheduled));
    assert.ok(Date.parse(scheduled.nextDueAt) <= now);
    if (scheduled.nextDueAt !== obligation.nextDueAt) rewrites += 1;
  }
  assert.equal(rewrites, 0);
  for (const nextDueAt of [null, "invalid", "2026-09-16T15:00:00.000Z"]) {
    const scheduled = scheduleObligation({ id: "first", recordClass: "meetings", subjectId: "body", routeId: null,
      active: true, readerImpactAt: null, observedChangeRateHours: null, lastWorkedAt: null, nextDueAt }, now);
    assert.ok(isScheduled(scheduled));
    assert.equal(scheduled.nextDueAt, NOW, "bad or future hints never postpone never-worked records");
  }
});

test("unchanged full-size registry synchronization uses one read and never rewrites provider or runtime state", async () => {
  const repos = createMemoryRepositories();
  const corpus = Array.from({ length: 2454 }, (_, i) => ({ id: `registered-${i}`, recordClass: "meetings", subjectId: `body-${i}`,
    routeId: null, active: true, readerImpactAt: null, observedChangeRateHours: null, lastWorkedAt: null }));
  await syncObligations(repos, corpus, NOW);
  const observed = observeCyclePhases(repos, () => 0);
  const sync = await syncObligations(observed.repos, structuredClone(corpus), "2026-09-15T16:00:00.000Z");
  assert.equal(sync.alreadyDurable.length, 2454);
  assert.equal(sync.refreshed.length, 0);
  assert.equal(sync.registered.length, 0);
  assert.equal(observed.finish("registration").repositoryCalls, 1);
  assert.ok(sync.all.every(row => row.updatedAt === NOW));
});

test("277 unchanged debts consume one bulk read and no write; changed and discharged debts persist", async () => {
  const repos = createMemoryRepositories();
  const debts = Array.from({ length: 277 }, (_, i) => recordFailure(null, {
    obligationId: `ob-${i}`, cause: "UPSTREAM_ERROR", detail: "host refused", target: "example.invalid", dueAt: NOW, now: NOW,
  }));
  await persistDebts(repos, debts, NOW);
  const observed = observeCyclePhases(repos, () => 0);
  const unchanged = await persistDebts(observed.repos, structuredClone(debts), NOW);
  assert.deepEqual(unchanged, { written: 0, cleared: [], clearedAsRetired: [] });
  assert.equal(observed.finish("debt").repositoryCalls, 1);
  const changed = { ...debts[0], detail: "new retained error evidence" };
  assert.deepEqual(await persistDebts(repos, [changed, ...debts.slice(2)], NOW), { written: 1, cleared: ["ob-1"], clearedAsRetired: [] });
  assert.equal((await repos.debts.mustRead("ob-1")).value.consecutiveFailures, 0);
  assert.equal((await repos.debts.mustRead("ob-0")).value.detail, changed.detail);
});

test("phase timing reports actual repository calls without arguments", async () => {
  let clock = 100;
  const measured = observeCyclePhases(createMemoryRepositories(), () => clock);
  await measured.repos.debts.list();
  clock = 150;
  assert.deepEqual(measured.finish("preparation"), { name: "preparation", durationMs: 50, repositoryCalls: 1 });
  clock = 170;
  assert.deepEqual(measured.finish("dispatch"), { name: "dispatch", durationMs: 20, repositoryCalls: 0 });
});
