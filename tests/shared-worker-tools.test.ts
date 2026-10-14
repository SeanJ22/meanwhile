import assert from "node:assert/strict";
import test from "node:test";
import { sharedScoutBrowser, browseWithPlaywright } from "../scripts/scout-browse.mts";
import type { GuardedBrowser } from "../scripts/browser.mts";
import { startWorkerToolsHost } from "../lib/control-plane/workers/process-pool.ts";
import { newFieldManualEntry, readFieldManual, writeFieldManual } from "../lib/control-plane/field-manual.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { availableWorkerMemoryBytes, measuredReservationBytes, routineProcessSlots, workerProcessSlots, workerMemoryHost, NATIONAL_PLACE_PEAK_MIB, WORKER_ENTRY_PEAK_MIB } from "../lib/control-plane/workers/worker-slots.ts";
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
    const rows = JSON.stringify([{ ProcessId: process.pid, ParentProcessId: process.ppid, WorkingSetSize: 200 * 1024 }]);
    const status = `PPid:\t${process.ppid}\nVmRSS:\t200 kB\n`;
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

test("capacity closed during an asynchronous host read cannot admit queued children", async () => {
  let capacity = 20;
  const host = workerMemoryHost({ processes: async () => { await yieldToEventLoop(); capacity = 0; return []; } });
  const slots = workerProcessSlots(() => capacity, { host, availableBytes: () => 1000, headroomBytes: 100, peakBytes: () => 300 });
  await assert.rejects(slots.acquire(), /LEASE_WORKER_CAPACITY_INVALID/);
  host.transact(state => { assert.equal(state.reservations.length, 0); }, false);
});

test("a nested research parent keeps only its inherited reservation after the fresh sample", async () => {
  const host = workerMemoryHost({ processes: () => [{ pid: process.pid, parentPid: process.ppid, rss: 200 }] });
  host.transact(state => { state.reservations.push({ id: "ancestor", owner: process.ppid, pid: process.pid, peak: 600, entry: "ancestor" }); }, false);
  const slots = workerProcessSlots(() => 20, { host, parentPeakBytes: 400, availableBytes: () => 0, headroomBytes: 100, peakBytes: () => 600 });
  const release = await slots.acquire();
  host.transact(state => { assert.equal(state.parents.some(parent => parent.pid === process.pid), false); assert.equal(state.reservations.length, 1); }, false);
  release();
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
  const slots = routineProcessSlots({ availableBytes: () => (768 + WORKER_ENTRY_PEAK_MIB.national!) * mib });
  const first = await slots.acquire("worker-publication:ballot-navigation:one/promote-manual-civic-projection.mts");
  await assert.rejects(slots.acquire("worker-publication:ballot-navigation:two/promote-manual-civic-projection.mts", Date.now() + 25), /WORKER_MEMORY_DEADLINE/);
  first();
  const census = routineProcessSlots({ availableBytes: () => (768 + 1199) * mib });
  await assert.rejects(census.acquire("census-geography/census-geography-refresh.mts", Date.now() + 25), /WORKER_MEMORY_DEADLINE/);
  const ordinary = await census.acquire("reader:meeting/ordinary-source.mts"); ordinary();
  const small = routineProcessSlots({ availableBytes: () => (768 + 342) * mib });
  for (const entry of ["meetings:any/ingest.ts", "az-money/state-money-az.mts", "nh-money/state-money-nh.mts", "nj-rollcalls/state-rollcalls.mts"]) {
    await assert.rejects(small.acquire(entry, Date.now() + 25), /WORKER_MEMORY_DEADLINE/);
  }
});

