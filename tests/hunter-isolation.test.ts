/**
 * One job must never end the others. In the standing hunter lane each worker process has its own progress
 * clock; a stuck one is ended alone with what it held and what it was waiting on, and the others keep running.
 * A queue the round writes mid-wave joins the running workers. The runner's heartbeat carries the host's
 * memory and reservations.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runLeaseWorkerProcesses, STANDING_STARTUP_FAILURES, type StuckWorker } from "../lib/control-plane/workers/process-pool.ts";
import { HUNTER_JOB_QUIET_MS, HUNTER_LANE_PROGRESS_EVERY_MS, HUNTER_WORKER_RETIRE_MS, HUNTER_WORKER_WALL_MS, hunterLane, hunterLaneProgress,
  stuckWorkerLine, type HunterQueue } from "../lib/control-plane/workers/hunter-lane.ts";
import type { ArmedHunterLane } from "../lib/control-plane/workers/hunter-lane-arming.ts";
import { RUNTIME_NO_PROGRESS_MS } from "../scripts/pilot-runtime-child.mts";
import { hostMemoryReading, memoryReading } from "../lib/control-plane/workers/worker-slots.ts";
import { liveCycleHeartbeat } from "../lib/control-plane/runner-standing.ts";

const config = (root: string, taskIds: string[]) => ({ root, postgres: false, taskIds, modelEnabled: false, searchEnabled: false, ceilingUsd: 0, fundedSubjects: [] });
const noModel = () => async () => { throw new Error("no model in this fixture"); };

async function fixture(name: string, worker: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), `hunter-isolation-${name}-`));
  await mkdir(join(root, "scripts"));
  await writeFile(join(root, "scripts/register-test-loader.mjs"), "");
  await writeFile(join(root, "worker.mjs"), worker);
  return root;
}

/* Each fixture worker claims the first id no sibling has claimed, as a lease would. */
const TAKES_FIRST = `
  import { openSync } from 'node:fs';
  const claim = ids => ids.find(id => { try { openSync('claim-' + id, 'wx'); return true; } catch { return false; } });
  const result = id => ({ obligationId: id, routeTaskId: id, outcome: 'WORKED', claimed: true, attemptId: 'a:' + id, dispositionCommitted: true,
    disposition: 'INGESTED', artifactIds: [], cost: null, worker: null, executor: null, executorChosen: null, decisionDisagreement: null, executorMismatch: false, detail: '' });
  const done = (config, id) => { process.send({ kind: 'result', id: '', body: result(id) }); process.send({ kind: 'finished', id: '', body: config.taskIds }); process.disconnect(); };
`;

