/**
 * **THE PAID SCOUT LANE: LONGEST WAIT FIRST WITHIN A BAND.** (2026-09-25.)
 *
 * The Scout lane orders due rows by reader-impact band. Before this fix, rows
 * in the same band were ordered by next-due, with ties broken by id. A row's
 * next-due advances only on a reading, so a row whose Scouts keep failing kept
 * its first next-due. Each time its backoff ended, it went back to the head of
 * its band. Production on 2026-09-25 (read-only):
 * - 329 failing and 49 never-tried `candidate-authored-awaits-site` rows shared
 *   one next-due, 2026-09-15T17:58:43.627Z.
 * - 4 more failing rows were owed since 2026-08-14.
 * - In the week before the owner's pause (2026-09-23), 2,104 Scout attempts
 *   went to 410 of these rows. Most rows were tried 3 to 6 times, and one was
 *   tried 17 times.
 *
 * The lane is paused, so these tests replay it offline on a moving clock. They
 * use the scheduler's own pure functions and the same comparator the standing
 * runner uses (`compareReaderImpact` over `orderableDueRow`):
 * - Under the old order, a never-tried row starves behind rows that keep
 *   failing.
 * - Under the new order, it runs within ⌈(A + 1) / c⌉ cycles of the rows
 *   ahead of it in its band.
 * - The band order and the runner's placement-first ranking are unchanged.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { compareReaderImpact, orderableDueRow, orderByReaderImpact, TIE_BREAK, type OrderingInputs } from "../lib/control-plane/research-metrics.ts";
import { recordFailure, retryable, type FreshnessDebt } from "../lib/control-plane/scheduler/debt.ts";
import { dueNow, scheduleAll, type FreshnessObligation, type ScheduledObligation } from "../lib/control-plane/scheduler/obligation.ts";
import { runCycle, type CycleResult } from "../lib/control-plane/scheduler/shadow-loop.ts";

const START_MS = Date.parse("2026-09-25T00:00:00.000Z");
const HOUR_MS = 3_600_000;
const TIE = "2026-09-15T17:58:43.627Z";
const OWED_SINCE_AUG = "2026-08-14T00:00:00.000Z";
const INPUTS: OrderingInputs = { pilotZips: ["85701"] };
const PROVIDER = "candidate-enrichment";

function row(id: string, firstOwed: string, subjectId = `nj:2026:${id}`): FreshnessObligation {
  return {
    id,
    recordClass: "candidate-enrichment",
    subjectId,
    routeId: `candidate-authored-awaits-site:${id}`,
    active: true,
    readerImpactAt: null,
    observedChangeRateHours: null,
    lastWorkedAt: null,
    nextDueAt: firstOwed,
  };
}

/**
 * Production's shape, in miniature, all band 2:
 * - four failing rows owed since August;
 * - four failing rows at the tie whose ids sort first;
 * - one never-tried row at the tie whose id sorts last.
 */
const EARLY = Array.from({ length: 4 }, (_, i) => row(`aug-walled-${i + 1}`, OWED_SINCE_AUG));
const AT_TIE = Array.from({ length: 4 }, (_, i) => row(`a-walled-${i + 1}`, TIE));
const NEVER_TRIED = row("z-never-tried", TIE);
const LANE = [...EARLY, ...AT_TIE, NEVER_TRIED];

type Comparator = (left: ScheduledObligation, right: ScheduledObligation, debtOf: (id: string) => FreshnessDebt | undefined) => number;
/* The comparator the runner used before: band, then next-due, then id. */
const OLD: Comparator = (l, r) =>
  compareReaderImpact(
    { id: l.obligation.id, subjectId: l.obligation.subjectId, readerImpactAt: l.obligation.readerImpactAt, providerId: PROVIDER, nextDueAt: l.nextDueAt },
    { id: r.obligation.id, subjectId: r.obligation.subjectId, readerImpactAt: r.obligation.readerImpactAt, providerId: PROVIDER, nextDueAt: r.nextDueAt },
    INPUTS,
  );
