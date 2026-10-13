import assert from "node:assert/strict";
import test from "node:test";
import { ZERO_COST } from "../lib/control-plane/attempt.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { keysWhere, type ControlPlaneRepositories } from "../lib/control-plane/repository/types.ts";
import { dispatchAutonomousTask, nextAutonomousOperation, type AutonomousCoordinatorRuntime } from "../lib/control-plane/workers/coordinator.ts";
import { readAuditHistory, readSpendWindowCosts, readSubjectScoutHistoryScoped, readScoutResultsForSubjects, SPEND_WINDOW_READ_SLACK_HOURS } from "../lib/control-plane/workers/scoped-history.ts";
import type { ArtifactRecord } from "../lib/control-plane/repository/types.ts";
import type { WorkItem } from "../lib/control-plane/work-item.ts";
import { readSubjectScoutHistory } from "../lib/control-plane/workers/detective.ts";
import { BOOTSTRAP_DDL, BOOTSTRAP_VERSION, SCOPED_HISTORY_INDEXES } from "../lib/control-plane/repository/pg-schema.ts";
import { pgEnsureOnlineIndex, type Sql } from "../lib/control-plane/repository/pg-store.ts";
import type { CostEntry } from "../lib/control-plane/cost.ts";
import type { ScoutResult } from "../lib/control-plane/scheduler/scout-result.ts";
import { autonomousHarness } from "./helpers/autonomous-fleet.ts";
import { readLineageHistory } from "../lib/control-plane/workers/scoped-history.ts";
import { autonomousStandingRuntime } from "../lib/control-plane/workers/standing-runtime.ts";
import { writeFieldManual } from "../lib/control-plane/field-manual.ts";
import { knowledgeEntries, methodVersionEntry } from "./method-store-fixture.ts";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { selectStandingLineages } from "../lib/control-plane/workers/standing-lineage.ts";
import { readCompletedWorkerResults } from "../lib/control-plane/repository/worker-completion.ts";
import { createWorkItem } from "../lib/control-plane/work-item.ts";
import { registerWorkItem } from "../lib/control-plane/repository/coordinator.ts";
import type { FreshnessOccurrence } from "../lib/control-plane/scheduler/durable.ts";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import type { PromotedProjection } from "../lib/civic-data/types.ts";
import { withReaderAuthorityEdge, type ReaderAuthorityEdgeBundle } from "../lib/registry/runtime-edge.ts";
import { manualEdgeEntry } from "./helpers/promoted-edge-entry.ts";

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
  assert.deepEqual(await keysWhere(repos.scoutResults, ["subjectId"], "s:1"), ["a", "c"]);
  for (const subjects of [[{ subjectId: "s:1", recordClass: "OFFICIAL_ROSTER" }], [{ subjectId: "s:3", recordClass: "OFFICIAL_ROSTER" }]]) {
    assert.deepEqual(await readSubjectScoutHistoryScoped(repos, subjects, true), await readSubjectScoutHistory(repos, subjects),
      "the newest-record rule keeps the same logs");
  }
  const { keysWhere: _drop, ...withoutFilter } = repos.scoutResults;
  const plain = { ...repos, scoutResults: withoutFilter as typeof repos.scoutResults };
  assert.equal(await keysWhere(plain.scoutResults, ["subjectId"], "s:1"), null, "a store without the filtered read says so");
  assert.deepEqual(await readScoutResultsForSubjects(plain, ["s:1"], true), all, "and the scoped read falls back to the whole log");
});