test("isolation: a stuck worker is ended alone, its state recorded, and its sibling finishes", async () => {
  const root = await fixture("stuck", `${TAKES_FIRST}
    process.once('message', config => {
      const id = claim(config.taskIds);
      process.send({ kind: 'task-start', id: '', taskId: id, body: id });
      if (id === 'stuck') { process.send({ kind: 'model', id: 'q1', taskId: id, jurisdiction: { subjectId: 's', state: null }, body: {} }); setInterval(() => {}, 1000); return; }
      setTimeout(() => done(config, id), 50);
    });`);
  try {
    const stuck: StuckWorker[] = [];
    const exited: string[] = [];
    const results = await runLeaseWorkerProcesses({ entry: "worker.mjs", childTimeoutMs: 60_000, config: config(root, ["stuck", "ok"]),
      capacity: () => 2, transportFor: () => () => new Promise(() => {}),
      standing: { quietMs: 700, onStuck: worker => stuck.push(worker) },
      onExited: (pid, why) => exited.push(`${pid}: ${why}`) });
    assert.equal(stuck.length, 1, "only the stuck worker is ended");
    assert.equal(stuck[0]!.taskId, "stuck");
    assert.match(stuck[0]!.waitingOn, /the lane's answer to its model request for task stuck/);
    const byTask = new Map(results.map(r => [r.routeTaskId, r]));
    assert.equal(byTask.get("ok")!.outcome, "WORKED", "the sibling's work is kept");
    assert.equal(byTask.get("stuck")!.outcome, "FAILED");
    assert.match(byTask.get("stuck")!.detail, /WORKER_STUCK:\d+: no progress .* while waiting on the lane's answer to its model request for task stuck.*work remains owed/);
    assert.equal(results.length, 2, "one result per task: no second failure for the stuck task");
    assert.ok(exited.some(line => /WORKER_STUCK/.test(line)) && exited.some(line => /exit 0/.test(line)));
    assert.match(stuckWorkerLine(stuck[0]!), /^hunter lane: stuck worker ended alone: pid \d+; task stuck; waiting on .*; its task remains owed and the other workers keep running$/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("isolation: a worker that keeps talking to the lane is never ended by the quiet clock", async () => {
  const root = await fixture("talking", `${TAKES_FIRST}
    process.once('message', config => {
      const id = claim(config.taskIds);
      process.send({ kind: 'task-start', id: '', taskId: id, body: id });
      let n = 0;
      const t = setInterval(() => { process.send({ kind: 'pending-order', id: 'p' + (++n), taskId: id, body: [] }); if (n === 8) { clearInterval(t); done(config, id); } }, 150);
    });`);
  try {
    const stuck: StuckWorker[] = [];
    let moved = 0;
    const results = await runLeaseWorkerProcesses({ entry: "worker.mjs", childTimeoutMs: 60_000, config: config(root, ["long"]),
      capacity: () => 1, transportFor: noModel, standing: { quietMs: 500, onStuck: worker => stuck.push(worker), onMoved: () => { moved++; } } });
    assert.equal(stuck.length, 0, "1.2 s of work, never quiet for 0.5 s");
    assert.equal(results[0]!.outcome, "WORKED");
    assert.ok(moved >= 8, "each message either way is the lane's progress signal");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("isolation: a worker ended by its wall leaves one deferral for the task it held", async () => {
  const root = await fixture("wall", `${TAKES_FIRST}
    process.once('message', config => {
      const id = claim(config.taskIds);
      process.send({ kind: 'task-start', id: '', taskId: id, body: id });
      let n = 0;
      setInterval(() => process.send({ kind: 'pending-order', id: 'p' + (++n), taskId: id, body: [] }), 100);
    });`);
  try {
    const results = await runLeaseWorkerProcesses({ entry: "worker.mjs", childTimeoutMs: 600, config: config(root, ["long"]),
      capacity: () => 1, transportFor: noModel, standing: { quietMs: 10_000 } });
    assert.equal(results.length, 1);
    assert.equal(results[0]!.routeTaskId, "long");
    assert.equal(results[0]!.outcome, "FAILED");
    assert.match(results[0]!.detail, /WORKER_CHILD_TIMEOUT/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("isolation: a queue written mid-wave joins the running workers instead of waiting for the slowest", async () => {
  const root = await fixture("join", `${TAKES_FIRST}
    process.once('message', config => {
      const id = claim(config.taskIds);
      process.send({ kind: 'task-start', id: '', taskId: id, body: id });
      setTimeout(() => done(config, id), id === 'slow' ? 3000 : 50);
    });`);
  try {
    let polls = 0;
    const order: string[] = [];
    const results = await runLeaseWorkerProcesses({ entry: "worker.mjs", childTimeoutMs: 60_000, config: config(root, ["slow"]),
      capacity: () => 4, transportFor: noModel,
      standing: { quietMs: 10_000, moreTasks: () => (++polls === 2 ? ["late", "slow"] : []) },
      onDispatched: result => { order.push(result.routeTaskId!); } });
    assert.deepEqual(order, ["late", "slow"], "the late task finished while the slow one still ran");
    assert.equal(results.length, 2, "a task already in the pool does not join twice");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("isolation: a worker past its retirement age takes no further task, and a fresh worker takes its remaining ones", async () => {
  const root = await fixture("retire", `${TAKES_FIRST}
    import { existsSync, writeFileSync } from 'node:fs';
    process.once('message', config => {
      const first = !existsSync('first');
      if (first) writeFileSync('first', '');
      setTimeout(() => {
        const replies = new Map();
        process.on('message', m => replies.get(m.id)?.(m.body));
        replies.set('o1', order => {
          if (!order.length) { writeFileSync('retired', String(process.pid)); process.send({ kind: 'finished', id: '', body: config.taskIds }); process.disconnect(); return; }
          process.send({ kind: 'task-start', id: '', taskId: order[0], body: order[0] });
          done(config, order[0]);
        });
        process.send({ kind: 'pending-order', id: 'o1', taskId: '', body: config.taskIds });
      }, first ? 400 : 0);
    });`);
  try {
    const started: number[] = [];
    const results = await runLeaseWorkerProcesses({ entry: "worker.mjs", childTimeoutMs: 60_000, config: config(root, ["owed"]),
      capacity: () => 1, transportFor: noModel, standing: { quietMs: 10_000, retireAfterMs: 200 },
      onStarted: pid => started.push(pid) });
    assert.equal(started.length, 2);
    assert.equal(Number(await readFile(join(root, "retired"), "utf8")), started[0], "the old worker retired");
    assert.equal(results.length, 1);
    assert.equal(results[0]!.outcome, "WORKED", "the fresh worker did the task the retired one left");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("isolation: workers that keep failing before their first task close admission instead of restarting every second", async () => {
  const root = await fixture("crash", "process.once('message', () => process.exit(1));");
  try {
    let started = 0;
    const results = await runLeaseWorkerProcesses({ entry: "worker.mjs", childTimeoutMs: 60_000, config: config(root, ["owed"]),
      capacity: () => 1, transportFor: noModel, standing: { quietMs: 10_000 }, onStarted: () => { started++; } });
    assert.equal(started, STANDING_STARTUP_FAILURES);
    assert.equal(results.length, 1);
    assert.equal(results[0]!.outcome, "FAILED");
    assert.match(results[0]!.detail, /LEASE_WORKER_EXIT/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("isolation: the clocks fit inside the runner's limit", () => {
  assert.ok(HUNTER_JOB_QUIET_MS + HUNTER_LANE_PROGRESS_EVERY_MS < RUNTIME_NO_PROGRESS_MS - 60_000,
    "a stuck job is ended and said before the runner's stall probe and limit");
  assert.ok(HUNTER_WORKER_RETIRE_MS < HUNTER_WORKER_WALL_MS);
  const lane = readFileSync(new URL("../scripts/hunter-lane.mts", import.meta.url), "utf8");
  assert.match(lane, /childTimeoutMs: HUNTER_WORKER_WALL_MS,/);
  assert.match(lane, /standing: \{ moreTasks, quietMs: HUNTER_JOB_QUIET_MS, retireAfterMs: HUNTER_WORKER_RETIRE_MS,/);
  const worker = readFileSync(new URL("../lib/control-plane/workers/lease-worker.ts", import.meta.url), "utf8");
  assert.match(worker, /broker\.send\("task-start", "", id\);/);
});

test("isolation: the lane says it is working only while workers move, with new totals each time", () => {
  const lines: string[] = [];
  const timers: (() => void)[] = [];
  const p = hunterLaneProgress({ log: line => lines.push(line), setTimer: run => { timers.push(run); return timers.length; }, clearTimer: () => {} });
  p.started(); p.started();
  p.step(); p.step(); p.taskDone();
  assert.equal(timers.length, 1, "one line per period, however many moves");
  timers.shift()!();
  assert.deepEqual(lines, ["hunter lane: working: 2 worker(s) running; 2 step(s) and 1 task(s) finished since the lane started"]);
  assert.equal(timers.length, 0, "no move, no line: a real hang still reaches the runner's limit");
  p.stuck(); p.ended();
  timers.shift()!();
  assert.match(lines[1]!, /1 worker\(s\) running; 2 step\(s\) and 1 task\(s\) finished since the lane started; 1 stuck worker\(s\) ended alone$/);
});

test("isolation: the lane hands a running wave the round's newer queue once, and never re-runs it as a wave", async () => {
  const T0 = Date.parse("2026-10-06T05:00:00.000Z");
  let now = T0;
  const q1: HunterQueue = { format: 1, writtenAt: "q1", taskIds: ["a"], plainTaskIds: [] };
  const q2: HunterQueue = { format: 1, writtenAt: "q2", taskIds: ["b"], plainTaskIds: [] };
  let written: HunterQueue = q1;
  const waves: string[] = [];
  const absorbed: (string | null)[] = [];
  const armed = { closed: null, armedAt: new Date(T0).toISOString(), fleetSafety: null, guards: { openJobs: () => [] } as never,
    arming: null, spendHolds: { settle: async () => null } as never, ceilingUsd: 5, discoverySearchOn: false } as ArmedHunterLane;
  const log: string[] = [];
  const lane = hunterLane({
    clock: () => now,
    sleep: async ms => { if (ms >= 5 * 60_000) return new Promise<void>(() => {}); now += ms; await new Promise(done => setImmediate(done)); },
    arm: async () => armed,
    readQueue: () => written,
    runWave: async ({ queue, absorb }) => {
      waves.push(queue.writtenAt);
      absorbed.push(absorb()?.writtenAt ?? null);
      written = q2;
      absorbed.push(absorb()?.writtenAt ?? null);
      now += 31_000;
      absorbed.push(absorb()?.writtenAt ?? null);
      now += 31_000;
      absorbed.push(absorb()?.writtenAt ?? null);
      return [];
    },
    stopRequested: () => false,
    log: line => log.push(line),
    lifeMs: 10 * 60_000,
  });
  await lane.run();
  assert.deepEqual(absorbed, [null, null, "q2", null], "read at most every idle-read period, and each newer queue once");
  assert.deepEqual(waves, ["q1"], "the joined queue is not worked again as its own wave");
  assert.ok(log.some(line => /the queue written q2 joins the running wave: 1 task\(s\), 0 plain-code/.test(line)));
});

test("isolation: the runner's heartbeat carries the host's memory, its process tree, the reservations and how many workers fit", async () => {
  const MIB = 1024 * 1024;
  const reading = memoryReading({ at: "2026-10-06T05:30:00.000Z", totalBytes: 8192 * MIB, availableBytes: 3000 * MIB, rootPid: 10,
    rows: [{ pid: 10, parentPid: 1, rss: 100 * MIB }, { pid: 11, parentPid: 10, rss: 900 * MIB }, { pid: 12, parentPid: 11, rss: 200 * MIB },
      { pid: 13, parentPid: 12, rss: 50 * MIB }, { pid: 99, parentPid: 1, rss: 500 * MIB }],
    state: { parents: [{ pid: 11, peak: 1000 * MIB }], reservations: [{ pid: 12, peak: 342 * MIB, entry: "lib/control-plane/workers/lease-worker.ts" }] } });
  assert.equal(reading.runnerTreeRssBytes, 1250 * MIB, "the runner and everything under it, not other host processes");
  assert.equal(reading.runnerTreeProcesses, 4);
  assert.deepEqual(reading.parents, [{ pid: 11, peakBytes: 1000 * MIB, rssBytes: 900 * MIB }]);
  assert.deepEqual(reading.reservations, [{ entry: "lease-worker.ts", peakBytes: 342 * MIB, rssBytes: 250 * MIB }], "a worker's tree, grandchildren included");
  assert.equal(reading.reservedGrowthBytes, (100 + 92) * MIB);
  assert.equal(reading.headroomBytes, 768 * MIB);
  assert.equal(reading.fitLeaseWorkers, Math.floor((3000 - 768 - 192) / 342), "admission's own arithmetic at the 0.75 GiB margin");
  assert.equal(memoryReading({ ...reading, rootPid: 10, rows: [], state: null, availableBytes: 500 * MIB }).fitLeaseWorkers, 0, "never negative");
  const live = await hostMemoryReading();
  assert.ok(live.totalBytes > 0 && live.availableBytes > 0 && live.runnerTreeProcesses >= 1);
  const beat = liveCycleHeartbeat(null, { at: live.at, startedAt: live.at, testedSha: null, host: "h", memory: live });
  assert.equal(beat.memory, live);
  assert.equal(liveCycleHeartbeat(beat, { at: live.at, startedAt: live.at, testedSha: null, host: "h", memory: null }).memory, live,
    "a beat that could not read memory keeps the last reading, with its own time");
  const runner = readFileSync(new URL("../scripts/pilot-runner.mts", import.meta.url), "utf8");
  assert.match(runner, /const memory = await hostMemoryReading\(\)\.catch\(\(\) => null\);/);
  assert.match(runner, /testedSha: RUNNING_CODE_SHA, host: hostname\(\), lastError, memory,/);
});