/* The comparator the runner uses now: every row through `orderableDueRow` with the debt it carried in. */
const NEW: Comparator = (l, r, debtOf) =>
  compareReaderImpact(orderableDueRow(l, PROVIDER, debtOf(l.obligation.id)), orderableDueRow(r, PROVIDER, debtOf(r.obligation.id)), INPUTS);

/** The lane cycle by cycle on a moving clock: hold backed-off rows, order the rest, admit `perCycle` Scouts, and every Scout fails. */
function replay(lane: readonly FreshnessObligation[], compare: Comparator, input: { readonly cycles: number; readonly perCycle: number }) {
  let debts: FreshnessDebt[] = [];
  const admittedAt: string[][] = [];
  const eligibleAt: Set<string>[] = [];
  for (let c = 0; c < input.cycles; c += 1) {
    const nowMs = START_MS + c * HOUR_MS;
    const now = new Date(nowMs).toISOString();
    const retryIds = new Set(retryable(debts, nowMs).map((d) => d.obligationId));
    const held = new Set(debts.filter((d) => d.consecutiveFailures > 0 && !retryIds.has(d.obligationId)).map((d) => d.obligationId));
    const due = dueNow(scheduleAll(lane, nowMs), nowMs).filter((r) => !held.has(r.obligation.id));
    eligibleAt.push(new Set(due.map((r) => r.obligation.id)));
    const byId = new Map(debts.map((d) => [d.obligationId, d] as const));
    const ran = [...due].sort((l, r) => compare(l, r, (id) => byId.get(id))).slice(0, input.perCycle);
    for (const r of ran) {
      byId.set(r.obligation.id, recordFailure(byId.get(r.obligation.id) ?? null, {
        obligationId: r.obligation.id,
        cause: "UPSTREAM_ERROR",
        detail: "the Scout found no campaign site",
        target: r.obligation.routeId ?? r.obligation.subjectId,
        dueAt: r.nextDueAt,
        now,
      }));
    }
    debts = [...byId.values()];
    admittedAt.push(ran.map((r) => r.obligation.id));
  }
  return { admittedAt, eligibleAt };
}

/** The real dispatcher's Scout lane, cycle after cycle, with the runner's comparator shape and its debt carried forward. */
async function scoutLaneRun(input: { readonly cycles: number; readonly perCycle: number }) {
  const repos = createMemoryRepositories();
  let debts: readonly FreshnessDebt[] = [];
  const cycles: CycleResult[] = [];
  for (let c = 0; c < input.cycles; c += 1) {
    const carried = new Map(debts.map((d) => [d.obligationId, d] as const));
    let admitted = 0;
    const cycle = await runCycle({
      repos,
      obligations: LANE,
      debts,
      routeTaskFor: () => null,
      maturity: () => "UNGRADUATED",
      executor: { lane: "DETERMINISTIC", run: async () => { throw new Error("no plain-code row in this lane"); } },
      holder: "scout-queue",
      now: new Date(START_MS + c * HOUR_MS).toISOString(),
      leaseTtlMs: 60_000,
      reader: { contract: "READER", state: "NOT_READY", reason: "fixture" },
      truth: { contract: "TRUTH", state: "NOT_READY", reason: "fixture" },
      research: {
        decide: () => ({ kind: "BOUNDED_MODEL_WORKER", why: "fixture: no address is known", disagreement: null }),
        compareModelRows: (l, r) => NEW(l, r, (id) => carried.get(id)),
        admitScout: () => {
          if (admitted >= input.perCycle) return { admit: false, code: "CYCLE_MAX", why: "fixture: the cycle's Scouts are spent" };
          admitted += 1;
          return { admit: true };
        },
        modelExecutor: { lane: "BOUNDED_MODEL_WORKER", run: async () => ({ ranAs: "BOUNDED_MODEL_WORKER", kind: "ABORTED", detail: "fixture" }) },
        workerCapacity: 1,
        scoutLeaseTtlMs: 60_000,
        scoutWallMs: 1_000,
      },
    });
    debts = cycle.debts;
    cycles.push(cycle);
  }
  return cycles;
}

