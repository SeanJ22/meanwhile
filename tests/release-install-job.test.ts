import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import * as nodeModule from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createContext, runInContext } from "node:vm";

import { JobRunBook } from "../lib/control-plane/job-runs.ts";
import { IndependentRuntimeLaneScheduler } from "../lib/ops/independent-runtime-pass.ts";
import { stageRuntimeRelease, stagedReleaseIsReady, readStagedRelease, type AsyncRunCommand } from "../lib/ops/runtime-release-stage.ts";

const source = readFileSync(new URL("../scripts/pilot-runner.mts", import.meta.url), "utf8");
const { stripTypeScriptTypes } = nodeModule as typeof nodeModule & { stripTypeScriptTypes(source: string): string };
const RUNNING = "1".repeat(40);
const TARGET = "4".repeat(40);

test("installing a release is a scheduled job: it never blocks other lanes, a failure is a failed job run while the old code keeps serving, and the next pass retries", async () => {
  const root = mkdtempSync(join(tmpdir(), "release-install-job-"));
  let installAttempts = 0;
  let failInstall = true;
  let openInstall: () => void = () => {};
  const installGate = new Promise<void>(resolve => { openInstall = resolve; });
  const run: AsyncRunCommand = async (executable, args) => {
    const line = `${executable} ${args.join(" ")}`;
    if (line.startsWith("git worktree add")) mkdirSync(args[3]!, { recursive: true });
    if (line.startsWith("git rev-parse")) return { status: 0, stdout: `${TARGET}\n`, stderr: "" };
    if (line.includes("pnpm install")) {
      installAttempts += 1;
      await installGate;
      return failInstall ? { status: 1, stdout: "", stderr: "ERR_PNPM_FROZEN_LOCKFILE" } : { status: 0, stdout: "", stderr: "" };
    }
    return { status: 0, stdout: "", stderr: "" };
  };
  const log: string[] = [];
  const context = createContext({
    AUTO_RELEASE_HANDOFF: true, ROOT: root, CODE_ROOT: root, RUNNING_CODE_SHA: RUNNING, wantedRelease: TARGET,
    stagedReleaseIsReady, stageRuntimeRelease: (input: Parameters<typeof stageRuntimeRelease>[0]) => stageRuntimeRelease({ ...input, run }),
    AbortSignal, Date, console: { log: (line: string) => log.push(line), error: (line: string) => log.push(line) },
  });
  runInContext(stripTypeScriptTypes(source.match(/async function runReleaseInstall\([\s\S]*?\n\}/)![0]), context);

  let clock = Date.now(); // the job derives its deadline from the real clock
  const jobRuns = new JobRunBook(() => new Date(clock).toISOString());
  let otherLaneRuns = 0;
  const scheduler = new IndependentRuntimeLaneScheduler([
    { id: "other-lane", everyMs: 1_000, budgetMs: 5_000, run: async () => { otherLaneRuns += 1; } },
    { id: "release-install", everyMs: 60_000, budgetMs: 20 * 60_000, cadenceIsLaunch: true, run: deadlineMs => runInContext(`runReleaseInstall(${deadlineMs})`, context) },
  ], outcome => {
    if (outcome.state === "FAILED") jobRuns.failed(outcome.id, outcome.error); else jobRuns.completed(outcome.id);
  }, id => jobRuns.started(id));
  for (const lane of scheduler.lanes) jobRuns.registerLane(lane);
  assert.equal(jobRuns.merged(null)["release-install"]!.everyMs, 60_000, "the recorded interval is the real cadence, not the 20-minute budget");
  assert.equal(jobRuns.merged(null)["other-lane"]!.everyMs, 5_000);

  // The first pass starts the install; it is still running, and other lanes keep launching meanwhile.
  assert.deepEqual(scheduler.tick(clock), ["other-lane", "release-install"]);
  clock += 2_000;
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(scheduler.tick(clock), ["other-lane"], "the install is one live run; the other lane is not held up by it");
  clock += 2_000;
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(scheduler.tick(clock), ["other-lane"]);
  assert.equal(otherLaneRuns, 3);
  assert.deepEqual(scheduler.inFlightIds().filter(id => id === "release-install"), ["release-install"]);

  // The install fails: the job run is FAILED with the reason, nothing switched, and the staging record says FAILED.
  openInstall();
  await scheduler.waitForIdle();
  const failed = jobRuns.merged(null)["release-install"]!;
  assert.match(failed.lastError ?? "", /FROZEN_INSTALL_FAILED/);
  assert.match(failed.lastError ?? "", /keeps serving 11111111/);
  assert.equal(failed.lastFailedAt, new Date(clock).toISOString());
  assert.equal(failed.lastFinishedAt, null, "a failed install is not a finished run");
  assert.equal(context.RUNNING_CODE_SHA, RUNNING);
  assert.equal(context.CODE_ROOT, root);
  assert.equal(stagedReleaseIsReady(root, TARGET), false);
  assert.equal(readStagedRelease(root)?.state, "FAILED");

  // Before the next scheduled pass the job is not launched again; at it, the install is retried and succeeds.
  clock += 30_000;
  assert.ok(!scheduler.tick(clock).includes("release-install"));
  failInstall = false;
  clock += 30_000;
  assert.ok(scheduler.tick(clock).includes("release-install"), "the next scheduled pass retries the install");
  await scheduler.waitForIdle();
  assert.equal(installAttempts, 2);
  assert.equal(stagedReleaseIsReady(root, TARGET), true);
  const retried = jobRuns.merged(null)["release-install"]!;
  assert.equal(retried.lastFinishedAt, new Date(clock).toISOString());
  assert.equal(context.RUNNING_CODE_SHA, RUNNING, "the job only installs; the switch is the release check's");
  assert.ok(log.some(line => /release 44444444 is installed beside the running one/.test(line)));

  // Once installed, later passes have nothing to do.
  clock += 60_000;
  scheduler.tick(clock);
  await scheduler.waitForIdle();
  assert.equal(installAttempts, 2);
});
