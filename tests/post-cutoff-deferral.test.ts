import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { RUNTIME_NO_PROGRESS_MS, STALL_PROBE_LEAD_MS, runRuntimeChildren } from "../scripts/pilot-runtime-child.mts";
import { POST_CUTOFF_QUIET_LEAD_MS, untilQuietLimit, watchOutputClock } from "../lib/control-plane/scheduler/post-cutoff-bound.ts";
import { STALL_REPORT_PREFIX, progressLines } from "../lib/control-plane/scheduler/round-progress.ts";

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
  assert.match(round, /methodVersion,\n\s+deadlineMs: dispatchDeadlineMs,/);
  assert.match(round, /spaceOut: spacer,\n\s+deadlineMs: dispatchDeadlineMs,\n\s+openFor:/);
  const publications = readFileSync(new URL("../lib/control-plane/promotion/campaign-publication-cycle.ts", import.meta.url), "utf8");
  assert.doesNotMatch(publications, /MAX_SAFE_INTEGER/);
});

/*
 * Sean, 2026-10-06 12:07 AM EDT: release 6's first round was killed after 43 minutes; the stall answer read "pending:
 * campaign-sites; last phase: occurrence-and-debt-commit". The lane now carries its own bound at the dispatch cutoff plus
 * a settle time, and the round's quiet clock reads output by the runner's rule, so a line the runner ignores (a repeat,
 * a beat) cannot hold a wait open past the runner's kill.
 */
const roundWithStuckCampaignSites = `
  import { untilQuietLimit, watchOutputClock } from ${boundModule};
  import { runIndependentRuntimePass } from ${independentModule};
  /* campaign-site-cycle.ts's withinWallTime, inline: that module's imports outlast this scaled window at start-up. */
  const withinWallTime = (work, ms) => { work.catch(() => undefined); let t;
    return Promise.race([work.then(value => ({ done: true, value })), new Promise(r => { t = setTimeout(() => r({ done: false }), ms); })]).finally(() => clearTimeout(t)); };
  const clock = watchOutputClock();
  const cutoff = Date.now() + 100;
  const SETTLE_MS = ${Math.round(QUIET_MS / 3)};
  const finished = new Set();
  const lane = (id, run) => ({ id, run: async () => { try { await run(); } finally { finished.add(id); console.log('lane ' + id + ' ended'); } } });
  const campaignSites = async () => {
    /* The chain waits on something that never answers; its socket keeps the event loop alive, as a real one would. */
    const bounded = await withinWallTime(new Promise(() => { setInterval(() => {}, 1000); }), cutoff + SETTLE_MS - Date.now());
    console.log(bounded.done ? 'campaign sites ran' : 'campaign-site pass deferred: still waiting on the campaign-site chain after the dispatch cutoff; its unread leads and unverified sites remain owed');
  };
  const lanes = runIndependentRuntimePass([lane('meetings-discovery', async () => {}), lane('campaign-sites', campaignSites)]);
  /* The early worker wave settles quietly, repeating one line the runner counts only once and printing beats it never counts. */
  const repeat = setInterval(() => { console.log('  worker slots: waiting for host memory'); console.log('  runner heartbeat'); }, ${Math.round(NO_PROGRESS_MS / 10)});
  const early = await untilQuietLimit(new Promise(() => undefined), { clock, quietMs: ${QUIET_MS} });
  clearInterval(repeat);
  if (!early.done) console.log('early worker wave deferred: still settling; its unsettled tasks remain owed');
  const joined = await untilQuietLimit(lanes, { clock, quietMs: ${QUIET_MS} });
  if (!joined.done) console.log('discovery lanes deferred at the join');
  console.log('round finished');
  process.exit(0);
`;

