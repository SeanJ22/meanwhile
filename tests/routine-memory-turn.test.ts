import assert from "node:assert/strict";
import test from "node:test";
import { runBoundedChildPass, type BoundedChildCommand } from "../lib/civic-data/bounded-child-pass.ts";
import { routineDeferral, ROUTINE_SOURCE_TASKS, routinePassLaunchOrder, routineFailureDomainFrontier } from "../lib/civic-data/runner.ts";
import { routineProcessSlots, workerMemoryHost, type WorkerMemoryRelease } from "../lib/control-plane/workers/worker-slots.ts";
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

test("all 56 state maps drain through measured memory while meeting and voting reads lead", async () => {
  const clock = new ControlledClock(0), launches: { id: string; at: number }[] = [];
  const maps = ROUTINE_SOURCE_TASKS.filter(task => task.id.startsWith("place-map-"));
  const meeting = ROUTINE_SOURCE_TASKS.find(task => task.recordClass === "MEETING")!;
  const candidates = [
    ...maps.map(task => ({ task, baselineOwed: true, lastConsideredAt: null })),
    { task: { ...meeting, id: "voting", sourceId: "voting", acquisitionFailureDomain: "voting" }, baselineOwed: false, lastConsideredAt: null, owedAtMs: -2 },
    { task: { ...meeting, id: "calendar" }, baselineOwed: false, lastConsideredAt: null, deadlineMs: -1 },
  ];
  const commands = routinePassLaunchOrder(routineFailureDomainFrontier(candidates), 0).map(({ task }) => ({ id: task.id,
    failureDomain: task.acquisitionFailureDomain, executable: "ignored", args: [] }));
  const peak = (entry: string) => entry === "calendar" ? 1447 : entry === "voting" ? 512 : 3709;
  const slots = routineProcessSlots({ availableBytes: () => 8192 * mib, peakBytes: entry => peak(entry) * mib,
    host: workerMemoryHost({ processes: () => [] }) });
  const releases = new Map<string, WorkerMemoryRelease>();
  let reserved = 0, activeMaps = 0, maxMaps = 0;
  await clock.run(async () => {
    const results = await runBoundedChildPass(commands, { cwd: process.cwd(), env: { NODE_ENV: "test" }, concurrency: commands.length,
      deadlineMs: 60_000,
      onStarting: async (command, priority) => {
        try { releases.set(command.id, await slots.acquire(command.id, 60_000, { priority, wait: false })); }
        catch (error) {
          if (error instanceof Error && error.message.startsWith("WORKER_MEMORY_BUSY:")) return false;
          throw error;
        }
      },
      onSettled: result => { releases.get(result.id)?.(); releases.delete(result.id); },
    }, async command => {
      launches.push({ id: command.id, at: clock.nowMs });
      reserved += peak(command.id);
      assert.ok(reserved + 768 <= 8192, "every start retains the 0.75 GiB margin");
      if (command.id.startsWith("place-map-")) maxMaps = Math.max(maxMaps, ++activeMaps);
      await clock.sleepUntil(clock.nowMs + 1000);
      reserved -= peak(command.id);
      if (command.id.startsWith("place-map-")) activeMaps--;
      return exited(command);
    });
    assert.ok(results.every(result => result.status === 0));
  });
  assert.deepEqual(launches.slice(0, 2).map(row => row.id), ["voting", "calendar"]);
  assert.ok(launches.slice(0, 2).every(row => row.at === 0));
  assert.equal(launches.filter(row => row.id.startsWith("place-map-")).length, 56);
  assert.equal(maxMaps, 2, "two 3709 MiB reservations fit alone on 8 GiB at the retained margin");
  assert.equal(releases.size, 0);
});
