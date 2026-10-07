/**
 * The plain-code lane runs the longest-waiting row first with a stated bound. A row's next-due advances only on a
 * reading, so ordering by next-due alone lets rows that keep failing return to the head of the queue after every
 * backoff. These tests replay the lane cycle by cycle with the scheduler's own pure functions: under
 * `plainCodeQueueOrder` a never-tried row runs within ⌈(A + 1) / c⌉ cycles and no row waits longer than
 * ⌈N / c⌉ − 1 cycles.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { recordFailure, retryable, type FreshnessDebt } from "../lib/control-plane/scheduler/debt.ts";
import { lanesInFlight } from "../lib/control-plane/scheduler/lane-reading.ts";
import {
  dueNow,
  plainCodeQueueOrder,
  scheduleAll,
  waitingSince,
  type FreshnessObligation,
  type ScheduledObligation,
} from "../lib/control-plane/scheduler/obligation.ts";
import { runCycle, type CycleResult } from "../lib/control-plane/scheduler/shadow-loop.ts";

const START_MS = Date.parse("2026-09-25T00:00:00.000Z");
const HOUR_MS = 3_600_000;
/** A tie: many due rows carrying exactly this next-due. */
const TIE = "2026-09-15T17:58:43.627Z";
const WALLED_SINCE = "2026-09-01T00:00:00.000Z";

function row(id: string, firstOwed: string, over: Partial<FreshnessObligation> = {}): FreshnessObligation {
  return {
    id,
    recordClass: "candidate-enrichment",
    subjectId: `candidate:${id}`,
    routeId: `route:${id}`,
    active: true,
    readerImpactAt: null,
    observedChangeRateHours: null,
    /* Never discharged: a first-owed time is retained until a reading moves it. */
    lastWorkedAt: null,
    nextDueAt: firstOwed,
    ...over,
  };
}

/** Eight rows that fail on every attempt (a search with no article to find), then one never-tried row at the tie. */
const WALLED = Array.from({ length: 8 }, (_, i) => row(`walled-${i + 1}`, WALLED_SINCE));
const NEVER_TRIED = row("never-tried", TIE);
const LANE = [...WALLED, NEVER_TRIED];

type Order = (due: readonly ScheduledObligation[], debtOf: (id: string) => FreshnessDebt | undefined) => readonly ScheduledObligation[];
const OLD_ORDER: Order = (due) => due; // next-due order only
const NEW_ORDER: Order = (due, debtOf) => plainCodeQueueOrder(due, debtOf);

/**
 * One cycle of the lane on a moving clock, from the same pure functions
 * `runCycle` uses: schedule, hold rows whose backoff has not ended, order, and
 * run `perCycle` rows. Every row fails and accrues debt, as a walled route does.
 */
function replay(order: Order, input: { readonly cycles: number; readonly perCycle: number }) {
  let debts: FreshnessDebt[] = [];
  const dispatchedAt: string[][] = [];
  /* The rows each cycle could have run: due, and not held by a backoff. */
  const eligibleAt: Set<string>[] = [];
  for (let c = 0; c < input.cycles; c += 1) {
    const nowMs = START_MS + c * HOUR_MS;
    const now = new Date(nowMs).toISOString();
    const retryIds = new Set(retryable(debts, nowMs).map((d) => d.obligationId));
    const backedOff = new Set(debts.filter((d) => d.consecutiveFailures > 0 && !retryIds.has(d.obligationId)).map((d) => d.obligationId));
    const due = dueNow(scheduleAll(LANE, nowMs), nowMs).filter((r) => !backedOff.has(r.obligation.id));
    eligibleAt.push(new Set(due.map((r) => r.obligation.id)));
    const byId = new Map(debts.map((d) => [d.obligationId, d] as const));
    const ran = order(due, (id) => byId.get(id)).slice(0, input.perCycle);
    for (const r of ran) {
      byId.set(r.obligation.id, recordFailure(byId.get(r.obligation.id) ?? null, {
        obligationId: r.obligation.id,
        cause: "NEVER_DISPATCHED",
        detail: "walled",
        target: r.obligation.routeId ?? r.obligation.subjectId,
        dueAt: r.nextDueAt,
        now,
      }));
    }
    debts = [...byId.values()];
    dispatchedAt.push(ran.map((r) => r.obligation.id));
  }
  return { dispatchedAt, eligibleAt };
}

