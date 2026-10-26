import assert from "node:assert/strict";
import test from "node:test";
import { runBoundedChildPass, type BoundedChildCommand } from "../lib/civic-data/bounded-child-pass.ts";
import { routineChildMemoryOrder, routineDeferral, ROUTINE_PASS_BUDGET_MS, ROUTINE_SOURCE_TASKS, routinePassLaunchOrder, routineFailureDomainFrontier,
  routinePlaceMapWaited, routineSerialLane, routineSerialLanesFirst, type RoutineTaskAdmissionCandidate } from "../lib/civic-data/runner.ts";
import { electionLaunchOrder } from "../lib/civic-data/ballot-publication.ts";
import { routineProcessSlots, workerMemoryHost, type WorkerMemoryRelease } from "../lib/control-plane/workers/worker-slots.ts";
import { placeMapReservationMiB } from "../lib/place-map/memory.ts";
import memory from "../lib/place-map/memory.json" with { type: "json" };
import { ControlledClock } from "./helpers/routine-pass-replay.ts";

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

/**
 * Production shape: a host whose 20,244 MiB is already full of the previous pass's meeting reads and a campaign-site run,
 * and a pass whose own 1,447 MiB meeting reads and 512 MiB campaign-site runs keep finishing and relaunching, plus the
 * owed maps. Ordering, Census lane, waited rule, memory order and per-state reservations are the runner's own.
 * `shipped` replays RT-01 as shipped: 3,709 MiB maps ordered last that take only a free turn.
 */
async function busyPass(maps: readonly Omit<RoutineTaskAdmissionCandidate, "deadlineMs">[], shipped = false) {
  const clock = new ControlledClock(0), launches: { id: string; at: number }[] = [];
  const window = 20 * 60_000, now = 0;
  const host = workerMemoryHost({ processes: () => [] });
  const memoryLimit = { availableBytes: () => 20_244 * mib, host,
    ...shipped ? { minimumPeakBytes: (entry: string) => entry.endsWith("/place-map-refresh.mts") ? 3709 * mib : 0 } : {} };
  const earlier = routineProcessSlots(memoryLimit), slots = routineProcessSlots(memoryLimit);
  const meeting = ROUTINE_SOURCE_TASKS.find(task => task.recordClass === "MEETING")!;
  const site = ROUTINE_SOURCE_TASKS.find(task => task.sourceId === "candidate-campaign-site-chain")!;
  const candidates: RoutineTaskAdmissionCandidate[] = [
    // More owed reads than one pass can start, so finished reads are always replaced.
    ...Array.from({ length: 100 }, (_, index) => ({ task: { ...meeting, id: `meetings:calendar-${index}`, acquisitionFailureDomain: `calendar-${index}` },
      deadlineMs: now - 3_600_000 + index, lastConsideredAt: null })),
    ...Array.from({ length: 100 }, (_, index) => ({ task: { ...site, id: `${site.id}:${index}`, acquisitionFailureDomain: `sites-${index}` },
      owedAtMs: now - 3_600_000 + index, lastConsideredAt: null })),
    ...maps,
  ];
  const admitted = routineFailureDomainFrontier(candidates);
  const waited = new Set(admitted.filter(candidate => routinePlaceMapWaited(candidate, now)).map(({ task }) => task.id));
  // As shipped, a never-run map was ordered after all overdue work.
  const passOrder = routinePassLaunchOrder(routineSerialLanesFirst(admitted), now);
  const ordered = shipped ? passOrder : electionLaunchOrder(passOrder);
  const commands: BoundedChildCommand[] = ordered.map(({ task }) => ({ id: task.id, failureDomain: task.acquisitionFailureDomain,
    serialLane: shipped ? undefined : routineSerialLane(task.command), executable: "ignored", args: [] }));
  const script = (id: string) => id.startsWith("place-map-") ? "place-map-refresh.mts" : id.startsWith("meetings:") ? "ingest.ts" : "derive-candidate-campaign-sites.mts";
  const runsFor = (id: string) => id.startsWith("place-map-") ? mapRunMs(id) : id.startsWith("meetings:") ? 4 * 60_000 : 60_000;
  const releases = new Map<string, WorkerMemoryRelease>();
  let mapsRunning = 0, mostMaps = 0, meetingsRunning = 0, fewestReads = Infinity, waitedHandedBack = 0;
  await clock.run(async () => {
    // The previous pass left 13 meeting reads and one campaign-site run: 19,323 MiB of 19,476 usable.
    const prior = [...Array.from({ length: 13 }, (_, index) => [`meetings:prior-${index}/ingest.ts`, 20_000 * (index + 1)] as const),
      ["candidate-campaign-sites-derived:prior/derive-candidate-campaign-sites.mts", 30_000] as const];
    for (const [entry, endsAt] of prior) {
      const release = await earlier.acquire(entry, 1000);
      if (entry.startsWith("meetings:")) meetingsRunning++;
      void clock.sleepUntil(endsAt).then(() => { release(); if (entry.startsWith("meetings:")) meetingsRunning--; });
    }
    await runBoundedChildPass(commands, { cwd: process.cwd(), env: { NODE_ENV: "test" }, concurrency: commands.length, deadlineMs: window,
      onStarting: async (command, index) => {
        const order = shipped ? { priority: index, wait: false as const } : routineChildMemoryOrder(index, waited.has(command.id));
        try { releases.set(command.id, await slots.acquire(`${command.id}/${script(command.id)}`, window, order)); }
        catch (error) {
          if (error instanceof Error && error.message.startsWith("WORKER_MEMORY_BUSY:")) {
            if (waited.has(command.id)) waitedHandedBack++;
            return false;
          }
          throw error;
        }
      },
      onSettled: result => { releases.get(result.id)?.(); releases.delete(result.id); },
    }, async command => {
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
    });
  });
  assert.equal(releases.size, 0);
  return { mostMaps, fewestReads, waitedHandedBack,
    maps: launches.filter(row => row.id.startsWith("place-map-")),
    meetings: launches.filter(row => row.id.startsWith("meetings:")) };
}

