import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as nodeModule from "node:module";
import { runInNewContext } from "node:vm";
import test from "node:test";
import { IndependentRuntimeLaneScheduler } from "../lib/ops/independent-runtime-pass.ts";
import { hasPendingPublicationWork, publishNowHasNothingOwed, publishNowLane, publishNowWorkerTasks, readOwedFactItems, readPublishNowWorkerTasks, readWorkerPublicationItems } from "../lib/civic-data/publish-now.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { AGGREGATE_LIST_READ_PAGE } from "../lib/control-plane/repository/pg-store.ts";
import { owedFactItems, type WorkerPublicationItem } from "../lib/civic-data/worker-publication-tasks.ts";
import type { WorkItem } from "../lib/control-plane/work-item.ts";
import type { WorkerResultRecord } from "../lib/control-plane/workers/types.ts";
import { routineSupervisorCycleId, type RoutineSourceTask } from "../lib/civic-data/runner.ts";
import type { ReaderEdgePublicationOutcome } from "../lib/civic-data/reader-edge-outcome.ts";
const NOW = "2026-10-05T18:00:00.000Z";
const { stripTypeScriptTypes } = nodeModule as unknown as { stripTypeScriptTypes(source: string): string };

test("BX-12: publish-now runs each minute while a routine pass remains in flight", async () => {
  let finish!: () => void;
  let count = 0;
  const scheduler = new IndependentRuntimeLaneScheduler([
    { id: "routine", everyMs: 300_000, run: () => new Promise<void>(resolve => { finish = resolve; }) },
    publishNowLane(async () => { count++; }),
  ]);
  assert.deepEqual(scheduler.tick(0), ["routine", "publish-now"]);
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  assert.deepEqual(scheduler.tick(59_999), []);
  assert.deepEqual(scheduler.tick(60_000), ["publish-now"]);
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  assert.deepEqual(scheduler.tick(120_000), ["publish-now"]);
  assert.equal(count, 3);
  assert.ok(scheduler.inFlightIds().includes("routine"));
  finish(); await scheduler.waitForIdle();
});

test("BX-03: all unacknowledged parser results stay owed across restart; an acknowledgement removes only its result", () => {
  const item = { id: "work-a", autonomousPlan: { contract: { recordClass: "OFFICIAL_BOARD_DIRECTORY" }, publication: { contractId: "registry-runtime-bindings" } } } as WorkItem;
  const parser = { id: "parser-a", workItemId: item.id, endedAt: "2026-10-01T12:00:00.000Z", result: { role: "PARSER", verdict: "EXTRACTED" } } as WorkerResultRecord;
  const sibling = { ...item, id: "work-b" };
  const siblingParser = { ...parser, id: "parser-b", workItemId: sibling.id };
  const tasks = publishNowWorkerTasks([item, sibling], [parser, siblingParser], NOW);
  assert.equal(tasks.length, 2);
  assert.ok(tasks.every(task => task.ownerInvocation?.publicationPending));
  assert.equal(tasks[0].ownerInvocation?.requestedAt, parser.endedAt, "a request older than the due-request lifetime is still owed");
  const restored = JSON.parse(JSON.stringify({ items: [item, sibling], results: [parser, siblingParser] }));
  assert.deepEqual(publishNowWorkerTasks(restored.items, restored.results, NOW), tasks);
  const oldAcknowledgement = { ...item, publicationOutcome: { workerResultId: parser.id, status: "PUBLISHED", at: NOW } } as WorkItem;
  assert.equal(publishNowWorkerTasks([oldAcknowledgement, sibling], [parser, siblingParser], NOW).length, 2, "an acknowledgement without observed source evidence still owes publication repair");
  const published = { ...item, publicationOutcome: { workerResultId: parser.id, status: "PUBLISHED", at: NOW, sourceObservedAt: parser.endedAt } } as WorkItem;
  assert.equal(publishNowWorkerTasks([published, sibling], [parser, siblingParser], NOW).length, 1);
  assert.equal(publishNowWorkerTasks([item], [], NOW).length, 1, "held-page publication shares the independent publication lane");
});

