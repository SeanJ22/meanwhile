import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { IndependentRuntimeLaneScheduler } from "../lib/ops/independent-runtime-pass.ts";
import { publishNowLane, publishNowDoorTasks, publishNowWorkerTasks } from "../lib/civic-data/publish-now.ts";
import type { WorkItem } from "../lib/control-plane/work-item.ts";
import type { WorkerResultRecord } from "../lib/control-plane/workers/types.ts";
import type { DoorRecord } from "../lib/doors/registry.ts";
import { routineSupervisorCycleId, type RoutineSourceTask } from "../lib/civic-data/runner.ts";
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
  const item = { id: "work-a", autonomousPlan: { contract: { recordClass: "OFFICIAL_ROSTER" }, publication: { contractId: "registry-runtime-bindings" } } } as WorkItem;
  const parser = { id: "parser-a", workItemId: item.id, endedAt: "2026-10-01T12:00:00.000Z", result: { role: "PARSER", verdict: "EXTRACTED" } } as WorkerResultRecord;
  const sibling = { ...item, id: "work-b" };
  const siblingParser = { ...parser, id: "parser-b", workItemId: sibling.id };
  const tasks = publishNowWorkerTasks([item, sibling], [parser, siblingParser], NOW);
  assert.equal(tasks.length, 2);
  assert.ok(tasks.every(task => task.ownerInvocation?.publicationPending));
  assert.equal(tasks[0].ownerInvocation?.requestedAt, parser.endedAt, "a request older than the due-request lifetime is still owed");
  const restored = JSON.parse(JSON.stringify({ items: [item, sibling], results: [parser, siblingParser] }));
  assert.deepEqual(publishNowWorkerTasks(restored.items, restored.results, NOW), tasks);
  const published = { ...item, publicationOutcome: { workerResultId: parser.id, status: "PUBLISHED", at: NOW } } as WorkItem;
  assert.equal(publishNowWorkerTasks([published, sibling], [parser, siblingParser], NOW).length, 1);
  assert.equal(publishNowWorkerTasks([item], [], NOW).length, 0, "held-page scans stay on the ordinary lane");
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

test("BX-12: the executable selects only publication work and never holds the routine singleton", () => {
  const runner = readFileSync("scripts/routine-civic-data-runner.mts", "utf8");
  assert.match(runner, /PUBLISH_NOW \? PUBLISH_NOW_SINGLETON_PORT : ROUTINE_DATA_RUNNER_SINGLETON_PORT/);
  assert.match(runner, /PUBLISH_NOW \? \[\] : await withNationalPlaceTasks/);
  assert.match(runner, /return \[\.\.\.publication, \.\.\.publishNowDoorTasks/);
  assert.match(runner, /!PUBLISH_NOW && ONLY === null \? null : selectedTasks/);
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