const neverRun = MAPS.map(task => ({ task, baselineOwed: true, lastConsideredAt: null }));

test("RT-01 as shipped: 3,709 MiB maps on free turns never start on a host busy with reads that keep relaunching", async () => {
  const pass = await busyPass(neverRun, true);
  assert.equal(pass.maps.length, 0, "the production failure: every place-map decision was DEFER");
  assert.ok(pass.meetings.length > 0);
});

test("a map waited a full pass when it was owed for one pass budget or has never run; other work never counts as waited", () => {
  const tx = MAPS.find(task => task.id === "place-map-tx")!;
  const now = Date.parse("2026-10-26T15:00:00.000Z");
  assert.equal(routinePlaceMapWaited({ task: tx, baselineOwed: true, lastConsideredAt: null }, now), true);
  assert.equal(routinePlaceMapWaited({ task: tx, owedAtMs: now - ROUTINE_PASS_BUDGET_MS, lastConsideredAt: "2026-09-20T00:00:00.000Z" }, now), true);
  assert.equal(routinePlaceMapWaited({ task: tx, owedAtMs: now - ROUTINE_PASS_BUDGET_MS + 1, lastConsideredAt: "2026-09-20T00:00:00.000Z" }, now), false);
  const meeting = ROUTINE_SOURCE_TASKS.find(task => task.recordClass === "MEETING")!;
  assert.equal(routinePlaceMapWaited({ task: meeting, baselineOwed: true, lastConsideredAt: null }, now), false);
  assert.deepEqual(routineChildMemoryOrder(3, true), { priority: 3, first: true });
  assert.deepEqual(routineChildMemoryOrder(4, false), { priority: 4, wait: false });
});

test("on a host busy with reads that keep relaunching, owed maps start smallest first, one at a time, and meeting reads keep running", async () => {
  assert.deepEqual([...new Set(ROUTINE_SOURCE_TASKS.filter(task => task.sourceId === "census-geography-relationships")
    .map(task => routineSerialLane(task.command)))], ["serial:census-geography"], "one shared Census worker");
  const without = await busyPass([]);
  const pass = await busyPass(neverRun);
  assert.equal(pass.mostMaps, 1, "one Census worker: one map at a time");
  assert.equal(pass.waitedHandedBack, 0, "a map that waited a full pass never hands its turn back");
  assert.equal(pass.maps[0]?.id, "place-map-as", "American Samoa reserves its own 502 MiB and starts first");
  assert.ok(pass.maps[0]!.at <= 20_000, `the first map takes the first room that opens (started at ${pass.maps[0]!.at / 1000}s)`);
  const started = new Map(pass.maps.map(row => [stateOf(row.id), row.at]));
  const small = ["AS", "VI", "GU", "MP", "DC", "WY"];
  assert.ok(small.every(state => started.has(state)), `small states start in the pass: ${[...started.keys()].join(" ")}`);
  const firstLarge = Math.min(...pass.maps.filter(row => placeMapReservationMiB(stateOf(row.id)) >= 1000).map(row => row.at));
  assert.ok(small.every(state => started.get(state)! < firstLarge), "small states never wait behind a large one");
  assert.ok(pass.maps.length >= 20, `${pass.maps.length} states start in one 20-minute launch window`);
  assert.ok(pass.fewestReads >= without.fewestReads,
    `meeting reads keep running beside the map: at least ${pass.fewestReads} at once with maps, ${without.fewestReads} without`);
  assert.ok(pass.meetings.length >= 0.85 * without.meetings.length,
    `meeting reads keep starting: ${pass.meetings.length} with maps, ${without.meetings.length} without`);
});

test("a map that waited a full pass takes the next freed memory that fits; one owed for less than a pass takes a free turn", async () => {
  const tx = MAPS.find(task => task.id === "place-map-tx")!;
  const waited = await busyPass([{ task: tx, owedAtMs: -ROUTINE_PASS_BUDGET_MS - 60_000, lastConsideredAt: "2026-09-20T00:00:00.000Z" }]);
  const recent = await busyPass([{ task: tx, owedAtMs: -5 * 60_000, lastConsideredAt: "2026-09-20T00:00:00.000Z" }]);
  // At 20 s one finished read leaves 1,600 MiB, which a free-turn read takes; Texas keeps it, and at 30 s a finished
  // campaign-site run brings it to Texas's own 1,672 MiB.
  assert.equal(waited.maps[0]?.at, 30_000);
  assert.equal(waited.waitedHandedBack, 0);
  assert.ok((recent.maps[0]?.at ?? Infinity) > 30_000, `a free turn lets reads take that room first (started at ${recent.maps[0]?.at})`);
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
