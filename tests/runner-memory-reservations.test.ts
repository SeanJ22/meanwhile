import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { CALENDAR_READ_PEAK_MIB, memoryReading, RESEARCH_PARENT_PEAK_MIB, ROUTINE_ENTRY_PEAK_MIB, routineProcessSlots,
  WORKER_ENTRY_PEAK_MIB, workerJobType, workerMemoryHost, workerProcessSlots } from "../lib/control-plane/workers/worker-slots.ts";

const mib = 1024 ** 2;

test("the runner forwards ordered memory reservations without losing a catch-up read's earlier deadline", async () => {
  const source = readFileSync("scripts/routine-civic-data-runner.mts", "utf8");
  const start = source.indexOf("async function acquireChildMemory(");
  const end = source.indexOf("\nfunction releaseChildMemory(", start);
  assert.ok(start >= 0 && end > start);
  const requests: { deadline: number; order: unknown }[] = [];
  const observed: number[] = [];
  const slots = { acquire: async (_entry: string, deadline: number, order: unknown) => {
    requests.push({ deadline, order });
    return Object.assign(() => {}, { observe: (pid: number) => observed.push(pid) });
  } };
  const repairDeadline = Date.now() + 300_000, launchDeadline = Date.now() + 600_000;
  const started = new Set<string>(), ran = new Set<string>();
  const acquire = new Function("routineMemorySlots", "PASS_REPAIR_DEADLINE_MS", "PASS_LAUNCH_DEADLINE_MS", "ROUTINE_CHILD_TIMEOUT_MS",
    "childMemoryReleases", "startedSourceChildren", "ranThisPass",
    ts.transpileModule(source.slice(start, end), { compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext } }).outputText + "\nreturn acquireChildMemory;")(
    slots, repairDeadline, launchDeadline, 900_000, new Map(), started, ran) as (...args: unknown[]) => Promise<void>;
  const order = { priority: 2, hold: true };
  const ordinary = { id: "state", args: ["scripts/ingest.ts"] };
  await acquire(ordinary, ["board"], order);
  const catchup = { id: "catchup", args: ["scripts/ingest.ts"], onStarted: undefined as ((pid: number) => void) | undefined };
  const earlierDeadline = Date.now() + 5_000;
  await acquire(catchup, ["catchup-board"], earlierDeadline);
  await acquire({ id: "repair", args: ["scripts/routine-civic-data-reader-repair.mts"] });
  assert.deepEqual(requests, [
    { deadline: launchDeadline, order }, { deadline: earlierDeadline, order: undefined }, { deadline: repairDeadline, order: undefined },
  ]);
  catchup.onStarted?.(123);
  assert.deepEqual([...ran], ["catchup-board"]);
  assert.deepEqual([...started], ["catchup", "catchup-board"]);
  assert.deepEqual(observed, [123]);
});

test("the round supervisor cannot reserve the state planner's old full research peak a second time", () => {
  const source = readFileSync("scripts/freshness-shadow.mts", "utf8");
  assert.ok(source.indexOf("const hostWorkerSlots =") > source.indexOf("const PLANNING_STATE=STATE;"));
  const peak = RESEARCH_PARENT_PEAK_MIB * mib;
  // Controlled replay of the reported available/growth totals, evenly split
  // between the two old parent reservations. OS availability includes every lane.
  const rss = (2 * peak - 5.77e9) / 2;
  const rows = [{ pid: 1, parentPid: 0, rss }, { pid: 2, parentPid: 1, rss }];
  const input = { at: "2026-10-20T22:19:00Z", totalBytes: 8192 * mib, availableBytes: 5.78e9, rootPid: 1, rows };
  const before = memoryReading({ ...input, state: { reservations: [], parents: [{ pid: 1, peak }, { pid: 2, peak }] } });
  const after = memoryReading({ ...input, state: { reservations: [], parents: [{ pid: 2, peak }] } });
  assert.equal(before.fitLeaseWorkers, 0);
  assert.equal(after.fitLeaseWorkers, 5);
  assert.equal(after.headroomBytes, 768 * mib);
  console.log(`RN-01 controlled admission: ${before.fitLeaseWorkers} -> ${after.fitLeaseWorkers} lease workers; ${after.headroomBytes / mib} MiB margin`);
});

test("the exact 7:09 PM production reservation snapshot fits five leases after removing the duplicate parent", () => {
  const input = { at: "2026-10-20T23:09:49Z", totalBytes: 8326938624, availableBytes: 5717168128, rootPid: 876022,
    rows: [
      { pid: 876022, parentPid: 0, rss: 230027264 }, { pid: 923370, parentPid: 876022, rss: 374734848 },
      { pid: 924070, parentPid: 876022, rss: 281899008 }, { pid: 925313, parentPid: 924070, rss: 447660032 },
      { pid: 100, parentPid: 876022, rss: 149188608 }, { pid: 101, parentPid: 876022, rss: 296165376 },
    ] };
  const state = { parents: [{ pid: 876022, peak: 0 }, { pid: 923370, peak: 0 },
    { pid: 924070, peak: 3070230528 }, { pid: 925313, peak: 3070230528 }],
    reservations: [{ pid: 100, entry: "ingest.ts", peak: 390070272 }, { pid: 101, entry: "platform-census-runner.mts", peak: 328204288 }] };
  const before = memoryReading({ ...input, state });
  assert.equal(before.reservedGrowthBytes, 5683822592);
  assert.equal(before.fitLeaseWorkers, 0);
  const after = memoryReading({ ...input, state: { ...state, parents: state.parents.filter(parent => parent.pid !== 924070) } });
  assert.equal(after.fitLeaseWorkers, 5);
  assert.equal(after.headroomBytes, 805306368);
  assert.equal(after.parents[0].peakRssBytes, null, "missing OS evidence remains unknown");
});

