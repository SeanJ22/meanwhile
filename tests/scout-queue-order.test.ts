/**
 * The Scout lane orders due rows by reader-impact band, and within a band by
 * longest wait, so a row whose Scouts keep failing cannot return to the head of
 * its band each time its backoff ends. These tests replay the lane offline on a
 * moving clock with the scheduler's own pure functions and the runner's
 * comparator (`compareReaderImpact` over `orderableDueRow`):
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
import { transpileModule, ScriptTarget, ModuleKind } from "typescript";

import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";

test("standing place ranks reuse one order version and rebuild overlapping memberships on refresh", () => {
  const source = readFileSync(join(process.cwd(), "scripts/freshness-shadow.mts"), "utf8");
  const start = source.indexOf("const placeRankFor = ");
  const end = source.indexOf("const providerQueue = ", start);
  const snippet = transpileModule(source.slice(start, end), {
    compilerOptions: { target: ScriptTarget.ES2022, module: ModuleKind.None },
  }).outputText;
  const make = new Function("expansionPlan", `let placeOrder = ['receipt:a', 'receipt:b']; ${snippet}
    return { rank: placeRankFor, replace: value => { placeOrder = value; } };`);
  let scopeReads = 0;
  const scopes = [
    { get kind() { scopeReads++; return "RESOLVED"; }, decision: { receiptId: "receipt:a" }, members: new Set(["a", "shared"]) },
    { get kind() { scopeReads++; return "RESOLVED"; }, decision: { receiptId: "receipt:b" }, members: new Set(["b", "shared"]) },
    { kind: "UNRESOLVED", decision: { receiptId: "receipt:missing" }, members: new Set(["unresolved"]) },
  ];
  const ranks = make({ scopes });
  for (let query = 0; query < 1000; query++) {
    assert.equal(ranks.rank("shared"), 0);
    assert.equal(ranks.rank("b"), 1);
    assert.equal(ranks.rank("outside"), null);
    assert.equal(ranks.rank("unresolved"), null);
  }
  assert.equal(scopeReads, 2, "four thousand queries read scope memberships only once for this order");
  ranks.replace(["receipt:b", "receipt:a"]);
  assert.equal(ranks.rank("shared"), 0);
  assert.equal(ranks.rank("a"), 1);
  assert.equal(ranks.rank("b"), 0);
  assert.equal(scopeReads, 4);
  ranks.replace([]);
  assert.equal(ranks.rank("shared"), null);
});

test("a failed priority refresh is not re-read until work changes its order version", async () => {
  const source = readFileSync(join(process.cwd(), "scripts/freshness-shadow.mts"), "utf8");
  const start = source.indexOf("let placeOrder: ");
  const end = source.indexOf("await refreshPlaceOrder();", start);
  const snippet = transpileModule(source.slice(start, end), { compilerOptions: { target: ScriptTarget.ES2022, module: ModuleKind.None } }).outputText;
  let reads = 0;
  const plan = { scopes: [{ kind: "RESOLVED", members: new Set(["ocd-division/example"]), decision: { receiptId: "receipt" } }] };
  const repos = { adminConfig: { read: async () => { reads++; throw new Error("forced one priority read failure"); } } };
  const make = new Function("expansionPlan", "repos", "ADMIN_CONFIG_ID", "readHeldPlaceCapture", "nowIso", "runtimeConditions", "console", `${snippet}
    return { refresh: refreshPlaceOrder, changed: () => { placeOrderDirty = true; } };`);
  const priority = make(plan, repos, "admin", async () => ({}), () => "2026-10-02T17:00:00Z", [], { warn: () => {} });
  for (let selection = 0; selection < 20; selection++) await priority.refresh();
  assert.equal(reads, 1, "one refused refresh keeps the last order without twenty repeated store reads");
  priority.changed();
  await priority.refresh();
  assert.equal(reads, 2, "new work still requests a fresh place order");
});
import { registerRouteTask, registerWorkItem } from "../lib/control-plane/repository/coordinator.ts";
import { createRouteTask } from "../lib/control-plane/route-task.ts";
import { createWorkItem } from "../lib/control-plane/work-item.ts";
import { compareReaderImpact, orderableDueRow, orderByReaderImpact, TIE_BREAK, type OrderingInputs } from "../lib/control-plane/research-metrics.ts";
import { recordFailure, retryable, type FreshnessDebt } from "../lib/control-plane/scheduler/debt.ts";
import { dueNow, scheduleAll, type FreshnessObligation, type ScheduledObligation } from "../lib/control-plane/scheduler/obligation.ts";
import { runCycle, runPool, type CycleResult } from "../lib/control-plane/scheduler/shadow-loop.ts";

test("place-order read failure keeps the last priority and does not poison sibling selection", async () => {
  const ran: string[] = [];
  let reads = 0;
  await runPool(["d", "c", "b", "a"], 1, async id => { ran.push(id); }, async () => {
    if (++reads === 2) throw new Error("forced place-order read failure");
    return (left, right) => left.localeCompare(right);
  });
  assert.deepEqual(ran, ["a", "b", "c", "d"]);
  const siblings: number[] = [];
  await runPool([1, 2, 3], 3, async id => { siblings.push(id); }, async () => {
    throw new Error("place-order read unavailable before first priority");
  });
  assert.deepEqual(siblings.sort(), [1, 2, 3]);
});

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
 * All band 2:
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

test("actual paid and plain-code admissions retain hunt rounds through place priority refreshes", async () => {
  const repos = createMemoryRepositories();
  const now = new Date(START_MS).toISOString();
  const ids = ["a1", "a2", "b1", "b2", "c1", "c2"];
  const obligations = ["plain", "paid"].flatMap(lane => ids.map(id => row(`${lane}:${id}`, TIE)));
  const tasks = new Map<string, string>();
  for (const obligation of obligations) {
    const item = createWorkItem({ project: "freshness", subject: obligation.subjectId,
      obligation: `refresh:${obligation.recordClass}`, why: "offline queue regression", now });
    const task = createRouteTask({ workItemId: item.id, routeId: obligation.routeId!,
      routeLabel: "offline queue route", target: "fixture.invalid", inherited: false, now });
    await registerWorkItem(repos, item, now);
    await registerRouteTask(repos, task, now);
    tasks.set(obligation.id, task.id);
  }
  const huntFor = (scheduled: ScheduledObligation) => scheduled.obligation.id.split(":")[1]![0]!;
  const ran = { plain: [] as string[], paid: [] as string[] };
  let priority = ["a", "b", "c"];
  const execute = (lane: keyof typeof ran, scheduled: ScheduledObligation) => async () => {
    ran[lane].push(scheduled.obligation.id.split(":")[1]!);
    if (ran[lane].length === 3) priority = ["c", "b", "a"];
    return { kind: "ABORTED" as const, ranAs: lane === "plain" ? "DETERMINISTIC" as const : "BOUNDED_MODEL_WORKER" as const,
      detail: "Offline lease-owned execution; no provider call" };
  };
  const cycle = await runCycle({ repos, obligations, debts: [], routeTaskFor: id => tasks.get(id) ?? null,
    maturity: () => "UNGRADUATED", holder: "hunt-round-regression", now, leaseTtlMs: 60_000,
    executor: scheduled => ({ lane: "DETERMINISTIC", run: execute("plain", scheduled) }), workerCapacity: 1,
    huntFor, placeComparator: async () => (a, b) => priority.indexOf(huntFor(a)) - priority.indexOf(huntFor(b)),
    reader: { contract: "READER", state: "NOT_READY", reason: "offline fixture" },
    truth: { contract: "TRUTH", state: "NOT_READY", reason: "offline fixture" },
    research: { decide: scheduled => ({ kind: scheduled.obligation.id.startsWith("paid:") ? "BOUNDED_MODEL_WORKER" : "DETERMINISTIC",
      why: "offline lane regression", disagreement: null }),
      admitScout: () => ({ admit: true }), workerCapacity: 1, scoutLeaseTtlMs: 60_000,
      modelExecutor: scheduled => ({ lane: "BOUNDED_MODEL_WORKER", run: execute("paid", scheduled) }) },
  });
  for (const lane of ["plain", "paid"] as const) {
    assert.deepEqual([...ran[lane].slice(0, 3)].sort(), ["a1", "b1", "c1"], `${lane}: every hunt reaches execution before a second child`);
    assert.deepEqual(ran[lane].slice(3), ["c2", "b2", "a2"], `${lane}: changed place priority orders the next round`);
  }
  assert.equal(cycle.dispatched.length, 12);
  assert.equal(new Set(cycle.dispatched.map(result => result.attemptId)).size, 12, "each task has one actual attempt");
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
  const pilot = { ...row("pima-walled", TIE, "az:county:county-of-pima"), readerImpactAt: "2026-09-01T00:00:00.000Z" };
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
