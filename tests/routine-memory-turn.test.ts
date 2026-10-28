import assert from "node:assert/strict";
import test from "node:test";
import { runBoundedChildPass, type BoundedChildCommand } from "../lib/civic-data/bounded-child-pass.ts";
import { routineChildMemoryOrder, routineDeferral, ROUTINE_SOURCE_TASKS, routinePassLaunchOrder, routineFailureDomainFrontier,
  routineWaitedFullPass, routineSerialLane, routineSerialLanesFirst, type RoutineTaskAdmissionCandidate } from "../lib/civic-data/runner.ts";
import { electionLaunchOrder } from "../lib/civic-data/ballot-publication.ts";
import { routineProcessSlots, workerMemoryHost, type WorkerMemoryRelease } from "../lib/control-plane/workers/worker-slots.ts";
import { placeMapReservationMiB } from "../lib/place-map/memory.ts";
import memory from "../lib/place-map/memory.json" with { type: "json" };
import { ControlledClock } from "./helpers/routine-pass-replay.ts";
import { PLACE_MAP_PASS_BUDGET_MS, PLACE_MAP_RUN_RESERVE_MS, PLACE_MAP_SETTLEMENT_MS, placeMapLaunchOrder } from "../lib/civic-data/place-map-lane.ts";
import { readFileSync } from "node:fs";

const mib = 1024 ** 2;
const exited = (command: BoundedChildCommand) => ({ id: command.id, status: 0, signal: null,
  stdout: "", stderr: "", termination: "EXITED" as const, errorMessage: null });

test("a memory wait returns the source turn in this pass without a source gap or attempt", async () => {
  const clock = new ControlledClock(0), launched: string[] = [];
  const slots = routineProcessSlots({ availableBytes: () => (3709 + 768) * mib,
    peakBytes: entry => (entry === "overlaps" ? 5000 : 3709) * mib,
    host: workerMemoryHost({ processes: () => [] }) });
  const releases = new Map<string, WorkerMemoryRelease>();
  const census = ROUTINE_SOURCE_TASKS.find(task => task.id === "census-geography-overlaps")!;
  const admitted = routineFailureDomainFrontier(["overlaps", "state-map"].map(id => ({
    task: { ...census, id }, lastConsideredAt: null,
  })));
  assert.equal(admitted.length, 2, "a source's waiting sibling is still offered in this pass");
  await clock.run(async () => {
    const results = await runBoundedChildPass(admitted.map(({ task: { id } }) => ({ id,
      failureDomain: "census-geography-relationships", executable: "ignored", args: [] })), {
      cwd: process.cwd(), env: { NODE_ENV: "test" }, concurrency: 2, sameDomainGapMs: 60_000, deadlineMs: 5000,
      onStarting: async (command, priority) => {
        try { releases.set(command.id, await slots.acquire(command.id, 5000, { priority, wait: false })); }
        catch (error) {
          if (error instanceof Error && error.message.startsWith("WORKER_MEMORY_BUSY:")) return false;
          throw error;
        }
      },
      onSettled: result => { releases.get(result.id)?.(); releases.delete(result.id); },
    }, async command => { launched.push(command.id); assert.equal(clock.nowMs, 0); return exited(command); });
    assert.deepEqual(launched, ["state-map"]);
    assert.match(routineDeferral(results[0]!, false)!, /^PASS_TIME_BUDGET:/);
    assert.equal(results[1]!.status, 0);
  });
  assert.equal(clock.nowMs, 5000, "a source gap cannot keep queued work past the pass deadline");
  assert.equal(releases.size, 0);
});

