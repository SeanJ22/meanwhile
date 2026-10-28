import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { ROUTINE_SOURCE_TASKS, routineSerialLane, routineTaskDue, routineTaskNextDueMs, type RoutineTaskClock } from "../lib/civic-data/runner.ts";
import { factRefreshBounds } from "../lib/civic-data/source-change-cadence.ts";
import { runBoundedChildPass } from "../lib/civic-data/bounded-child-pass.ts";
import { PLACE_MAP_PASS_BUDGET_MS, PLACE_MAP_RUN_RESERVE_MS, PLACE_MAP_SETTLEMENT_MS, isPlaceMapTask, laneSourceTasks,
  placeMapLaunchOrder, placeMapRowsOwed, placeMapsLane } from "../lib/civic-data/place-map-lane.ts";
import { ROUTINE_PASS_BUDGET_MS } from "../lib/civic-data/contracts.ts";

const MAPS = ROUTINE_SOURCE_TASKS.filter(isPlaceMapTask).map(task => ({ ...task, ...factRefreshBounds(task) }));
const map = (state: string) => MAPS.find(task => task.id === `place-map-${state.toLowerCase()}`)!;
const HOUR = 3_600_000;
const runner = readFileSync("scripts/routine-civic-data-runner.mts", "utf8");
const pilot = readFileSync("scripts/pilot-runner.mts", "utf8");

test("every state, DC and territory map runs in the place-map lane; the routine pass offers one only when the owner names it", () => {
  assert.equal(MAPS.length, 56);
  assert.ok(["DC", "TX", "CA", "AK"].every(state => map(state)));
  assert.deepEqual(laneSourceTasks(ROUTINE_SOURCE_TASKS, true, []).map(task => task.id).sort(), MAPS.map(task => task.id).sort());
  const routine = laneSourceTasks(ROUTINE_SOURCE_TASKS, false, []);
  assert.equal(routine.filter(isPlaceMapTask).length, 0, "no map in the routine pass");
  assert.equal(routine.length, ROUTINE_SOURCE_TASKS.length - 56, "every other task stays in the routine pass");
  assert.equal(laneSourceTasks(ROUTINE_SOURCE_TASKS, false, ["--force", "--only=place-map-tx"]).filter(isPlaceMapTask).length, 56,
    "an owner refresh of one map still reaches it; --only narrows the pass to it");
  assert.ok(MAPS.every(task => routineSerialLane(task.command) === undefined), "the Census lane no longer holds maps");
  assert.match(runner, /PLACE_MAPS \? laneSourceTasks\(ROUTINE_SOURCE_TASKS, true, \[\]\)/);
  assert.match(runner, /await withNationalPlaceTasks\(laneSourceTasks\(\[[\s\S]*?\], false, process\.argv\.slice\(2\)\), process\.argv\.slice\(2\)\)/);
});