test("CH-26: an audit's scoped rows are every row its whole-table reads would have used", async () => {
  const repos = createMemoryRepositories();
  const at = "2026-10-05T18:00:00.000Z";
  const item = (id: string, subject: string, inheritsFrom?: string) => ({ id, subject, project: "p",
    autonomousPlan: { acquisition: inheritsFrom ? [{ held: [{ inheritedFromWorkItemId: inheritsFrom }] }] : [] } }) as unknown as WorkItem;
  const capture = (artifactId: string, workItemId: string) => ({ artifactId, workItemId, partial: false, canonicalUrl: `https://x.example.gov/${artifactId}` }) as unknown as ArtifactRecord;
  for (const row of [item("owner", "s:1", "origin"), item("sibling", "s:1"), item("origin", "s:other"), item("stranger", "s:2")]) await repos.workItems.put(row.id, row, at);
  for (const [key, record] of [["owner", capture("primary", "owner")], ["sibling", capture("sib-page", "sibling")], ["origin", capture("inherited", "origin")],
    ["stranger", capture("authority", "stranger")], ["stranger-2", capture("unrelated", "stranger-2")], ["held:1", capture("replayed", "sibling")]] as const) {
    await repos.artifacts.append(key, `${key}:${record.artifactId}`, record, at);
  }
  const scoped = (await readAuditHistory(repos, { workItemId: "owner", subjectId: "s:1", requiredArtifactIds: ["primary", "authority"] }))!;
  const allItems = (await repos.workItems.list()).map(row => row.value);
  const allArtifacts = await repos.artifacts.readAll();
  const subjectIds = new Set(allItems.filter(row => row.subject === "s:1").map(row => row.id));
  assert.deepEqual(scoped.items.filter(row => row.subject === "s:1"), allItems.filter(row => row.subject === "s:1"), "the subject's items, in id order");
  assert.ok(scoped.items.some(row => row.id === "owner"));
  assert.deepEqual(scoped.artifacts.filter(row => subjectIds.has(row.workItemId)), allArtifacts.filter(row => subjectIds.has(row.workItemId)),
    "every same-subject capture, including one recorded under another log key");
  for (const id of ["primary", "authority"]) assert.deepEqual(scoped.artifacts.find(row => row.artifactId === id), allArtifacts.find(row => row.artifactId === id),
    "the first capture of a required ID is the same capture");
  assert.ok(scoped.artifacts.some(row => row.artifactId === "inherited"), "a capture the owner's plan inherits");
  assert.ok(!scoped.artifacts.some(row => row.artifactId === "unrelated"), "nothing else");
  const { keysWhere: _drop, ...withoutFilter } = repos.artifacts;
  assert.equal(await readAuditHistory({ ...repos, artifacts: withoutFilter as typeof repos.artifacts }, { subjectId: "s:1", requiredArtifactIds: [] }), null);
});

test("CH-26: a task's lineage, read through the lineage index, is the lineage the whole store gives", async () => {
  const h = await autonomousHarness();
  const first = (await h.repos.workItems.mustRead(h.item.id)).value;
  const second = { ...createWorkItem({ project: first.project, subject: first.subject, obligation: "same source period, second round", why: "retry", now: h.now() }),
    autonomousPlan: first.autonomousPlan };
  const child = { ...createWorkItem({ project: first.project, subject: first.subject, obligation: "linked repair child", why: "repair", now: h.now() }),
    autonomousPlan: first.autonomousPlan, planRepair: { parentWorkItemId: first.id, rootWorkItemId: first.id, depth: 1, proposalHash: "p",
      scoutAttemptId: "a", sourceArtifactId: "x", retainedEvidenceIds: [], admittedAt: h.now(), authority: "WORK_INSTRUCTIONS_ONLY" as const, unresolved: [] } };
  const stranger = { ...createWorkItem({ project: first.project, subject: "fixture:nh:other", obligation: "another government", why: "other", now: h.now() }),
    autonomousPlan: first.autonomousPlan };
  for (const item of [second, child, stranger]) await registerWorkItem(h.repos, item as typeof first, h.now());
  const dueAt = "2026-09-03T18:00:00.000Z";
  const occurrence = (id: string, obligationId: string, workItemId: string, openedAt: string): FreshnessOccurrence => ({ id, obligationId, sequence: 1, dueAt,
    workItemId, routeTaskId: `route-${id}`, openedAt, closedAt: openedAt, disposition: null, unresolvedReason: "owed" });
  for (const row of [occurrence("round-1", "obligation-a", first.id, "2026-09-03T18:01:00.000Z"), occurrence("round-2", "obligation-a", second.id, "2026-09-03T19:01:00.000Z"),
    occurrence("round-x", "obligation-b", stranger.id, "2026-09-03T18:30:00.000Z")]) await h.repos.occurrences.put(row.id, row, dueAt);

  const history = (await readLineageHistory(h.repos, child.id))!;
  assert.deepEqual(new Set(history.workItems.map(item => item.id)), new Set([first.id, second.id, child.id]), "the lineage and its repair family, nothing else");
  assert.deepEqual(history.occurrences.map(row => row.id), ["round-1", "round-2"]);
  const whole = selectStandingLineages({ occurrences: (await h.repos.occurrences.list()).map(row => row.value),
    workItems: (await h.repos.workItems.list()).map(row => row.value), artifacts: await h.repos.artifacts.readAll(),
    attempts: (await h.repos.attempts.list()).map(row => row.value), workerResults: await readCompletedWorkerResults(h.repos) });
  const mine = whole.filter(lineage => lineage.siblingRootIds.includes(first.id));
  assert.deepEqual(mine.map(lineage => new Set(lineage.siblingRootIds)), [new Set([first.id, second.id])], "a real two-root lineage");
  assert.deepEqual(selectStandingLineages(history), mine);
});

