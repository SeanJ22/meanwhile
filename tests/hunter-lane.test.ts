import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { hunterLane, HUNTER_LANE_IDLE_SAY_MS, type HunterQueue } from "../lib/control-plane/workers/hunter-lane.ts";
import type { ArmedHunterLane } from "../lib/control-plane/workers/hunter-lane-arming.ts";
import { modelLaneClosure } from "../lib/control-plane/scheduler/model-lane.ts";

const T0 = Date.parse("2026-10-06T03:00:00.000Z");

function armedLane(closed: string | null, openJobs: unknown[] = []): ArmedHunterLane {
  return { closed: closed === null ? null : { code: "PAUSED", reason: closed }, armedAt: new Date(T0).toISOString(), fleetSafety: null,
    guards: { openJobs: () => openJobs } as never, arming: null, spendHolds: { settle: async () => null } as never, ceilingUsd: 50, discoverySearchOn: false };
}

function harness(options: { queues: (HunterQueue | null)[]; arms: ArmedHunterLane[]; lifeMs?: number; drainAfterWaves?: number }) {
  let now = T0;
  const log: string[] = [];
  const waves: { queue: HunterQueue; paidOpen: boolean; guardsAtEnd: ArmedHunterLane }[] = [];
  let arms = 0;
  let reads = 0;
  const REFRESH_MS = 5 * 60_000;

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
    selectState: async () => "az",
    claim: async () => options.queues[Math.min(reads++, options.queues.length - 1)] ?? null,
    endWave: async () => {},
    runWave: async ({ queue, paidOpen }) => {

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

const queue = (claimedAt: string, taskIds: string[], plainTaskIds: string[] = []): HunterQueue => ({ claimedAt, taskIds, plainTaskIds });

test("CH-24 lane: works each claim of rows once, with no slice, and re-arms mid-wave", async () => {
  const q1 = queue("2026-10-06T02:59:00.000Z", ["t1", "t2"]);
  const q2 = queue("2026-10-06T03:10:00.000Z", ["t3"]);
  const h = harness({ queues: [q1, null, q2, null], arms: [armedLane(null), armedLane(null), armedLane(null), armedLane(null)] });
  const run = await h.lane.run();
  assert.deepEqual(h.waves.map(w => w.queue.claimedAt), [q1.claimedAt, q2.claimedAt], "each claim once");
  assert.equal(run.dispatched, 3);
  assert.ok(h.arms >= 3, "the guards are re-armed every five minutes, also while a wave runs");
  assert.match(run.ended, /its life ended/);
});

test("CH-24 lane: while paid work is held it says so and waits for rows it may take", async () => {
  const h = harness({ queues: [null], arms: [armedLane("the owner paused the runner")], lifeMs: 12 * 60_000 });
  const run = await h.lane.run();
  assert.equal(run.waves, 0);
  assert.ok(h.log.some(line => /waiting for hunts on the work list \(paid work is held; only plain-code tasks are taken\)/.test(line)));
  assert.ok(h.log.some(line => /paid work held: the owner paused the runner; plain-code tasks continue/.test(line)));
});

test("CH-24 lane: an idle lane says what it waits for inside the no-progress limit, and a release drain ends it after its wave", async () => {
  const idle = harness({ queues: [null], arms: [armedLane(null)], lifeMs: 12 * 60_000 });
  await idle.lane.run();
  const waits = idle.log.filter(line => /waiting for hunts on the work list/.test(line));
  assert.ok(waits.length >= 2 && HUNTER_LANE_IDLE_SAY_MS < 10 * 60_000, "said at least every five minutes");
  const drained = harness({ queues: [queue("a", ["t1"]), null, queue("b", ["t2"])], arms: [armedLane(null)], lifeMs: 60 * 60_000, drainAfterWaves: 1 });
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

test("CH-24 lane: the round under the switch closes its own model lane after any owner closure, adds every planned task to the work list, and starts no lease worker", () => {
  const round = readFileSync(new URL("../scripts/freshness-shadow.mts", import.meta.url), "utf8");
  assert.match(round, /const CONTINUOUS_HUNTERS = process\.env\.WTP_CONTINUOUS_HUNTERS === "1";/);
  assert.match(round, /const laneClosure = modelLaneClosure\(\{[\s\S]{0,800}?paidWorkInHunterLane: CONTINUOUS_HUNTERS,\n  unreadableControls,\n\}\);/);
  assert.match(round, /row\.action === "SCOUT" && \(CONTINUOUS_HUNTERS \|\| paidWorkerCapacity\(\) > 0\)/);
  const wave = round.slice(round.indexOf("if (CONTINUOUS_HUNTERS) {"), round.indexOf("const workerDispatches = await runLeaseWorkerProcesses({"));
  assert.match(wave, /huntList\.ensure\(rows\.slice\(at, at \+ 1_000\)\)/);
  assert.match(wave, /return \{ \.\.\.planned, dispatches: \[\.\.\.queueFailures\], scoutsAdmitted: 0, scoutsLimitedAdmitted: 0 \};/);
});

test("CH-24 lane: the runner starts the lane only under the switch, names one reading path for every checkout, and drains it on a release", () => {
  const runner = readFileSync(new URL("../scripts/pilot-runner.mts", import.meta.url), "utf8");
  assert.match(runner, /if \(!CONTINUOUS_HUNTERS \|\| canary \|\| runtimeAdmissionsHeld\) return;/);
  assert.ok(!runner.includes("process.env.WTP_HUNTER_LANE_ARMING ="));
  assert.match(runner, /\{ id: "hunter-lane", everyMs: 60_000, budgetMs: HUNTER_LANE_LIFE_MS \+ HUNTER_WORKER_WALL_MS, run: runHunterLane \}/);
  assert.match(runner, /noProgressMs: RUNTIME_NO_PROGRESS_MS,\n    onStdout: \(_id, output\) => process\.stdout\.write\(output\),\n    onStderr: \(_id, output\) => process\.stderr\.write\(output\),\n    onStarted: \(_id, child\) => \{ hunterLaneChild = child; \},/);
  assert.equal(runner.match(/drainHunterLane\(\);/g)?.length, 2, "both release paths drain the lane; the breaker never stops it");
  const lane = readFileSync(new URL("../scripts/hunter-lane.mts", import.meta.url), "utf8");
  assert.ok(!/deadlineMs,\n/.test(lane.slice(lane.indexOf("runLeaseWorkerProcesses({"))), "no worker is ended mid-task by the lane's life");
  assert.match(lane, /orderPending: async ids => !handingOut\(\) \? \[\] :/);
});

test("CH-24 lane: under the switch the round's model lane closes last, so an owner pause is still named as the pause", () => {
  const facts = { dry: false, noModel: false, credentialConfigured: true, credentialVar: "K",
    paused: false, pauseIntentId: null, runnerPaused: false, runnerPauseIntentId: null, spendHold: null, unreadableControls: [] };
  assert.equal(modelLaneClosure(facts), null);
  assert.match(modelLaneClosure({ ...facts, paidWorkInHunterLane: true })!.reason, /runs in the standing hunter lane/);
  assert.equal(modelLaneClosure({ ...facts, paidWorkInHunterLane: true, runnerPaused: true, runnerPauseIntentId: "i-1" })!.code, "PAUSED");
});
