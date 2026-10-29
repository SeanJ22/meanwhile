import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { HUNT_STATES, requestHuntStop } from "../lib/control-plane/hunt-orders.ts";
import { readIntents, type ResearchIntent } from "../lib/control-plane/scheduler/research-policy.ts";
import { admitJobLaunch, JOB_BREAKER_PATH_ENV } from "../lib/control-plane/job-breaker-local.ts";
import { runResearchLoop } from "../lib/control-plane/scheduler/research-loop.ts";
import { JobRunBook } from "../lib/control-plane/job-runs.ts";
import { stalledJobs } from "../lib/control-plane/line-keeper/jobs.ts";

const intent = (action: string, at: string) => ({ formatVersion: 1, kind: "INTENT", intentId: `${action}:${at}`, action, actor: "admin",
  adminSessionRef: "s", requestedAt: at, note: null }) as ResearchIntent;
const T0 = Date.parse("2026-10-29T07:00:00Z");
const breaker = (jobs: object) => {
  const path = join(mkdtempSync(join(tmpdir(), "breaker-")), "breaker.json");
  writeFileSync(path, JSON.stringify({ checkedAt: new Date(T0).toISOString(), hour: new Date(T0).toISOString(), jobs }));
  return { ...process.env, [JOB_BREAKER_PATH_ENV]: path };
};

/** The runner's research clock with the cycle and its digest replaced. */
async function loop(hold: () => string | null) {
  const log: string[] = [];
  await runResearchLoop({ cycles: 1, waitForOwner: async () => ({}), releaseExit: async () => null, hold,
    held: async reason => { log.push(`held: ${reason}`); }, cycle: async n => { log.push(`cycle ${n}`); return { ok: true, waitMs: async () => 0 }; },
    sleep: async () => undefined, recover: async error => { throw error; } });
  return log;
}

test("Stop every hunt in every state, with no Send, no longer holds the research cycle (Oct 25-29)", async () => {
  const repos = createMemoryRepositories();
  await requestHuntStop(repos, { receiptId: "expansion.scope.stopAll:v6-e7df6dfc", at: "2026-10-25T05:03:32.290Z", actor: "adm" });
  for (const state of HUNT_STATES) assert.equal((await repos.huntOrders.latestStop(state))?.value.requestedAt, "2026-10-25T05:03:32.290Z");
  const intents = [intent("PAUSE_RUNNER", "2026-10-25T05:03:54.068Z"), intent("RESUME_RUNNER", "2026-10-26T03:38:06.420Z"),
    intent("RUN_CYCLE_NOW", "2026-10-29T06:33:22.288Z")];
  assert.equal(readIntents(intents).runnerPause.paused, false);
  const env = breaker({ "place-maps": { seen: new Date(T0).toISOString(), times: 8 } });
  assert.deepEqual(await loop(() => admitJobLaunch("research-cycle", env, T0) ? null : "slowed"), ["cycle 1"]);
  for (const script of ["scripts/pilot-runner.mts", "scripts/freshness-shadow.mts"])
    assert.doesNotMatch(readFileSync(script, "utf8"), /researchPlanningStates|honorStoppedHunts|All hunts are stopped/);
});

test("a research cycle slowed by the breaker names its wait and launches at its spaced turn, never refused for good", async () => {
  const env = breaker({ "research-cycle": { seen: new Date(T0).toISOString(), times: 4 } });
  assert.equal(admitJobLaunch("research-cycle", env, T0), true);
  let now = T0;
  assert.deepEqual(await loop(() => admitJobLaunch("research-cycle", env, now += 60_000) ? null : "slowed"),
    ["held: slowed", "held: slowed", "held: slowed", "cycle 1"]);
});

test("the line keeper flags a job past two intervals, names why, and clears it after a finish", () => {
  let now = "2026-10-26T00:47:36.000Z";
  const book = new JobRunBook(() => now);
  book.register("research-cycle", 3_600_000);
  book.register("place-maps", 600_000);
  book.started("research-cycle");
  book.finished("place-maps");
  now = "2026-10-26T01:54:09.000Z";
  book.failed("research-cycle", "FATAL ERROR: Ineffective mark-compacts near heap limit Allocation failed - JavaScript heap out of memory");
  book.finished("place-maps");
  assert.deepEqual(stalledJobs(book.merged(null), now, "2026-10-26T02:00:00.000Z"), []);
  // Oct 29: the heartbeat still beats, the place maps keep finishing, and the research cycle has not finished since Oct 25.
  now = "2026-10-29T07:03:22.660Z";
  const restarted = new JobRunBook(() => now);
  restarted.register("research-cycle", 3_600_000);
  restarted.register("place-maps", 600_000);
  restarted.finished("place-maps");
  const stored = restarted.merged(book.merged(null));
  const [flag, ...rest] = stalledJobs(stored, now, now);
  assert.equal(rest.length, 0);
  assert.equal(flag!.job, "research-cycle");
  assert.equal(flag!.says, "Paid research rounds has not finished a run since it was scheduled October 25, 8:47 PM ET; it runs every hour. " +
    "Its last run failed October 25, 9:54 PM ET: FATAL ERROR: Ineffective mark-compacts near heap limit Allocation failed - JavaScript heap out of memory");
  restarted.held("research-cycle", "Slowed by the job transfer breaker: its launches are spaced out.");
  assert.match(stalledJobs(restarted.merged(stored), now, now)[0]!.says, /Slowed by the job transfer breaker/);
  assert.match(stalledJobs(stored, "2026-10-29T05:00:00.000Z", now)[0]!.says, /The runner itself last reported October 29, 1:00 AM ET/);
  restarted.started("research-cycle");
  restarted.finished("research-cycle");
  assert.deepEqual(stalledJobs(restarted.merged(stored), now, "2026-10-29T07:13:00.000Z"), []);
});
