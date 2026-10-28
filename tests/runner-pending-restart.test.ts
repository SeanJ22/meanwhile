import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as nodeModule from "node:module";
import { test } from "node:test";
import { createContext, runInContext } from "node:vm";
import { IndependentRuntimeLaneScheduler } from "../lib/ops/independent-runtime-pass.ts";
import { PendingRestart } from "../lib/ops/pending-restart.ts";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ReleaseStaging, stageRuntimeRelease, stagedReleaseDirectory, type AsyncRunCommand } from "../lib/ops/runtime-release-stage.ts";
import { runRuntimeChildren, waitForRuntimeQuiescence } from "../scripts/pilot-runtime-child.mts";

const source = readFileSync(new URL("../scripts/pilot-runner.mts", import.meta.url), "utf8");
const { stripTypeScriptTypes } = nodeModule as typeof nodeModule & { stripTypeScriptTypes(source: string): string };

function runnerFunction(name: string): string {
  const fn = source.match(new RegExp(`\\n(?:async )?function ${name}\\([\\s\\S]*?\\n\\}`))?.[0];
  assert.ok(fn, `pilot-runner.mts has no ${name}()`);
  return fn;
}

test("a pending restart stops relaunching routine children and restarts within one pass deadline", async t => {
  const PASS_BUDGET_MS = 6_000;
  const target = "b".repeat(40);
  const launches: { id: string; at: number }[] = [];
  const lane = (id: string, childMs: number) => ({ id, everyMs: 1, budgetMs: PASS_BUDGET_MS, run: async (deadlineMs: number) => {
    launches.push({ id, at: Date.now() });
    await runRuntimeChildren([{ id, executable: process.execPath, args: ["-e", `setTimeout(()=>{},${childMs})`] }],
      { cwd: process.cwd(), env: process.env, maxBufferBytes: 4096, deadlineMs });
  } });
  // Routine children finish and relaunch every tick; publish-now would outlive its deadline.
  const scheduler = new IndependentRuntimeLaneScheduler([lane("routine-civic-data", 400), lane("publish-now", 60_000)]);
  const releaseAppearsAt = Date.now() + 2_400;
  const applied: string[] = [];
  const log: string[] = [];
  const context = createContext({
    AUTO_RELEASE_HANDOFF: true, RELEASE_QUICK_SWITCH: false, ROOT: ".", CONTROL_WAKE_POLL_MS: 30_000, RUNTIME_NO_PROGRESS_MS: 600_000,
    pendingRestart: new PendingRestart(), releaseCheck: null, runtimeAdmissionsHeld: false, standingDrainFailed: false,
    canary: false, standingBeat: async () => {},
    standingRuntimeTimer: null, ownerControlTimer: null, adminCopyTimer: null, activeControlRead: null,
    researchCycleActive: false, researchCycleChild: null, ownerWakePending: false, standingRuntimeScheduler: scheduler,
    inspectRuntimeRelease: async () => Date.now() < releaseAppearsAt ? { state: "CURRENT", targetSha: null }
      : { state: "UPDATE_REQUIRED", targetSha: target },
    advanceStagedRelease: async () => "DRAIN",
    resumeRuntimeReleaseInstall: () => null,
    applyRuntimeRelease: ({ targetSha }: { targetSha: string }) => { applied.push(targetSha); return { state: "UPDATED", detail: `installed ${targetSha.slice(0, 8)}` }; },
    discardStagedReleases: async () => {}, persistRuntimeBoundaryFailure: async () => { throw new Error("no refusal expected"); },
    stopAdminCopyClock: async () => {}, stopScheduledOrderClock: async () => {}, auditPasses: { stop: async () => {} },
    drainHunterLane: () => {}, waitForRuntimeQuiescence, ownerSays: async () => "NOTHING",
    console: { log: (line: string) => log.push(line), error: (line: string) => log.push(line) },
    clearInterval, setInterval, Date,
  });
  runInContext(stripTypeScriptTypes(["checkReleaseForRestart", "holdForRestart", "runStandingRuntimeTick",
    "holdStandingRuntimeAtQuiescence", "reconcileRuntimeReleaseAtBoundary", "sleepUnlessRunNow"].map(runnerFunction).join("\n")), context);

  context.standingRuntimeTimer = setInterval(() => runInContext(`runStandingRuntimeTick("independent standing clock")`, context), 160);
  t.after(() => clearInterval(context.standingRuntimeTimer));
  // The main loop sleeps toward its next research cycle; the pending restart must wake it.
  await runInContext("sleepUnlessRunNow(60_000)", context);
  const pendingAt = Date.now();
  assert.equal(context.pendingRestart.target, target);
  assert.ok(pendingAt - releaseAppearsAt < 1_600, `the sleep woke ${pendingAt - releaseAppearsAt}ms after the release appeared`);
  assert.equal(context.runtimeAdmissionsHeld, true);
  assert.ok(launches.filter(l => l.id === "routine-civic-data").length >= 3, "routine children kept finishing and relaunching before the release");

  const exit = await runInContext("reconcileRuntimeReleaseAtBoundary()", context);
  const restartedAfterMs = Date.now() - pendingAt;
  assert.equal(exit, 0, "the runner exits for the launcher to start the new code");
  assert.deepEqual(applied, [target]);
  assert.ok(restartedAfterMs <= PASS_BUDGET_MS + 2_000, `restart took ${restartedAfterMs}ms, beyond one pass deadline`);
  assert.deepEqual(launches.filter(l => l.at > pendingAt), [], "no standing run started once the restart was pending");
  assert.equal(context.standingRuntimeTimer, null);
  assert.deepEqual(scheduler.inFlightIds(), []);
  assert.ok(log.some(line => /loads by restart: no new standing run starts/.test(line)));
  console.log(`routine launches before restart ${launches.length}; restart ${restartedAfterMs}ms after the release was noticed`);
});

