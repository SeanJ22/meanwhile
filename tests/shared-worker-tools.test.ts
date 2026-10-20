import assert from "node:assert/strict";
import test from "node:test";
import { sharedScoutBrowser, browseWithPlaywright } from "../scripts/scout-browse.mts";
import type { GuardedBrowser } from "../scripts/browser.mts";
import { startWorkerToolsHost } from "../lib/control-plane/workers/process-pool.ts";
import { newFieldManualEntry, readFieldManual, writeFieldManual } from "../lib/control-plane/field-manual.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { availableWorkerMemoryBytes, workerMemoryPeakKey, routineProcessSlots, workerProcessSlots, workerMemoryHost, memoryReading, NATIONAL_PLACE_PEAK_MIB, RESEARCH_PARENT_PEAK_MIB, WORKER_ENTRY_PEAK_MIB, ROUTINE_ENTRY_PEAK_MIB, RUNNER_PARENT_PEAK_MIB } from "../lib/control-plane/workers/worker-slots.ts";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fork, spawn, type ChildProcess } from "node:child_process";
import { pathToFileURL } from "node:url";
import { once } from "node:events";
import { setImmediate as yieldToEventLoop } from "node:timers/promises";
import { writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import ts from "typescript";

/* A measured child reserves its high-water peak, 5% over, rounded up to a whole MiB. */
const reservedFor = (peaks: readonly number[]) => Math.ceil(Math.max(...peaks) * 1.05 / 1048576) * 1048576;

test("Linux zombies cannot retain parent or child memory reservations even while kill(pid,0) succeeds", () => {
  const nativeRequire = createRequire(import.meta.url);
  const source = ts.transpileModule(readFileSync(new URL("../lib/control-plane/workers/worker-slots.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loaded: Record<string, unknown> = {};
  const states: Record<number, string> = { 1001: "S", 1002: "Z", 1003: "X" };
  const mockProcess = Object.create(process) as typeof process;
  mockProcess.kill = () => true;
  runInNewContext(source, { exports: loaded, process: mockProcess, console, Buffer, setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask,
    require: (name: string) => {
      if (name === "node:os") return { ...nativeRequire(name), platform: () => "linux" };
      if (name === "node:fs") return { ...nativeRequire(name), readFileSync: (path: string) => {
        const match = /^\/proc\/(\d+)\/stat$/.exec(path);
        if (match) return `${match[1]} (worker (old) name) ${states[Number(match[1])]} 1 0`;
        return nativeRequire(name).readFileSync(path, "utf8");
      } };
      return nativeRequire(name);
    } });
  const host = (loaded.workerMemoryHost as typeof workerMemoryHost)({ processes: () => [] });
  host.transact(state => {
    state.parents.push({ pid: 1002, peak: 7e9 });
    state.reservations.push({ id: "zombie", owner: 1002, pid: 1003, peak: 7e9, entry: "lease-worker.ts" },
      { id: "surviving-child", owner: 1002, pid: 1001, peak: 1024, entry: "lease-worker.ts" });
  }, false);
  host.transact(state => {
    assert.equal(state.parents.length, 0);
    assert.equal(state.reservations.length, 1);
    assert.equal(state.reservations[0]?.id, "surviving-child");
  }, false);
});

test("Windows and Linux process probes leave timers and the host lock available", async context => {
  const nativeRequire = createRequire(import.meta.url);
  const nativeFS = nativeRequire("node:fs") as typeof import("node:fs");
  const source = ts.transpileModule(readFileSync(new URL("../lib/control-plane/workers/worker-slots.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  for (const operatingSystem of ["win32", "linux"] as const) await context.test(operatingSystem, async () => {
    const root = await mkdtemp(join(tmpdir(), "s18-process-probe-"));
    let probing = false, metadataDuringProbe = false, samples = 0;
    const locksAtProbe: boolean[] = [];
    const rows = JSON.stringify([{ ProcessId: process.pid, ParentProcessId: process.ppid, WorkingSetSize: 200 * 1024, PeakWorkingSetSize: 500 }]);
    const status = `PPid:\t${process.ppid}\nVmRSS:\t200 kB\nVmHWM:\t500 kB\n`;
    const beginProbe = () => { samples++; probing = true; locksAtProbe.push(existsSync(join(root, "meanwhile-worker-memory.json.lock"))); };
    const finishProbe = () => { probing = false; };
    const waitForProbe = async () => { beginProbe(); await new Promise(resolve => setTimeout(resolve, 75)); finishProbe(); };
    const syncProbe = () => { beginProbe(); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 75); finishProbe(); };
    const loaded: Record<string, unknown> = {};
    runInNewContext(source, { exports: loaded, require: (name: string) => {
      if (name === "node:os") return { ...nativeRequire(name), platform: () => operatingSystem, tmpdir: () => root };
      if (name === "node:child_process") return { ...nativeRequire(name),
        execFileSync: () => { syncProbe(); return rows; },
        execFile: (_file: string, _args: string[], options: { windowsHide: boolean; timeout: number }, callback: (error: null, stdout: string) => void) => {
          assert.equal(options.windowsHide, true); assert.equal(options.timeout, 5000);
          void waitForProbe().then(() => callback(null, rows));
        } };
      if (name === "node:fs") return { ...nativeFS,
        readdirSync: (path: string) => { if (path === "/proc") { syncProbe(); return [String(process.pid)]; } return nativeFS.readdirSync(path); },
        readFileSync: (path: string, options: "utf8") => path.startsWith("/proc/") ? status : nativeFS.readFileSync(path, options) };
      if (name === "node:fs/promises") return { ...nativeRequire(name),
        readdir: async (path: string) => { assert.equal(path, "/proc"); await waitForProbe(); return [String(process.pid)]; },
        readFile: async (path: string) => { assert.equal(path, `/proc/${process.pid}/status`); return status; } };
      return nativeRequire(name);
    }, process, console, Buffer, setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask });
    const loadedSlots = loaded as { workerMemoryHost: typeof workerMemoryHost; workerProcessSlots: typeof workerProcessSlots };
    const host = loadedSlots.workerMemoryHost({ shared: true });
    const slots = loadedSlots.workerProcessSlots(() => 20, { host, availableBytes: () => 1000 * 1024,
      parentPeakBytes: 300 * 1024, headroomBytes: 100 * 1024, peakBytes: () => 30 * 1024 });
    let parentReserved = false;
    host.transact(state => { parentReserved = state.parents.some(parent => parent.pid === process.pid && parent.peak === 300 * 1024); }, false);
    assert.equal(parentReserved, true, "parent growth is registered before any asynchronous sample");
    const heartbeat = new Promise<void>(resolve => setTimeout(() => {
      host.transact(() => { metadataDuringProbe = probing; }, false); resolve();
    }, 10));
    try {
      const releases = await Promise.all(Array.from({ length: 20 }, () => slots.acquire("scout-worker.ts", Date.now() + 2000)));
      host.transact(state => { assert.equal(state.parents.find(parent => parent.pid === process.pid)?.peak, 500 * 1024,
        "a short high-water spike raises the parent floor even after current RSS has fallen"); }, false);
      releases.forEach(release => release());
      await heartbeat;
      assert.equal(metadataDuringProbe, true, "unrelated timers and metadata updates run before the OS probe returns");
      assert.deepEqual(locksAtProbe, [false], "one fresh sample serves the burst and holds no shared lock");
      assert.equal(samples, 1);
    } finally { await yieldToEventLoop(); await rm(root, { recursive: true, force: true }); }
  });
});

test("memory deadlines settle while an asynchronous host sample is still pending", async () => {
  let finishSample!: (rows: readonly { pid: number; parentPid: number; rss: number }[]) => void;
  let sampled = false;
  const host = workerMemoryHost({ processes: () => new Promise(resolve => { finishSample = rows => { sampled = true; resolve(rows); }; }) });
  const slots = workerProcessSlots(() => 20, { host, availableBytes: () => 1000, headroomBytes: 100, peakBytes: () => 300 });
  const fallback = setTimeout(() => finishSample([]), 200);
  try {
    await assert.rejects(slots.acquire("scout-worker.ts", Date.now() + 25), /WORKER_MEMORY_DEADLINE/);
    assert.equal(sampled, false, "the queued deadline does not wait for the OS read");
  } finally { clearTimeout(fallback); finishSample([]); await yieldToEventLoop(); }
});

test("concurrent observers share one pending host process sample", async () => {
  let samples = 0, updates = 0;
  const host = workerMemoryHost({ processes: async () => { samples++; await yieldToEventLoop(); return []; } });
  await Promise.all(Array.from({ length: 20 }, () => host.transact(() => { updates++; })));
  assert.equal(samples, 1); assert.equal(updates, 20);
});

test("capacity closed during an asynchronous host read cannot admit queued children", async () => {
  let capacity = 20;
  const host = workerMemoryHost({ processes: async () => { await yieldToEventLoop(); capacity = 0; return []; } });
  const slots = workerProcessSlots(() => capacity, { host, availableBytes: () => 1000, headroomBytes: 100, peakBytes: () => 300 });
  await assert.rejects(slots.acquire(), /LEASE_WORKER_CAPACITY_INVALID/);
  host.transact(state => { assert.equal(state.reservations.length, 0); }, false);
});

test("a nested parent must reserve each child at the margin, even inside an admitted process", async () => {
  const host = workerMemoryHost({ processes: () => [{ pid: process.pid, parentPid: process.ppid, rss: 200 }] });
  host.transact(state => { state.reservations.push({ id: "ancestor", owner: process.ppid, pid: process.pid, peak: 600, entry: "ancestor" }); }, false);
  let free = 0;
  const slots = workerProcessSlots(() => 20, { host, parentPeakBytes: 400, availableBytes: () => free, headroomBytes: 100, peakBytes: () => 600 });
  await assert.rejects(slots.acquire(undefined, Date.now() + 25), /WORKER_MEMORY_DEADLINE/);
  free = 1100; // Parent's remaining 400, the new child's 600, and the 100 margin.
  const release = await slots.acquire(undefined, Date.now() + 500);
  host.transact(state => { assert.equal(state.parents.some(parent => parent.pid === process.pid), false); assert.equal(state.reservations.length, 2); }, false);
  release();
});

test("nested reservations count exclusive process memory in admission and the heartbeat", async () => {
  const rows = [{ pid: process.pid, parentPid: process.ppid, rss: 200 },
    { pid: 100001, parentPid: process.pid, rss: 300 }, { pid: 100002, parentPid: 100001, rss: 100 }];
  const host = workerMemoryHost({ processes: () => rows });
  host.transact(state => { state.reservations = [
    { id: "parent", owner: process.ppid, pid: process.pid, peak: 600, entry: "promoter" },
    { id: "child", owner: process.pid, pid: 100001, peak: 500, entry: "national" },
  ]; }, false);
  let free = 899;
  const slots = workerProcessSlots(() => 20, { host, availableBytes: () => free, headroomBytes: 100, peakBytes: () => 300 });
  await assert.rejects(slots.acquire("next", Date.now() + 25), /WORKER_MEMORY_DEADLINE/);
  host.transact(state => {
    const reading = memoryReading({ at: "2026-10-20T00:00:00Z", rows, state, totalBytes: 2000, availableBytes: free,
      rootPid: process.pid, headroomBytes: 100, leaseWorkerPeakBytes: 300 });
    assert.deepEqual(reading.reservations.map(row => row.rssBytes), [200, 400]);
    assert.equal(reading.runnerTreeRssBytes, 600);
    assert.equal(reading.reservedGrowthBytes, 500);
    assert.equal(reading.fitLeaseWorkers, 0);
  }, false);
  free = 900;
  const release = await slots.acquire("next", Date.now() + 500);
  release();
});

test("heartbeat capacity includes every managed process under a configured host memory limit", async () => {
  const nativeRequire = createRequire(import.meta.url), mib = 1048576;
  const source = ts.transpileModule(readFileSync(new URL("../lib/control-plane/workers/worker-slots.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const rows = [{ pid: process.pid, parent: process.ppid, rss: 200 }, { pid: 100001, parent: process.pid, rss: 300 },
    { pid: 100002, parent: 1, rss: 400 }];
  const state = { parents: [{ pid: process.pid, peak: 300 * mib }, { pid: 100002, peak: 500 * mib }],
    reservations: [{ id: "child", owner: process.pid, pid: 100001, peak: 400 * mib, entry: "lease-worker.ts" }] };
  const mockProcess = Object.create(process) as typeof process;
  mockProcess.env = { ...process.env, WTP_WORKER_HOST_MEMORY_MIB: "2048" };
  mockProcess.kill = () => true;
  const loaded: Record<string, unknown> = {};
  runInNewContext(source, { exports: loaded, process: mockProcess, console, Buffer, setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask,
    require: (name: string) => {
      if (name === "node:os") return { ...nativeRequire(name), platform: () => "linux", freemem: () => 4096 * mib };
      if (name === "node:fs/promises") return { ...nativeRequire(name), readdir: async () => rows.map(row => String(row.pid)) };
      if (name === "node:fs") return { ...nativeRequire(name), readFileSync: (path: string) => {
        if (path.endsWith("meanwhile-worker-memory.json")) return JSON.stringify(state);
        const found = /^\/proc\/(\d+)\/(status|stat)$/.exec(path);
        if (found?.[2] === "stat") return `${found[1]} (worker) S 1 0`;
        if (found) { const row = rows.find(row => row.pid === Number(found[1]))!; return `PPid:\t${row.parent}\nVmRSS:\t${row.rss * 1024} kB\n`; }
        return nativeRequire(name).readFileSync(path, "utf8");
      } };
      return nativeRequire(name);
    } });
  const reading = await (loaded.hostMemoryReading as typeof import("../lib/control-plane/workers/worker-slots.ts").hostMemoryReading)();
  assert.equal(reading.availableBytes, (2048 - 900) * mib);
  assert.equal(reading.runnerTreeRssBytes, 500 * mib);
  assert.equal(reading.reservedGrowthBytes, 300 * mib);
  assert.equal(reading.fitLeaseWorkers, 0);
});

test("small runs cannot lower any script's known peak or admit an extra money job", async () => {
  const mib = 1048576;
  for (const [script, peak] of Object.entries(ROUTINE_ENTRY_PEAK_MIB)) {
    const host = workerMemoryHost({ processes: () => [] });
    host.transact(state => { state.peaks = { [workerMemoryPeakKey(script)!]: Array(5).fill(20 * mib) }; }, false);
    const slots = routineProcessSlots({ host, availableBytes: () => (768 + 2 * peak) * mib - 1 });
    const first = await slots.acquire(`one/${script}`, Date.now() + 500);
    await assert.rejects(slots.acquire(`two/${script}`, Date.now() + 25), /WORKER_MEMORY_DEADLINE/, script);
    first();
  }
  const host = workerMemoryHost({ processes: () => [] });
  const slots = routineProcessSlots({ host, availableBytes: () => Number.MAX_SAFE_INTEGER });
  const release = await slots.acquire("national-place:85701/promote-registry-runtime.mts");
  host.transact(state => assert.equal(state.reservations[0]!.peak, NATIONAL_PLACE_PEAK_MIB * mib), false);
  release();
});

test("runtime parents and publication-prefixed commands retain the actual executable's peak", async () => {
  const mib = 1048576;
  const entries = [
    ...Object.entries(RUNNER_PARENT_PEAK_MIB).map(([script, peak]) => [`runtime/${script}`, peak] as const),
    ["voting-sites:AZ/fetch-voting-sites.mts", ROUTINE_ENTRY_PEAK_MIB["fetch-voting-sites.mts"]!] as const,
    ["candidate-profiles:AZ/national-people-refresh.mts", ROUTINE_ENTRY_PEAK_MIB["national-people-refresh.mts"]!] as const,
  ];
  for (const [entry, peak] of entries) {
    const host = workerMemoryHost({ processes: () => [] });
    const slots = routineProcessSlots({ host, availableBytes: () => (768 + peak) * mib - 1 });
    await assert.rejects(slots.acquire(entry, Date.now() + 25), /WORKER_MEMORY_DEADLINE/, entry);
  }
});

test("parent and nested job high-water growth includes their own unmanaged children exactly once", async () => {
  const rows = [{ pid: process.pid, parentPid: process.ppid, rss: 200, peakRss: 600 },
    { pid: 100001, parentPid: process.pid, rss: 300, peakRss: 900 },
    { pid: 100002, parentPid: 100001, rss: 100, peakRss: 120 },
    { pid: 100003, parentPid: process.pid, rss: 100, peakRss: 150 }];
  const host = workerMemoryHost({ processes: () => rows });
  host.transact(state => {
    state.parents.push({ pid: process.pid, peak: 400 });
    state.reservations.push({ id: "nested", owner: process.pid, pid: 100001, peak: 500, entry: "nested-job" });
  }, false);
  let free = 1469;
  const slots = workerProcessSlots(() => 10, { host, parentPeakBytes: 400, availableBytes: () => free, headroomBytes: 100, peakBytes: () => 300 });
  await assert.rejects(slots.acquire("next-job", Date.now() + 25), /WORKER_MEMORY_DEADLINE/);
  host.transact(state => {
    assert.equal(state.parents[0]?.peak, 750); assert.equal(state.reservations[0]?.peak, 1020);
    const reading = memoryReading({ at: "2026-10-20T00:00:00Z", rows, state, totalBytes: 2500, availableBytes: free,
      rootPid: process.pid, headroomBytes: 100, leaseWorkerPeakBytes: 300 });
    assert.equal(reading.parents[0]?.rssBytes, 300); assert.equal(reading.reservations[0]?.rssBytes, 400);
    assert.equal(reading.reservedGrowthBytes, 1070); assert.equal(reading.fitLeaseWorkers, 0);
  }, false);
  free = 1470;
  const release = await slots.acquire("next-job", Date.now() + 500); release();
});

test("independent parent samples retain full growth before PID binding and transfer only the proved child tree", async () => {
  const nativeRequire = createRequire(import.meta.url), mib = 1048576;
  const root = await mkdtemp(join(tmpdir(), "s18-binding-race-"));
  const source = ts.transpileModule(readFileSync(new URL("../lib/control-plane/workers/worker-slots.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  type SlotsModule = { workerMemoryHost: typeof workerMemoryHost; workerProcessSlots: typeof workerProcessSlots;
    memoryReading: typeof memoryReading; workerMemoryPeakKey: typeof workerMemoryPeakKey };
  const loadParent = (pid: number): SlotsModule => {
    const loaded: Record<string, unknown> = {}, parentProcess = Object.create(process) as typeof process;
    Object.defineProperty(parentProcess, "pid", { value: pid });
    parentProcess.kill = () => true;
    parentProcess.env = { ...process.env, WTP_WORKER_MEMORY_RELEASE: "binding-race" };
    delete parentProcess.env.WTP_WORKER_HOST_MEMORY_MIB;
    runInNewContext(source, { exports: loaded, process: parentProcess, console, Buffer,
      setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask,
      require: (name: string) => name === "node:os" ? { ...nativeRequire(name), platform: () => "win32", tmpdir: () => root } : nativeRequire(name),
    });
    return loaded as unknown as SlotsModule;
  };
  const first = loadParent(100000), second = loadParent(100010);
  let rows = [{ pid: 100000, parentPid: 1, rss: 200 * mib, peakRss: 200 * mib },
    { pid: 100010, parentPid: 1, rss: 100 * mib, peakRss: 100 * mib }];
  const host = first.workerMemoryHost({ shared: true, processes: () => rows });
  let bindingBlocked = false;
  const delayedHost: typeof host = { transact: (operation, sample) => bindingBlocked ? false : host.transact(operation, sample) };
  const otherHost = second.workerMemoryHost({ shared: true, processes: () => rows });
  const memory = { availableBytes: () => 5000 * mib, headroomBytes: 768 * mib };
  const ownSlots = first.workerProcessSlots(() => 10, { ...memory, host: delayedHost, parentPeakBytes: 250 * mib, peakBytes: () => 800 * mib });
  const otherSlots = second.workerProcessSlots(() => 10, { ...memory, host: otherHost, parentPeakBytes: 150 * mib, peakBytes: () => 300 * mib });
  const releases: (() => void)[] = [];
  try {
    const child = await ownSlots.acquire("managed-child.mts"); releases.push(child);
    rows.push({ pid: 100001, parentPid: 100000, rss: 700 * mib, peakRss: 900 * mib },
      { pid: 100002, parentPid: 100000, rss: 40 * mib, peakRss: 150 * mib },
      { pid: 100003, parentPid: 100001, rss: 20 * mib, peakRss: 80 * mib });
    const beforeBinding = await otherSlots.acquire("before-spawn-callback"); releases.push(beforeBinding);
    otherHost.transact(state => {
      const parent = state.parents.find(row => row.pid === 100000)!;
      assert.equal(parent.peak, 250 * mib, "an unclassified child is not committed as the parent's permanent peak");
      const reading = second.memoryReading({ at: "2026-10-20T00:00:00Z", totalBytes: 8192 * mib, availableBytes: 5000 * mib,
        rootPid: 100000, rows, state });
      assert.equal(reading.parents.find(row => row.pid === 100000)?.peakBytes, 1330 * mib,
        "the complete own, child, and both unmanaged-browser high waters remain reserved before proof");
      assert.equal(reading.headroomBytes, 768 * mib);
    }, false);
    for (let index = 1; index <= 8; index++) {
      rows = rows.map(row => row.pid === 100001 ? { ...row, peakRss: (900 + index) * mib } : row);
      const raised = await otherSlots.acquire("same-topology-new-high-water"); releases.push(raised); raised();
    }
    otherHost.transact(state => {
      assert.equal(state.parents.find(row => row.pid === 100000)?.pendingPeaks?.length, 1,
        "changing VmHWM within one PID/parent topology coalesces instead of retaining poll history");
    }, false);
    rows = rows.filter(row => row.pid !== 100002 && row.pid !== 100003);
    bindingBlocked = true;
    child.observe!(100001);
    const duringBinding = await otherSlots.acquire("while-observe-lock-busy"); releases.push(duringBinding);
    otherHost.transact(state => {
      assert.equal(state.reservations.find(row => row.entry === "managed-child.mts")?.pid, null);
      assert.equal(state.parents.find(row => row.pid === 100000)?.peak, 250 * mib);
      assert.equal(state.parents.find(row => row.pid === 100000)?.pendingPeaks?.length, 2,
        "a changed browser topology preserves its earlier proved memory rather than replacing that observation");
    }, false);
    bindingBlocked = false;
    await new Promise(resolve => setTimeout(resolve, 80));
    beforeBinding(); duringBinding();
    otherHost.transact(state => {
      const parent = state.parents.find(row => row.pid === 100000)!;
      const admitted = state.reservations.find(row => row.entry === "managed-child.mts")!;
      assert.equal(parent.peak, 350 * mib, "the parent's genuine unmanaged browser remains in its confirmed peak");
      assert.equal(parent.pendingPeaks, undefined);
      assert.equal(admitted.pid, 100001);
      assert.equal(admitted.peak, 988 * mib, "the proved child receives its own peak and its own unmanaged browser");
      assert.equal(admitted.observedPeak, 988 * mib);
    }, false);
    rows = rows.filter(row => row.pid !== 100002 && row.pid !== 100003);
    const later = await otherSlots.acquire("after-browsers-exit"); releases.push(later); later();
    otherHost.transact(state => {
      assert.equal(state.parents.find(row => row.pid === 100000)?.peak, 350 * mib);
      assert.equal(state.reservations.find(row => row.entry === "managed-child.mts")?.peak, 988 * mib);
      const reading = second.memoryReading({ at: "2026-10-20T00:00:01Z", totalBytes: 8192 * mib, availableBytes: 5000 * mib,
        rootPid: 100000, rows, state });
      assert.equal(reading.reservedGrowthBytes, 488 * mib, "real prior browser peaks remain reserved after the browsers exit");
    }, false);
    rows = rows.filter(row => row.pid !== 100001);
    child();
    otherHost.transact(state => {
      assert.equal(state.peaks?.[first.workerMemoryPeakKey("managed-child.mts")!]?.[0], 988 * mib,
        "adaptive script peaks receive the child's corrected observation, never the ancestor's combined tree");
    }, false);
    const unstarted = await ownSlots.acquire("unstarted.mts"); releases.push(unstarted);
    rows.push({ pid: 100004, parentPid: 100000, rss: 20 * mib, peakRss: 180 * mib });
    const sample = await otherSlots.acquire("unmanaged-during-unstarted-offer"); releases.push(sample); sample();
    unstarted();
    otherHost.transact(state => {
      assert.equal(state.parents.find(row => row.pid === 100000)?.peak, 380 * mib,
        "releasing an unstarted offer preserves every unproved process as genuinely unmanaged");
    }, false);
  } finally {
    bindingBlocked = false;
    releases.forEach(release => release());
    await new Promise(resolve => setTimeout(resolve, 80));
    await rm(root, { recursive: true, force: true });
  }
});

test("a process sample returning after child release keeps its proved ownership and genuine browser peaks", async () => {
  const mib = 1048576;
  let rows = [{ pid: process.pid, parentPid: process.ppid, rss: 200 * mib, peakRss: 200 * mib }];
  let holdSample = false, finishSample: ((sampleRows: typeof rows) => void) | undefined;
  const host = workerMemoryHost({ processes: () => holdSample ? new Promise<typeof rows>(resolve => { finishSample = resolve; }) : rows });
  const memory = { host, availableBytes: () => 5000 * mib, headroomBytes: 768 * mib, parentPeakBytes: 250 * mib, peakBytes: () => 300 * mib };
  const own = workerProcessSlots(() => 10, memory), other = workerProcessSlots(() => 10, memory);
  const child = await own.acquire("sampled-child.mts");
  rows.push({ pid: 100001, parentPid: process.pid, rss: 700 * mib, peakRss: 900 * mib },
    { pid: 100002, parentPid: process.pid, rss: 40 * mib, peakRss: 150 * mib });
  child.observe!(100001);
  const before = await other.acquire("before-release"); before();
  holdSample = true;
  const pending = other.acquire("sample-returning-late");
  await yieldToEventLoop();
  assert.ok(finishSample);
  const captured = rows;
  rows = rows.filter(row => row.pid === process.pid);
  child();
  holdSample = false;
  finishSample(captured);
  const release = await pending;
  try {
    host.transact(state => {
      assert.equal(state.parents.find(row => row.pid === process.pid)?.peak, 350 * mib,
        "the exited managed child cannot become a parent's permanent high water, while the real browser peak stays");
    }, false);
  } finally { child(); release(); }
});

test("concurrent workers share a browser and close only their own contexts", async () => {
  let launches = 0, pages = 0, contextsClosed = 0, browsersClosed = 0;
  const browser = sharedScoutBrowser(async () => {
    launches++;
    return { page: async () => {
      pages++;
      let address = "";
      return { on: () => {}, goto: async (url: string) => { address = url; return { status: () => 200 }; },
        waitForLoadState: async () => {}, content: async () => "<body>official</body>", evaluate: async () => "official",
        url: () => address, context: () => ({ close: async () => { contextsClosed++; } }) };
    }, close: async () => { browsersClosed++; } } as unknown as GuardedBrowser;
  });
  const results = await Promise.all(["https://one.gov", "https://two.gov"].map(url => browser.browse({ url, timeoutMs: 1000, holder: "test" })));
  assert.deepEqual(results.map(row => row.finalUrl), ["https://one.gov", "https://two.gov"]);
  assert.equal(launches, 1); assert.equal(pages, 2); assert.equal(contextsClosed, 2); assert.equal(browsersClosed, 0);
  await browser.close(); assert.equal(browsersClosed, 1);
});

test("hosted workers receive their own manual rows and browser observations without reading the manual themselves", async () => {
  const priorUrl = process.env.WTP_WORKER_TOOLS_URL, priorToken = process.env.WTP_WORKER_TOOLS_TOKEN;
  const entry = (state: string) => newFieldManualEntry("test", state || "portable", { role: "SHARED", kind: "REFERENCE",
    title: state, summary: state, outcome: "REFERENCE", states: state ? [state] : [], portable: state === "" });
  const shared = createMemoryRepositories();
  await writeFieldManual(shared, [entry("az"), entry("nj"), entry("")], "2026-10-07T00:00:00.000Z");
  const host = await startWorkerToolsHost({ repos: shared, browse: async input => ({ finalUrl: input.url,
    status: 200, html: "official", text: "official", requests: [], transportError: null, durationMs: 1 }) });
  try {
    const repos = { fieldManual: { slice: async () => { throw new Error("worker must not read the manual itself"); } } };
    const manual = await readFieldManual(repos as never, { state: "az" });
    assert.equal(manual.error, undefined);
    assert.deepEqual(manual.store.entries.map(row => row.states).sort(), [[], ["az"]]);
    assert.equal((await browseWithPlaywright({ url: "https://one.gov", timeoutMs: 1000, holder: "test" })).text, "official");
  } finally {
    await host.close();
    if (priorUrl === undefined) delete process.env.WTP_WORKER_TOOLS_URL; else process.env.WTP_WORKER_TOOLS_URL = priorUrl;
    if (priorToken === undefined) delete process.env.WTP_WORKER_TOOLS_TOKEN; else process.env.WTP_WORKER_TOOLS_TOKEN = priorToken;
  }
});

test("routine sources, reader repairs and catch-up share reservations including the national child", async () => {
  const peak = WORKER_ENTRY_PEAK_MIB.lease! * 1024 * 1024;
  const nationalPeak = NATIONAL_PLACE_PEAK_MIB * 1024 * 1024;
  const slots = routineProcessSlots({ availableBytes: () => nationalPeak + peak + 100, headroomBytes: 100 });
  const national = await slots.acquire("national-place:85635");
  const reader = await slots.acquire("reader:meetings");
  let started = false;
  const catchUp = slots.acquire("meetings:catch-up").then(release => { started = true; return release; });
  await Promise.resolve(); assert.equal(started, false);
  reader(); const release = await catchUp; assert.equal(started, true);
  national(); reader(); release();
});

test("national pairs retain both measured entry peaks and the 768 MiB margin", async () => {
  for (const [availableMiB, expected] of [[2 * NATIONAL_PLACE_PEAK_MIB + 767, 1], [2 * NATIONAL_PLACE_PEAK_MIB + 768, 2]] as const) {
    const slots = routineProcessSlots({ availableBytes: () => availableMiB * 1024 * 1024 });
    const active = await Promise.all(Array.from({ length: expected }, (_, i) => slots.acquire(`national-place:zip-${i}`)));
    let admitted = false;
    const queued = slots.acquire("national-place:next").then(release => { admitted = true; return release; });
    await Promise.resolve();
    assert.equal(admitted, false, `${availableMiB} MiB permits ${expected} jobs with the margin`);
    active[0]!();
    const release = await queued;
    assert.equal(admitted, true);
    for (const done of active) done();
    release();
  }
});

test("all publication siblings and routine script families reserve their measured peak", async () => {
  const mib = 1024 * 1024;
  const slots = routineProcessSlots({ availableBytes: () => (768 + ROUTINE_ENTRY_PEAK_MIB["promote-manual-civic-projection.mts"]!) * mib });
  const first = await slots.acquire("worker-publication:ballot-navigation:one/promote-manual-civic-projection.mts");
  await assert.rejects(slots.acquire("worker-publication:ballot-navigation:two/promote-manual-civic-projection.mts", Date.now() + 25), /WORKER_MEMORY_DEADLINE/);
  first();
  const census = routineProcessSlots({ availableBytes: () => (768 + 1199) * mib });
  await assert.rejects(census.acquire("census-geography/census-geography-refresh.mts", Date.now() + 25), /WORKER_MEMORY_DEADLINE/);
  const ordinary = await census.acquire("reader:meeting/ordinary-source.mts"); ordinary();
  const small = routineProcessSlots({ availableBytes: () => (768 + 341) * mib });
  for (const entry of ["meetings:any/ingest.ts", "az-money/state-money-az.mts", "nh-money/state-money-nh.mts", "nj-rollcalls/state-rollcalls.mts", "campaign-money/state-campaign-finance.mts"]) {
    await assert.rejects(small.acquire(entry, Date.now() + 25), /WORKER_MEMORY_DEADLINE/);
  }
});

test("state registry publications reserve one state and queue until memory is released", async () => {
  const peak = Math.max(512, WORKER_ENTRY_PEAK_MIB.lease!);
  for (const [availableMiB, expected] of [[768 + peak, 1], [768 + 2 * peak, 2]] as const) {
    const slots = routineProcessSlots({ availableBytes: () => availableMiB * 1024 * 1024 });
    const entries = ["worker-publication:registry-runtime:AZ:roster-one",
      "worker-publication:registry-runtime:NH:directory-two",
      "worker-publication:registry-runtime:NJ:roster-three", "registry-runtime:CA"];
    const admitted: string[] = [];
    const offers = entries.map(entry => slots.acquire(entry).then(release => { admitted.push(entry); return release; }));
    await yieldToEventLoop();
    assert.deepEqual(admitted, entries.slice(0, expected), "reserved future RSS protects the 768 MiB margin before publishers grow");
    for (let index = 0; index < entries.length; index++) {
      const release = await offers[index]!;
      release();
      await Promise.resolve();
      assert.ok(admitted.length <= Math.min(entries.length, expected + index + 1));
    }
    assert.deepEqual(admitted, entries, "releasing each publisher wakes all remaining offered work");
  }
});

test("state publishers retain their state-unit floor after small-state measurements", async () => {
  const mib = 1024 * 1024;
  for (const [family, script, measured] of [
    ["ballot-contests", "assemble-ballot-package.mts", 512 * mib],
    ["candidate-profiles", "promote-manual-civic-projection.mts", ROUTINE_ENTRY_PEAK_MIB["promote-manual-civic-projection.mts"]! * mib],
    ["candidate-corpus", "promote-manual-civic-projection.mts", ROUTINE_ENTRY_PEAK_MIB["promote-manual-civic-projection.mts"]! * mib],
    ["voting-sites", "fetch-voting-sites.mts", ROUTINE_ENTRY_PEAK_MIB["fetch-voting-sites.mts"]! * mib],
    ["candidate-campaign-sites-derived", "derive-candidate-campaign-sites.mts", 512 * mib],
  ] as const) {
    const host = workerMemoryHost({ processes: () => [] });
    host.transact(state => { state.peaks = { [workerMemoryPeakKey(script)!]: Array(5).fill(200 * mib) }; }, false);
    const slots = routineProcessSlots({ host, availableBytes: () => 2 * measured + 768 * mib - 1 });
    const task = family === "candidate-profiles" ? `candidate-findings:${family}` : family;
    const first = await slots.acquire(`${task}:IL/${script}`, Date.now() + 500);
    host.transact(state => assert.ok(state.reservations[0]!.peak >= measured), false);
    await assert.rejects(slots.acquire(`worker-publication:${family}:TX:next/${script}`, Date.now() + 25), /WORKER_MEMORY_DEADLINE/);
    first();
    const next = await slots.acquire(`worker-publication:${family}:TX:next/${script}`, Date.now() + 500);
    next();
  }
});


test("OS-free memory reserves only unreached child peaks and the research parent's growth", async () => {
  let childRss = 0;
  const host = workerMemoryHost({ processes: () => [
    { pid: process.pid, parentPid: process.ppid, rss: 200 },
    { pid: 100001, parentPid: process.pid, rss: childRss },
  ] });
  const slots = workerProcessSlots(() => 10, { host, availableBytes: () => 1000 - childRss,
    parentPeakBytes: 400, headroomBytes: 100, peakBytes: () => 300 });
  const first = await slots.acquire(); first.observe!(100001);
  childRss = 300;
  const second = await slots.acquire();
  let thirdStarted = false;
  const third = slots.acquire(undefined, Date.now() + 1000).then(release => { thirdStarted = true; return release; });
  await Promise.resolve(); assert.equal(thirdStarted, false, "unreached second-child and parent growth still reserve memory");
  second(); const release = await third;
  assert.equal(thirdStarted, true);
  first(); release();
});

test("a routine child uses the lease peak and a large queue head does not block smaller work", async () => {
  const mib = 1024 * 1024;
  const lease = WORKER_ENTRY_PEAK_MIB.lease!;
  const registry = ROUTINE_ENTRY_PEAK_MIB["promote-registry-runtime.mts"]!;
  const ordinary = routineProcessSlots({ availableBytes: () => (768 + lease) * mib });
  const release = await ordinary.acquire("meetings:ordinary", Date.now() + 100);
  release();
  let free = (768 + lease) * mib;
  const slots = routineProcessSlots({ availableBytes: () => free });
  let rosterStarted = false;
  const roster = slots.acquire("registry-runtime:AZ/promote-registry-runtime.mts", Date.now() + 2000).then(release => { rosterStarted = true; return release; });
  const small = await slots.acquire("meetings:small", Date.now() + 100);
  assert.equal(rosterStarted, false); small();
  free = (768 + registry) * mib;
  const large = await roster;
  assert.equal(rosterStarted, true, "the state roster runs once its executable's reservation fits");
  large();
});

test("research and routine pools use one host budget, and memory waits expire without claiming work", async () => {
  const host = workerMemoryHost({ processes: () => [] });
  const memory = { host, availableBytes: () => 1000, headroomBytes: 100, peakBytes: () => 600 };
  const research = workerProcessSlots(() => 10, memory);
  const routine = routineProcessSlots(memory);
  const active = await research.acquire();
  await assert.rejects(routine.acquire("routine", Date.now() + 25), /WORKER_MEMORY_DEADLINE/);
  active();
  const next = await routine.acquire("routine", Date.now() + 100);
  next();
});

test("research parent growth is reserved before its first worker asks for admission", async () => {
  const host = workerMemoryHost({ processes: () => [] });
  const memory = { host, availableBytes: () => 1000, headroomBytes: 100, peakBytes: () => 600 };
  workerProcessSlots(() => 10, { ...memory, parentPeakBytes: 400 });
  const routine = routineProcessSlots(memory);
  const result = await routine.acquire("routine", Date.now() + 25).then(release => { release(); return "admitted"; },
    error => { assert.match(error.message, /WORKER_MEMORY_DEADLINE/); return "deferred"; });
  assert.equal(result, "deferred", "routine must pay for the research parent's future growth while research is still preparing its queue");
});

test("a burst of queued offers shares one fresh admission sample without blocking child startup", async () => {
  let samples = 0;
  const host = workerMemoryHost({ processes: () => { samples++; return []; } });
  const slots = workerProcessSlots(() => 20, { host, availableBytes: () => 1000, headroomBytes: 100, peakBytes: () => 600 });
  const offers = Array.from({ length: 20 }, () => slots.acquire());
  const first = await offers[0]!;
  try { assert.equal(samples, 1, "waiting siblings must not synchronously resample the host before the admitted child can start"); }
  finally { first(); for (const offer of offers.slice(1)) (await offer)(); }
});

test("children already at their peaks do not reserve their current RSS a second time", async () => {
  const rows: { pid: number; parentPid: number; rss: number }[] = [];
  let free = 1000;
  const host = workerMemoryHost({ processes: () => rows });
  const slots = workerProcessSlots(() => 10, { host, availableBytes: () => free, headroomBytes: 100, peakBytes: () => 300 });
  const one = await slots.acquire(); rows.push({ pid: 100001, parentPid: process.pid, rss: 300 }); one.observe!(100001); free = 700;
  const two = await slots.acquire(); rows.push({ pid: 100002, parentPid: process.pid, rss: 300 }); two.observe!(100002); free = 400;
  const three = await slots.acquire(undefined, Date.now() + 100);
  one(); two(); three();
});

test("independent parent host handles serialize reservations through the same transient file", async () => {
  const root = await mkdtemp(join(tmpdir(), "s18-host-memory-"));
  const prior = { TEMP: process.env.TEMP, TMP: process.env.TMP, TMPDIR: process.env.TMPDIR };
  try {
    Object.assign(process.env, { TEMP: root, TMP: root, TMPDIR: root });
    const memory = { availableBytes: () => 1000, headroomBytes: 100, peakBytes: () => 600 };
    const research = workerProcessSlots(() => 10, { ...memory, host: workerMemoryHost({ shared: true, processes: () => [] }) });
    const routine = routineProcessSlots({ ...memory, host: workerMemoryHost({ shared: true, processes: () => [] }) });
    const active = await research.acquire();
    await assert.rejects(routine.acquire("routine", Date.now() + 25), /WORKER_MEMORY_DEADLINE/);
    active();
    const next = await routine.acquire("routine", Date.now() + 100); next();
  } finally {
    for (const [name, value] of Object.entries(prior)) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
    await rm(root, { recursive: true, force: true });
  }
});

test("separate research and routine parent processes cannot over-admit the shared host", async () => {
  const root = await mkdtemp(join(tmpdir(), "s18-memory-parents-"));
  const children: ChildProcess[] = [];
  try {
    const moduleUrl = pathToFileURL(join(process.cwd(), "lib/control-plane/workers/worker-slots.ts")).href;
    const script = join(root, "parent.mjs");
    await writeFile(script, `import { workerProcessSlots, routineProcessSlots, workerMemoryHost } from ${JSON.stringify(moduleUrl)};
      let release;
      process.on('message', async message => {
        if (message.kind === 'release') { release?.(); process.send({ kind: 'released' }); return; }
        const memory = { availableBytes: () => 1000, headroomBytes: 100, peakBytes: () => 600,
          host: workerMemoryHost({ shared: true, processes: () => [] }) };
        const slots = message.routine ? routineProcessSlots(memory) : workerProcessSlots(() => 10, memory);
        try { release = await slots.acquire('child', Date.now() + message.waitMs); process.send({ kind: 'admitted' }); }
        catch (error) { process.send({ kind: 'deferred', detail: error.message }); }
      });`);
    const start = () => { const child = fork(script, [], { env: { ...process.env, TEMP: root, TMP: root, TMPDIR: root },
      execArgv: ["--experimental-strip-types"], stdio: ["ignore", "ignore", "inherit", "ipc"] }); children.push(child); return child; };
    const offer = async (child: ChildProcess, message: Record<string, string | number | boolean>) => {
      const reply = once(child, "message"); child.send(message);
      return (await reply)[0] as { kind: string; detail?: string };
    };
    const research = start(), routine = start();
    assert.equal((await offer(research, { waitMs: 1000 })).kind, "admitted");
    const blocked = await offer(routine, { waitMs: 100, routine: true });
    assert.equal(blocked.kind, "deferred"); assert.match(blocked.detail!, /WORKER_MEMORY_DEADLINE/);
    assert.equal((await offer(research, { kind: "release" })).kind, "released");
    assert.equal((await offer(routine, { waitMs: 1000, routine: true })).kind, "admitted");
    await offer(routine, { kind: "release" });
  } finally {
    await Promise.all(children.map(async child => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      const ended = once(child, "exit"); child.kill(); await ended;
    }));
    await rm(root, { recursive: true, force: true });
  }
});

test("twenty Scouts and a routine pass finish under one 8 GiB budget without a stuck queue", async () => {
  const mib = 1024 * 1024;
  const lease = WORKER_ENTRY_PEAK_MIB.lease!;
  const scout = WORKER_ENTRY_PEAK_MIB.scout!;
  const parent = RESEARCH_PARENT_PEAK_MIB;
  const host = workerMemoryHost({ processes: () => [{ pid: process.pid, parentPid: process.ppid, rss: 1024 * mib }] });
  const memory = { host, availableBytes: () => (8192 - 1024) * mib, parentPeakBytes: parent * mib };
  const research = workerProcessSlots(() => 20, memory);
  const routine = routineProcessSlots(memory);
  const admitted = new Map<number, () => void>();
  let simultaneous = 0, routineOverlap = 0;
  const offers = Array.from({ length: 20 }, (_, id) => research.acquire("scout-worker.ts", Date.now() + 2000).then(release => {
    admitted.set(id, release); simultaneous = Math.max(simultaneous, admitted.size);
    assert.ok(parent + 768 + admitted.size * scout + (routineDone ? lease : 0) <= 8192);
  }));
  let routineDone: (() => void) | undefined;
  const pass = routine.acquire("meetings:ordinary", Date.now() + 2000).then(release => {
    routineDone = release; routineOverlap = admitted.size;
    assert.ok(parent + 768 + admitted.size * scout + lease <= 8192);
  });
  await yieldToEventLoop();
  const initialScouts = Math.floor((8192 - parent - 768) / scout);
  const scoutsWithRoutine = Math.floor((8192 - parent - 768 - lease) / scout);
  assert.equal(admitted.size, initialScouts);
  for (let id = 0; id < 20; id++) {
    await offers[id];
    admitted.get(id)!(); admitted.delete(id);
    await yieldToEventLoop();
    if (id === 20 - scoutsWithRoutine - 1) await pass;
  }
  await pass;
  routineDone!();
  assert.equal(simultaneous, initialScouts);
  assert.ok(routineOverlap > 0, "the ordinary routine pass overlaps live Scouts");
  assert.equal(admitted.size, 0);
});

test("the staging host size accounts for its already-running parent", () => {
  const prior = process.env.WTP_WORKER_HOST_MEMORY_MIB;
  process.env.WTP_WORKER_HOST_MEMORY_MIB = "1";
  try {
    assert.ok(process.memoryUsage.rss() > 1024 * 1024);
    assert.equal(availableWorkerMemoryBytes(), 0);
  } finally {
    if (prior === undefined) delete process.env.WTP_WORKER_HOST_MEMORY_MIB;
    else process.env.WTP_WORKER_HOST_MEMORY_MIB = prior;
  }
});

test("a script's reservation follows its measured peak, and a never-measured script keeps its table peak", async () => {
  const mib = 1024 * 1024;
  const crashed = 3.57e9;
  const host = workerMemoryHost({ processes: () => [] });
  host.transact(state => { state.peaks = { [workerMemoryPeakKey("national-people-refresh.mts")!]: [1.1e9, crashed, 1.2e9] }; }, false);
  let free = crashed + 768 * mib;
  const slots = routineProcessSlots({ host, availableBytes: () => free });
  const people = "people-wikidata-people-ca/national-people-refresh.mts";
  await assert.rejects(slots.acquire(people, Date.now() + 25), /WORKER_MEMORY_DEADLINE/,
    "the 1,258 MiB table value would fit; the measured 3.57 GB does not");
  free = reservedFor([crashed]) + 768 * mib;
  const release = await slots.acquire(people, Date.now() + 100);
  host.transact(state => { assert.ok(state.reservations[0]!.peak >= crashed); }, false);
  release();
  free = Number.MAX_SAFE_INTEGER;
  const votes = await slots.acquire("openstates-votes-ca/openstates-votes-refresh.mts");
  host.transact(state => { assert.equal(state.reservations[0]!.peak, 3072 * mib); }, false);
  votes();
});

test("adaptive peaks from older code cannot carry a country's former memory hold into a bounded release", async () => {
  const mib = 1024 * 1024;
  const host = workerMemoryHost({ processes: () => [] });
  host.transact(state => { state.peaks = { "lease-worker.ts": [7e9], "old-release:old-table:lease-worker.ts": [7e9] }; }, false);
  const slots = workerProcessSlots(() => 2, { host, availableBytes: () => 768 * mib + 2 * WORKER_ENTRY_PEAK_MIB.lease! * mib });
  const first = await slots.acquire("lease-worker.ts", Date.now() + 500);
  const second = await slots.acquire("lease-worker.ts", Date.now() + 500);
  host.transact(state => assert.ok(state.reservations.every(row => row.peak === WORKER_ENTRY_PEAK_MIB.lease! * mib)), false);
  first(); second();
  host.transact(state => { state.peaks![workerMemoryPeakKey("lease-worker.ts")!] = [7e9]; }, false);
  await assert.rejects(slots.acquire("lease-worker.ts", Date.now() + 25), /WORKER_MEMORY_DEADLINE/,
    "a peak observed on the current code remains binding");
});

test("a running child's high-water memory is sampled, raises its live reservation and sets the next one", { skip: process.platform !== "linux" }, async () => {
  const mib = 1024 * 1024;
  const host = workerMemoryHost();
  const slots = workerProcessSlots(() => 10, { host, availableBytes: () => Number.MAX_SAFE_INTEGER, headroomBytes: 0, peakBytes: () => mib });
  const release = await slots.acquire("probe/peak-probe.mts");
  const child = spawn(process.execPath, ["-e", "const b = Buffer.alloc(160 * 1024 * 1024, 1); setTimeout(() => b.length, 2600)"], { stdio: "ignore" });
  release.observe!(child.pid!);
  await new Promise(resolve => setTimeout(resolve, 2300));
  host.transact(state => { assert.ok(state.reservations[0]!.peak >= 160 * mib, "growth past the reserved peak is reserved"); }, false);
  await once(child, "exit");
  release();
  await yieldToEventLoop();
  let recorded: number[] = [];
  host.transact(state => { recorded = state.peaks?.[workerMemoryPeakKey("peak-probe.mts")!] ?? []; }, false);
  assert.equal(recorded.length, 1);
  assert.ok(recorded[0]! >= 160 * mib);
  const next = await slots.acquire("probe/peak-probe.mts");
  host.transact(state => { assert.equal(state.reservations[0]!.peak, reservedFor(recorded)); }, false);
  next();
});