test("a campaign-sites lane that never returns ends as a named deferral inside the runner's window, and the round finishes", async () => {
  const [result] = await runRuntimeChildren([{ id: "research-cycle", executable: process.execPath,
    args: ["--experimental-strip-types", "--input-type=module", "-e", roundWithStuckCampaignSites] }], {
    cwd: process.cwd(), env: process.env, maxBufferBytes: 1 << 16, noProgressMs: NO_PROGRESS_MS });
  assert.equal(result!.termination, "EXITED", `${result!.errorMessage ?? ""}\n${result!.stdout}\n${result!.stderr}`);
  assert.match(result!.stdout, /campaign-site pass deferred: still waiting on the campaign-site chain/);
  assert.match(result!.stdout, /lane campaign-sites ended/);
  assert.match(result!.stdout, /early worker wave deferred/, "repeated lines and beats did not hold the early wave's wait open");
  assert.doesNotMatch(result!.stdout, /discovery lanes deferred at the join/, "the lane's own bound ended it before the join had to");
  assert.match(result!.stdout, /round finished/);
});

test("the round's quiet clock counts a line as the runner does: once, and never a beat or a stall answer", () => {
  const renews = progressLines();
  assert.equal(renews("  lane meetings-discovery: 60ms\n"), 1);
  assert.equal(renews("  lane meetings-discovery: 60ms\n"), 0, "a repeated line is not progress to the runner");
  assert.equal(renews("  runner heartbeat at 04:20Z\n"), 0);
  assert.equal(renews(`  ${STALL_REPORT_PREFIX} pending: campaign-sites\n`), 0);
  assert.equal(renews("  campaign sites "), 0, "a partial line waits for its end");
  assert.equal(renews("deferred\n\n"), 1);

  let ms = 0;
  const stream = { write: (_chunk: unknown) => true };
  const clock = watchOutputClock({ streams: [stream], now: () => ms });
  ms = 10; stream.write("  worker slots: waiting for host memory\n");
  ms = 20; stream.write("  worker slots: waiting for host memory\n");
  ms = 30; stream.write("  runner heartbeat\n");
  assert.equal(clock.lastOutputAt(), 10);
});

test("the campaign-sites lane is bounded at the cutoff plus a settle time that ends inside the round's quiet limit", async () => {
  const round = readFileSync(new URL("../scripts/freshness-shadow.mts", import.meta.url), "utf8");
  const settle = /const CAMPAIGN_SITES_SETTLE_MS = (\d+) \* 60_000;/.exec(round);
  assert.ok(settle, "the lane names its settle time");
  const { CAMPAIGN_SITE_REQUEST_TIMEOUT_MS } = await import("../lib/control-plane/promotion/campaign-site-cycle.ts");
  const settleMs = Number(settle[1]) * 60_000;
  assert.ok(settleMs > CAMPAIGN_SITE_REQUEST_TIMEOUT_MS, "a read in flight at the cutoff can still answer");
  assert.ok(settleMs < RUNTIME_NO_PROGRESS_MS - POST_CUTOFF_QUIET_LEAD_MS, "the lane ends before the round's join would have to defer it");
  assert.match(round, /\}\)\(\), dispatchDeadlineMs \+ CAMPAIGN_SITES_SETTLE_MS - Date\.now\(\)\);/);
  for (const label of ["the saved-page index", "the held Marginalia answers", "the method version", "the campaign-site chain"]) {
    assert.ok(round.includes(`step("${label}"`), `the lane labels its wait on ${label}`);
  }
  assert.match(round, /return pending\.step\(`campaign-sites:\$\{label\}`, run\);/);
  assert.match(round, /deferred: still waiting on \$\{waitingOn\}/);
  /* The early worker wave was the one unlabelled wait between the lanes' start and their join. */
  assert.match(round, /pending\.enter\("autonomous-workers:early-wave"\);\n\s+const early = await boundedAfterCutoff\(earlyOriginal\);/);
  assert.match(round, /const wave = await boundedAfterCutoff\(runAutonomousProcesses\(\)\);/);
  assert.doesNotMatch(round, /await earlyOriginal;/);
});
