/**
 * CH-24 part 2: the standing hunter lane works the round's queue with no
 * 15-minute slice. It re-arms its guards mid-wave, runs plain-code tasks while
 * paid work is held and the paid ones once it opens, picks up each new queue,
 * ends at the end of its life or on a release drain, and releases the request
 * holds it never settled. The round, with the switch on, writes the queue and
 * holds its own model lane closed; the runner starts the lane only then.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hunterLane, hunterQueuePath, readHunterQueue, writeHunterQueue, HUNTER_LANE_IDLE_SAY_MS, type HunterQueue } from "../lib/control-plane/workers/hunter-lane.ts";
import type { ArmedHunterLane } from "../lib/control-plane/workers/hunter-lane-arming.ts";

const T0 = Date.parse("2026-10-06T03:00:00.000Z");

function armedLane(closed: string | null, openJobs: unknown[] = []): ArmedHunterLane {
  return { closed: closed === null ? null : { code: "PAUSED", reason: closed }, armedAt: new Date(T0).toISOString(), fleetSafety: null,
    guards: { openJobs: () => openJobs } as never, arming: null, spendHolds: { settle: async () => null } as never, ceilingUsd: 50, discoverySearchOn: false };
}

function harness(options: { queues: (HunterQueue | { unread: string })[]; arms: ArmedHunterLane[]; lifeMs?: number; drainAfterWaves?: number }) {
  let now = T0;
  const log: string[] = [];
  const waves: { queue: HunterQueue; paidOpen: boolean; guardsAtEnd: ArmedHunterLane }[] = [];
  let arms = 0;
  let reads = 0;
  const REFRESH_MS = 5 * 60_000;
  /* The refresher's waits are passive, like a real timer: they end when the lane's own waits or work move the clock past them. */
  const passive: { at: number; done: () => void }[] = [];
  const pass = (ms: number): void => {
    now += ms;
    for (const sleeper of [...passive]) if (sleeper.at <= now) { passive.splice(passive.indexOf(sleeper), 1); sleeper.done(); }
  };
  const lane = hunterLane({
    clock: () => now,
    sleep: async ms => {
      if (ms === REFRESH_MS) { await new Promise<void>(done => { passive.push({ at: now + ms, done }); }); return; }
      pass(ms);
      await new Promise(done => setImmediate(done));
    },
    arm: async () => options.arms[Math.min(arms++, options.arms.length - 1)],
    readQueue: () => options.queues[Math.min(reads++, options.queues.length - 1)],
    runWave: async ({ queue, paidOpen }) => {
      /* A wave takes six minutes: longer than a refresh, so the guards change under it. */
      for (let i = 0; i < 6; i += 1) { pass(60_000); await new Promise(done => setImmediate(done)); }
      waves.push({ queue, paidOpen, guardsAtEnd: lane.current() });
      return queue.taskIds.map(id => ({ obligationId: id }) as never);
    },
    stopRequested: () => options.drainAfterWaves !== undefined && waves.length >= options.drainAfterWaves,
    log: line => { log.push(line); },
    lifeMs: options.lifeMs ?? 30 * 60_000,
    refreshMs: REFRESH_MS,
  });
  return { lane, log, waves, get arms() { return arms; } };
}

const queue = (writtenAt: string, taskIds: string[], plainTaskIds: string[] = []): HunterQueue => ({ format: 1, writtenAt, taskIds, plainTaskIds });

test("CH-24 lane: the queue round-trips beside the reading, and a missing or malformed queue is named", () => {
  const dir = mkdtempSync(join(tmpdir(), "hunter-queue-"));
  const path = hunterQueuePath(join(dir, "arming.json"));
  assert.equal(path, join(dir, "queue.json"));
  assert.deepEqual(readHunterQueue(path), { unread: "no round has written a queue yet" });
  writeHunterQueue(path, { writtenAt: "2026-10-06T03:00:00.000Z", taskIds: ["a", "b"], plainTaskIds: ["b"] });
  assert.deepEqual(readHunterQueue(path), queue("2026-10-06T03:00:00.000Z", ["a", "b"], ["b"]));
  writeFileSync(path, "{\"format\":2}");
  assert.deepEqual(readHunterQueue(path), { unread: "the round's queue is not in the expected form" });
});

test("CH-24 lane: works each new queue once, with no slice, and re-arms mid-wave", async () => {
  const q1 = queue("2026-10-06T02:59:00.000Z", ["t1", "t2"]);
  const q2 = queue("2026-10-06T03:10:00.000Z", ["t3"]);
  const h = harness({ queues: [q1, q1, q2, q2], arms: [armedLane(null), armedLane(null), armedLane(null), armedLane(null)] });
  const run = await h.lane.run();
  assert.deepEqual(h.waves.map(w => w.queue.writtenAt), [q1.writtenAt, q2.writtenAt], "each queue once; the same queue is not re-run");
  assert.equal(run.dispatched, 3);
  assert.ok(h.arms >= 3, "the guards are re-armed every five minutes, also while a wave runs");
  assert.match(run.ended, /its life ended/);
});

