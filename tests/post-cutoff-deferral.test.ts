import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { RUNTIME_NO_PROGRESS_MS, STALL_PROBE_LEAD_MS, runRuntimeChildren } from "../scripts/pilot-runtime-child.mts";
import { POST_CUTOFF_QUIET_LEAD_MS, untilQuietLimit, watchOutputClock } from "../lib/control-plane/scheduler/post-cutoff-bound.ts";
import { STALL_REPORT_PREFIX } from "../lib/control-plane/scheduler/round-progress.ts";

const boundModule = JSON.stringify(new URL("../lib/control-plane/scheduler/post-cutoff-bound.ts", import.meta.url).href);
const independentModule = JSON.stringify(new URL("../lib/ops/independent-runtime-pass.ts", import.meta.url).href);

/*
 * The returned live failure (River, 2026-10-06 ~01:10Z): on the 23:13:58Z production cycle the research child's last
 * output was at 23:30:50Z, after the dispatch cutoff, and it was killed as RESEARCH_CHILD_NO_PROGRESS at 23:40:50Z while
 * it joined its discovery lanes. Here the runner's limits are scaled down in the same proportion as production's: a lane
 * that is still running and prints nothing after the cutoff, for longer than the runner's no-progress window.
 */
const NO_PROGRESS_MS = 1_000;
const QUIET_MS = Math.round(NO_PROGRESS_MS * (RUNTIME_NO_PROGRESS_MS - POST_CUTOFF_QUIET_LEAD_MS) / RUNTIME_NO_PROGRESS_MS);
const roundChild = (bounded: boolean) => `
  import { untilQuietLimit, watchOutputClock } from ${boundModule};
  import { runIndependentRuntimePass } from ${independentModule};
  const clock = watchOutputClock();
  const finished = new Set();
  const lane = (id, run) => ({ id, run: async () => { try { await run(); } finally { finished.add(id); console.log('lane ' + id + ' ended'); } } });
  const lanes = runIndependentRuntimePass([
    lane('meetings-discovery', async () => {}),
    /* A read that never answers; its socket keeps the event loop alive, as a real one would. */
    lane('campaign-sites', () => new Promise(() => { setInterval(() => {}, 1000); })),
  ]);
  console.log('dispatch cutoff reached; joining the discovery lanes');
  if (${bounded}) {
    const joined = await untilQuietLimit(lanes, { clock, quietMs: ${QUIET_MS} });
    if (!joined.done) for (const id of ['meetings-discovery', 'campaign-sites'].filter(id => !finished.has(id)))
      console.log(id + ' lane deferred: still running past the dispatch cutoff; its work remains owed');
  } else {
    await lanes;
  }
  console.log('round finished');
  process.exit(0);
`;

test("a lane still running and silent after the cutoff for longer than the runner's window ends the round as a named deferral", async () => {
  const [result] = await runRuntimeChildren([{ id: "research-cycle", executable: process.execPath,
    args: ["--experimental-strip-types", "--input-type=module", "-e", roundChild(true)] }], {
    cwd: process.cwd(), env: process.env, maxBufferBytes: 1 << 16, noProgressMs: NO_PROGRESS_MS });
  assert.equal(result!.termination, "EXITED", result!.errorMessage ?? "");
  assert.equal(result!.status, 0);
  assert.match(result!.stdout, /campaign-sites lane deferred: still running past the dispatch cutoff; its work remains owed/);
  assert.doesNotMatch(result!.stdout, /meetings-discovery lane deferred/, "a lane that finished is not named");
  assert.match(result!.stdout, /round finished/);
});

test("the same join without the bound is killed as RESEARCH_CHILD_NO_PROGRESS (the live failure)", async () => {
  const [result] = await runRuntimeChildren([{ id: "research-cycle", executable: process.execPath,
    args: ["--experimental-strip-types", "--input-type=module", "-e", roundChild(false)] }], {
    cwd: process.cwd(), env: process.env, maxBufferBytes: 1 << 16, noProgressMs: NO_PROGRESS_MS });
  assert.equal(result!.termination, "TIMED_OUT");
  assert.match(result!.errorMessage!, /RESEARCH_CHILD_NO_PROGRESS/);
  assert.doesNotMatch(result!.stdout, /round finished/);
});