const MAPS = ROUTINE_SOURCE_TASKS.filter(task => task.id.startsWith("place-map-"));
const stateOf = (id: string) => id.slice("place-map-".length).toUpperCase();
const blockBytes = (id: string) => (memory.states as Record<string, { blockFileBytes: number }>)[stateOf(id)]!.blockFileBytes;
/** RB-A2's runs took 225 s (TX), 175 s (CA) and 19 s (AK): about 15 s plus 0.9 s per MB of the state's block file. */
const mapRunMs = (id: string) => 15_000 + Math.round(blockBytes(id) * 0.0009);
/** The place-map lane's first run: maps start until its launch deadline and are ended just before its own. */
const MAP_LAUNCH_MS = PLACE_MAP_PASS_BUDGET_MS - PLACE_MAP_RUN_RESERVE_MS, MAP_WALL_MS = PLACE_MAP_PASS_BUDGET_MS - PLACE_MAP_SETTLEMENT_MS;

/**
 * Production shape: a host whose 20,244 MiB is already full of the previous pass's meeting reads and a campaign-site run,
 * and a routine pass whose own 1,447 MiB meeting reads and 512 MiB campaign-site runs keep finishing and relaunching.
 * The owed maps run beside it in the place-map lane: another process sharing the host's memory, one map at a time,
 * each waiting at the front of its own lane. Ordering, memory order and per-state reservations are the runners' own.
 * `routineLaunchMs` is how much of the routine pass's launch window remains when the lane starts.
 */
