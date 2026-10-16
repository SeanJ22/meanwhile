import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { pgAggregateRepository, pgCoordinatorWorkItems, readCoordinatorWorkItems, type Sql } from "../lib/control-plane/repository/pg-store.ts";
import { archivedAggregateRepository, createPgDispatchState, DISPATCH_ARCHIVE_MOVE_SQL, DISPATCH_STATE_DDL } from "../lib/control-plane/repository/dispatch-state.ts";
import { closeOccurrence, openOccurrence, resumeOpenOccurrence, scanOccurrences, settledRouteTaskIds, standing, type FreshnessOccurrence } from "../lib/control-plane/scheduler/durable.ts";
import type { WorkItem } from "../lib/control-plane/work-item.ts";
import type { ScoutResult } from "../lib/control-plane/scheduler/scout-result.ts";
import { createRouteTask, type RouteTask } from "../lib/control-plane/route-task.ts";
import { registerRouteTask } from "../lib/control-plane/repository/coordinator.ts";
import { autonomousHarness } from "./helpers/autonomous-fleet.ts";
import { nextAutonomousOperation, dispatchAutonomousTask } from "../lib/control-plane/workers/coordinator.ts";
import { readWorkerPublicationItems } from "../lib/civic-data/publish-now.ts";
import { readHeldInputs } from "../lib/civic-data/worker-held-elections.ts";
import { CHANGED_AT_TOUCH_FUNCTION_DDL, changedAtColumnDdl } from "../lib/control-plane/repository/pg-schema.ts";

const NOW = "2026-10-01T12:00:00.000Z";
async function fixture() {
  const db = new PGlite();
  const statements: string[] = [];
  const hooks: { before: ((text: string) => Promise<void>) | null } = { before: null };
  const sql = { async query(text: string, params?: readonly unknown[]) { statements.push(text); await hooks.before?.(text); return (await db.query<Record<string, unknown>>(text, [...params ?? []])).rows; } } satisfies Sql;
  for (const table of ["work_items", "route_tasks", "occurrences", "attempts"]) await db.exec(`CREATE TABLE cp_${table} (
    id text PRIMARY KEY, revision bigint NOT NULL, updated_at timestamptz NOT NULL,
    value jsonb NOT NULL, changed_at timestamptz NOT NULL DEFAULT now());`);
  await db.exec("CREATE TABLE cp_log_artifacts (log_key text, record jsonb); CREATE TABLE cp_log_worker_results (log_key text, record jsonb);");
  await db.exec("CREATE TABLE cp_log_scout_results (log_key text, position bigint, record jsonb);");
  await db.exec("CREATE INDEX cp_route_tasks_state ON cp_route_tasks ((value->>'state')); CREATE INDEX cp_route_tasks_changed_at ON cp_route_tasks (changed_at);");
  await db.exec("CREATE FUNCTION cp_reject_rewrite() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'delete refused'; END $$;");
  for (const ddl of DISPATCH_STATE_DDL) await db.exec(ddl);
  const repos = createMemoryRepositories();
  const aggregate = <T>(kind: "work_items" | "route_tasks" | "occurrences") => {
    const name = { work_items: "WorkItem", route_tasks: "RouteTask", occurrences: "FreshnessOccurrence" }[kind];
    return archivedAggregateRepository(pgAggregateRepository<T>(sql, name, `cp_${kind}`), pgAggregateRepository<T>(sql, name, `cp_${kind}_archive`));
  };
  Object.assign(repos, { workItems: aggregate<WorkItem>("work_items"), routeTasks: aggregate<RouteTask>("route_tasks"), occurrences: aggregate<FreshnessOccurrence>("occurrences"),
    dispatchState: createPgDispatchState(sql, () => repos) });
  const obligation = standing({ id: "place-source", subjectId: "place", recordClass: "meetings", routeId: "calendar", active: true,
    readerImpactAt: null, observedChangeRateHours: null, lastWorkedAt: null }, NOW);
  await repos.obligations.put(obligation.id, obligation, NOW);
  return { db, sql, repos, statements, obligation, hooks };
}

