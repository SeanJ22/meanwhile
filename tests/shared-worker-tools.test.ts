import assert from "node:assert/strict";
import test from "node:test";
import { sharedScoutBrowser, browseWithPlaywright } from "../scripts/scout-browse.mts";
import type { GuardedBrowser } from "../scripts/browser.mts";
import { startWorkerToolsHost } from "../lib/control-plane/workers/process-pool.ts";
import { emptyFieldManual, newFieldManualEntry, readFieldManual } from "../lib/control-plane/field-manual.ts";
import { availableWorkerMemoryBytes, routineProcessSlots, workerProcessSlots, workerMemoryHost, NATIONAL_PLACE_PEAK_MIB, WORKER_ENTRY_PEAK_MIB } from "../lib/control-plane/workers/worker-slots.ts";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fork, type ChildProcess } from "node:child_process";
import { pathToFileURL } from "node:url";
import { once } from "node:events";
import { writeFile } from "node:fs/promises";

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

test("hosted workers receive state manual pieces and browser observations without reloading the manual", async () => {
  const priorUrl = process.env.WTP_WORKER_TOOLS_URL, priorToken = process.env.WTP_WORKER_TOOLS_TOKEN;
  const entry = (state: string) => newFieldManualEntry("test", state || "portable", { role: "SHARED", kind: "REFERENCE",
    title: state, summary: state, outcome: "REFERENCE", states: state ? [state] : [] });
  const entries = [entry("az"), entry("nj"), entry("")];
  const host = await startWorkerToolsHost({ knowledge: { store: { ...emptyFieldManual(), entries }, revision: 7,
    projection: { lines: [], entryIds: [], matched: 3, total: 3 } }, browse: async input => ({ finalUrl: input.url,
    status: 200, html: "official", text: "official", requests: [], transportError: null, durationMs: 1 }) });
  try {
    const repos = { fieldManual: { read: async () => { throw new Error("worker must not reload the manual"); } } };
    const manual = await readFieldManual(repos as never, { state: "az" });
    assert.equal(manual.error, undefined); assert.equal(manual.revision, 7);
    assert.deepEqual(manual.store.entries.map(row => row.states), [["az"], []]);
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

test("the measured national place pair admits four jobs while retaining the 768 MiB margin", async () => {
  for (const [availableMiB, expected] of [[4700, 3], [4764, 4]] as const) {
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

test("legacy registry roster publications reserve their measured RSS and queue until memory is released", async () => {
  // Roster publication runs alone on either host while keeping its measured peak.
  for (const [availableMiB, expected] of [[8192 - 1024, 1], [2 * 4012 + 768, 1]] as const) {
    const slots = routineProcessSlots({ availableBytes: () => availableMiB * 1024 * 1024 });
    const entries = ["worker-publication:registry-runtime-bindings:roster-one",
      "worker-publication:registry-runtime-bindings:directory-two",
      "worker-publication:registry-runtime-bindings:roster-three", "registry-runtime-bindings"];
    const admitted: string[] = [];
    const offers = entries.map(entry => slots.acquire(entry).then(release => { admitted.push(entry); return release; }));
    await Promise.resolve();
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
  await Promise.resolve();
  assert.equal(admitted.size, 18);
  for (let id = 0; id < 20; id++) {
    await offers[id];
    admitted.get(id)!(); admitted.delete(id);
    await Promise.resolve();
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