test("the restart is noticed on the standing clock, not only inside a research cycle", () => {
  const tick = runnerFunction("runStandingRuntimeTick");
  assert.match(tick, /checkReleaseForRestart\(\);\s*if \(runtimeAdmissionsHeld\) return;/);
  assert.doesNotMatch(source, /requestQueuedReleaseDrain|releaseDrain/);
  for (const name of ["sleepUnlessRunNow", "holdWhilePaused"]) assert.match(runnerFunction(name), /pendingRestart\.sleep\(/);
});

test("a pending restart wakes every sleeper at once and clears for a later release", async () => {
  const pending = new PendingRestart();
  const started = Date.now();
  const sleepers = [pending.sleep(30_000), pending.sleep(30_000)];
  assert.equal(pending.mark("c".repeat(40)), true);
  assert.equal(pending.mark("d".repeat(40)), false);
  await Promise.all(sleepers);
  assert.ok(Date.now() - started < 100);
  await pending.sleep(30_000);
  pending.clear();
  assert.equal(pending.target, null);
});

test("a staging stuck on an older release cannot hold a newer one: the newer one is staged at once and handed off on the next pass", async () => {
  const a = "a".repeat(40), b = "b".repeat(40), running = "9".repeat(40);
  for (const quick of [true, false]) {
    const root = mkdtempSync(join(tmpdir(), "runner-stuck-stage-"));
    const okRun: AsyncRunCommand = async (_executable, args) => {
      if (args[0] === "worktree" && args[1] === "add") mkdirSync(args[3]!, { recursive: true });
      return { status: 0, stdout: args[0] === "rev-parse" ? `${b}\n` : "", stderr: "" };
    };
    let deployed = a;
    const context = createContext({
      AUTO_RELEASE_HANDOFF: true, RELEASE_QUICK_SWITCH: quick, ROOT: root, CODE_ROOT: root, PARENT_CODE_SHA: running,
      RUNNING_CODE_SHA: running, pendingRestart: new PendingRestart(), releaseCheck: null, runtimeAdmissionsHeld: false,
      parentChangeReported: new Set(), researchCycleActive: false, researchCycleChild: null,
      releaseStaging: new ReleaseStaging({ root, stage: input => input.targetSha === a ? new Promise(() => {})
        : stageRuntimeRelease({ ...input, run: okRun }) }),
      inspectRuntimeRelease: async () => ({ state: "UPDATE_REQUIRED", targetSha: deployed }),
      parentCodeChanged: async () => ({ changed: false, why: [] }), defaultAsyncRunCommand: okRun, stagedReleaseDirectory,
      runtimeContracts: { request: () => {} }, standingRuntimeScheduler: { inFlightIds: () => [] }, drainHunterLane: () => {},
      console: { log: () => {}, error: () => {} },
    });
    runInContext(stripTypeScriptTypes(["advanceStagedRelease", "checkReleaseForRestart", "holdForRestart"].map(runnerFunction).join("\n")), context);
    const pass = async () => { await runInContext("checkReleaseForRestart(); releaseCheck", context); };
    await pass();
    await pass();
    assert.equal(context.pendingRestart.target, null, "a release still staging holds nothing yet");
    deployed = b;
    await pass();
    assert.equal(context.releaseStaging.status().targetSha, b, "the pass that first sees B starts B's staging");
    await new Promise(resolve => setImmediate(resolve));
    await pass();
    if (quick) {
      assert.equal(context.RUNNING_CODE_SHA, b, "B is switched to on the next pass");
      assert.equal(context.CODE_ROOT, stagedReleaseDirectory(root, b));
    } else assert.equal(context.pendingRestart.target, b, "B is held for restart on the next pass");
  }
});
