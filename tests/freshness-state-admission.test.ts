import assert from "node:assert/strict";
import test from "node:test";
import { fork as nativeFork, type ChildProcess } from "node:child_process";
import { EventEmitter, once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { setImmediate as nextTurn } from "node:timers/promises";
import ts from "typescript";
import { FRESHNESS_PARENT_PEAK_MIB, freshnessProcessMemoryEntry, routineProcessPeakBytes, routineProcessSlots,
  workerMemoryHost, workerMemoryPeakKey, type WorkerProcessSlots, type WorkerMemoryRelease } from "../lib/control-plane/workers/worker-slots.ts";
import { runRuntimeChildren } from "../scripts/pilot-runtime-child.mts";

const mib = 1048576, at = "2026-10-20T00:00:00.000Z";
/** Exercise the native runState body with a real fork, replacing only external job/DB fixtures. */
function stateRunner(input: { root: string; slots: WorkerProcessSlots; fork?: typeof nativeFork; cleanup?: (key: string) => Promise<void> }) {
  const script = readFileSync(new URL("../scripts/freshness-shadow.mts", import.meta.url), "utf8");
  const start = script.indexOf("  const runState = async (state: string)");
  const end = script.indexOf("\n  const states=IDS?", start);
  assert.ok(start >= 0 && end > start, "extract the actual native direct-fork admission path");
  const body = script.slice(start, end).replace("new URL(import.meta.url)", "new URL(childUrl)");
  const compiled = ts.transpileModule(body, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  const parent = Object.assign(new EventEmitter(), { pid: process.pid, execArgv: [], connected: false });
  const summaries = new Map<string, { state: string }>();
  const create = new Function("statePlanningSlots", "fork", "freshnessProcessMemoryEntry", "argv", "NOW", "ROOT",
    "admittedRuntimeChildEnvironment", "process", "summaries", "mergeStatePlanningPass", "releaseWindowLease", "parentRepos", "HOST", "nowIso", "childUrl",
    `let releaseDrainRequested = false; ${compiled}; return runState;`);
  const run = create(input.slots, input.fork ?? nativeFork, freshnessProcessMemoryEntry, ["--provider=postgres"], at, input.root,
    () => ({ ...process.env }), parent, summaries, (_prior: unknown, row: unknown) => row,
    (_repos: unknown, key: string) => input.cleanup?.(key) ?? Promise.resolve(), {}, "fixture-host", () => at,
    pathToFileURL(join(input.root, "planner.mjs")).href) as (state: string) => Promise<boolean>;
  return { run, parent, summaries };
}
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "state-planning-admission-"));
  await writeFile(join(root, "planner.mjs"), `const state=process.argv.find(arg=>arg.startsWith('--state=')).slice(8);
process.send({type:'STATE_PLANNING_SUMMARY',summary:{state}});
process.on('message',message=>{if(message.kind==='FINISH')process.exit(0);});`);
  return root;
}