async function busyPass(maps: readonly Omit<RoutineTaskAdmissionCandidate, "deadlineMs">[], legiscan?: "shipped" | "held", routineLaunchMs = 20 * 60_000) {
  const clock = new ControlledClock(0), launches: { id: string; at: number }[] = [];
  const window = routineLaunchMs, now = 0;
  const host = workerMemoryHost({ processes: () => [] });
  const memoryLimit = { availableBytes: () => 20_244 * mib, host };
  const earlier = routineProcessSlots(memoryLimit), slots = routineProcessSlots(memoryLimit), mapSlots = routineProcessSlots(memoryLimit);
  const meeting = ROUTINE_SOURCE_TASKS.find(task => task.recordClass === "MEETING")!;
  const site = ROUTINE_SOURCE_TASKS.find(task => task.sourceId === "candidate-campaign-site-chain")!;
  const candidates: RoutineTaskAdmissionCandidate[] = [
    // More owed reads than one pass can start, so finished reads are always replaced.
    ...Array.from({ length: 100 }, (_, index) => ({ task: { ...meeting, id: `meetings:calendar-${index}`, acquisitionFailureDomain: `calendar-${index}` },
      deadlineMs: now - 3_600_000 + index, lastConsideredAt: null })),
    ...Array.from({ length: 100 }, (_, index) => ({ task: { ...site, id: `${site.id}:${index}`, acquisitionFailureDomain: `sites-${index}` },
      owedAtMs: now - 3_600_000 + index, lastConsideredAt: null })),
    // The national bill fan-out continuing from the previous pass: no owed instant, considered a pass ago.
    ...legiscan ? [{ task: ROUTINE_SOURCE_TASKS.find(task => task.id === "legiscan-bulk")!, lastConsideredAt: new Date(now - 30 * 60_000).toISOString() }] : [],
  ];
  const admitted = routineFailureDomainFrontier(candidates);
  const waited = new Set(admitted.filter(candidate => routineWaitedFullPass(candidate)).map(({ task }) => task.id));
  const passOrder = routinePassLaunchOrder(routineSerialLanesFirst(admitted), now);
  // As shipped (BL-02), the bill fan-out was ordinary late work on a free turn.
  const bills = (row: { task: { id: string } }) => row.task.id === "legiscan-bulk";
  if (legiscan === "shipped") waited.delete("legiscan-bulk");
  const ordered = legiscan === "shipped"
    ? [...electionLaunchOrder(passOrder.filter(row => !bills(row))), ...passOrder.filter(bills)] : electionLaunchOrder(passOrder);
  const commands: BoundedChildCommand[] = ordered.map(({ task }) => ({ id: task.id, failureDomain: task.acquisitionFailureDomain,
    serialLane: legiscan === "shipped" && task.id === "legiscan-bulk" ? undefined : routineSerialLane(task.command), executable: "ignored", args: [] }));
  const mapCommands: BoundedChildCommand[] = placeMapLaunchOrder(routineFailureDomainFrontier(maps)).map(({ task }) => ({ id: task.id,
    failureDomain: task.acquisitionFailureDomain, executable: "ignored", args: [] }));
  const script = (id: string) => id.startsWith("place-map-") ? "place-map-refresh.mts" : id.startsWith("meetings:") ? "ingest.ts"
    : id === "legiscan-bulk" ? "legiscan-bulk.mts" : "derive-candidate-campaign-sites.mts";
  const runsFor = (id: string) => id.startsWith("place-map-") ? mapRunMs(id) : id.startsWith("meetings:") ? 4 * 60_000 : id === "legiscan-bulk" ? window : 60_000;
  const releases = new Map<string, WorkerMemoryRelease>();
  let mapsRunning = 0, mostMaps = 0, meetingsRunning = 0, fewestReads = Infinity, waitedHandedBack = 0;
  const launch = async (command: BoundedChildCommand) => {
    launches.push({ id: command.id, at: clock.nowMs });
    const map = command.id.startsWith("place-map-"), read = command.id.startsWith("meetings:");
    if (map) mostMaps = Math.max(mostMaps, ++mapsRunning);
    if (read) meetingsRunning++;
    await clock.sleepUntil(clock.nowMs + runsFor(command.id));
    if (map) mapsRunning--;
    if (read) meetingsRunning--;
    // Meeting reads running, the previous pass's included, at each completion inside the launch window.
    if (clock.nowMs < window) fewestReads = Math.min(fewestReads, meetingsRunning);
    return exited(command);
  };
  await clock.run(async () => {
    // The previous pass left 13 meeting reads and one campaign-site run: 19,323 MiB of 19,476 usable.
    const prior = [...Array.from({ length: 13 }, (_, index) => [`meetings:prior-${index}/ingest.ts`, 20_000 * (index + 1)] as const),
      ["candidate-campaign-sites-derived:prior/derive-candidate-campaign-sites.mts", 30_000] as const];
    for (const [entry, endsAt] of prior) {
      const release = await earlier.acquire(entry, 1000);
      if (entry.startsWith("meetings:")) meetingsRunning++;
      void clock.sleepUntil(endsAt).then(() => { release(); if (entry.startsWith("meetings:")) meetingsRunning--; });
    }
    await Promise.all([
      runBoundedChildPass(commands, { cwd: process.cwd(), env: { NODE_ENV: "test" }, concurrency: Math.max(1, commands.length), deadlineMs: window,
        onStarting: async (command, index) => {
          if (clock.nowMs >= window) throw new Error("PASS_TIME_BUDGET: this pass's time is spent");
          try { releases.set(command.id, await slots.acquire(`${command.id}/${script(command.id)}`, window, routineChildMemoryOrder(index, waited.has(command.id)))); }
          catch (error) {
            if (error instanceof Error && error.message.startsWith("WORKER_MEMORY_BUSY:")) {
              if (waited.has(command.id)) waitedHandedBack++;
              return false;
            }
            throw error;
          }
        },
        onSettled: result => { releases.get(result.id)?.(); releases.delete(result.id); },
      }, launch),
      // The place-map lane, exactly as the runner gives it: one at a time, every map at the front of its own lane.
      runBoundedChildPass(mapCommands, { cwd: process.cwd(), env: { NODE_ENV: "test" }, concurrency: 1, deadlineMs: MAP_WALL_MS,
        onStarting: async (command, index) => {
          if (clock.nowMs >= MAP_LAUNCH_MS) throw new Error("PASS_TIME_BUDGET: this pass's time is spent");
          releases.set(command.id, await mapSlots.acquire(`${command.id}/${script(command.id)}`, MAP_LAUNCH_MS, routineChildMemoryOrder(index, true)));
        },
        onSettled: result => { releases.get(result.id)?.(); releases.delete(result.id); },
      }, launch),
    ]);
  });
  assert.equal(releases.size, 0);
  return { mostMaps, fewestReads, waitedHandedBack,
    bills: launches.filter(row => row.id === "legiscan-bulk"),
    maps: launches.filter(row => row.id.startsWith("place-map-")),
    meetings: launches.filter(row => row.id.startsWith("meetings:")) };
}