function longestWaits(ranAt: readonly (readonly string[])[], eligibleAt: readonly ReadonlySet<string>[]): Map<string, number> {
  const current = new Map<string, number>();
  const longest = new Map<string, number>();
  ranAt.forEach((ran, c) => {
    for (const id of eligibleAt[c]!) {
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

test("SEEDED STARVATION: within a band, ordered by next-due then id, a never-tried row waits forever behind Scouts that keep failing", () => {
  const old = replay(LANE, OLD, { cycles: 720, perCycle: 1 });
  const ran = old.admittedAt.flat();
  const runs = (id: string) => ran.filter((x) => x === id).length;
  assert.equal(runs(NEVER_TRIED.id), 0, "the never-tried row gets no Scout in 30 days of hourly cycles");
  assert.ok(old.eligibleAt.every((ids) => ids.has(NEVER_TRIED.id)), "though it was due and admissible in every cycle");
  /* Not a capacity shortfall: 720 Scouts are 80 each for a 9-row band. */
  assert.equal(ran.length, 720);
  assert.ok(runs(EARLY[0]!.id) >= 100, `the first August row took ${runs(EARLY[0]!.id)} Scouts`);
  /* The new order gives each row exactly its share. */
  const fair = replay(LANE, NEW, { cycles: 720, perCycle: 1 }).admittedAt.flat();
  assert.deepEqual(LANE.map((o) => fair.filter((x) => x === o.id).length), Array(LANE.length).fill(80));
});

test("the replay is the dispatcher: runCycle's Scout pool admits exactly the replay's new order, cycle by cycle", async () => {
  const cycles = await scoutLaneRun({ cycles: 48, perCycle: 1 });
  assert.deepEqual(cycles.map((c) => c.dispatched.map((d) => d.obligationId)), replay(LANE, NEW, { cycles: 48, perCycle: 1 }).admittedAt);
  /* Admission is untouched. Each cycle admits one Scout, and every other due row is refused under its own code. */
  for (const c of cycles) {
    const model = c.lanes!.model;
    assert.equal(model.dispatched, 1);
    assert.equal(model.dispatched + (model.deferredBy.CYCLE_MAX ?? 0), model.due);
  }
});

test("BOUND: within its band a row gets a Scout within ⌈(A + 1) / c⌉ cycles, and no row waits more than ⌈N / c⌉ − 1", async () => {
  const cycles = await scoutLaneRun({ cycles: 200, perCycle: 1 });
  const ran = cycles.map((c) => c.dispatched.map((d) => d.obligationId));
  assert.equal(ran.findIndex((ids) => ids.includes(NEVER_TRIED.id)), 8, "eight rows were ahead of it (A = 8, c = 1)");
  const two = replay(LANE, NEW, { cycles: 300, perCycle: 2 });
  for (const [perCycle, run] of [[1, replay(LANE, NEW, { cycles: 200, perCycle: 1 })], [2, two]] as const) {
    const waits = longestWaits(run.admittedAt, run.eligibleAt);
    assert.equal(waits.size, LANE.length);
    for (const [id, n] of waits) assert.ok(n <= Math.ceil(LANE.length / perCycle) - 1, `${id} waited ${n} cycles at ${perCycle} a cycle`);
  }
});

test("BAND ORDER STANDS: a band-1 row whose backoff just ended still goes ahead of the longest-waiting band-2 row", () => {
  const pilot = row("pima-walled", TIE, "az:county:county-of-pima");
  const nowMs = START_MS;
  const debt = recordFailure(null, { obligationId: pilot.id, cause: "UPSTREAM_ERROR", detail: "x", target: pilot.id, dueAt: TIE, now: new Date(nowMs - 20 * 60_000).toISOString() });
  const due = dueNow(scheduleAll([pilot, NEVER_TRIED, EARLY[0]!], nowMs), nowMs);
  const debtOf = (id: string) => (id === pilot.id ? debt : undefined);
  const ordered = orderByReaderImpact(due.map((d) => orderableDueRow(d, PROVIDER, debtOf(d.obligation.id))), INPUTS).ordered;
  assert.deepEqual(ordered.map((b) => [b.band, b.row.id]), [[1, pilot.id], [2, EARLY[0]!.id], [2, NEVER_TRIED.id]]);
  assert.equal(orderByReaderImpact([], INPUTS).ordering.inputs.tieBreak, TIE_BREAK, "the record names the rule in force");
});

test("NOT SLOWED: a row with no failing debt never has more rows ahead of it than under the old order, and no key is before its own due time", () => {
  let seed = 7;
  const rand = () => ((seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648) / 2_147_483_648);
  const nowMs = START_MS;
  const lane = Array.from({ length: 60 }, (_, i) =>
    row(`r-${String(i).padStart(2, "0")}`, new Date(nowMs - Math.floor(rand() * 400) * HOUR_MS).toISOString(), rand() < 0.2 ? `az:county:county-of-pima:${i}` : `nj:2026:${i}`),
  );
  const debts = new Map<string, FreshnessDebt>();
  for (const o of lane) {
    if (rand() < 0.5) continue;
    const at = new Date(nowMs - Math.floor(rand() * 300) * 60_000).toISOString();
    debts.set(o.id, recordFailure(null, { obligationId: o.id, cause: "UPSTREAM_ERROR", detail: "x", target: o.id, dueAt: at, now: at }));
  }
  const due = dueNow(scheduleAll(lane, nowMs), nowMs).filter((r) => {
    const d = debts.get(r.obligation.id);
    return d === undefined || Date.parse(d.retryAt) <= nowMs;
  });
  const debtOf = (id: string) => debts.get(id);
  const oldIds = [...due].sort((l, r) => OLD(l, r, debtOf)).map((r) => r.obligation.id);
  const newIds = [...due].sort((l, r) => NEW(l, r, debtOf)).map((r) => r.obligation.id);
  assert.ok(debts.size > 10 && due.length > 30, "the fixture holds both kinds of row");
  for (const r of due) {
    const key = orderableDueRow(r, PROVIDER, debtOf(r.obligation.id)).queuedSince!;
    assert.ok(key >= r.nextDueAt, `${r.obligation.id} is keyed before its own due time`);
    if (debts.has(r.obligation.id)) continue;
    assert.ok(newIds.indexOf(r.obligation.id) <= oldIds.indexOf(r.obligation.id), `${r.obligation.id} moved back`);
  }
});

test("the standing runner builds BOTH the recorded queue and the live Scout pool through orderableDueRow with the debt it carried in, after placement", () => {
  const src = readFileSync(join(import.meta.dirname, "..", "scripts", "freshness-shadow.mts"), "utf8");
  assert.match(src, /\.\.\.orderableDueRow\(d, registry\.providerOf\(d\.obligation\.id\), debtAtCycleStart\.get\(d\.obligation\.id\)\)/, "the recorded queue");
  assert.match(src, /orderableDueRow\(row, registry\.providerOf\(row\.obligation\.id\), debtAtCycleStart\.get\(row\.obligation\.id\)\)/, "the live Scout pool");
  const compare = src.slice(src.indexOf("const compareScoutRows"), src.indexOf("return compareReaderImpact(orderable(left), orderable(right), orderingInputs);"));
  assert.ok(compare.indexOf("placementRank(left.obligation.id)") >= 0 && compare.indexOf("placementRank(left.obligation.id)") < compare.indexOf("orderableDueRow"), "the owner's placement still ranks first");
  assert.ok(src.indexOf("const debtAtCycleStart") < src.indexOf("const modelOrder = orderByReaderImpact("), "the debt map is built before the order reads it");
});