test("closed occurrences leave hot tables; exact and scoped history and later publication remain available", async () => {
  const f = await fixture();
  try {
    const opened = await openOccurrence(f.repos, { obligation: f.obligation, dueAt: NOW, now: NOW });
    assert.ok(opened);
    await assert.rejects(f.db.query("DELETE FROM cp_work_items WHERE id=$1", [opened.workItem.id]), /exact archived copy/);
    await closeOccurrence(f.repos, { occurrenceId: opened.occurrence.id, disposition: "INGESTED", unresolvedReason: null, now: NOW });
    for (const table of ["occurrences", "work_items", "route_tasks"]) {
      assert.equal((await f.db.query<{ n: number }>(`SELECT count(*)::int AS n FROM cp_${table}`)).rows[0].n, 0);
      assert.equal((await f.db.query<{ n: number }>(`SELECT count(*)::int AS n FROM cp_${table}_archive`)).rows[0].n, 1);
    }
    assert.equal((await f.repos.occurrences.mustRead(opened.occurrence.id)).value.disposition, "INGESTED");
    assert.equal((await f.repos.occurrences.listWhere(["obligationId"], f.obligation.id)).length, 1);
    assert.equal((await f.db.query<{ n: number }>("SELECT count(*)::int AS n FROM cp_work_items_history WHERE id=$1", [opened.workItem.id])).rows[0].n, 1);
    const item = await f.repos.workItems.mustRead(opened.workItem.id);
    await f.repos.workItems.compareAndSet(item.id, item.revision, { ...item.value, why: "publication attached after scout closed" }, NOW);
    assert.equal((await f.repos.workItems.mustRead(item.id)).revision, item.revision + 1);
    assert.equal((await f.repos.dispatchState.readOpen()).occurrences.size, 0);
    await assert.rejects(f.db.query("DELETE FROM cp_work_items_archive"), /delete refused/);
    for (const [table, prefix] of [["work_items", "work"], ["route_tasks", "task"]]) await f.db.exec(`
      INSERT INTO cp_${table} (id, revision, updated_at, value)
      SELECT '${prefix}-batch-'||n, 1, now(), jsonb_build_object('id','${prefix}-batch-'||n) FROM generate_series(1,1001) n`);
    await f.db.exec(`INSERT INTO cp_occurrences (id,revision,updated_at,value)
      SELECT 'occ-batch-'||n,1,now(),jsonb_build_object('id','occ-batch-'||n,'closedAt',now(),
      'workItemId','work-batch-'||n,'routeTaskId','task-batch-'||n) FROM generate_series(1,1001) n`);
    assert.equal((await f.db.query<{ moved: number }>(DISPATCH_ARCHIVE_MOVE_SQL)).rows[0].moved, 1000);
    assert.equal((await f.db.query<{ moved: number }>(DISPATCH_ARCHIVE_MOVE_SQL)).rows[0].moved, 1);
    assert.equal((await f.db.query<{ moved: number }>(DISPATCH_ARCHIVE_MOVE_SQL)).rows[0].moved, 0);
    assert.equal((await f.db.query<{ n: number }>("SELECT count(*)::int AS n FROM cp_occurrences_archive")).rows[0].n, 1002);
  } finally { await f.db.close(); }
});