test("the independent publication lane preserves held roster, board and ballot-route fallbacks with their existing retry clocks", () => {
  const items: WorkerPublicationItem[] = [
    { id: "roster", autonomousPlan: { contract: { recordClass: "OFFICIAL_ROSTER" }, publication: { contractId: "registry-runtime-bindings" } } },
    { id: "board", autonomousPlan: { contract: { recordClass: "OFFICIAL_BOARD_DIRECTORY" }, publication: { contractId: "registry-runtime-bindings" } } },
    { id: "ballot", autonomousPlan: { contract: { recordClass: "VOTER_ACCESS_ROUTE" }, publication: { contractId: "ballot-navigation" } } },
  ];
  const tasks = publishNowWorkerTasks(items, [], NOW);
  assert.deepEqual(tasks.map(task => task.id.split(":").at(-1)), ["board", "ballot"], "a held roster publishes as facts in the lane itself");
  assert.deepEqual(owedFactItems(items, [], NOW).rosters, ["roster"]);
  assert.ok(tasks.every(task => task.ownerInvocation?.publicationPending && task.retryMs === 15 * 60000));
  const held = items.map(item => ({ ...item, publicationOutcome: { status: "HELD", at: NOW } as WorkItem["publicationOutcome"] }));
  assert.equal(publishNowWorkerTasks(held, [], "2026-10-05T18:59:59.999Z").length, 0);
  assert.deepEqual(owedFactItems(held, [], "2026-10-05T18:59:59.999Z").rosters, []);
  assert.equal(publishNowWorkerTasks(held, [], "2026-10-05T19:00:00.000Z").length, 2);
  assert.deepEqual(owedFactItems(held, [], "2026-10-05T19:00:00.000Z").rosters, ["roster"]);
});

test("publication admission reads only the named result page and releases its evidence before the next page", async () => {
  const items: WorkerPublicationItem[] = Array.from({ length: AGGREGATE_LIST_READ_PAGE * 2 + 1 }, (_, index) => ({
    id: `work-${index}`, autonomousPlan: { contract: { recordClass: "OFFICIAL_BOARD_DIRECTORY" }, publication: { contractId: "registry-runtime-bindings" } },
  }));
  const readIds: string[][] = [];
  let reading = false;
  const tasks = await readPublishNowWorkerTasks(items, async ids => {
    assert.equal(reading, false, "one completion evidence page is retained at a time");
    reading = true;
    assert.ok(ids.length <= AGGREGATE_LIST_READ_PAGE);
    readIds.push([...ids]);
    await Promise.resolve();
    reading = false;
    return ids.map(id => ({ id: `parser:${id}`, workItemId: id, endedAt: NOW,
      result: { role: "PARSER", verdict: "EXTRACTED" } } as WorkerResultRecord));
  }, NOW);
  assert.equal(readIds.length, 3);
  assert.deepEqual(readIds.flat(), items.map(item => item.id));
  assert.equal(tasks.length, items.length, "paging does not cap the publication backlog");
  assert.equal(new Set(tasks.map(task => task.id)).size, items.length);
});