test("native state planning acquires its distinct whole-parent reservation before fork and releases at close before lease cleanup", async () => {
  const root = await fixture(), events: string[] = [], host = workerMemoryHost({ processes: () => [] });
  const nativeSlots = routineProcessSlots({ host, availableBytes: () => Number.MAX_SAFE_INTEGER });
  let admit!: () => void, child: ChildProcess | undefined, cleanupDone!: () => void;
  const cleanup = new Promise<void>(resolve => { cleanupDone = resolve; });
  const slots: WorkerProcessSlots = { acquire: async (entry, deadline, signal) => {
    assert.equal(entry, "state-planner:az/freshness-shadow.mts");
    const release = await nativeSlots.acquire(entry, deadline, signal);
    events.push("acquired");
    return new Promise<WorkerMemoryRelease>(resolve => { admit = () => resolve(Object.assign(() => { events.push("released"); release(); }, {
      observe: (pid: number) => { events.push("observed"); release.observe?.(pid); },
    })); });
  } };
  const runner = stateRunner({ root, slots, cleanup: async key => { assert.match(key, /^cycle@fixture-host#\d+$/); events.push("cleanup"); await cleanup; },
    fork: ((...args: Parameters<typeof nativeFork>) => { events.push("forked"); child = nativeFork(...args); child.once("close", () => { events.push("closed"); }); return child; }) as typeof nativeFork });
  try {
    const running = runner.run("az");
    await nextTurn();
    assert.deepEqual(events, ["acquired"]);
    host.transact(state => assert.equal(state.reservations[0]?.peak, FRESHNESS_PARENT_PEAK_MIB.state * mib), false);
    admit();
    await nextTurn();
    assert.ok(child);
    if (!runner.summaries.has("az")) await once(child, "message");
    const closed = once(child, "close");
    runner.parent.emit("message", { kind: "FINISH" });
    await closed;
    await nextTurn();
    assert.deepEqual(events, ["acquired", "forked", "observed", "closed", "released", "cleanup"]);
    host.transact(state => assert.equal(state.reservations.length, 0), false);
    cleanupDone(); assert.equal(await running, true);
    assert.equal(runner.parent.listenerCount("SIGTERM"), 0); assert.equal(runner.parent.listenerCount("message"), 0);
  } finally { cleanupDone(); child?.kill(); await rm(root, { recursive: true, force: true }); }
});

test("draining a native queued state admission starts no child and leaves no reservation", async () => {
  const root = await fixture(), host = workerMemoryHost({ processes: () => [] }); let free = 0, forks = 0;
  const slots = routineProcessSlots({ host, availableBytes: () => free });
  const runner = stateRunner({ root, slots, fork: (() => { forks++; throw new Error("drained state forked"); }) as typeof nativeFork });
  try {
    const running = runner.run("az"); await nextTurn();
    runner.parent.emit("message", { kind: "RUNTIME_RELEASE_DRAIN" });
    assert.equal(await running, false); assert.equal(forks, 0);
    free = Number.MAX_SAFE_INTEGER;
    const next = await slots.acquire(freshnessProcessMemoryEntry(["--state=nh"])); next();
    host.transact(state => assert.equal(state.reservations.length, 0), false);
    assert.equal(runner.parent.listenerCount("SIGTERM"), 0); assert.equal(runner.parent.listenerCount("message"), 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("a late state admission after SIGTERM releases without forking", async () => {
  const root = await fixture(); let grant!: (release: WorkerMemoryRelease) => void, releases = 0, forks = 0;
  const runner = stateRunner({ root, slots: { acquire: () => new Promise(resolve => { grant = resolve; }) },
    fork: (() => { forks++; throw new Error("late state forked"); }) as typeof nativeFork });
  try {
    const running = runner.run("az"); await nextTurn(); runner.parent.emit("SIGTERM");
    grant(() => { releases++; }); assert.equal(await running, false);
    assert.equal(forks, 0); assert.equal(releases, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("native state spawn failure releases only after actual child close", async () => {
  const root = await fixture(), events: string[] = [];
  const runner = stateRunner({ root: join(root, "missing"), slots: { acquire: async () => () => { events.push("released"); } },
    fork: ((...args: Parameters<typeof nativeFork>) => { const child = nativeFork(...args); child.once("error", () => { events.push("error"); }); child.once("close", () => { events.push("closed"); }); return child; }) as typeof nativeFork });
  try { await assert.rejects(runner.run("az"), /ENOENT/); assert.deepEqual(events, ["error", "closed", "released"]); }
  finally { await rm(root, { recursive: true, force: true }); }
});

test("round and state peak learning are separate while every state shares its measured job floor", async () => {
  const round = freshnessProcessMemoryEntry([]), az = freshnessProcessMemoryEntry(["--state=az"]), nh = freshnessProcessMemoryEntry(["--state=nh"]);
  assert.equal(round, "freshness-round/freshness-shadow.mts");
  assert.notEqual(workerMemoryPeakKey(round), workerMemoryPeakKey(az)); assert.equal(workerMemoryPeakKey(az), workerMemoryPeakKey(nh));
  assert.equal(routineProcessPeakBytes(round), FRESHNESS_PARENT_PEAK_MIB.round * mib);
  assert.equal(routineProcessPeakBytes(az), FRESHNESS_PARENT_PEAK_MIB.state * mib);
  const host = workerMemoryHost({ processes: () => [] });
  host.transact(state => { state.peaks = { [workerMemoryPeakKey(az)!]: [7e9] }; }, false);
  const slots = routineProcessSlots({ host, availableBytes: () => (768 + FRESHNESS_PARENT_PEAK_MIB.round) * mib });
  const release = await slots.acquire(round, Date.now() + 500); release();
  await assert.rejects(slots.acquire(az, Date.now() + 25), /WORKER_MEMORY_DEADLINE/);
  const source = readFileSync(new URL("../scripts/freshness-shadow.mts", import.meta.url), "utf8");
  assert.match(source, /parentPeakBytes: routineProcessPeakBytes\(freshnessProcessMemoryEntry\(process\.argv\.slice\(2\)\)\)/);
});

test("central pilot admission identifies the actual round and state freshness scripts", async () => {
  const entries: string[] = [];
  for (const state of [null, "az"]) await runRuntimeChildren([{ id: "freshness-research", executable: process.execPath,
    args: ["--experimental-strip-types", "scripts/freshness-shadow.mts", ...(state ? [`--state=${state}`] : [])] }], {
    cwd: process.cwd(), env: process.env, maxBufferBytes: 4096,
    slots: { acquire: async entry => { entries.push(entry!); throw new Error("FIXTURE_STOP_BEFORE_FORK"); } },
  });
  assert.deepEqual(entries, ["freshness-round/freshness-shadow.mts", "state-planner:az/freshness-shadow.mts"]);
});