test("archived publication work is selected when its result or saved body page changes", async () => {
  const f = await fixture();
  try {
    await f.db.exec("ALTER TABLE cp_log_worker_results ADD COLUMN changed_at timestamptz; ALTER TABLE cp_log_artifacts ADD COLUMN changed_at timestamptz, ADD COLUMN recorded_at timestamptz;");
    const opened = await openOccurrence(f.repos, { obligation: f.obligation, dueAt: NOW, now: NOW });
    assert.ok(opened);
    await closeOccurrence(f.repos, { occurrenceId: opened.occurrence.id, disposition: "INGESTED", unresolvedReason: null, now: NOW });
    const before = "2026-10-01T11:00:00.000Z", after = "2026-10-01T13:00:00.000Z";
    await f.db.query("UPDATE cp_work_items_archive SET value = value || $2::jsonb, changed_at = $3 WHERE id = $1", [opened.workItem.id,
      JSON.stringify({ subject: "place", autonomousPlan: { publication: { contractId: "ballot-navigation", bodyId: "body" }, contract: { recordClass: "VOTER_ACCESS_ROUTE" } } }), before]);
    const read = (sharedInputsMoved = false) => readWorkerPublicationItems(f.sql.query, ["ballot-navigation"], { at: NOW, sharedInputsMoved });
    const ids = async (shared = false) => (await read(shared)).map(row => row.id);
    assert.deepEqual(await ids(), []);
    assert.deepEqual(await ids(true), [opened.workItem.id]);
    await f.db.query("UPDATE cp_work_items_archive SET changed_at = $2 WHERE id = $1", [opened.workItem.id, after]);
    assert.deepEqual(await ids(), [opened.workItem.id]);
    await f.db.query("UPDATE cp_work_items_archive SET changed_at = $2 WHERE id = $1", [opened.workItem.id, before]);
    await f.db.query("INSERT INTO cp_log_worker_results (log_key, record, changed_at) VALUES ($1, '{}'::jsonb, $2)", [opened.workItem.id, after]);
    assert.deepEqual(await ids(), [opened.workItem.id]);
    await f.db.exec("DELETE FROM cp_log_worker_results");
    await f.db.query("INSERT INTO cp_log_artifacts (log_key, record, changed_at, recorded_at) VALUES ($1, '{}'::jsonb, $2, $2)", [opened.workItem.id, after]);
    assert.deepEqual(await ids(), [opened.workItem.id]);
    const inputs = await readHeldInputs(f.sql.query, { nationalAt: null, registryAt: null, routesAt: null }, await read());
    assert.equal(inputs.pagesAt.get("place"), after);
    assert.equal(inputs.bodyPagesAt.get("body"), after);
    await f.db.exec("DELETE FROM cp_log_artifacts");
    assert.deepEqual(await ids(), []);
    await f.db.exec(CHANGED_AT_TOUCH_FUNCTION_DDL);
    await f.db.exec(changedAtColumnDdl("cp_work_items_archive"));
    const held = await f.repos.workItems.mustRead(opened.workItem.id);
    await f.repos.workItems.compareAndSet(held.id, held.revision, { ...held.value, why: "publication updated after archival" }, NOW);
    assert.deepEqual(await ids(), [opened.workItem.id]);
  } finally { await f.db.close(); }
});

test("dispatch reuses one open snapshot; settled and abandoned results do not point-read each row", async () => {
  const f = await fixture();
  try {
    for (let sequence = 0; sequence < 30; sequence++) {
      const obligation = (await f.repos.obligations.mustRead(f.obligation.id)).value;
      const opened = await openOccurrence(f.repos, { obligation, dueAt: NOW, now: NOW });
      assert.ok(opened);
      await closeOccurrence(f.repos, { occurrenceId: opened.occurrence.id, disposition: "INGESTED", unresolvedReason: null, now: NOW });
    }
    const obligation = (await f.repos.obligations.mustRead(f.obligation.id)).value;
    const opened = await openOccurrence(f.repos, { obligation, dueAt: NOW, now: NOW });
    assert.ok(opened);
    const current = (await f.repos.obligations.mustRead(f.obligation.id)).value;
    const snapshot = await f.repos.dispatchState.readOpen();
    assert.equal(snapshot.occurrences.size, 1);
    assert.equal(snapshot.workItems.size, 1);
    assert.equal(snapshot.routeTasks.size, 1);
    f.statements.length = 0;
    assert.deepEqual(await resumeOpenOccurrence(f.repos, current, snapshot), { kind: "OPEN", id: opened.occurrence.id, routeTaskId: opened.routeTask.id });
    const scan = await scanOccurrences(f.repos, { obligations: [current], settledRouteTaskIds: settledRouteTaskIds([...snapshot.routeTasks.values()]),
      neverClaimedRouteTaskIds: new Set([opened.routeTask.id]), snapshot });
    assert.deepEqual(scan, { settled: [], abandoned: [] });
    assert.equal(f.statements.length, 0);
    const task = await f.repos.routeTasks.mustRead(opened.routeTask.id);
    await f.repos.routeTasks.compareAndSet(task.id, task.revision, { ...task.value, state: "DISPOSED", disposition: {
      disposition: "INGESTED", attemptId: "attempt", at: NOW, artifactIds: [], observation: null, permission: "ALLOWED", transport: "REACHABLE", note: "done",
    } }, NOW);
    await f.db.query("UPDATE cp_route_tasks SET changed_at='2026-01-01' WHERE id=$1", [task.id]);
    const changed = await f.repos.dispatchState.readOpen();
    const resumed = await resumeOpenOccurrence(f.repos, current, changed);
    assert.equal(resumed?.kind, "SETTLED");
    assert.ok(f.statements.some(statement => statement.includes("changed_at >=") && statement.includes("cp_route_tasks")));
  } finally { await f.db.close(); }
});