const neverRun = MAPS.map(task => ({ task, baselineOwed: true, lastConsideredAt: null }));

test("only the bill fan-out counts as having waited a full pass in the routine pass; every state map waits first in its own lane", () => {
  const tx = MAPS.find(task => task.id === "place-map-tx")!;
  assert.equal(routineWaitedFullPass({ task: tx }), false);
  const meeting = ROUTINE_SOURCE_TASKS.find(task => task.recordClass === "MEETING")!;
  assert.equal(routineWaitedFullPass({ task: meeting }), false);
  assert.equal(routineWaitedFullPass({ task: ROUTINE_SOURCE_TASKS.find(task => task.id === "legiscan-bulk")! }), true);
  const runner = readFileSync("scripts/routine-civic-data-runner.mts", "utf8");
  assert.match(runner, /const waitedFullPass = new Set\(admitted\.filter\(candidate => PLACE_MAPS \|\| routineWaitedFullPass\(candidate\)\)/);
  assert.match(runner, /concurrency: PLACE_MAPS \? 1 : /, "the lane runs one map at a time");
  assert.deepEqual(routineChildMemoryOrder(3, true), { priority: 3, first: true });
  assert.deepEqual(routineChildMemoryOrder(4, false), { priority: 4, wait: false });
});

test("on a host busy with reads that keep relaunching, owed maps start in their own lane smallest first, one at a time, and meeting reads keep running", async () => {
  assert.deepEqual(MAPS.map(task => routineSerialLane(task.command)).filter(Boolean), [], "no map is in the routine pass's Census lane");
  assert.equal(routineSerialLane(ROUTINE_SOURCE_TASKS.find(task => task.id === "census-geography-overlaps")!.command), "serial:census-geography");
  const without = await busyPass([]);
  const pass = await busyPass(neverRun);
  assert.equal(pass.mostMaps, 1, "one map at a time");
  assert.equal(pass.maps[0]?.id, "place-map-as", "American Samoa reserves its own 502 MiB and starts first");
  const started = new Map(pass.maps.map(row => [stateOf(row.id), row.at]));
  const small = placeMapLaunchOrder(MAPS.map(task => ({ task }))).slice(0, 6).map(({ task }) => stateOf(task.id));
  assert.ok(small.includes("DC"));
  assert.ok(small.every(state => started.has(state)), `small states start in the lane's first run: ${[...started.keys()].join(" ")}`);
  const large = pass.maps.filter(row => placeMapReservationMiB(stateOf(row.id)) >= 1000).map(row => row.at);
  assert.ok(small.every(state => started.get(state)! < Math.min(Infinity, ...large)), "small states never wait behind a large one");
  assert.ok(pass.maps.length >= 10, `${pass.maps.length} states start in the lane's ${MAP_LAUNCH_MS / 60_000}-minute launch window`);
  assert.ok(pass.maps.every(row => row.at < MAP_LAUNCH_MS));
  assert.ok(pass.meetings.length >= 0.85 * without.meetings.length,
    `meeting reads keep starting: ${pass.meetings.length} with maps, ${without.meetings.length} without`);
});

test("owed maps launch when the routine pass's time is already spent", async () => {
  const pass = await busyPass(neverRun, undefined, 0);
  assert.equal(pass.meetings.length, 0, "the routine pass starts nothing past its launch deadline");
  assert.ok(pass.maps.length >= 20, `${pass.maps.length} maps start in the lane anyway`);
  assert.equal(pass.mostMaps, 1);
  assert.ok(MAP_WALL_MS - MAP_LAUNCH_MS >= 15 * 60_000, "a map started at the lane's last moment still has 15 minutes");
});

test("each state's reservation is its own measured peak, or its block-file fit, plus 5% rounded up", () => {
  const states = memory.states as Record<string, { fips: string; blockFileBytes: number; reservationMiB: number }>;
  assert.deepEqual(Object.keys(states).sort(), MAPS.map(task => stateOf(task.id)).sort(), "every registered state has a reservation");
  const measured = memory.measured as Record<string, { peakBytes: number }>;
  const points = Object.entries(measured).map(([state, row]) => [states[state]!.blockFileBytes, row.peakBytes] as const);
  const meanX = points.reduce((sum, [x]) => sum + x, 0) / points.length, meanY = points.reduce((sum, [, y]) => sum + y, 0) / points.length;
  const slope = points.reduce((sum, [x, y]) => sum + (x - meanX) * (y - meanY), 0) / points.reduce((sum, [x]) => sum + (x - meanX) ** 2, 0);
  assert.ok(Math.abs(slope - memory.fit.slope) < 1e-9 * slope);
  assert.equal(memory.fit.interceptBytes, Math.ceil(Math.max(...points.map(([x, y]) => y - memory.fit.slope * x))));
  for (const [state, row] of Object.entries(states)) {
    const peak = measured[state]?.peakBytes ?? memory.fit.interceptBytes + memory.fit.slope * row.blockFileBytes;
    assert.equal(row.reservationMiB, Math.ceil(peak * 1.05 / mib), state);
  }
  assert.equal(placeMapReservationMiB("TX"), 1672);
  assert.equal(placeMapReservationMiB("as"), 502);
  for (const [state, row] of Object.entries(measured)) {
    assert.ok(memory.fit.interceptBytes + memory.fit.slope * states[state]!.blockFileBytes >= row.peakBytes, `${state} lies on or under the fit`);
  }
});

test("BL-02 as shipped: the 2,130 MiB bill fan-out on a late free turn never starts on a host busy with reads", async () => {
  const pass = await busyPass([], "shipped");
  assert.equal(pass.bills.length, 0, "the production failure: every legiscan-bulk decision since 11:47 UTC was DEFER");
});

test("the bill fan-out has always waited a full pass, so it takes the next freed memory in a busy pass beside the map lane", async () => {
  const bulk = ROUTINE_SOURCE_TASKS.find(task => task.id === "legiscan-bulk")!;
  assert.equal(routineSerialLane(bulk.command), "serial:scripts/legiscan-bulk.mts");
  assert.equal(routineWaitedFullPass({ task: bulk }), true);
  const without = await busyPass(neverRun);
  const pass = await busyPass(neverRun, "held");
  assert.equal(pass.bills.length, 1);
  assert.equal(pass.waitedHandedBack, 0, "the fan-out never hands its turn back");
  assert.ok(pass.bills[0]!.at <= 5 * 60_000, `the fan-out takes early room (started at ${pass.bills[0]!.at / 1000}s)`);
  assert.equal(pass.maps[0]?.id, "place-map-as", "the smallest state still starts first");
  assert.equal(pass.mostMaps, 1);
  assert.ok(pass.maps.length >= 0.8 * without.maps.length, `maps keep their turn: ${pass.maps.length} with the fan-out, ${without.maps.length} without`);
  // The fan-out holds one 2,130 MiB child (about 1.5 meeting reads) for the whole window while bills are owed.
  assert.ok(pass.fewestReads >= 2, `meeting reads keep running beside it: at least ${pass.fewestReads} at once`);
  assert.ok(pass.meetings.length >= 0.8 * without.meetings.length,
    `meeting reads keep starting: ${pass.meetings.length} with the fan-out, ${without.meetings.length} without`);
});
