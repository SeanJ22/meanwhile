/**
 * CH-26: each task reads only its own history. With the runner switch on, a
 * task's reads are scoped to its own work item, subject and lineage, so the
 * repository calls it makes, and the rows they return, stay flat as unrelated
 * history grows. With the switch off, the old whole-table reads still run.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { ZERO_COST } from "../lib/control-plane/attempt.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { keysWhere, type ControlPlaneRepositories } from "../lib/control-plane/repository/types.ts";
import { dispatchAutonomousTask, nextAutonomousOperation, type AutonomousCoordinatorRuntime } from "../lib/control-plane/workers/coordinator.ts";
import { readSpendWindowCosts, readSubjectScoutHistoryScoped, readScoutResultsForSubjects, SPEND_WINDOW_READ_SLACK_HOURS } from "../lib/control-plane/workers/scoped-history.ts";
import { readSubjectScoutHistory } from "../lib/control-plane/workers/detective.ts";
import { BOOTSTRAP_DDL, BOOTSTRAP_VERSION, SCOPED_HISTORY_INDEXES } from "../lib/control-plane/repository/pg-schema.ts";
import { pgEnsureOnlineIndex, type Sql } from "../lib/control-plane/repository/pg-store.ts";
import type { CostEntry } from "../lib/control-plane/cost.ts";
import type { ScoutResult } from "../lib/control-plane/scheduler/scout-result.ts";
import { autonomousHarness } from "./helpers/autonomous-fleet.ts";

const WHOLE_TABLE = new Set(["list", "listNarrowed", "readAll", "keys"]);

/** Counts every repository method call by `repository.method`, without changing what any call does. */
function counted(repos: ControlPlaneRepositories) {
  const calls = new Map<string, number>();
  const rows = { n: 0 };
  const wrapped = Object.fromEntries(Object.entries(repos).map(([name, repo]) => {
    if (repo === null || typeof repo !== "object") return [name, repo];
    const proxy = new Proxy(repo as object, { get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== "function" || typeof prop !== "string") return value;
      return (...args: unknown[]) => {
        calls.set(`${name}.${prop}`, (calls.get(`${name}.${prop}`) ?? 0) + 1);
        const out = (value as (...a: unknown[]) => unknown).apply(target, args);
        return out instanceof Promise ? out.then(result => {
          rows.n += Array.isArray(result) ? result.length : result instanceof Map ? result.size : result === null ? 0 : 1;
          return result;
        }) : out;
      };
    } });
    return [name, proxy];
  })) as unknown as ControlPlaneRepositories;
  const whole = () => [...calls].filter(([key]) => WHOLE_TABLE.has(key.split(".")[1]!)).map(([key, n]) => `${key}×${n}`);
  return { repos: wrapped, calls, rows, whole, reset: () => { calls.clear(); rows.n = 0; } };
}

const cost = (id: string, at: string, usd: number): CostEntry => ({ attemptId: id, role: "SCOUT", source: "api.anthropic.com", recordedAt: at,
  cost: { ...ZERO_COST, usd, inputTokens: 1, outputTokens: 1, requestCount: 1 } }) as unknown as CostEntry;
const scout = (obligationId: string, subjectId: string, at: string): ScoutResult => ({ attemptId: `${obligationId}-a`, obligationId, subjectId,
  recordClass: "OFFICIAL_ROSTER", recordedAt: at, refusal: null, candidates: [], findings: [], rungs: [], nextRungs: [], artifactIds: [] }) as unknown as ScoutResult;

/** Unrelated history: other governments' work, attempts, Scout results and old charges. */
async function growUnrelatedHistory(repos: ControlPlaneRepositories, n: number, at: string) {
  for (let i = 0; i < n; i++) {
    await repos.scoutResults.append(`other-obligation-${i}`, `other-${i}`, scout(`other-obligation-${i}`, `other:subject:${i}`, at), at);
    await repos.costs.append(`old-${i}`, `old-${i}`, cost(`old-${i}`, "2026-01-01T00:00:00.000Z", 1), "2026-01-01T00:00:00.000Z");
  }
}