test("an archive move between the writer's read and CAS preserves the update and refuses deletion without evidence", async () => {
  const f = await fixture();
  try {
    const opened = await openOccurrence(f.repos, { obligation: f.obligation, dueAt: NOW, now: NOW });
    assert.ok(opened);
    const occurrence = await f.repos.occurrences.mustRead(opened.occurrence.id);
    await f.repos.occurrences.compareAndSet(occurrence.id, occurrence.revision, { ...occurrence.value, closedAt: NOW }, NOW);
    const item = await f.repos.workItems.mustRead(opened.workItem.id);
    let rebuilds = 0;
    const rebuild = async () => { rebuilds++; return [{ key: "lineage", obligationId: f.obligation.id, dueAt: NOW,
      rootWorkItemId: item.id, siblingRootIds: [item.id], publishedAt: null }]; };
    await f.repos.dispatchState.lineages(f.obligation.id, rebuild);
    await f.repos.dispatchState.lineages(f.obligation.id, rebuild);
    assert.equal(rebuilds, 1, "unchanged history is reduced to its per-place fingerprint");
    f.hooks.before = async text => {
      if (!text.startsWith("UPDATE cp_work_items\n")) return;
      f.hooks.before = null;
      await f.repos.dispatchState.archiveOccurrence(occurrence.id, NOW);
    };
    await f.repos.workItems.compareAndSet(item.id, item.revision, { ...item.value, why: "concurrent publication" }, NOW);
    assert.equal((await f.repos.workItems.mustRead(item.id)).value.why, "concurrent publication");
    assert.equal((await f.db.query<{ n: number }>("SELECT count(*)::int AS n FROM cp_work_items")).rows[0].n, 0);
    assert.equal((await f.repos.workItems.list()).length, 1);
    await f.repos.dispatchState.lineages(f.obligation.id, rebuild);
    assert.equal(rebuilds, 2, "an archived item's later publication invalidates its summary");
    await f.db.query("INSERT INTO cp_log_artifacts VALUES ($1,$2::jsonb)", [item.id, JSON.stringify({ workItemId: item.id })]);
    await f.repos.dispatchState.lineages(f.obligation.id, rebuild);
    assert.equal(rebuilds, 3, "a new capture invalidates even when its transaction clock is old");
    for (const ddl of DISPATCH_STATE_DDL) await f.db.exec(ddl);
    assert.equal((await f.repos.occurrences.mustRead(occurrence.id)).value.closedAt, NOW);
    const next = await openOccurrence(f.repos, { obligation: (await f.repos.obligations.mustRead(f.obligation.id)).value, dueAt: NOW, now: NOW });
    assert.ok(next);
    const nextOccurrence = await f.repos.occurrences.mustRead(next.occurrence.id);
    await f.repos.occurrences.compareAndSet(nextOccurrence.id, nextOccurrence.revision, { ...nextOccurrence.value, closedAt: NOW }, NOW);
    const nextItem = await f.repos.workItems.mustRead(next.workItem.id);
    f.hooks.before = async text => {
      if (!text.startsWith("INSERT INTO cp_work_items ")) return;
      f.hooks.before = null;
      await f.repos.dispatchState.archiveOccurrence(next.occurrence.id, NOW);
    };
    assert.equal((await f.repos.workItems.put(nextItem.id, nextItem.value, NOW)).created, false);
    assert.equal((await f.db.query<{ n: number }>("SELECT count(*)::int AS n FROM cp_work_items WHERE id=$1", [next.workItem.id])).rows[0].n, 0);
  } finally { await f.db.close(); }
});