/** The real dispatcher, cycle after cycle, carrying its debt forward. */
async function dispatcherRun(input: { readonly cycles: number; readonly perCycle: number; readonly placeFirst?: ReadonlySet<string> }) {
  const repos = createMemoryRepositories();
  let debts: readonly FreshnessDebt[] = [];
  const cycles: CycleResult[] = [];
  for (let c = 0; c < input.cycles; c += 1) {
    const cycle = await runCycle({
      repos,
      obligations: LANE,
      debts,
      /* No RouteTask: each dispatch reaches the lane and fails as NO_ROUTE_TASK, a walled route in miniature. */
      routeTaskFor: () => null,
      maturity: () => "GRADUATED",
      executor: { lane: "DETERMINISTIC", run: async () => ({ ranAs: "DETERMINISTIC", kind: "ABORTED", detail: "not reached" }) },
      holder: "plain-code-queue",
      now: new Date(START_MS + c * HOUR_MS).toISOString(),
      leaseTtlMs: 60_000,
      maxDispatches: input.perCycle,
      ...(input.placeFirst ? { placeFirst: input.placeFirst } : {}),
      research: {
        decide: () => ({ kind: "DETERMINISTIC", why: "fixture: a derived HTTP_GET shape", disagreement: null }),
        admitScout: () => ({ admit: false, code: "PAUSED", why: "fixture" }),
        modelExecutor: { lane: "BOUNDED_MODEL_WORKER", run: async () => { throw new Error("no Scout may start"); } },
        workerCapacity: 1,
        scoutLeaseTtlMs: 60_000,
      },
    });
    debts = cycle.debts;
    cycles.push(cycle);
  }
  return cycles;
}

/** For each row, the most consecutive cycles it was due, not held by backoff, and not run. */
function longestWaits(dispatchedAt: readonly (readonly string[])[], eligible: (cycle: number) => ReadonlySet<string>): Map<string, number> {
  const current = new Map<string, number>();
  const longest = new Map<string, number>();
  dispatchedAt.forEach((ran, c) => {
    for (const id of eligible(c)) {
      if (ran.includes(id)) current.set(id, 0);
      else {
        const n = (current.get(id) ?? 0) + 1;
        current.set(id, n);
        longest.set(id, Math.max(longest.get(id) ?? 0, n));
      }
    }
  });
  return longest;
}

test("SEEDED STARVATION: ordered by next-due alone, a never-tried row waits forever behind rows that keep failing", () => {
  /* Thirty days of hourly cycles, one plain-code dispatch each. */
  const old = replay(OLD_ORDER, { cycles: 720, perCycle: 1 });
  const ran = old.dispatchedAt.flat();
  const runs = (id: string) => ran.filter((x) => x === id).length;
  assert.equal(runs(NEVER_TRIED.id), 0, "under the old order the never-tried row never runs in 720 cycles");
  assert.ok(old.eligibleAt.every((ids) => ids.has(NEVER_TRIED.id)), "and it was due and runnable in every one of them");
  /* Walled rows at the six-hour backoff cap return to the head of the queue on their first next-due and take every turn. */
  assert.deepEqual(WALLED.map((w) => runs(w.id)), [124, 123, 122, 120, 117, 114, 0, 0]);
  /* And it is not a capacity shortfall: 720 dispatches are 80 turns for a 9-row lane. */
  assert.equal(ran.length, 720);
  /* The new order gives each of the nine rows exactly those 80 turns. */
  const fair = replay(NEW_ORDER, { cycles: 720, perCycle: 1 }).dispatchedAt.flat();
  assert.deepEqual(LANE.map((o) => fair.filter((x) => x === o.id).length), Array(LANE.length).fill(80));
});