test("CH-26: a lease worker's scoped runtime builds and begins a task without listing a whole table", async t => {
  const counter = counted(createMemoryRepositories());
  const h = await autonomousHarness({ repos: counter.repos });
  const root = await mkdtemp(join(tmpdir(), "scoped-runtime-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const method = { version: 56, updatedOn: "2026-09-03", routes: [] };
  await writeFieldManual(h.repos, [...knowledgeEntries(method), methodVersionEntry(method)], h.now());
  counter.reset();
  const { projection } = JSON.parse(gunzipSync(readFileSync("tests/fixtures/registry-transfer-import.json.gz")).toString("utf8")) as { projection: PromotedProjection };
  const registry: ReaderAuthorityEdgeBundle = { promoted: new Map([[projection.key, manualEdgeEntry("registry-runtime-bindings", projection.payload, projection.versionId)]]) };
  const runtime = await withReaderAuthorityEdge(registry, () => autonomousStandingRuntime({ root, repos: h.repos, now: h.now, auditCeilingUsd: 1, scopedReads: true, environment: { NODE_ENV: "test" } }));
  assert.deepEqual(counter.whole(), [], "the build reads no whole table");
  for (const row of (await h.repos.routeTasks.listWhere(["workItemId"], h.item.id))) {
    counter.reset();
    await runtime.beginTask!(row.value);
    assert.deepEqual(counter.whole(), [], "beginning a task reads only its own lineage");
  }
  counter.reset();
  await withReaderAuthorityEdge(registry, () => autonomousStandingRuntime({ root, repos: h.repos, now: h.now, auditCeilingUsd: 1 }));
  assert.ok(counter.whole().length > 0, "the round's unscoped build still does the whole-store upkeep");
});

test("CH-26: schema version 20 builds the scoped indexes online, on the exact expressions the reads send", async () => {
  assert.ok(BOOTSTRAP_VERSION >= 20, "v20 added the scoped indexes; later versions (v21 live audits) keep them");
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

test("CH-26: each lease task reports its repository calls, and the round records their mean as a phase", async () => {
  const { readFile } = await import("node:fs/promises");
  const worker = await readFile(new URL("../lib/control-plane/workers/lease-worker.ts", import.meta.url), "utf8");
  assert.match(worker, /const observer = observeCyclePhases\(stores\);\s*const repos = observer\.repos;/);
  assert.match(worker, /observer\.finish\("runtime"\);\s*await runtime\.beginTask\?\.\(task, item\);/, "the runtime build is not charged to the task");
  assert.match(worker, /repositoryCalls: observer\.finish\("task"\)\.repositoryCalls/);
  assert.match(worker, /WTP_SCOPED_TASK_READS !== "0"/, "the scoped path is the default; the whole-table path stays behind its runner switch");
  const round = await readFile(new URL("../scripts/freshness-shadow.mts", import.meta.url), "utf8");
  assert.match(round, /if \(typeof result\.repositoryCalls === "number"\) leaseTaskCalls\.push\(result\.repositoryCalls\);/);
  assert.match(round, /cyclePhases: \[\.\.\.cycleObservation\.phases, \.\.\.leaseTaskReadsPhase\(\)\]/);
  assert.ok(round.indexOf("const leaseTaskCalls") < round.indexOf("const earlyOriginal"), "declared before the first wave can report");
});