test("CH-26: a Scout task's reads stay flat as unrelated history grows, and none lists a whole table", async () => {
  const counter = counted(createMemoryRepositories());
  const h = await autonomousHarness({ repos: counter.repos, plan: plan => ({ ...plan, sources: [], acquisition: [] }) });
  const refusingScout = (runtime: AutonomousCoordinatorRuntime): AutonomousCoordinatorRuntime => ({ ...runtime, rollingCeilingUsd: 5,
    scoutFor: () => ({ lane: "BOUNDED_MODEL_WORKER",
      workerFor: ({ holder }) => ({ role: "SCOUT", provider: "offline-bounded-control", version: "1", instance: holder }),
      run: async () => ({ kind: "ABORTED", ranAs: "BOUNDED_MODEL_WORKER", failureOutcome: "DENIED_BY_POLICY", endedAt: h.now(),
        cost: { ...ZERO_COST, requestCount: 0, inputTokens: 0, outputTokens: 0, usd: 0 },
        detail: "SCOUT_RESULT_REFUSED: SCOUT_POLICY_DENIED — request refused before sending by the spending or execution policy" }) }) });
  const scoped = refusingScout({ ...h.runtime, scopedReads: true });
  const decision = await nextAutonomousOperation(scoped, h.item.id);
  assert.equal(decision.action, "SCOUT");
  const measure = async () => {
    // Each measurement runs the same task from the same state.
    const row = await h.repos.routeTasks.mustRead(decision.task!.id);
    const { policyDenial: _denial, ...rest } = row.value;
    await h.repos.routeTasks.compareAndSet(row.id, row.revision, { ...rest, state: "RECLAIMABLE" }, h.now());
    counter.reset();
    await dispatchAutonomousTask(scoped, (await h.repos.routeTasks.mustRead(decision.task!.id)).value);
    return { whole: counter.whole(), total: [...counter.calls.values()].reduce((a, b) => a + b, 0), rows: counter.rows.n };
  };
  const first = await measure();
  const small = await measure();
  assert.deepEqual(small.whole, [], "no whole-table read on the task path");
  await growUnrelatedHistory(h.repos, 200, h.now());
  const large = await measure();
  assert.deepEqual(large.whole, []);
  assert.equal(large.total, small.total, "repository calls per task stay flat as history grows");
  // Each run adds the task's own attempt to its history; 200 unrelated Scout results and charges add nothing.
  assert.ok(large.rows - small.rows <= Math.max(2, small.rows - first.rows), `rows stay flat (${first.rows}, ${small.rows}, then ${large.rows})`);

  // The same task on the old path reads every unrelated row.
  const old = refusingScout({ ...h.runtime });
  const row = await h.repos.routeTasks.mustRead(decision.task!.id);
  const { policyDenial: _denial, ...rest } = row.value;
  await h.repos.routeTasks.compareAndSet(row.id, row.revision, { ...rest, state: "RECLAIMABLE" }, h.now());
  counter.reset();
  await dispatchAutonomousTask(old, (await h.repos.routeTasks.mustRead(decision.task!.id)).value);
  assert.ok(counter.rows.n >= large.rows + 200, `the old path returns the unrelated history (${counter.rows.n} rows against ${large.rows})`);
});

test("CH-26: with the switch off, the old whole-table reads still run", async () => {
  const counter = counted(createMemoryRepositories());
  const h = await autonomousHarness({ repos: counter.repos, plan: plan => ({ ...plan, sources: [], acquisition: [] }) });
  counter.reset();
  await nextAutonomousOperation(h.runtime, h.item.id);
  assert.ok(counter.whole().some(call => call.startsWith("attempts.list")), "the old path is the default");
  counter.reset();
  await nextAutonomousOperation({ ...h.runtime, scopedReads: true }, h.item.id);
  assert.deepEqual(counter.whole(), []);
});