test("legacy registry roster publications reserve their measured RSS and queue until memory is released", async () => {
  // Roster publication runs alone on either host while keeping its measured peak.
  for (const [availableMiB, expected] of [[8192 - 1024, 1], [2 * 4012 + 768, 1]] as const) {
    const slots = routineProcessSlots({ availableBytes: () => availableMiB * 1024 * 1024 });
    const entries = ["worker-publication:registry-runtime-bindings:roster-one",
      "worker-publication:registry-runtime-bindings:directory-two",
      "worker-publication:registry-runtime-bindings:roster-three", "registry-runtime-bindings"];
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
  const ordinary = routineProcessSlots({ availableBytes: () => (768 + 342) * mib });
  const release = await ordinary.acquire("meetings:ordinary", Date.now() + 100);
  release();
  let free = 3000 * mib;
  const slots = routineProcessSlots({ availableBytes: () => free });
  let rosterStarted = false;
  const roster = slots.acquire("registry-runtime-bindings", Date.now() + 2000).then(release => { rosterStarted = true; return release; });
  const small = await slots.acquire("meetings:small", Date.now() + 100);
  assert.equal(rosterStarted, false); small();
  free = (768 + 4012) * mib;
  const large = await roster;
  assert.equal(rosterStarted, true, "the roster runs alone once memory can fit it");
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
  const rows = [{ pid: 100001, parentPid: process.pid, rss: 300 }, { pid: 100002, parentPid: process.pid, rss: 300 }];
  let free = 1000;
  const host = workerMemoryHost({ processes: () => rows });
  const slots = workerProcessSlots(() => 10, { host, availableBytes: () => free, headroomBytes: 100, peakBytes: () => 300 });
  const one = await slots.acquire(); one.observe!(100001); free = 700;
  const two = await slots.acquire(); two.observe!(100002); free = 400;
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
  const host = workerMemoryHost({ processes: () => [{ pid: process.pid, parentPid: process.ppid, rss: 1024 * mib }] });
  const memory = { host, availableBytes: () => (8192 - 1024) * mib, parentPeakBytes: 2928 * mib };
  const research = workerProcessSlots(() => 20, memory);
  const routine = routineProcessSlots(memory);
  const admitted = new Map<number, () => void>();
  let simultaneous = 0, routineOverlap = 0;
  const offers = Array.from({ length: 20 }, (_, id) => research.acquire("scout-worker.ts", Date.now() + 2000).then(release => {
    admitted.set(id, release); simultaneous = Math.max(simultaneous, admitted.size);
    assert.ok(2928 + 768 + admitted.size * 248 + (routineOverlap ? 342 : 0) <= 8192);
  }));
  let routineDone: (() => void) | undefined;
  const pass = routine.acquire("meetings:ordinary", Date.now() + 2000).then(release => {
    routineDone = release; routineOverlap = admitted.size;
    assert.ok(2928 + 768 + admitted.size * 248 + 342 <= 8192);
  });
  await yieldToEventLoop();
  assert.equal(admitted.size, 18);
  for (let id = 0; id < 20; id++) {
    await offers[id];
    admitted.get(id)!(); admitted.delete(id);
    await yieldToEventLoop();
    if (id === 3) await pass;
  }
  await pass;
  routineDone!();
  assert.equal(simultaneous, 18);
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
  host.transact(state => { state.peaks = { "national-people-refresh.mts": [1.1e9, crashed, 1.2e9] }; }, false);
  let free = crashed + 768 * mib;
  const slots = routineProcessSlots({ host, availableBytes: () => free });
  const people = "people-wikidata-people-ca/national-people-refresh.mts";
  await assert.rejects(slots.acquire(people, Date.now() + 25), /WORKER_MEMORY_DEADLINE/,
    "the 1,258 MiB table value would fit; the measured 3.57 GB does not");
  free = measuredReservationBytes([crashed]) + 768 * mib;
  const release = await slots.acquire(people, Date.now() + 100);
  host.transact(state => { assert.ok(state.reservations[0]!.peak >= crashed); }, false);
  release();
  free = Number.MAX_SAFE_INTEGER;
  const votes = await slots.acquire("openstates-votes-ca/openstates-votes-refresh.mts");
  host.transact(state => { assert.equal(state.reservations[0]!.peak, 3072 * mib); }, false);
  votes();
});

test("a running child's high-water memory is sampled, raises its live reservation and sets the next one", { skip: process.platform !== "linux" }, async () => {
  const mib = 1024 * 1024;
  const host = workerMemoryHost({ processes: () => [] });
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
  host.transact(state => { recorded = state.peaks?.["peak-probe.mts"] ?? []; }, false);
  assert.equal(recorded.length, 1);
  assert.ok(recorded[0]! >= 160 * mib);
  const next = await slots.acquire("probe/peak-probe.mts");
  host.transact(state => { assert.equal(state.reservations[0]!.peak, measuredReservationBytes(recorded)); }, false);
  next();
});