test("publication admission filters and projects work-item metadata in the database with advancing pages", async () => {
  const rows = Array.from({ length: AGGREGATE_LIST_READ_PAGE + 1 }, (_, index) => ({ id: `work-${String(index).padStart(3, "0")}`,
    contract_id: "registry-runtime-bindings", record_class: "OFFICIAL_ROSTER", publication_outcome: null }));
  const parameters: unknown[][] = [];
  const items: unknown[] = [];
  for await (const page of readWorkerPublicationItems(async (query, values) => {
    assert.match(query, /WHERE value #>> '\{autonomousPlan,publication,contractId\}' = ANY\(\$1::text\[\]\)/);
    const select = query.slice(0, query.indexOf("FROM cp_work_items"));
    assert.doesNotMatch(select, /SELECT\s+\*|SELECT\s+id,\s*value\s*(?:,|FROM)|transitions|targetUrls|observationArtifactIds/i);
    assert.match(select, /sourceObservedAt/);
    assert.deepEqual(values[0], ["registry-runtime-bindings"]);
    assert.equal(values[1], "AZ");
    const after = values[2];
    assert.match(query, /AND id > \$3/);
    parameters.push([...values]);
    return rows.filter(row => after === undefined || row.id > String(after)).slice(0, AGGREGATE_LIST_READ_PAGE);
  }, "US-AZ", NOW, ["registry-runtime-bindings"])) {
    assert.ok(page.length <= AGGREGATE_LIST_READ_PAGE);
    items.push(...page);
  }
  assert.equal(items.length, rows.length);
  assert.equal(parameters.length, 2);
  assert.equal(parameters[1][2], rows[AGGREGATE_LIST_READ_PAGE - 1].id);
  assert.deepEqual(items[0], { id: rows[0].id, autonomousPlan: { publication: { contractId: "registry-runtime-bindings" }, contract: { recordClass: "OFFICIAL_ROSTER" } } });
});

test("publication candidate SQL skips quiet holds while retaining new evidence, recoverable publications and held ballot inputs", async () => {
  const { PGlite } = await import("@electric-sql/pglite");
  const db = new PGlite();
  try {
    await db.exec("CREATE TABLE cp_work_items(id text PRIMARY KEY,value jsonb); CREATE TABLE cp_log_worker_results(log_key text,record_id text,record jsonb)");
    const insert = async (id: string, outcome: Record<string, unknown> | null, parser?: string, target = "registry-runtime-bindings", recordClass = "OFFICIAL_ROSTER", state = "AZ") => {
      await db.query("INSERT INTO cp_work_items VALUES($1,$2)", [id, { autonomousPlan: { jurisdiction: state, publication: { contractId: target }, contract: { recordClass } },
        ...(outcome ? { publicationOutcome: { at: NOW, ...outcome } } : {}) }]);
      if (parser) await db.query("INSERT INTO cp_log_worker_results VALUES($1,$2,$3)", [id, parser,
        { id: parser, endedAt: NOW, result: { role: "PARSER", verdict: "EXTRACTED" } }]);
    };
    await insert("quiet-hold", { status: "HELD" });
    await insert("old-hold", { status: "HELD", at: "2026-10-05T17:00:00.000Z" });
    await insert("new-evidence", { status: "HELD", workerResultId: "before", recovery: "WORKER" }, "new");
    await insert("worker-dead-end", { status: "HELD", workerResultId: "done", recovery: "WORKER" }, "done");
    await insert("published", { status: "PUBLISHED", workerResultId: "done+group", sourceObservedAt: NOW }, "done");
    await insert("repair", { status: "PUBLISHED", workerResultId: "done" }, "done");
    await insert("publisher-retry", { status: "HELD", workerResultId: "done", recovery: "PUBLISHER" }, "done");
    await insert("partial-measure", { status: "PARTIALLY_PUBLISHED", workerResultId: "done", sourceObservedAt: NOW }, "done", "ballot-contests", "BALLOT_MEASURE");
    await insert("held-ballot", { status: "HELD" }, undefined, "ballot-navigation", "VOTER_ACCESS_ROUTE");
    await insert("new-work", null);
    await insert("unrelated-state", null, undefined, "registry-runtime-bindings", "OFFICIAL_ROSTER", "NM");
    await insert("broken", { status: "PUBLISHED", workerResultId: "done", sourceObservedAt: NOW }, "done");
    await db.query("INSERT INTO cp_log_worker_results VALUES($1,$2,$3)", ["broken", "audit",
      { endedAt: "2026-10-05T18:01:00.000Z", result: { role: "ADVERSARIAL_AUDITOR", verdict: "BROKE" } }]);
    const ids: string[] = [];
    for await (const items of readWorkerPublicationItems(async (sql, params) => (await db.query<Record<string, unknown>>(sql, [...params])).rows, "US-AZ", NOW)) {
      ids.push(...items.map(item => item.id));
    }
    assert.deepEqual(ids, ["broken", "held-ballot", "new-evidence", "new-work", "old-hold", "partial-measure", "publisher-retry", "repair"]);
  } finally { await db.close(); }
});

test("the pilot Boolean preserves held roster retry timing without loading source doors", async () => {
  const repos = createMemoryRepositories(), store = new MemoryRoutineDataStore();
  let outcomeAt = NOW;
  const query = async (sql: string) => sql.includes("FROM cp_work_items") ? [{ id: "held-roster", contract_id: "registry-runtime-bindings",
    record_class: "OFFICIAL_ROSTER", publication_outcome: { status: "HELD", at: outcomeAt } }] : [];
  const input = { repos, store, query, state: "US-AZ", now: NOW };
  assert.equal(await hasPendingPublicationWork(input), false);
  outcomeAt = "2026-10-05T17:00:00.000Z";
  assert.equal(await hasPendingPublicationWork(input), true);
});

test("BX-12: the executable selects only publication work and never holds the routine singleton", () => {
  const runner = readFileSync("scripts/routine-civic-data-runner.mts", "utf8");
  assert.match(runner, /PUBLISH_NOW \? PUBLISH_NOW_SINGLETON_PORT \+ ROUTINE_STATES.indexOf\(STATE_SCOPE\) : ROUTINE_DATA_RUNNER_SINGLETON_PORT/);
  assert.match(runner, /PUBLISH_NOW \? \[\]\s*: FAMILY === "meetings" \? standingTasks : await withNationalPlaceTasks/);
  assert.doesNotMatch(runner, /publishNowDoorTasks|readPublishNowDoors|installDoorRecords/);
  assert.match(runner, /if \(!PUBLISH_NOW && !FORCE && controlPlaneUrlFromEnv\(\) !== null\)/);
  assert.match(runner, /const observedChangeRates = PUBLISH_NOW \? new Map<string, number>\(\) : await readObservedChangeRates\(\)/);
  assert.match(runner, /const finalReaderEdge: ReaderEdgePublicationOutcome = publishNowEdgeChecks \? await publishNowEdgeChecks\.run\(\)/);
});

test("the publication coordinator leaves 20,802 changed source doors to their ordinary clocks", async () => {
  const runner = readFileSync("scripts/routine-civic-data-runner.mts", "utf8");
  const declaration = runner.slice(runner.indexOf("async function readHuntSourceTasks("), runner.indexOf("function newestConsideredAt("));
  let doorReads = 0, sourceReads = 0;
  const noSourceRead = () => { sourceReads++; throw new Error("publication must not acquire meeting sources"); };
  const changedDoors = Array.from({ length: 20_802 }, (_, index) => ({ id: `changed-${index}`,
    value: { status: "OPEN", lastSuccessAt: null, validators: { changedAt: NOW } } }));
  const noDoorRead = async () => { doorReads++; throw new Error(`${changedDoors.length} changed sources belong to ordinary clocks`); };
  const repos = { researchIntents: { read: async () => [] }, doors: { list: noDoorRead, listWhere: noDoorRead, read: noDoorRead },
    websitePacing: {}, adminConfig: { read: async () => null } };
  const readTasks = runInNewContext(`(${stripTypeScriptTypes(declaration)})`, {
    FORCE: false, ONLY: null, PUBLISH_NOW: true, STATE_SCOPE: "US-IL", RUN_STARTED_AT: NOW,
    ROOT: "/fixture", VAULT_DIR: [], BOX_FINDINGS_PER_PASS: 300, RESEARCH_INTENT_LOG_KEY: "policy", ADMIN_CONFIG_ID: "current",
    WORKER_PUBLICATION_TASK_IDS: ["registry-runtime-bindings"], MEETING_PARTITION_CONTRACTS: [], MEETING_PARTITION_TASK_IDS: new Set(),
    controlPlaneUrlFromEnv: () => "fixture", createPgRepositories: async () => repos,
    readIntents: () => ({ runnerPause: { paused: false } }),
    neon: () => ({ query: async (query: string) => {
      if (query.includes("cp_doors")) return noDoorRead();
      return [{ id: "held-board", contract_id: "registry-runtime-bindings", record_class: "OFFICIAL_BOARD_DIRECTORY", publication_outcome: null }];
    } }),
    readWorkerPublicationItems, readOwedFactItems, readPublishNowWorkerTasks,
    readCompletedWorkerResultsOf: async (_repos: unknown, ids: readonly string[]) => ids.map(id => ({
      id: `parser:${id}`, workItemId: id, endedAt: NOW, result: { role: "PARSER", verdict: "EXTRACTED" },
    })),
    readHeldBallotInputs: async () => null,
    PostgresRoutineDataStore: class { clock = noSourceRead; readPromotionIdentity = async () => null; },
    publishBoxFindings: async () => ({ looked: 0 }), readerFactDb: () => ({}), factClocks: () => ({}),
    DurableEvidenceStore: class {}, join: () => "/fixture/vault", pacedProbeFetch: () => noSourceRead,
    routineTaskFromContract: noSourceRead, getDb: noSourceRead,
    safeFailure: String, sanitizedErrorDiagnostic: String,
    console: { log: (line: string) => { throw new Error(`unexpected publication failure: ${line}`); } },
  }) as (store: unknown, failures: unknown[]) => Promise<readonly RoutineSourceTask[]>;
  const failures: unknown[] = [];
  const tasks = await readTasks({}, failures);
  assert.equal(tasks.length, 1);
  assert.ok(tasks[0]!.id.endsWith(":held-board"));
  assert.equal(tasks[0]!.ownerInvocation?.publicationPending, true);
  assert.deepEqual(failures, []);
  assert.equal(doorReads, 0, "the outbox does not retain or execute changed source work");
  assert.equal(sourceReads, 0);
});

test("a publish-now minute with nothing owed ends quietly with exit 0, before any outcome or count", () => {
  const current: ReaderEdgePublicationOutcome = { ok: true, readerEdge: "CURRENT", store: "Netlify Blobs", sequence: 1, detail: null };
  assert.equal(publishNowHasNothingOwed(true, 0, 0, current), true);
  assert.equal(publishNowHasNothingOwed(true, 1, 0, current), false, "owed work runs");
  assert.equal(publishNowHasNothingOwed(true, 0, 1, current), false, "a failure on the way is still reported");
  assert.equal(publishNowHasNothingOwed(false, 0, 0, current), false, "the routine pass keeps its floor");
  assert.equal(publishNowHasNothingOwed(true, 0, 0, { ...current, readerEdge: "PUBLISHED" }), false, "a copied source pointer receives a zero-source-attempt receipt");
  assert.equal(publishNowHasNothingOwed(true, 0, 0, { ...current, ok: false, readerEdge: "FAILED" }), false, "edge failure remains owed even with no worker tasks");
  assert.equal(publishNowHasNothingOwed(true, 0, 0, { ...current, readerEdge: "SKIPPED_OWNER_PAUSE" }), true, "the existing full publication pause ends an empty minute quietly");
  const runner = readFileSync("scripts/routine-civic-data-runner.mts", "utf8");
  const initial = runner.indexOf("await publishNowEdgeChecks.run()");
  assert.ok(initial > 0 && initial < runner.indexOf("huntTasks = await readHuntSourceTasks(store, supervisorFailures)"), "promoted pointers publish before a large worker admission read");
  const quiet = runner.indexOf("if (publishNowHasNothingOwed(PUBLISH_NOW, selectedTasks.length, supervisorFailures.length, readerEdge)) {");
  assert.ok(quiet > runner.indexOf("const selectedTasks = "), "decided once the minute's tasks are selected");
  const quietBranch = runner.slice(quiet, runner.indexOf("  } else {", quiet));
  assert.match(quietBranch, /console\.log\("publish-now: nothing owed this minute"\);/);
  assert.doesNotMatch(quietBranch, /supervisorFailures\.push|ownerDigests\.append|RCD_OPERATIONAL_OUTCOME|floored/);
  const exit = runner.slice(quiet, runner.indexOf("\n}\n", quiet));
  assert.match(exit, /await ROUTINE_DATA_PROCESS_LEASE\.release\(\);[\s\S]*process\.exit\(supervisorFailures\.length === 0 \? 0 : 2\);/);
  assert.match(exit, /attemptedTasks: 0, verifiedSourceSuccesses: 0, verifiedSourceFailures: 0/);
  assert.match(exit, /taskReceipts: \[\], dueRequestLines: \[\]/);
  assert.doesNotMatch(exit, /floored|RCD_RUN=/, "an edge-only publication does not fabricate a source denominator");
  for (const later of ["RCD_OPERATIONAL_OUTCOME=", 'floored(\n  "attempted routine source tasks"']) {
    assert.ok(runner.indexOf(later) > quiet, `${later.split("(")[0]} comes after the quiet exit`);
  }
});

test("the standing runner starts publish-now each minute on its own lane, beside the routine pass", () => {
  const pilot = readFileSync("scripts/pilot-runner.mts", "utf8");
  const lanes = pilot.slice(pilot.indexOf("const standingRuntimeScheduler = new IndependentRuntimeLaneScheduler(["));
  assert.match(lanes.slice(0, lanes.indexOf("], (outcome) =>")), /flatMap\(family => ROUTINE_STATES\.flatMap\(state =>[\s\S]*run: \(\) => runRoutineState\(state, family, bucket\)[\s\S]*publishNowLane\(\(\) => runPublishState\(state\)\)/);
  const run = pilot.slice(pilot.indexOf("async function runPublishNow(state: string)"), pilot.indexOf("async function persistOuterRoutineChildFailure("));
  assert.match(run, /if \(provider !== "postgres" \|\| canary\) return;/, "only the standing production runner publishes");
  assert.match(run, /args: \[\.\.\.TS_CHILD, "scripts\/publish-now-runner\.mts", `--state=\$\{state\}`\]/);
  assert.match(run, /standingChildEnvironment\("ROUTINE_SUPERVISOR", \{ \.\.\.process\.env, \[ROUTINE_SUPERVISOR_STARTED_AT_ENV\]: startedAt \}\)/);
  assert.match(run, /persistOuterRoutineChildFailure\(routineSupervisorCycleId\(`\$\{hostname\(\)\}\/\$\{state\}`, startedAt, "publish-now"\)/, "a crash still reaches Admin, under its own lane");
  const routine = readFileSync("scripts/routine-civic-data-runner.mts", "utf8");
  assert.match(routine, /const cycleScope = PUBLISH_NOW \? `\$\{hostname\(\)\}\/\$\{STATE_SCOPE\}`/);
  assert.match(routine, /routineSupervisorCycleId\(cycleScope, RUN_STARTED_AT, PUBLISH_NOW \? "publish-now" : "routine-civic-data"\)/);
});

test("the two lanes started in one millisecond never share an outcome's identity", () => {
  assert.equal(routineSupervisorCycleId("host", NOW), `routine-civic-data-supervisor:host:${NOW}`);
  assert.equal(routineSupervisorCycleId("host", NOW, "publish-now"), `publish-now-supervisor:host:${NOW}`);
});
