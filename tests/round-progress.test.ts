import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RUNTIME_NO_PROGRESS_MS, runRuntimeChildren } from "../scripts/pilot-runtime-child.mts";
import { answerStallProbes, roundProgressReporter, RESEARCH_STALL_PROBE, STALL_REPORT_PREFIX } from "../lib/control-plane/scheduler/round-progress.ts";
import { runLeaseWorkerProcesses } from "../lib/control-plane/workers/process-pool.ts";
import { CENSUS_LANE_BUDGET_MS } from "../lib/control-plane/discovery/census-lane.ts";

const progressModule = JSON.stringify(new URL("../lib/control-plane/scheduler/round-progress.ts", import.meta.url).href);
const stallModule = JSON.stringify(new URL("../lib/control-plane/scheduler/cycle-stall.ts", import.meta.url).href);
// Cold child imports can exceed 400 ms under suite load. The 3-second wave still outlasts this guard,
// so the reporting case must keep renewing it and the silent case must be ended before completion.
const WAVE_QUIET_MS = 2_000;

const waveChild = (report: boolean) => `
  import { roundProgressReporter } from ${progressModule};
  const progress = roundProgressReporter({ everyMs: 100 });
  console.log('lease worker process: pid 1; pulls existing RouteTasks');
  let finished = 0;
  const wave = setInterval(() => {
    finished++;
    ${report ? "progress.note('worker wave');" : ""}
    if (finished === 24) { clearInterval(wave); console.log('worker fleet: 24 finished'); process.disconnect(); }
  }, 125);
`;

test("a worker wave that finishes tasks silently for longer than the quiet allowance is ended (the live failure)", async () => {
  const [result] = await runRuntimeChildren([{ id: "research-cycle", executable: process.execPath,
    args: ["--experimental-strip-types", "--input-type=module", "-e", waveChild(false)] }], {
    cwd: process.cwd(), env: process.env, maxBufferBytes: 1 << 16, noProgressMs: WAVE_QUIET_MS });
  assert.equal(result!.termination, "TIMED_OUT");
  assert.match(result!.errorMessage!, /RESEARCH_CHILD_NO_PROGRESS/);
  assert.doesNotMatch(result!.stdout, /worker fleet: 24 finished/);
});

test("the same wave reporting its finished tasks completes the round", async () => {
  const [result] = await runRuntimeChildren([{ id: "research-cycle", executable: process.execPath,
    args: ["--experimental-strip-types", "--input-type=module", "-e", waveChild(true)] }], {
    cwd: process.cwd(), env: process.env, maxBufferBytes: 1 << 16, noProgressMs: WAVE_QUIET_MS });
  assert.equal(result!.termination, "EXITED");
  assert.equal(result!.status, 0);
  assert.match(result!.stdout, /round progress: worker wave \d+ finished/);
  assert.match(result!.stdout, /worker fleet: 24 finished/);
});

test("a round stuck on one await names it before the limit, and the answer does not keep it alive", async () => {
  const source = `
    import { answerStallProbes } from ${progressModule};
    import { PendingOperations, describePending } from ${stallModule};
    const pending = new PendingOperations();
    answerStallProbes({ describe: () => describePending(pending.snapshot()) });
    pending.phaseFinished('dispatch');
    console.log('phase dispatch: 10ms');
    const leave = pending.enter('autonomous-workers');
    pending.storeCallStarted('routeTasks.read');
    await new Promise(() => { setInterval(() => {}, 1000); });
    leave();
  `;
  const [result] = await runRuntimeChildren([{ id: "research-cycle", executable: process.execPath,
    args: ["--experimental-strip-types", "--input-type=module", "-e", source] }], {
    cwd: process.cwd(), env: process.env, maxBufferBytes: 1 << 16, noProgressMs: 600 });
  assert.equal(result!.termination, "TIMED_OUT");
  assert.match(result!.errorMessage!, /RESEARCH_CHILD_NO_PROGRESS/);
  assert.match(result!.stderr, new RegExp(`${STALL_REPORT_PREFIX} pending: autonomous-workers; store call in flight: routeTasks\\.read; last phase: dispatch`));
  assert.ok(result!.stderr.indexOf(STALL_REPORT_PREFIX) < result!.stderr.indexOf("RESEARCH_CHILD_NO_PROGRESS"),
    "the report comes before the round is ended");
});