test("the lane is its own standing clock, independent of the routine pass's budget, and a map started last still has 15 minutes", () => {
  const lane = placeMapsLane(async () => {});
  assert.equal(lane.id, "place-maps");
  assert.equal(lane.budgetMs, PLACE_MAP_PASS_BUDGET_MS);
  assert.ok(lane.budgetMs <= ROUTINE_PASS_BUDGET_MS, "a release restart never waits longer for it than for a routine pass");
  assert.ok(PLACE_MAP_RUN_RESERVE_MS - PLACE_MAP_SETTLEMENT_MS >= 15 * 60_000);
  assert.ok(PLACE_MAP_PASS_BUDGET_MS - PLACE_MAP_RUN_RESERVE_MS >= 10 * 60_000, "the lane has a launch window");
  assert.match(pilot, /placeMapsLane\(runPlaceMaps\)/);
  assert.match(pilot, /async function runPlaceMaps[\s\S]*?jobLaunchAllowed\("place-maps"\)[\s\S]*?"scripts\/routine-civic-data-runner\.mts", "--place-maps"/);
  // The lane's run ends by its own deadline: maps start until its launch deadline and are ended just before it.
  assert.match(runner, /const PASS_LAUNCH_DEADLINE_MS = PLACE_MAPS \? PASS_DEADLINE_MS - PLACE_MAP_RUN_RESERVE_MS : /);
  assert.match(runner, /const SOURCE_CHILD_DEADLINE_MS = PLACE_MAPS \? PASS_DEADLINE_MS - PLACE_MAP_SETTLEMENT_MS : PASS_LAUNCH_DEADLINE_MS;/);
  assert.match(runner, /PUBLISH_NOW \? PUBLISH_NOW_SINGLETON_PORT : PLACE_MAPS \? PLACE_MAP_SINGLETON_PORT : ROUTINE_DATA_RUNNER_SINGLETON_PORT/);
  // Settlement is the routine runner's own: the same receipt checks, durable promotion check and launch log.
  assert.match(runner, /onSettled: async \(run, index\) => \{\s*await withDatabaseJob\(run\.id,/);
  assert.match(runner, /recordLaunchDecision\(task, "SKIP"/);
});

test("catch-up: every never-loaded state is owed now; once loaded it waits its monthly clock", () => {
  const now = Date.parse("2026-10-28T06:00:00.000Z");
  // Production on Oct 28: 18 maps loaded on Oct 26; 38 states have never run and hold no ZIPs.
  const held = new Map([["DC", 296], ["WV", 860], ["AS", 1], ["AZ", 0]]);
  const tx = map("TX");
  assert.equal(routineTaskDue(tx, undefined, now), true, "a state that never ran is due");
  assert.equal(placeMapRowsOwed(tx, held, undefined, now), true, "and production holds no ZIPs for it");
  assert.equal(placeMapRowsOwed(map("AZ"), held, undefined, now), true, "three tribal-area rows are not a map");
  const loaded = "2026-10-26T19:02:34.755Z";
  const clock: RoutineTaskClock = { lastAttemptedAt: loaded, lastSucceededAt: loaded, lastSucceededObservedAt: loaded, lastSucceededParserVersion: tx.parserVersion };
  for (const state of ["DC", "WV", "AS"]) {
    assert.equal(routineTaskDue(map(state), clock, now), false, `${state} waits for its monthly check`);
    assert.equal(placeMapRowsOwed(map(state), held, clock, now), false, `${state}'s production map holds ZIPs`);
    assert.equal(new Date(routineTaskNextDueMs(map(state), clock, now)).toISOString(), "2026-11-25T19:02:34.755Z");
  }
  assert.equal(routineTaskDue(map("DC"), clock, Date.parse("2026-11-25T19:02:34.755Z")), true, "the 30-day cadence resumes");
});

test("a state whose production map holds no ZIPs is owed on its retry clock, whatever its monthly clock says", () => {
  const tx = map("TX"), now = Date.parse("2026-10-28T06:00:00.000Z");
  const recent = new Date(now - 2 * HOUR).toISOString(), old = new Date(now - 7 * HOUR).toISOString();
  const succeeded = (at: string): RoutineTaskClock => ({ lastAttemptedAt: at, lastSucceededAt: at, lastSucceededObservedAt: at, lastSucceededParserVersion: tx.parserVersion });
  const empty = new Map<string, number>();
  assert.equal(routineTaskDue(tx, succeeded(old), now), false, "its monthly clock is not due");
  assert.equal(placeMapRowsOwed(tx, empty, succeeded(old), now), true, "rows lost after a success: owed now");
  assert.equal(placeMapRowsOwed(tx, empty, succeeded(recent), now), false, "but no more often than its six-hour retry");
  assert.equal(tx.retryMs, 6 * HOUR);
  assert.equal(placeMapRowsOwed(tx, null, succeeded(old), now), false, "an unread count table changes nothing");
  assert.equal(placeMapRowsOwed(tx, new Map([["TX", 2_000]]), succeeded(old), now), false);
  assert.equal(placeMapRowsOwed(ROUTINE_SOURCE_TASKS.find(task => task.id === "census-geography-overlaps")!, empty, undefined, now), false);
  // The runner offers such a map as owed now and logs why.
  assert.match(runner, /const mapRowsOwed = placeMapRowsOwed\(task, heldMapZips, durableClock, admissionNowMs\);/);
  assert.match(runner, /!publicationDue && !discoveryDue && !mapRowsOwed\) \{/);
});

test("DC's map is complete, so it waits its monthly clock: 61 places and 296 ZIPs from 7 Census layers plus its 46 ANCs", () => {
  const now = Date.parse("2026-10-28T06:00:00.000Z"), at = "2026-10-26T19:02:34.755Z";
  const clock = { lastAttemptedAt: at, lastSucceededAt: at, lastSucceededObservedAt: at, lastSucceededParserVersion: map("DC").parserVersion };
  assert.equal(placeMapRowsOwed(map("DC"), new Map([["DC", 296]]), clock, now), false);
  assert.equal(placeMapRowsOwed(map("DC"), new Map([["DC", 0]]), clock, now), true, "DC would run again at once if its ZIPs were gone");
});

test("the lane runs maps smallest first, one at a time, each under its own job name and memory reservation", async () => {
  const order = placeMapLaunchOrder(MAPS.map(task => ({ task }))).map(({ task }) => task.id);
  assert.equal(order[0], "place-map-as");
  assert.equal(order.at(-1), "place-map-tx");
  assert.match(runner, /args: \[\.\.\.TS_CHILD, \.\.\.\(isPlaceMapTask\(pending\) \? \["--max-old-space-size=1024"\] : \[\]\), \.\.\.pending\.command\]/);
  assert.match(runner, /concurrency: PLACE_MAPS \? 1 : /);
  // A real child: the job its database bytes are metered and paused under is the map's own task id.
  const seen: string[] = [];
  const results = await runBoundedChildPass(["place-map-dc", "place-map-wy"].map(id => ({ id, failureDomain: map(id.slice(10)).acquisitionFailureDomain,
    executable: process.execPath, args: ["-e", "console.log(process.env.WTP_DATABASE_JOB)"] })), {
    cwd: process.cwd(), env: { NODE_ENV: "test", PATH: process.env.PATH ?? "" }, concurrency: 1,
    onStarting: command => { seen.push(command.id); },
  });
  assert.deepEqual(results.map(run => run.stdout.trim()), ["place-map-dc", "place-map-wy"]);
  assert.deepEqual(seen, ["place-map-dc", "place-map-wy"]);
  // Each map is admitted by the job breaker under its own name before its clock is read.
  assert.match(runner, /const selectedTasks = offeredTasks\.filter\(task => \{\s*if \(admitJobLaunch\(task\.id\)\) return true;/);
  assert.ok(MAPS.every(task => task.contract.databaseBytesPerRun === 60_592_693), "each run states its database bytes");
  assert.ok(60_592_693 < 500_000_000, "one run an hour per state stays under the 0.5 GB job breaker");
});