test("coordinator selection retains archived Scout continuations and admits only owed hunt lanes", async () => {
  const f = await fixture();
  try {
    const plan = (await autonomousHarness()).item.autonomousPlan!;
    async function seed(name: string, hunt: boolean, closed: boolean, exaComplete: boolean, instructions = plan) {
      const obligation = { ...standing({ id: name, subjectId: name, recordClass: "meetings", routeId: hunt ? "hunter:packet" : "calendar",
        active: true, readerImpactAt: null, observedChangeRateHours: null, lastWorkedAt: null }, NOW),
      autonomousPlan: { ...instructions, capability: hunt ? "hunt-packet" : instructions.capability } };
      await f.repos.obligations.put(name, obligation, NOW);
      const opened = await openOccurrence(f.repos, { obligation, dueAt: NOW, now: NOW });
      assert.ok(opened);
      if (exaComplete) {
        const exa = createRouteTask({ workItemId: opened.workItem.id, routeId: "hunter:exa-agent", routeLabel: "Exa", target: name, inherited: false, now: NOW });
        await registerRouteTask(f.repos, { ...exa, state: "RESULT_RECORDED" }, NOW);
      }
      if (closed) {
        const task = await f.repos.routeTasks.mustRead(opened.routeTask.id);
        await f.repos.routeTasks.compareAndSet(task.id, task.revision, { ...task.value, state: "DISPOSED" }, NOW);
        await closeOccurrence(f.repos, { occurrenceId: opened.occurrence.id, disposition: "INGESTED", unresolvedReason: null, now: NOW });
      }
      return opened.workItem.id;
    }
    const continuation = await seed("archived-scout-owes-parser", false, true, false);
    const finished = await seed("finished-hunt", true, true, true);
    const open = await seed("open-hunt", true, false, false);
    const missingExa = await seed("finished-hunt-owes-exa", true, true, false);
    const noSource={...plan,acquisition:[],sources:[]};
    const emptyClosed=await seed("closed-scout-with-no-source",false,true,false,noSource);
    const emptyOpen=await seed("open-scout-with-no-source",false,false,false,noSource);
    const retired=await seed("retired-meeting-source",false,true,false,{...plan,
      contract:{...plan.contract,schemaVersion:1,recordClass:"LEGISTAR_EVENTS"} as typeof plan.contract});
    assert.equal((await f.db.query<{ n: number }>("SELECT count(*)::int AS n FROM cp_work_items_archive WHERE id=$1", [continuation])).rows[0].n, 1);
    const ids = async (exa: boolean) => (await pgCoordinatorWorkItems(f.sql, exa)).map(item => item.id).sort();
    assert.deepEqual(await ids(false), [continuation, open, emptyOpen, retired].sort());
    assert.deepEqual(await ids(true), [continuation, open, missingExa, emptyOpen, retired].sort());
    for(const id of [finished,emptyClosed]) assert.ok(!(await ids(true)).includes(id));
    assert.deepEqual((await readCoordinatorWorkItems(f.repos)).map(item=>item.id).sort(),await ids(false));

  } finally { await f.db.close(); }
});

test("an archived Scout's acquired source still advances to its owed Parser", async () => {
  const f=await fixture();
  try {
    const h=await autonomousHarness({repos:f.repos});
    const seed=(await f.repos.routeTasks.listWhere(["workItemId"],h.item.id))[0]!;
    const acquired=await nextAutonomousOperation(h.runtime,h.item.id);
    assert.equal(acquired.task?.workerTask?.role,"ACQUIRER");
    assert.equal((await dispatchAutonomousTask(h.runtime,acquired.task!)).outcome,"WORKED");
    const occurrence:FreshnessOccurrence={id:"closed-scout-parser",obligationId:f.obligation.id,sequence:1,dueAt:NOW,
      workItemId:h.item.id,routeTaskId:seed.id,openedAt:NOW,closedAt:null,disposition:null,unresolvedReason:null};
    await f.repos.occurrences.put(occurrence.id,occurrence,NOW);
    await closeOccurrence(f.repos,{occurrenceId:occurrence.id,disposition:"INGESTED",unresolvedReason:null,now:NOW});
    assert.equal((await f.db.query<{n:number}>("SELECT count(*)::int AS n FROM cp_work_items WHERE id=$1",[h.item.id])).rows[0].n,0);
    assert.deepEqual((await pgCoordinatorWorkItems(f.sql)).map(item=>item.id),[h.item.id]);
    const parser=await nextAutonomousOperation(h.runtime,h.item.id);
    assert.equal(parser.task?.workerTask?.role,"PARSER");
  } finally { await f.db.close(); }
});