test("the replay is the dispatcher: runCycle runs exactly the replay's new order, cycle by cycle", async () => {
  const cycles = await dispatcherRun({ cycles: 48, perCycle: 1 });
  assert.deepEqual(
    cycles.map((c) => c.dispatched.map((d) => d.obligationId)),
    replay(NEW_ORDER, { cycles: 48, perCycle: 1 }).dispatchedAt,
  );
});

test("BOUND: the never-tried row runs within ⌈(A + 1) / c⌉ cycles, and no row ever waits more than ⌈N / c⌉ − 1", async () => {
  const cycles = await dispatcherRun({ cycles: 200, perCycle: 1 });
  const ran = cycles.map((c) => c.dispatched.map((d) => d.obligationId));
  /* Eight walled rows were ahead of it (A = 8, c = 1): it runs in cycle 9, not never. */
  assert.equal(ran.findIndex((ids) => ids.includes(NEVER_TRIED.id)), 8);
  /* Every row, every time it waited: at most ⌈9 / 1⌉ − 1 = 8 cycles between joining the queue and running. */
  const waits = longestWaits(ran, (c) => new Set([...cycles[c]!.dispatched.map((d) => d.obligationId), ...cycles[c]!.deferred.filter((d) => /stated ceiling/.test(d.why)).map((d) => d.obligationId)]));
  assert.equal(waits.size, LANE.length, "every row waited at some point, so the bound is exercised for each");
  for (const [id, n] of waits) assert.ok(n <= LANE.length - 1, `${id} waited ${n} cycles`);
  /* Each row is tried about equally often: no row gets the lane to itself. */
  const tries = LANE.map((o) => ran.flat().filter((id) => id === o.id).length);
  assert.ok(Math.max(...tries) - Math.min(...tries) <= 2, `tries per row ${tries.join(", ")}`);
});

test("BOUND with two a cycle: waits stay within ⌈N / c⌉ − 1 = 4 cycles", () => {
  const { dispatchedAt, eligibleAt } = replay(NEW_ORDER, { cycles: 300, perCycle: 2 });
  const waits = longestWaits(dispatchedAt, (c) => eligibleAt[c]!);
  for (const [id, n] of waits) assert.ok(n <= Math.ceil(LANE.length / 2) - 1, `${id} waited ${n} cycles`);
  assert.ok(dispatchedAt.flat().includes(NEVER_TRIED.id));
});

test("the plain-code reading names the longest WAIT, during the cycle and after it, not a failing row's first next-due", async () => {
  const cycles = await dispatcherRun({ cycles: 8, perCycle: 1 });
  /* Cycle 8: all eight walled rows have failed once, and the never-tried row is next. */
  const last = cycles[7]!;
  assert.deepEqual(last.dispatched.map((d) => d.obligationId), ["walled-8"]);
  assert.equal(last.lanes!.deterministic.oldestWaitingDueAt, TIE, "the oldest wait is the row waiting since the tie");
  /* The same measure while a cycle runs, from the debt it carried in. */
  const debtsIn = cycles[6]!.debts;
  const due = LANE.map((o) => ({ obligation: { id: o.id }, nextDueAt: o.nextDueAt! }));
  const inFlight = lanesInFlight({
    at: "2026-09-25T07:00:00.000Z",
    deterministicRows: due,
    modelRows: [],
    deterministicDispatched: 1,
    modelDispatched: 0,
    startedIds: new Set(["walled-8"]),
    runningIds: new Set(),
    debtFor: (id) => debtsIn.find((d) => d.obligationId === id),
  });
  assert.equal(inFlight.deterministic.oldestWaitingDueAt, TIE);
  /* Without the debt, the reading is the earliest next-due, as it always was. */
  const bare = lanesInFlight({ at: "2026-09-25T07:00:00.000Z", deterministicRows: due, modelRows: [], deterministicDispatched: 1, modelDispatched: 0, startedIds: new Set(["walled-8"]), runningIds: new Set() });
  assert.equal(bare.deterministic.oldestWaitingDueAt, WALLED_SINCE);
});

