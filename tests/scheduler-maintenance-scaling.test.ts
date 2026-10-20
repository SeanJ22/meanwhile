import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { recordFailure } from "../lib/control-plane/scheduler/debt.ts";
import { persistDebts, syncObligations } from "../lib/control-plane/scheduler/durable.ts";
import { observeCyclePhases } from "../lib/control-plane/scheduler/cycle-phases.ts";
import { scheduleObligation, isScheduled } from "../lib/control-plane/scheduler/obligation.ts";
import { ConcurrentModification } from "../lib/control-plane/repository/types.ts";
import { eachStore } from "./control-plane-fixtures.ts";

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

test("independent debt retirement, discharge and writes overlap and retain result order", { timeout: 10_000 }, async () => {
  for (const [label, repos] of await eachStore("wtp-debt-parallel-")) {
    const debt = (obligationId: string) => recordFailure(null, {
      obligationId, cause: "UPSTREAM_ERROR", detail: "host refused", target: "example.invalid", dueAt: NOW, now: NOW,
    });
    await persistDebts(repos, [debt("first"), debt("retired"), debt("last"), debt("changed")], NOW);
    let releaseFirst!: () => void;
    let bothEntered!: () => void;
    const firstHeld = new Promise<void>(resolve => { releaseFirst = resolve; });
    const overlap = new Promise<void>(resolve => { bothEntered = resolve; });
    const entered: string[] = [];
    const compareAndSet = repos.debts.compareAndSet.bind(repos.debts);
    repos.debts.compareAndSet = async (...args) => {
      entered.push(args[0]);
      if (entered.includes("first") && entered.includes("retired")) bothEntered();
      if (args[0] === "first") await firstHeld;
      return compareAndSet(...args);
    };
    const settling = persistDebts(repos, [debt("new"), { ...debt("changed"), detail: "changed evidence" }], NOW,
      null, new Map([["retired", "authority transferred"]]), 2);
    await overlap;
    assert.ok(entered.includes("first") && entered.includes("retired"), label);
    assert.equal((await repos.debts.mustRead("first")).value.consecutiveFailures, 1,
      `${label}: retirement enters while the independent discharge is still blocked`);
    releaseFirst();
    assert.deepEqual(await settling, { written: 2, cleared: ["first", "last"], clearedAsRetired: ["retired"] });
    assert.equal((await repos.debts.mustRead("first")).value.consecutiveFailures, 0);
    assert.match((await repos.debts.mustRead("retired")).value.detail, /retired.*Not a reading/);
    assert.equal((await repos.debts.mustRead("new")).value.consecutiveFailures, 1);
    assert.equal((await repos.debts.mustRead("changed")).value.detail, "changed evidence");
  }
});

test("duplicate debt IDs serialize and failed groups fully join before returning the earliest error", { timeout: 10_000 }, async () => {
  for (const [label, repos] of await eachStore("wtp-debt-failure-")) {
    const debt = (obligationId: string) => recordFailure(null, {
      obligationId, cause: "UPSTREAM_ERROR", detail: "host refused", target: "example.invalid", dueAt: NOW, now: NOW,
    });
    await persistDebts(repos, [debt("first"), debt("fast-error"), debt("slow")], NOW);
    let releaseFirst!: () => void;
    let releaseSlow!: () => void;
    let firstEntered!: () => void;
    let slowEntered!: () => void;
    let remainingWritten!: () => void;
    const firstHeld = new Promise<void>(resolve => { releaseFirst = resolve; });
    const slowHeld = new Promise<void>(resolve => { releaseSlow = resolve; });
    const firstStarted = new Promise<void>(resolve => { firstEntered = resolve; });
    const slowStarted = new Promise<void>(resolve => { slowEntered = resolve; });
    const remainingDone = new Promise<void>(resolve => { remainingWritten = resolve; });
    const original = new ConcurrentModification("debts", "first", 1, 2);
    const compareAndSet = repos.debts.compareAndSet.bind(repos.debts);
    let firstCalls = 0;
    repos.debts.compareAndSet = async (...args) => {
      if (args[0] === "first") {
        firstCalls += 1;
        firstEntered();
        await firstHeld;
        throw original;
      }
      if (args[0] === "fast-error") throw new Error("later operation failed first in wall time");
      if (args[0] === "slow") {
        slowEntered();
        await slowHeld;
      }
      return compareAndSet(...args);
    };
    const put = repos.debts.put.bind(repos.debts);
    repos.debts.put = async (...args) => {
      const result = await put(...args);
      if (args[0] === "remaining") remainingWritten();
      return result;
    };
    const changedFirst = { ...debt("first"), detail: "new evidence" };
    let returned = false;
    const settling = persistDebts(repos, [changedFirst, { ...changedFirst, detail: "later same ID" },
      { ...debt("fast-error"), detail: "new evidence" }, { ...debt("slow"), detail: "new evidence" }, debt("remaining")],
    NOW, null, new Map(), 2).then(() => null, error => error).then(error => { returned = true; return error; });
    await Promise.all([firstStarted, slowStarted]);
    assert.equal(firstCalls, 1, "later operation cannot enter while the same stored row is in flight");
    releaseFirst();
    await remainingDone;
    assert.equal(firstCalls, 1, "later operation cannot retry a failed stored row unchanged");
    assert.equal(returned, false, "an independent write is still running");
    releaseSlow();
    assert.equal(await settling, original, `${label}: original-order error identity and class survive concurrent failure`);
    assert.equal((await repos.debts.mustRead("slow")).value.detail, "new evidence");
    assert.equal((await repos.debts.mustRead("remaining")).value.consecutiveFailures, 1);
    assert.equal((await repos.debts.mustRead("first")).value.detail, "host refused");
  }
});