test("pending latest Scout outcomes select a Hunt or an autonomous continuation for each place", async () => {
  const f = await fixture();
  try {
    const item = (await autonomousHarness()).item;
    const hunt = async (subject: string, suffix: string, createdAt: string, archive = false, capability = "hunt-packet") => {
      const value: WorkItem = { ...item, id: `${subject}-${suffix}`, subject, createdAt,
        autonomousPlan: { ...item.autonomousPlan!, capability, acquisition:[],sources:[] } };
      await f.db.query(`INSERT INTO cp_work_items${archive ? "_archive" : ""} (id, revision, updated_at, value) VALUES ($1,1,$2,$3::jsonb)`, [value.id, NOW, JSON.stringify(value)]);
      return value.id;
    };
    let position = 0;
    const scout = async (subjectId: string, outcome: ScoutResult["outcome"], recordedAt: string, recordClass = "meetings", refusal: ScoutResult["refusal"] = null) => {
      const record = { subjectId, recordClass, outcome, refusal, recordedAt } as ScoutResult;
      const id = `scout-${position++}`;
      await f.db.query("INSERT INTO cp_log_scout_results VALUES ($1,$2,$3::jsonb)", [subjectId, position, JSON.stringify(record)]);
      await f.repos.scoutResults.append(subjectId, id, record, recordedAt);
    };
    const earlier = "2026-09-30T12:00:00.000Z";
    await hunt("pending", "old", earlier, true);
    const pending = await hunt("pending", "latest", NOW, true);
    await hunt("resolved", "latest", NOW, true);
    await hunt("refused", "latest", NOW, true);
    const mixed = await hunt("mixed", "latest", NOW);
    await hunt("tie-resolved", "latest", NOW);
    const tiePending = await hunt("tie-pending", "latest", NOW);
    const nonHunt = await hunt("pending-non-hunt", "latest", NOW, true, "officials/offices");
    await hunt("pending-non-hunt", "old", earlier, true, "officials/offices");
    await hunt("resolved-non-hunt", "latest", NOW, true, "officials/offices");
    const preferredHunt = await hunt("prefer-hunt", "hunt", earlier, true);
    await hunt("prefer-hunt", "newer-plan", NOW, true, "officials/offices");
    await scout("pending", "NEEDS_ADAPTER", earlier);
    await scout("pending", "NEEDS_ADAPTER", NOW, "people");
    await scout("resolved", "NEEDS_ADAPTER", earlier);
    await scout("resolved", "EVIDENCE_FOUND", NOW);
    await scout("refused", "NEEDS_ADAPTER", NOW, "meetings", []);
    await scout("mixed", "NEEDS_ADAPTER", earlier);
    await scout("mixed", "EVIDENCE_FOUND", NOW, "people");
    await scout("tie-resolved", "NEEDS_ADAPTER", NOW);
    await scout("tie-resolved", "EVIDENCE_FOUND", NOW);
    await scout("tie-pending", "EVIDENCE_FOUND", NOW);
    await scout("tie-pending", "NEEDS_ADAPTER", NOW);
    await scout("pending-non-hunt", "NEEDS_ADAPTER", NOW);
    await scout("resolved-non-hunt", "NEEDS_ADAPTER", earlier);
    await scout("resolved-non-hunt", "EVIDENCE_FOUND", NOW);
    await scout("prefer-hunt", "NEEDS_ADAPTER", NOW);
    const expected = [pending, mixed, tiePending, nonHunt, preferredHunt].sort();
    assert.deepEqual((await pgCoordinatorWorkItems(f.sql)).map(row => row.id).sort(), expected);
    assert.deepEqual((await readCoordinatorWorkItems(f.repos)).map(row => row.id).sort(), expected);
    assert.ok(!f.statements.some(statement => /SELECT .*record FROM cp_log_scout_results/.test(statement)), "selection transfers work candidates only");
  } finally { await f.db.close(); }
});
