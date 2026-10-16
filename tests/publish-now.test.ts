import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { IndependentRuntimeLaneScheduler } from "../lib/ops/independent-runtime-pass.ts";
import { publishNowHasNothingOwed, publishNowLane, publishNowDoorTasks, publishNowWorkerTasks, readPublishNowWorkerTasks, readWorkerPublicationItems } from "../lib/civic-data/publish-now.ts";
import { AGGREGATE_LIST_READ_PAGE } from "../lib/control-plane/repository/pg-store.ts";
import { owedFactItems, type WorkerPublicationItem } from "../lib/civic-data/worker-publication-tasks.ts";
import type { WorkItem } from "../lib/control-plane/work-item.ts";
import type { WorkerResultRecord } from "../lib/control-plane/workers/types.ts";
import type { DoorRecord } from "../lib/doors/registry.ts";
import { routineSupervisorCycleId, type RoutineSourceTask } from "../lib/civic-data/runner.ts";
import type { ReaderEdgePublicationOutcome } from "../lib/civic-data/reader-edge-outcome.ts";
const NOW = "2026-10-05T18:00:00.000Z";

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

test("BX-12: changed doors persist until success and unrelated or shut doors are never offered", () => {
  const door = { doorId: "door-a", status: "OPEN", meeting: { family: null }, lastSuccessAt: null,
    validators: { changedAt: "2026-10-01T12:00:00.000Z" } } as DoorRecord;
  const tasks = [{ id: door.doorId }, { id: "unrelated" }] as RoutineSourceTask[];
  const pending = publishNowDoorTasks([door], tasks, NOW);
  assert.equal(pending.length, 1);
  assert.equal(pending[0].id, door.doorId);
  assert.ok(pending[0].ownerInvocation?.publicationPending);
  assert.equal(publishNowDoorTasks([{ ...door, status: "SHUT" }], tasks, NOW).length, 0);
  assert.equal(publishNowDoorTasks([{ ...door, lastSuccessAt: NOW }], tasks, NOW).length, 0);
  assert.equal(publishNowDoorTasks([{ ...door, lastFailureAt: NOW }], tasks, NOW).length, 1);
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
  const items = await readWorkerPublicationItems(async (query, values) => {
    assert.match(query, /WHERE value #>> '\{autonomousPlan,publication,contractId\}' = ANY\(\$1::text\[\]\)/);
    const select = query.slice(0, query.indexOf("FROM cp_work_items"));
    assert.doesNotMatch(select, /SELECT\s+\*|SELECT\s+id,\s*value\s*(?:,|FROM)|transitions|targetUrls|observationArtifactIds/i);
    assert.match(select, /sourceObservedAt/);
    assert.deepEqual(values[0], ["registry-runtime-bindings"]);
    const after = values[1];
    if (after !== undefined) assert.match(query, /AND id > \$2/);
    parameters.push([...values]);
    return rows.filter(row => after === undefined || row.id > String(after)).slice(0, AGGREGATE_LIST_READ_PAGE);
  }, ["registry-runtime-bindings"]);
  assert.equal(items.length, rows.length);
  assert.equal(parameters.length, 2);
  assert.equal(parameters[1][1], rows[AGGREGATE_LIST_READ_PAGE - 1].id);
  assert.deepEqual(items[0], { id: rows[0].id, autonomousPlan: { publication: { contractId: "registry-runtime-bindings" }, contract: { recordClass: "OFFICIAL_ROSTER" } } });
});

test("BX-12: the executable selects only publication work and never holds the routine singleton", () => {
  const runner = readFileSync("scripts/routine-civic-data-runner.mts", "utf8");
  assert.match(runner, /PUBLISH_NOW \? PUBLISH_NOW_SINGLETON_PORT : ROUTINE_DATA_RUNNER_SINGLETON_PORT/);
  assert.match(runner, /PUBLISH_NOW \? \[\] : await withNationalPlaceTasks/);
  assert.match(runner, /return \[\.\.\.publication, \.\.\.publishNowDoorTasks/);
  assert.match(runner, /const finalReaderEdge = publishNowEdgeChecks \? await publishNowEdgeChecks\.run\(\)/);
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
  assert.match(lanes.slice(0, lanes.indexOf("], (outcome) =>")), /\{ id: "routine-civic-data", everyMs: ROUTINE_DATA_ADMISSION_MS, run: runRoutineCivicData \},[\s\S]*publishNowLane\(runPublishNow\),\n$/);
  const run = pilot.slice(pilot.indexOf("async function runPublishNow()"), pilot.indexOf("async function persistOuterRoutineChildFailure("));
  assert.match(run, /if \(provider !== "postgres" \|\| canary\) return;/, "only the standing production runner publishes");
  assert.match(run, /args: \[\.\.\.TS_CHILD, "scripts\/publish-now-runner\.mts"\]/);
  assert.match(run, /standingChildEnvironment\("ROUTINE_SUPERVISOR", \{ \.\.\.process\.env, \[ROUTINE_SUPERVISOR_STARTED_AT_ENV\]: startedAt \}\)/);
  assert.match(run, /persistOuterRoutineChildFailure\(routineSupervisorCycleId\(hostname\(\), startedAt, "publish-now"\)/, "a crash still reaches Admin, under its own lane");
  const routine = readFileSync("scripts/routine-civic-data-runner.mts", "utf8");
  assert.match(routine, /routineSupervisorCycleId\(hostname\(\), RUN_STARTED_AT, PUBLISH_NOW \? "publish-now" : "routine-civic-data"\)/);
});

test("the two lanes started in one millisecond never share an outcome's identity", () => {
  assert.equal(routineSupervisorCycleId("host", NOW), `routine-civic-data-supervisor:host:${NOW}`);
  assert.equal(routineSupervisorCycleId("host", NOW, "publish-now"), `publish-now-supervisor:host:${NOW}`);
});

test("a held roster or board is read again only once a page for its body is saved after its last outcome; a later pass reads only what changed", async () => {
  const held: WorkerPublicationItem[] = ["roster", "board"].map((id, n) => ({ id, autonomousPlan: {
    contract: { recordClass: n === 0 ? "OFFICIAL_ROSTER" : "OFFICIAL_BOARD_DIRECTORY" }, publication: { contractId: "registry-runtime-bindings", bodyId: `body-${id}` } },
    publicationOutcome: { workerResultId: "none", status: "HELD", at: NOW, recovery: "WORKER" } }));
  const later = "2026-10-06T00:00:00.000Z";
  const inputs = { pagesAt: new Map<string, string>(), nationalAt: null, registryAt: null, routesAt: null,
    bodyPagesAt: new Map([["body-roster", "2026-10-05T17:00:00.000Z"], ["body-board", "2026-10-05T18:30:00.000Z"]]) };
  assert.deepEqual(owedFactItems(held, [], later, inputs).rosters, [], "six hours on, but no page saved since: not read");
  assert.deepEqual((await readPublishNowWorkerTasks(held, async () => [], later, inputs)).map(task => task.id.split(":").at(-1)), ["board"]);

  const seen: { query: string; values: readonly unknown[] }[] = [];
  await readWorkerPublicationItems(async (query, values) => { seen.push({ query, values }); return []; }, ["registry-runtime-bindings"], { at: NOW, sharedInputsMoved: false });
  assert.match(seen[0]!.query, /^WITH due\(id\) AS/);
  assert.match(seen[0]!.query, /AND id IN \(SELECT id FROM due\)/);
  assert.deepEqual(seen[0]!.values, [["registry-runtime-bindings"], NOW, false]);
});