test("heartbeat parent high-water RSS is separate from its reservation and current RSS", () => {
  const reading = memoryReading({ at: "2026-10-20T23:09:49Z", totalBytes: 8192 * mib, availableBytes: 5000 * mib, rootPid: 1,
    rows: [{ pid: 1, parentPid: 0, rss: 300 * mib, peakRss: 650 * mib }],
    state: { parents: [{ pid: 1, peak: 2928 * mib, entry: "freshness-shadow.mts:az" }], reservations: [] } });
  assert.equal(reading.parents[0].peakRssBytes, 650 * mib);
  assert.equal(reading.parents[0].rssBytes, 300 * mib);
  assert.equal(reading.parents[0].peakBytes, 2928 * mib);
  assert.equal(reading.parents[0].entry, "freshness-shadow.mts:az");
});

test("four lease workers acquire memory alongside a standing job and the full research parent on 8 GiB", async () => {
  const host = workerMemoryHost({ processes: () => [{ pid: process.pid, parentPid: process.ppid, rss: 768 * mib }] });
  const memory = { host, availableBytes: () => (8192 - 768) * mib, parentPeakBytes: RESEARCH_PARENT_PEAK_MIB * mib };
  const standing = await routineProcessSlots(memory).acquire("legiscan-votes-refresh.mts");
  const leases = await Promise.all(Array.from({ length: 4 }, () => workerProcessSlots(() => 1, memory).acquire("lease-worker.ts")));
  assert.ok(RESEARCH_PARENT_PEAK_MIB + ROUTINE_ENTRY_PEAK_MIB["legiscan-votes-refresh.mts"] + 4 * WORKER_ENTRY_PEAK_MIB.lease! + 768 <= 8192);
  leases.forEach(release => release()); standing();
});

test("small-state observations cannot lower complete native vote or ACS reservations", async () => {
  const host = workerMemoryHost({ processes: () => [] });
  host.transact(state => { state.peaks = { "openstates-votes-refresh.mts": [100 * mib], "legiscan-votes-refresh.mts": [100 * mib] }; }, false);
  const slots = routineProcessSlots({ host, availableBytes: () => 10000 * mib });
  for (const [entry, expected] of [["openstates-votes-refresh.mts", 3574], ["legiscan-votes-refresh.mts", 1312], ["acs-population-promote.mts", 3928]] as const) {
    const release = await slots.acquire(entry);
    host.transact(state => assert.equal(state.reservations[0].peak, expected * mib), false);
    release();
  }
});

test("measured memory is filed by job: every calendar read is one job, a statewide job is its family, never the script it runs", () => {
  assert.equal(workerJobType("meetings-state:CA/ingest.ts"), "calendar-read");
  assert.equal(workerJobType("meetings:legistar:ocd-division%2Fcountry%3Aus%2Fstate%3Aaz%2Fcounty%3Apima%23governing/ingest.ts"), "calendar-read");
  assert.equal(workerJobType("meetings:derived:US-TX/ingest.ts"), "calendar-read");
  assert.equal(workerJobType("openstates-votes-ca/openstates-votes-refresh.mts"), workerJobType("openstates-votes-wy/openstates-votes-refresh.mts"));
  assert.equal(workerJobType("openstates-votes-ca/openstates-votes-refresh.mts"), "openstates-votes-*/openstates-votes-refresh.mts");
  assert.equal(workerJobType("az-state-legislators/state-legislators.mts"), "*-state-legislators/state-legislators.mts");
  assert.equal(workerJobType("registry-runtime:AZ/promote-registry-runtime.mts"), "registry-runtime:*/promote-registry-runtime.mts");
  assert.equal(workerJobType("fec-funding/fetch-fec.mts"), "fec-funding/fetch-fec.mts");
  assert.equal(workerJobType("lease-worker.ts"), "lease-worker.ts");
  assert.equal(workerJobType("national-place:ocd-division/country:us"), null);
});

test("a state's calendar program is reserved from measured calendar reads, not the statewide bound once measured", async () => {
  const host = workerMemoryHost({ processes: () => [] });
  const slots = routineProcessSlots({ host, availableBytes: () => 10000 * mib });
  let release = await slots.acquire("meetings-state:CA/ingest.ts");
  host.transact(state => assert.equal(state.reservations[0].peak, CALENDAR_READ_PEAK_MIB * mib), false);
  release();
  host.transact(state => { state.peaks = { "calendar-read": [400 * mib], "ingest.ts": [3000 * mib] }; }, false);
  release = await slots.acquire("meetings-state:WY/ingest.ts");
  host.transact(state => assert.equal(state.reservations[0].peak, 420 * mib, "the measured calendar read, 5% over"), false);
  release();
});

test("the runner admits its door-publication and federal-split children through host memory like every source child", () => {
  const runner = readFileSync("scripts/routine-civic-data-runner.mts", "utf8");
  assert.ok(runner.indexOf("const routineMemorySlots = routineProcessSlots();") < runner.indexOf('"scripts/publish-meeting-doors.mts"'));
  assert.equal((runner.match(/onStarting: command => acquireChildMemory\(command(?:, \[\], deadlineMs)?\), onSettled: run => releaseChildMemory\(run\.id\)/g) ?? []).length, 2);
});