test("the production quiet limit ends inside the runner's window and before its stall probe", () => {
  const quiet = RUNTIME_NO_PROGRESS_MS - POST_CUTOFF_QUIET_LEAD_MS;
  assert.ok(quiet > 0);
  assert.ok(quiet < RUNTIME_NO_PROGRESS_MS - STALL_PROBE_LEAD_MS, "the wait ends before the runner asks what the round waits on");
  assert.ok(quiet >= 5 * 60_000, "a slow but answering read still has minutes to finish");
});

test("output during the wait moves the limit forward; a stall answer does not; work that settles is returned", async () => {
  let ms = 0;
  const lines: string[] = [];
  const stream = { write: (chunk: unknown) => { lines.push(String(chunk)); return true; } };
  const clock = watchOutputClock({ streams: [stream], now: () => ms });
  const timers: { at: number; run: () => void }[] = [];
  const setTimer = (run: () => void, wait: number) => { const t = { at: ms + wait, run }; timers.push(t); return { clear: () => { timers.splice(timers.indexOf(t), 1); } }; };
  const advance = (to: number) => { ms = to; for (const t of [...timers].filter(t => t.at <= ms)) { timers.splice(timers.indexOf(t), 1); t.run(); } };

  const never = untilQuietLimit(new Promise<string>(() => undefined), { clock, quietMs: 100, now: () => ms, setTimer });
  advance(60);
  stream.write("  lane meetings-discovery: 60ms\n");
  advance(120);
  stream.write(`  ${STALL_REPORT_PREFIX} waiting on discovery-lanes:join\n`);
  advance(159);
  let settled = false;
  void never.then(() => { settled = true; });
  await Promise.resolve();
  assert.equal(settled, false, "the line at 60 moved the limit to 160; the stall answer at 120 did not");
  advance(160);
  const ended = await never;
  assert.deepEqual(ended, { done: false, quietMs: 100 });

  stream.write("  promotion tail: reading held bytes\n");
  const answered = await untilQuietLimit(Promise.resolve("bytes"), { clock, quietMs: 100, now: () => ms, setTimer });
  assert.deepEqual(answered, { done: true, value: "bytes" });
  assert.equal(timers.length, 0, "the timer is cleared when the work settles");
});

test("the round races its post-cutoff waits against the quiet limit and names what it deferred", () => {
  const round = readFileSync(new URL("../scripts/freshness-shadow.mts", import.meta.url), "utf8");
  assert.match(round, /const outputClock = watchOutputClock\(\);/);
  assert.match(round, /POST_CUTOFF_QUIET_MS = RUNTIME_NO_PROGRESS_MS - POST_CUTOFF_QUIET_LEAD_MS/);
  assert.match(round, /const joined = await boundedAfterCutoff\(discoveryLaneRun\);/);
  assert.match(round, /lane deferred: still running/);
  assert.match(round, /await boundedAfterCutoff\(vault\.readBack\(entry\.key\)\)/);
  assert.match(round, /await boundedAfterCutoff\(readHeldBody\(\)\)/);
  /* Both candidate lanes stop starting reads at the cutoff. */
  assert.match(round, /methodVersion: \(await readMethodKnowledge\(repos\)\)\.version,\n\s+deadlineMs: dispatchDeadlineMs,/);
  assert.match(round, /spaceOut: spacer,\n\s+deadlineMs: dispatchDeadlineMs,\n\s+openFor:/);
  const publications = readFileSync(new URL("../lib/control-plane/promotion/campaign-publication-cycle.ts", import.meta.url), "utf8");
  assert.doesNotMatch(publications, /MAX_SAFE_INTEGER/);
});
