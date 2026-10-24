import assert from "node:assert/strict";
import test from "node:test";
import { runBoundedChildPass, type BoundedChildCommand, type BoundedChildResult } from "../lib/civic-data/bounded-child-pass.ts";
import { ROUTINE_SOURCE_TASKS, routinePassLaunchOrder, routineSerialLane, routineSerialLanesFirst } from "../lib/civic-data/runner.ts";
import { workerMemoryHost, workerProcessSlots, type WorkerMemoryOrder } from "../lib/control-plane/workers/worker-slots.ts";

const mib = 1024 * 1024;
const people = (id: string) => ROUTINE_SOURCE_TASKS.find(task => task.id === id)!;
const meeting = ROUTINE_SOURCE_TASKS.find(task => task.recordClass === "MEETING")!;

test("overdue meetings retain first turn after serial-lane tie ordering, then first reads and steady refreshes", () => {
  const now = Date.parse("2026-10-22T18:26:00.000Z");
  const president = people("people-statewide-executive-sources-us");
  assert.equal(routineSerialLane(president.command), "serial:scripts/national-people-refresh.mts");
  const jobs = [
    { task: meeting, deadlineMs: now - 1, baselineOwed: false, lastConsideredAt: "2026-10-22T17:00:00.000Z" },
    { task: people("people-legiscan-api-de"), deadlineMs: undefined, baselineOwed: true, lastConsideredAt: "2026-10-22T17:30:00.000Z" },
    { task: people("people-wikidata-people-de"), deadlineMs: undefined, baselineOwed: false, lastConsideredAt: "2026-10-21T06:00:00.000Z" },
    { task: president, deadlineMs: undefined, baselineOwed: true, lastConsideredAt: null },
  ];
  const ordered = routinePassLaunchOrder(routineSerialLanesFirst(jobs), now).map(job => job.task.id);
  assert.deepEqual(ordered, [meeting.id, "people-statewide-executive-sources-us", "people-wikidata-people-de", "people-legiscan-api-de"],
    "serial-lane preference cannot move overdue meetings behind national baselines");
  assert.deepEqual(routineSerialLanesFirst([jobs[0]!]), [jobs[0]], "a pass with no serial lane keeps its order");
});

test("memory goes in launch order, and a held waiter is not overtaken by smaller work queued behind it", async () => {
  const host = workerMemoryHost({ processes: () => [] });
  const peaks: Record<string, number> = { big: 1500 * mib, small: 300 * mib };
  const slots = workerProcessSlots(() => 10, { host, availableBytes: () => 2500 * mib, peakBytes: entry => peaks[entry.split("#")[0]!]! });
  const running = await slots.acquire("small#running", Date.now() + 10_000);
  const admitted: string[] = [];
  const wait = (entry: string, order?: WorkerMemoryOrder) => slots.acquire(entry, Date.now() + 10_000, order).then(release => { admitted.push(entry); return release; });
  const later = wait("small#later", { priority: 2 });
  const lane = wait("big#lane", { priority: 1, hold: true });
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.deepEqual(admitted, [], "768 headroom + 300 running + 1500 does not fit 2500; the held lane read keeps the small read out");
  running();
  const laneRelease = await lane;
  assert.deepEqual(admitted, ["big#lane"]);
  laneRelease();
  (await later)();
  assert.deepEqual(admitted, ["big#lane", "small#later"]);

  const unheld = await slots.acquire("small#running", Date.now() + 10_000);
  const order: string[] = [];
  const bigPlain = slots.acquire("big#plain", Date.now() + 10_000, { priority: 1 }).then(release => { order.push("big#plain"); return release; });
  const smallPlain = slots.acquire("small#plain", Date.now() + 10_000, { priority: 2 }).then(release => { order.push("small#plain"); return release; });
  (await smallPlain)();
  assert.deepEqual(order, ["small#plain"], "without a hold, work that fits still starts");
  unheld();
  (await bigPlain)();
});

test("a pass whose meeting programs fill memory still runs every read of the people lane before its launch deadline", async () => {
  const host = workerMemoryHost({ processes: () => [] });
  const slots = workerProcessSlots(() => 100, { host, availableBytes: () => 4096 * mib, peakBytes: entry => (entry.startsWith("small") ? 342 : 1258) * mib });
  const lane = "serial:scripts/national-people-refresh.mts";
  const command = (id: string, serialLane?: string): BoundedChildCommand => ({ id, executable: "node", args: [], ...(serialLane ? { serialLane } : {}) });
  const calendars = Array.from({ length: 12 }, (_, i) => command(`calendar-${i}`));
  const small = Array.from({ length: 12 }, (_, i) => command(`small-${i}`));
  const peopleReads = ["people-us", "people-az", "people-tx"].map(id => command(id, lane));
  const durations = (id: string) => id.startsWith("calendar") ? 400 : id.startsWith("small") ? 40 : 30;
  const deadline = Date.now() + 1_000;
  const ran: string[] = [];
  const releases = new Map<string, () => void>();
  const ordered = routineSerialLanesFirst([...calendars, ...small, ...peopleReads].map(c => ({ task: { command: c.serialLane ? ["scripts/national-people-refresh.mts"] : ["x"] }, c }))).map(({ c }) => c);
  const results = await runBoundedChildPass(ordered, {
    cwd: ".", env: process.env, concurrency: ordered.length,
    onStarting: async (c, index) => { releases.set(c.id, await slots.acquire(`${c.id}/x.mts`, deadline, { priority: index, hold: c.serialLane !== undefined })); },
    onSettled: async run => { releases.get(run.id)?.(); },
  }, async (c): Promise<BoundedChildResult> => {
    ran.push(c.id);
    await new Promise(resolve => setTimeout(resolve, durations(c.id)));
    return { id: c.id, status: 0, signal: null, stdout: "", stderr: "", termination: "EXITED", errorMessage: null };
  });
  assert.deepEqual(peopleReads.map(c => ran.includes(c.id)), [true, true, true], `ran: ${ran.join(" ")}`);
  assert.equal(results.filter(r => r.termination === "EXITED").length, ran.length);
});