test("finished work is printed at most once per interval, and the last count is never lost", async () => {
  const lines: string[] = [];
  const progress = roundProgressReporter({ write: line => lines.push(line), everyMs: 80 });
  progress.note("dispatch");
  assert.deepEqual(lines, ["  round progress: dispatch 1 finished"]);
  progress.note("dispatch");
  progress.note("worker wave");
  assert.equal(lines.length, 1, "a second line inside the interval waits");
  await new Promise(resolve => setTimeout(resolve, 150));
  assert.deepEqual(lines.at(-1), "  round progress: dispatch 2 finished · worker wave 1 finished");
  progress.flush();
  assert.equal(lines.length, 2, "nothing new, nothing printed");
});

test("only the runner's probe is answered", () => {
  const lines: string[] = [];
  let listener: (message: unknown) => void = () => {};
  answerStallProbes({ describe: () => "pending: x; last phase: y", on: l => { listener = l; }, write: line => lines.push(line) });
  listener({ kind: "RUNTIME_RELEASE_DRAIN" });
  listener(null);
  listener({ kind: RESEARCH_STALL_PROBE });
  assert.deepEqual(lines, [`  ${STALL_REPORT_PREFIX} pending: x; last phase: y`]);
});

test("a worker process ended by its timer says so", async () => {
  const root = await mkdtemp(join(tmpdir(), "round-progress-worker-"));
  try {
    await mkdir(join(root, "scripts"));
    await writeFile(join(root, "scripts/register-test-loader.mjs"), "");
    await writeFile(join(root, "worker.mjs"), "process.once('message', () => { setInterval(() => {}, 1000); });");
    const ended: string[] = [];
    const results = await runLeaseWorkerProcesses({ entry: "worker.mjs", childTimeoutMs: 300,
      config: { root, postgres: false, taskIds: ["owed"], modelEnabled: false, searchEnabled: false, ceilingUsd: 0, fundedSubjects: [] },
      capacity: () => 1, transportFor: () => async () => { throw new Error("no model in this fixture"); },
      onExited: (pid, why) => ended.push(`${pid}: ${why}`) });
    assert.equal(results[0]!.outcome, "FAILED");
    assert.equal(ended.length, 1);
    assert.match(ended[0]!, /WORKER_CHILD_TIMEOUT/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("the round wires its long phases to the reporter and ends a hung worker before the runner's limit", () => {
  const round = readFileSync(new URL("../scripts/freshness-shadow.mts", import.meta.url), "utf8");
  assert.match(round, /answerStallProbes\(\{ describe: \(\) => describePending\(pending\.snapshot\(\)\) \}\)/);
  for (const label of ["dispatch", "worker wave"]) assert.ok(round.includes(`roundProgress.note("${label}")`), label);
  assert.ok(!round.includes('roundProgress.note("meetings walks")'));
  const census = readFileSync(new URL("../lib/control-plane/discovery/platform-census-runtime.ts", import.meta.url), "utf8");
  const watchdog = readFileSync(new URL("../lib/control-plane/discovery/platform-census-watchdog.ts", import.meta.url), "utf8");
  assert.match(watchdog, /CENSUS_PROGRESS/);
  assert.match(census, /platformCensusWatchdog\(deadline\)/);
  for (const label of ["public page", "government", "control read", "registration read"]) assert.ok(census.includes(`progress.note("${label}")`), label);
  assert.ok(CENSUS_LANE_BUDGET_MS - 60_000 < RUNTIME_NO_PROGRESS_MS);
  assert.match(round, /childTimeoutMs: RUNTIME_NO_PROGRESS_MS - 60_000/);
  assert.ok(RUNTIME_NO_PROGRESS_MS - 60_000 > 8 * 60_000, "a hunter's own 8-minute wall still ends it first");
});

test("a census blocked on an await is ended by its own wall before the parent limit", async () => {
  const watchdog = JSON.stringify(new URL("../lib/control-plane/discovery/platform-census-watchdog.ts", import.meta.url).href);
  const [result] = await runRuntimeChildren([{ id: "platform-census", executable: process.execPath,
    args: ["--experimental-strip-types", "--input-type=module", "-e", `import { platformCensusWatchdog } from ${watchdog};
      platformCensusWatchdog(Date.now() + 100); setInterval(() => {}, 1000); await new Promise(() => {});`] }],
    { cwd: process.cwd(), env: process.env, maxBufferBytes: 1 << 16, noProgressMs: 3000 });
  assert.equal(result!.termination, "EXITED");
  assert.equal(result!.status, 1);
  assert.match(result!.stderr, /CENSUS_PASS_TIMEOUT/);
});
