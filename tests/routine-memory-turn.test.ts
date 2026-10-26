import assert from "node:assert/strict";
import test from "node:test";
import { runBoundedChildPass, type BoundedChildCommand } from "../lib/civic-data/bounded-child-pass.ts";
import { routineChildMemoryOrder, routineDeferral, ROUTINE_SOURCE_TASKS, routinePassLaunchOrder, routineFailureDomainFrontier, routineSerialLane,
  routineSerialLanesFirst } from "../lib/civic-data/runner.ts";
import { electionLaunchOrder } from "../lib/civic-data/ballot-publication.ts";
import { MEMORY_HOLD_MS, routineProcessSlots, workerMemoryHost, type WorkerMemoryRelease } from "../lib/control-plane/workers/worker-slots.ts";
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

/**
 * Production shape: a host whose 20,244 MiB is already full of the previous pass's meeting reads and campaign-site runs,
 * and a pass whose own 1,447 MiB meeting reads and 512 MiB campaign-site runs keep finishing and relaunching, plus all
 * 56 owed maps. Ordering, serial lane, memory order and reservations are the runner's own; `shipped` replays RT-01 as
 * shipped: 3,709 MiB maps that take only a free turn.
 */
async function busyPass(options: { maps: boolean; shipped?: boolean; legiscan?: "shipped" | "held" }) {
  const clock = new ControlledClock(0), launches: { id: string; at: number }[] = [];
  const window = 20 * 60_000, now = 0;
  const host = workerMemoryHost({ processes: () => [] });
  const memory = { availableBytes: () => 20_244 * mib, host,
    ...options.shipped ? { minimumPeakBytes: (entry: string) => entry.endsWith("/place-map-refresh.mts") ? 3709 * mib : 0 } : {} };
  const earlier = routineProcessSlots(memory), slots = routineProcessSlots(memory);
  const meeting = ROUTINE_SOURCE_TASKS.find(task => task.recordClass === "MEETING")!;
  const site = ROUTINE_SOURCE_TASKS.find(task => task.sourceId === "candidate-campaign-site-chain")!;
  const maps = ROUTINE_SOURCE_TASKS.filter(task => task.id.startsWith("place-map-"));
  assert.equal(maps.length, 56);
  const candidates = [
    // More owed reads than one pass can start, so finished reads are always replaced.
    ...Array.from({ length: 100 }, (_, index) => ({ task: { ...meeting, id: `meetings:calendar-${index}`, acquisitionFailureDomain: `calendar-${index}` },
      deadlineMs: now - 3_600_000 + index, lastConsideredAt: null })),
    ...Array.from({ length: 100 }, (_, index) => ({ task: { ...site, id: `${site.id}:${index}`, acquisitionFailureDomain: `sites-${index}` },
      owedAtMs: now - 3_600_000 + index, lastConsideredAt: null })),
    ...options.maps ? maps.map(task => ({ task, baselineOwed: true, lastConsideredAt: null })) : [],
    // The national bill fan-out continuing from the previous pass: no owed instant, considered a pass ago.
    ...options.legiscan ? [{ task: ROUTINE_SOURCE_TASKS.find(task => task.id === "legiscan-bulk")!, lastConsideredAt: new Date(now - 30 * 60_000).toISOString() }] : [],
  ];
  // As shipped, a never-run map was ordered after all overdue work.
  const passOrder = routinePassLaunchOrder(routineSerialLanesFirst(routineFailureDomainFrontier(candidates)), now);
  // As shipped, the bill fan-out was ordinary late work on a free turn.
  const bills = (row: { task: { id: string } }) => row.task.id === "legiscan-bulk";
  const ordered = options.shipped ? passOrder : options.legiscan === "shipped"
    ? [...electionLaunchOrder(passOrder.filter(row => !bills(row))), ...passOrder.filter(bills)] : electionLaunchOrder(passOrder);
  const commands: BoundedChildCommand[] = ordered.map(({ task }) => ({ id: task.id, failureDomain: task.acquisitionFailureDomain,
    serialLane: options.shipped || options.legiscan === "shipped" && task.id === "legiscan-bulk" ? undefined : routineSerialLane(task.command), executable: "ignored", args: [] }));
  const script = (id: string) => id.startsWith("place-map-") ? "place-map-refresh.mts" : id.startsWith("meetings:") ? "ingest.ts"
    : id === "legiscan-bulk" ? "legiscan-bulk.mts" : "derive-candidate-campaign-sites.mts";
  const runsFor = (id: string) => id.startsWith("place-map-") ? 3 * 60_000 : id.startsWith("meetings:") ? 4 * 60_000 : id === "legiscan-bulk" ? window : 60_000;
  const releases = new Map<string, WorkerMemoryRelease>();
  let mapsRunning = 0, mostMaps = 0, meetingsRunning = 0, fewestReads = Infinity;
  await clock.run(async () => {
    // The previous pass left 13 meeting reads and one campaign-site run: 19,323 MiB of 19,476 usable.
    const prior = [...Array.from({ length: 13 }, (_, index) => [`meetings:prior-${index}/ingest.ts`, 20_000 * (index + 1)] as const),
      ["candidate-campaign-sites-derived:prior/derive-candidate-campaign-sites.mts", 30_000] as const];
    for (const [entry, endsAt] of prior) {
      const release = await earlier.acquire(entry, 1000);
      void clock.sleepUntil(endsAt).then(release);
    }
    await runBoundedChildPass(commands, { cwd: process.cwd(), env: { NODE_ENV: "test" }, concurrency: commands.length, deadlineMs: window,
      onStarting: async (command, index) => {
        const order = options.shipped ? { priority: index, wait: false as const } : routineChildMemoryOrder(command.serialLane, index);
        try { releases.set(command.id, await slots.acquire(`${command.id}/${script(command.id)}`, window, order)); }
        catch (error) {
          if (error instanceof Error && error.message.startsWith("WORKER_MEMORY_BUSY:")) return false;
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
      // Reads running at each completion inside the launch window, once the previous pass has begun to finish.
      if (clock.nowMs >= 30_000 && clock.nowMs < window) fewestReads = Math.min(fewestReads, meetingsRunning);
      return exited(command);
    });
  });
  assert.equal(releases.size, 0);
  return { mostMaps, fewestReads,
    bills: launches.filter(row => row.id === "legiscan-bulk"),
    maps: launches.filter(row => row.id.startsWith("place-map-")),
    meetings: launches.filter(row => row.id.startsWith("meetings:")) };
}

test("RT-01 as shipped: 3,709 MiB maps on free turns never start on a host busy with reads that keep relaunching", async () => {
  const pass = await busyPass({ maps: true, shipped: true });
  assert.equal(pass.maps.length, 0, "the production failure: every place-map decision was DEFER");
  assert.ok(pass.meetings.length > 0);
});

test("on a host busy with reads that keep relaunching, state maps start within one pass and meeting reads keep running", async () => {
  const maps = ROUTINE_SOURCE_TASKS.filter(task => task.id.startsWith("place-map-"));
  assert.ok(maps.every(task => routineSerialLane(task.command) === "serial:scripts/place-map-refresh.mts"), "one state map at a time");
  assert.deepEqual(routineChildMemoryOrder("serial:scripts/place-map-refresh.mts", 3), { priority: 3, hold: true });
  assert.deepEqual(routineChildMemoryOrder(undefined, 4), { priority: 4, wait: false });
  assert.deepEqual(routineChildMemoryOrder("serial:scripts/national-people-refresh.mts", 5), { priority: 5, wait: false });

  const without = await busyPass({ maps: false });
  const pass = await busyPass({ maps: true });
  const first = pass.maps[0];
  assert.ok(first, "at least one state map starts in the pass");
  // At 20 s one finished read leaves 1,600 MiB, which a free-turn read would take; the held map keeps it, and at 30 s
  // a finished campaign-site run brings it to the map's 1,672 MiB.
  assert.ok(first.at <= 30_000 && first.at <= MEMORY_HOLD_MS, `the first map takes the first room that opens (started at ${first.at / 1000}s)`);
  assert.equal(pass.mostMaps, 1, "maps run one at a time: one 1,672 MiB reservation");
  assert.ok(pass.maps.length >= 5, `maps keep their turn through the pass (${pass.maps.length} started)`);
  assert.ok(pass.fewestReads >= without.fewestReads,
    `meeting reads keep running beside the map: at least ${pass.fewestReads} at once with maps, ${without.fewestReads} without`);
  assert.ok(pass.meetings.length >= 0.85 * without.meetings.length,
    `meeting reads keep starting: ${pass.meetings.length} with maps, ${without.meetings.length} without`);
});

test("BL-02 as shipped: the 2,130 MiB bill fan-out on a late free turn never starts on a host busy with reads", async () => {
  const pass = await busyPass({ maps: true, legiscan: "shipped" });
  assert.equal(pass.bills.length, 0, "the production failure: every legiscan-bulk decision since 11:47 UTC was DEFER");
});

test("the bill fan-out keeps its place in the memory queue and starts early in a busy pass beside the maps", async () => {
  assert.equal(routineSerialLane(["scripts/legiscan-bulk.mts", "--promote"]), "serial:scripts/legiscan-bulk.mts");
  assert.deepEqual(routineChildMemoryOrder("serial:scripts/legiscan-bulk.mts", 2), { priority: 2, hold: true });
  const without = await busyPass({ maps: true });
  const pass = await busyPass({ maps: true, legiscan: "held" });
  assert.equal(pass.bills.length, 1);
  assert.ok(pass.bills[0]!.at <= MEMORY_HOLD_MS, `the fan-out takes the first room that opens (started at ${pass.bills[0]!.at / 1000}s)`);
  assert.ok(pass.maps.length >= without.maps.length, `maps keep their turn: ${pass.maps.length} with the fan-out, ${without.maps.length} without`);
  // The fan-out holds one 2,130 MiB child (about 1.5 meeting reads) for the whole window while bills are owed.
  assert.ok(pass.fewestReads >= 2, `meeting reads keep running beside it: at least ${pass.fewestReads} at once`);
  assert.ok(pass.meetings.length >= 0.8 * without.meetings.length,
    `meeting reads keep starting: ${pass.meetings.length} with the fan-out, ${without.meetings.length} without`);
});
