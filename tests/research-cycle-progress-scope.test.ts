import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { RUNTIME_NO_PROGRESS_MS, runRuntimeChildren } from "../scripts/pilot-runtime-child.mts";
import { POST_CUTOFF_QUIET_LEAD_MS } from "../lib/control-plane/scheduler/post-cutoff-bound.ts";
import { PLANNER_SCOPE_PREFIX, progressLines } from "../lib/control-plane/scheduler/round-progress.ts";
import { STATE_DEFERRED, runStatePlanningRound } from "../lib/control-plane/scheduler/state-planning.ts";

const boundModule = JSON.stringify(new URL("../lib/control-plane/scheduler/post-cutoff-bound.ts", import.meta.url).href);
const progressModule = JSON.stringify(new URL("../lib/control-plane/scheduler/round-progress.ts", import.meta.url).href);

// The runner's limits scaled down in proportion (10 min -> 4 s; the round's quiet limit sits 3 min inside it).
const NO_PROGRESS_MS = 4_000;
const QUIET_MS = Math.round(NO_PROGRESS_MS * (RUNTIME_NO_PROGRESS_MS - POST_CUTOFF_QUIET_LEAD_MS) / RUNTIME_NO_PROGRESS_MS);
// How long into a state a fixed line prints: late enough that a bound measured from it ends after the runner's kill
// unless the runner counted that same line.
const FIXED_LINE_AT_MS = 1_500;

/**
 * The live round: the supervisor forks one planner per state on the runner's own pipe. Every planner prints the same
 * fixed lines ("candidate documents not run: ...") and then waits on a worker wave that never answers, bounded by its
 * own quiet clock. The planner's clock is fresh per process; the runner's list of lines already seen lasts the round.
 */
const roundOf = (states: readonly string[], announce: boolean) => `
  import { spawn } from "node:child_process";
  import { PLANNER_SCOPE_PREFIX } from ${progressModule};
  const planner = (state) => \`
    import { untilQuietLimit, watchOutputClock } from ${boundModule};
    const clock = watchOutputClock();
    console.log('phase dispatch: ' + Math.round(Math.random() * 1e6) + 'ms (${"$"}{state})');
    await new Promise(r => setTimeout(r, ${FIXED_LINE_AT_MS}));
    console.log('candidate documents not run: exact selected hunt receipt is unavailable');
    const early = await untilQuietLimit(new Promise(() => { setInterval(() => {}, 1000); }), { clock, quietMs: ${QUIET_MS} });
    if (!early.done) console.log('early worker wave deferred in ${"$"}{state}: its unsettled tasks remain owed');
    process.exit(0);
  \`;
  for (const state of ${JSON.stringify(states)}) {
    if (${announce}) console.log(PLANNER_SCOPE_PREFIX + ' ' + state + ' ' + new Date().toISOString());
    const child = spawn(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', planner(state)],
      { stdio: ['ignore', 'inherit', 'inherit'] });
    const code = await new Promise(resolve => child.once('exit', resolve));
    console.log('planned ' + state + ' exit ' + code);
    if (code !== 0) process.exit(1);
  }
  console.log('round finished');
  process.exit(0);
`;

const runRound = (states: readonly string[], announce: boolean) => runRuntimeChildren([{ id: "research-cycle", executable: process.execPath,
  args: ["--experimental-strip-types", "--input-type=module", "-e", roundOf(states, announce)] }], {
  cwd: process.cwd(), env: process.env, maxBufferBytes: 1 << 16, noProgressMs: NO_PROGRESS_MS });

test("without a planner scope marker the second state is killed: the runner already saw its fixed line (the live failure)", async () => {
  const [result] = await runRound(["ak", "al"], false);
  assert.equal(result!.termination, "TIMED_OUT", `${result!.stdout}\n${result!.stderr}`);
  assert.match(result!.errorMessage!, /RESEARCH_CHILD_NO_PROGRESS/);
  assert.match(result!.stdout, /planned ak exit 0/, "the first state's fixed line was new to the runner, so it ended by its own bound");
  assert.doesNotMatch(result!.stdout, /round finished/);
});

test("a marker printed before each planner makes the runner count a planner's lines the way the planner does", async () => {
  const [result] = await runRound(["ak", "al", "az"], true);
  assert.equal(result!.termination, "EXITED", `${result!.errorMessage ?? ""}\n${result!.stdout}\n${result!.stderr}`);
  assert.equal(result!.status, 0);
  for (const state of ["ak", "al", "az"]) assert.match(result!.stdout, new RegExp(`early worker wave deferred in ${state}`));
  assert.match(result!.stdout, /round finished/);
});