test("CH-26: scoped reads return what the whole-table reads returned, after the caller's own filter", async () => {
  const repos = createMemoryRepositories();
  const now = "2026-10-05T18:00:00.000Z";
  await repos.costs.append("in-window", "w", cost("w", "2026-10-05T10:00:00.000Z", 2), "2026-10-05T10:00:00.000Z");
  await repos.costs.append("written-late", "late", cost("late", "2026-10-04T19:00:00.000Z", 3), "2026-10-04T20:00:00.000Z");
  await repos.costs.append("old", "o", cost("o", "2026-09-01T00:00:00.000Z", 7), "2026-09-01T00:00:00.000Z");
  const scopedCosts = await readSpendWindowCosts(repos, now, true);
  assert.deepEqual(scopedCosts.map(row => row.attemptId).sort(), ["late", "w"]);
  assert.equal((await readSpendWindowCosts(repos, now, false)).length, 3);
  assert.ok(SPEND_WINDOW_READ_SLACK_HOURS > 0);

  for (const [key, subject, at] of [["a", "s:1", "2026-10-01T00:00:00.000Z"], ["b", "s:2", "2026-10-01T00:00:01.000Z"],
    ["c", "s:1", "2026-10-01T00:00:02.000Z"], ["c", "s:3", "2026-10-01T00:00:03.000Z"]] as const) {
    await repos.scoutResults.append(key, `${key}-${at}`, { ...scout(key, subject, at), attemptId: `${key}-${at}` }, at);
  }
  const all = await repos.scoutResults.readAll();
  const scoped = await readScoutResultsForSubjects(repos, ["s:1"], true);
  assert.deepEqual(scoped.filter(row => row.subjectId === "s:1"), all.filter(row => row.subjectId === "s:1"));
  assert.deepEqual(await keysWhere(repos.scoutResults, row => row.obligationId, ["subjectId"], "s:1"), ["a", "c"]);
  for (const subjects of [[{ subjectId: "s:1", recordClass: "OFFICIAL_ROSTER" }], [{ subjectId: "s:3", recordClass: "OFFICIAL_ROSTER" }]]) {
    assert.deepEqual(await readSubjectScoutHistoryScoped(repos, subjects, true), await readSubjectScoutHistory(repos, subjects),
      "the newest-record rule keeps the same logs");
  }
  const { keysWhere: _drop, ...withoutFilter } = repos.scoutResults;
  assert.deepEqual(await keysWhere({ ...withoutFilter } as typeof repos.scoutResults, row => row.obligationId, ["subjectId"], "s:1"), ["a", "c"],
    "a store without the filtered read falls back to reading every record");
});

test("CH-26: schema version 20 builds the scoped indexes online, on the exact expressions the reads send", async () => {
  assert.equal(BOOTSTRAP_VERSION, 20);
  for (const index of SCOPED_HISTORY_INDEXES) {
    assert.match(index.ddl, /^CREATE INDEX CONCURRENTLY IF NOT EXISTS /);
    assert.ok(BOOTSTRAP_DDL.includes(index.ddl));
  }
  const ddl = SCOPED_HISTORY_INDEXES.map(index => index.ddl).join("\n");
  assert.match(ddl, /cp_attempts \(\(value #>> '\{workItemId\}'\)\)/);
  assert.match(ddl, /cp_route_tasks \(\(value #>> '\{workItemId\}'\)\)/);
  assert.match(ddl, /cp_occurrences \(\(value #>> '\{workItemId\}'\)\)/);
  assert.match(ddl, /cp_work_items \(\(value #>> '\{planRepair,parentWorkItemId\}'\)\)/, "the lineage index");
  assert.match(ddl, /cp_log_scout_results \(\(record #>> '\{subjectId\}'\)\)/);
  assert.match(ddl, /cp_log_costs \(recorded_at\)/);

  const calls: string[] = [];
  const sql: Sql = { query: async text => {
    calls.push(text);
    if (text.includes("pg_try_advisory_lock")) return [{ locked: true }];
    return [];
  } };
  await pgEnsureOnlineIndex(sql, SCOPED_HISTORY_INDEXES[0]!);
  assert.ok(calls.some(text => text.includes("to_regclass('cp_attempts_work_item')")));
  assert.equal(calls.filter(text => text === SCOPED_HISTORY_INDEXES[0]!.ddl).length, 1);
  assert.ok(!calls.some(text => /\bBEGIN\b|\bCOMMIT\b/.test(text)), "never inside a transaction");
});