test("ADM-8: the owner's placed-first rows still go ahead of the longest wait", async () => {
  const [first] = await dispatcherRun({ cycles: 1, perCycle: 1, placeFirst: new Set([NEVER_TRIED.id]) });
  assert.deepEqual(first!.dispatched.map((d) => d.obligationId), [NEVER_TRIED.id]);
});

test("NOT SLOWED: a row with no failing debt never has more rows ahead of it than under the old order", () => {
  const nowMs = START_MS;
  const now = new Date(nowMs).toISOString();
  const hours = (h: number) => new Date(nowMs - h * HOUR_MS).toISOString();
  const lane = [
    row("fail-old", hours(600)),
    row("fail-tie", TIE),
    row("never-tried-tie", TIE),
    row("recurring", hours(0), { lastWorkedAt: hours(30) }),
    /* A meetings row with a sitting two hours out: a one-hour reader-impact cadence, read three hours ago, no debt. */
    row("meeting-this-week", hours(0), { recordClass: "meetings", lastWorkedAt: hours(3), readerImpactAt: new Date(nowMs + 2 * HOUR_MS).toISOString() }),
    row("fail-recent", hours(2)),
  ];
  const fail = (id: string, retryHoursAgo: number): FreshnessDebt => ({
    ...recordFailure(null, { obligationId: id, cause: "UPSTREAM_ERROR", detail: "x", target: id, dueAt: now, now: new Date(nowMs - (retryHoursAgo * HOUR_MS + 15 * 60_000)).toISOString() }),
  });
  const debts = new Map([fail("fail-old", 0.5), fail("fail-tie", 1), fail("fail-recent", 0.1)].map((d) => [d.obligationId, d] as const));
  const due = dueNow(scheduleAll(lane, nowMs), nowMs);
  assert.equal(due.length, lane.length, "every fixture row is due");
  const oldIds = due.map((r) => r.obligation.id);
  const newIds = plainCodeQueueOrder(due, (id) => debts.get(id)).map((r) => r.obligation.id);
  for (const r of due) {
    if (debts.has(r.obligation.id)) continue;
    assert.ok(newIds.indexOf(r.obligation.id) <= oldIds.indexOf(r.obligation.id), `${r.obligation.id} moved back`);
  }
  /* The failing rows now wait behind every row that has not had a turn, oldest retry first. */
  assert.deepEqual(newIds.slice(-3), ["fail-tie", "fail-old", "fail-recent"]);
  /* And the key a row is queued on is its next-due unless its last attempt failed. */
  assert.equal(waitingSince(due.find((r) => r.obligation.id === "never-tried-tie")!, undefined), TIE);
  assert.equal(waitingSince(due.find((r) => r.obligation.id === "fail-tie")!, debts.get("fail-tie")), debts.get("fail-tie")!.retryAt);
});

test("a row due only as a retry (its next-due still ahead) stays behind every row due by the clock, as before", () => {
  const now = new Date(START_MS).toISOString();
  const later = new Date(START_MS + 5 * HOUR_MS).toISOString();
  const retryOnly = { obligation: { id: "retry-only" }, nextDueAt: later };
  const clockDue = { obligation: { id: "clock-due" }, nextDueAt: now };
  const debt = { consecutiveFailures: 3, retryAt: new Date(START_MS - HOUR_MS).toISOString() };
  assert.equal(waitingSince(retryOnly, debt), later, "the later of its next-due and its retry");
  assert.deepEqual(
    plainCodeQueueOrder([retryOnly, clockDue], (id) => (id === "retry-only" ? debt : undefined)).map((r) => r.obligation.id),
    ["clock-due", "retry-only"],
  );
});