test("the marker starts a new list of seen lines on both streams; a hung process cannot forge it by repeating a line", () => {
  const scope = {};
  const out = progressLines(scope);
  const err = progressLines(scope);
  assert.equal(out("worker slots: waiting for host memory\n"), 1);
  assert.equal(err("worker slots: waiting for host memory\n"), 0, "one list of seen lines is shared by the streams of a scope");
  assert.equal(out(`${PLANNER_SCOPE_PREFIX} ak 2026-11-08T00:00:00.000Z\n`), 1);
  assert.equal(err("worker slots: waiting for host memory\n"), 1, "after the marker the line is new again, on either stream");
  assert.equal(out("worker slots: waiting for host memory\n"), 0, "and counts only once in the new scope");
  assert.equal(out(`${PLANNER_SCOPE_PREFIX} ak 2026-11-08T00:00:00.000Z\n`), 0, "the same marker repeated is not progress");
});

test("the supervisor announces each planner before it starts, and a release handoff defers the states it never started", () => {
  const round = readFileSync(new URL("../scripts/freshness-shadow.mts", import.meta.url), "utf8");
  assert.match(round, /console\.log\(`\$\{PLANNER_SCOPE_PREFIX\} \$\{state\} \$\{nowIso\(\)\}`\);\n\s+const child=fork\(/);
  assert.match(round, /failureReasons\.set\(state,"not started \(release handoff\)"\);resolve\(STATE_DEFERRED\)/);
  assert.match(round, /process\.exit\(result\.failed\.length\?1:0\)/, "only a state that really failed makes the round exit non-zero");
});

test("a planning round counts a state it deferred as neither completed nor failed", async () => {
  const round = await runStatePlanningRound(async state => state === "ak" ? true : state === "al" ? false : STATE_DEFERRED, ["ak", "al", "az", "ca"]);
  assert.deepEqual(round, { completed: 1, failed: ["al"], deferred: ["az", "ca"] });
});

// A read that walks a table page by page for longer than the runner's window (the live `dispatchState.readOpen` stall):
// every page completes, and none of it prints unless the scan reports.
const scanModule = JSON.stringify(new URL("../lib/control-plane/repository/scan-progress.ts", import.meta.url).href);
const longScan = (reported: boolean) => `
  import { roundProgressReporter } from ${progressModule};
  import { noteScanProgress, observeScanProgress } from ${scanModule};
  const progress = roundProgressReporter({ everyMs: 300 });
  observeScanProgress(label => progress.note(label));
  console.log('phase retirement: 76ms; 1 repository calls');
  for (let page = 0; page < 20; page++) {
    await new Promise(resolve => setTimeout(resolve, 300));
    if (${reported}) noteScanProgress('open work pages read');
  }
  progress.flush();
  console.log('open work read');
  process.exit(0);
`;
const runScan = (reported: boolean) => runRuntimeChildren([{ id: "research-cycle", executable: process.execPath,
  args: ["--experimental-strip-types", "--input-type=module", "-e", longScan(reported)] }], {
  cwd: process.cwd(), env: process.env, maxBufferBytes: 1 << 16, noProgressMs: NO_PROGRESS_MS });

test("a silent page-by-page read longer than the runner's window is killed (the live failure)", async () => {
  const [result] = await runScan(false);
  assert.equal(result!.termination, "TIMED_OUT");
  assert.match(result!.errorMessage!, /RESEARCH_CHILD_NO_PROGRESS/);
  assert.doesNotMatch(result!.stdout, /open work read/);
});

test("the same read, reporting each finished page, completes", async () => {
  const [result] = await runScan(true);
  assert.equal(result!.termination, "EXITED", `${result!.errorMessage ?? ""}\n${result!.stdout}`);
  assert.equal(result!.status, 0);
  assert.match(result!.stdout, /round progress: open work pages read \d+ finished/);
  assert.match(result!.stdout, /open work read/);
});

test("the planner reports its open-work read and names it in the stall report", () => {
  const round = readFileSync(new URL("../scripts/freshness-shadow.mts", import.meta.url), "utf8");
  assert.match(round, /observeScanProgress\(label => roundProgress\.note\(label\)\);/);
  assert.match(round, /await pending\.step\("dispatch-state:read-open", \(\) => recoveryRepos\.dispatchState\.readOpen\(/);
  assert.doesNotMatch(round, /await recoveryRepos\.dispatchState\.readOpen\(/, "the read is never an unlabelled await");
});