test("CH-24 lane: while paid work is held only plain-code tasks run; when it opens the same queue runs again for the paid ones", async () => {
  const q = queue("2026-10-06T02:59:00.000Z", ["scout", "plain"], ["plain"]);
  const h = harness({ queues: [q], arms: [armedLane("the owner paused the runner"), armedLane(null)], lifeMs: 20 * 60_000 });
  await h.lane.run();
  assert.deepEqual(h.waves.map(w => w.paidOpen), [false, true]);
  assert.ok(h.log.some(line => /paid work held: the owner paused the runner; plain-code tasks continue/.test(line)));
  assert.ok(h.log.some(line => /paid tasks wait/.test(line)));
});

test("CH-24 lane: an idle lane says what it waits for inside the no-progress limit, and a release drain ends it after its wave", async () => {
  const idle = harness({ queues: [{ unread: "no round has written a queue yet" }], arms: [armedLane(null)], lifeMs: 12 * 60_000 });
  await idle.lane.run();
  const waits = idle.log.filter(line => /waiting for the round's next queue \(no round has written a queue yet\)/.test(line));
  assert.ok(waits.length >= 2 && HUNTER_LANE_IDLE_SAY_MS < 10 * 60_000, "said at least every five minutes");
  const drained = harness({ queues: [queue("a", ["t1"]), queue("b", ["t2"])], arms: [armedLane(null)], lifeMs: 60 * 60_000, drainAfterWaves: 1 });
  const run = await drained.lane.run();
  assert.equal(drained.waves.length, 1);
  assert.match(run.ended, /a release asked it to drain/);
});

test("CH-24 lane: on exit every request hold any of its guards left open is released", async () => {
  const released: string[] = [];
  const job = (id: string) => ({ jobId: id, committedUsd: 0.5 });
  const withJobs = (ids: string[]): ArmedHunterLane => ({ ...armedLane(null, ids.map(job)),
    spendHolds: { settle: async (jobId: string) => { released.push(jobId); return null; } } as never });
  const h = harness({ queues: [queue("a", ["t1"])], arms: [withJobs(["job-1"]), withJobs(["job-2"])], lifeMs: 8 * 60_000 });
  const run = await h.lane.run();
  assert.deepEqual(run.releaseFailures, []);
  assert.ok(released.includes("job-1") && released.includes("job-2"), "holds from every refresh's guards");
});

test("CH-24 lane: the round under the switch closes its own model lane after any owner closure, queues every planned Scout, and starts no lease worker", () => {
  const round = readFileSync(new URL("../scripts/freshness-shadow.mts", import.meta.url), "utf8");
  assert.match(round, /const CONTINUOUS_HUNTERS = process\.env\.WTP_CONTINUOUS_HUNTERS === "1";/);
  assert.match(round, /const laneClosure: ModelLaneClosure \| null = ownerLaneClosure \?\? \(CONTINUOUS_HUNTERS/);
  assert.match(round, /row\.action === "SCOUT" && \(CONTINUOUS_HUNTERS \|\| paidWorkerCapacity\(\) > 0\)/);
  const wave = round.slice(round.indexOf("if (CONTINUOUS_HUNTERS) {\n    /* CH-24 part 2"), round.indexOf("const workerDispatches = await runLeaseWorkerProcesses({"));
  assert.match(wave, /writeHunterQueue\(hunterQueuePath\(hunterLaneArmingPath\(ROOT\)\)/);
  assert.match(wave, /return \{ \.\.\.planned, dispatches: \[\.\.\.queueFailures\], scoutsAdmitted: 0, scoutsLimitedAdmitted: 0 \};/);
});

test("CH-24 lane: the runner starts the lane only under the switch, names one reading path for every checkout, and drains it on a release", () => {
  const runner = readFileSync(new URL("../scripts/pilot-runner.mts", import.meta.url), "utf8");
  assert.match(runner, /if \(!CONTINUOUS_HUNTERS \|\| canary \|\| runtimeAdmissionsHeld\) return;/);
  assert.match(runner, /process\.env\.WTP_HUNTER_LANE_ARMING = hunterLaneArmingPath\(ROOT\)/);
  assert.match(runner, /\{ id: "hunter-lane", everyMs: 60_000, run: runHunterLane \}/);
  assert.match(runner, /noProgressMs: RUNTIME_NO_PROGRESS_MS,\n    onStdout: \(_id, output\) => process\.stdout\.write\(output\),\n    onStderr: \(_id, output\) => process\.stderr\.write\(output\),\n    onStarted: \(_id, child\) => \{ hunterLaneChild = child; \},/);
  assert.equal(runner.match(/drainHunterLane\(\);/g)?.length, 2, "both release paths drain the lane");
  const lane = readFileSync(new URL("../scripts/hunter-lane.mts", import.meta.url), "utf8");
  assert.ok(!/deadlineMs,\n/.test(lane.slice(lane.indexOf("runLeaseWorkerProcesses({"))), "no worker is ended mid-task by the lane's life");
  assert.match(lane, /orderPending: async ids => !handingOut\(\) \? \[\] :/);
});
