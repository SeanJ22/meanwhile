import { storedKeyEnvironment } from "../lib/core/keys-values.ts";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import * as nodeModule from "node:module";
import { createContext, runInContext } from "node:vm";
import { boundedBeat } from "../lib/ops/bounded-beat.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { liveCycleHeartbeat, standingHeartbeat, type CycleHeartbeat } from "../lib/control-plane/runner-standing.ts";
import { JobRunBook } from "../lib/control-plane/job-runs.ts";

test("a hung beat is left behind after its bound and the next beat writes", async () => {
  let writes = 0, late = 0, landed = 0;
  const beat = boundedBeat(async () => {
    if (++writes === 1) await new Promise(() => undefined);
    landed++;
  }, 30, () => { late++; });
  const first = beat();
  assert.equal(beat(), first, "a beat inside its bound is shared, never queued behind");
  await first;
  assert.equal(late, 1);
  await beat();
  assert.equal(writes, 2);
  assert.equal(landed, 1, "the beat after a hung one still lands");
});

test("a failed beat settles at once and does not hold the next", async () => {
  let writes = 0;
  const beat = boundedBeat(async () => { writes++; throw new Error("Neon request timed out"); }, 1000);
  const started = Date.now();
  await beat();
  await beat();
  assert.equal(writes, 2);
  assert.ok(Date.now() - started < 500);
});

test("the runner beats every minute through bounded beats, and a routine pass between cycles checks in", () => {
  const runner = readFileSync("scripts/pilot-runner.mts", "utf8");
  assert.doesNotMatch(runner, /cycleBeat = cycleBeat\.then/, "no beat waits on the one before it");
  assert.match(runner, /const beat = boundedBeat\(\(\) => writeLiveCycleBeat\(startedAt\), BEAT_BOUND_MS, lateBeat\);/);
  assert.match(runner, /const beatTimer = setInterval\(\(\) => \{ if \(!researchCycleActive\) void standingBeat\(\); \}, 60_000\);/);
  assert.match(runner, /const BEAT_BOUND_MS = 45_000;/);
});

test("startup and the standing clock write the running code, at most once a minute, without starting research or touching cycle fields", async () => {
  const runner = readFileSync("scripts/pilot-runner.mts", "utf8");
  const { stripTypeScriptTypes } = nodeModule as typeof nodeModule & { stripTypeScriptTypes(source: string): string };
  const write = runner.match(/\n(?:async )?function (?:privateText|writeLiveCycleBeat)\([\s\S]*?\n\}/g)?.join("");
  const clock = runner.match(/\nconst STANDING_BEAT_MS[\s\S]*?BEAT_BOUND_MS, lateBeat\);/)?.[0];
  assert.ok(write && clock);
  const tick = runner.match(/function runStandingRuntimeTick\([\s\S]*?\n\}/)?.[0] ?? "";
  assert.match(tick, /^function runStandingRuntimeTick\(reason: string, force = false\): void \{\s*if \(!canary\) void standingBeat\(\);/,
    "every standing tick, including the forced one at startup, beats before any admission decision");
  assert.match(runner, /function startStandingRuntimeClock\(\)[\s\S]*?runStandingRuntimeTick\("independent standing clock startup", true\)/);

  const repos = createMemoryRepositories();
  const previous = { formatVersion: 1, beatAt: "2026-10-26T01:54:09.583Z", lastCycleStartedAt: "2026-10-26T00:47:36.258Z",
    lastCycleFinishedAt: "2026-10-26T01:54:09.583Z", nextCycleDueAt: null, lastCycleOk: false, testedSha: "8664f367eee4009fb9cc893a2092581efc48a52a",
    host: "meanwhile-runner", codeIdentity: { verdict: "RUNNER_BEHIND_EXECUTABLE", runnerTestedSha: "8664f367eee4009fb9cc893a2092581efc48a52a" },
    cycle: { startedAt: "2026-10-26T00:47:36.258Z", finishedAt: "2026-10-26T01:54:09.583Z", exitCode: 1, signal: null, lastError: "old" } };
  await repos.runnerHeartbeat.put("pilot-runner", previous as never, previous.beatAt);
  const running = "9352c8e143db00d1623735f02e8c419d1c697278";
  let identityReads = 0;
  const staging = { targetSha: "a".repeat(40), state: "FAILED", code: "STAGING_TIMED_OUT", detail: "stuck", startedAt: "x", at: "y" };
  const context = createContext({ storedKeyEnvironment, provider: "postgres", currentCycleErrors: "", process, RUNNER_ID: "pilot-runner", CODE_ROOT: ".",
    RUNNING_CODE_SHA: running, nativeAbortLine: () => null, neonReadFailureLine: () => null, ownerRepositories: async () => repos,
    hostMemoryReading: async () => null, neonBytesReading: () => null, hostname: () => "meanwhile-runner",
    readCodeIdentity: (input: { runnerTestedSha: string }) => { identityReads += 1; return { verdict: "CONSISTENT", runnerTestedSha: input.runnerTestedSha }; },
    stagingStatus: () => staging, standingHeartbeat, liveCycleHeartbeat, jobRuns: new JobRunBook(), boundedBeat, BEAT_BOUND_MS: 45_000, lateBeat: () => {},
    console: { error: (line: string) => { throw new Error(line); } }, Date });
  runInContext(stripTypeScriptTypes(`${write}\n${clock}`), context);
  await runInContext("standingBeat()", context);
  await runInContext("standingBeat()", context);
  const beat = (await repos.runnerHeartbeat.read("pilot-runner"))!.value as unknown as typeof previous & { releaseStaging: unknown };
  assert.equal(beat.testedSha, running);
  assert.deepEqual(beat.codeIdentity, { verdict: "CONSISTENT", runnerTestedSha: running });
  assert.deepEqual(beat.releaseStaging, staging, "a failed staging rides on the heartbeat Admin reads");
  assert.equal(identityReads, 1, "a second beat inside the minute writes nothing");
  assert.ok(Date.parse(beat.beatAt) > Date.parse(previous.beatAt));
  for (const key of ["lastCycleStartedAt", "lastCycleFinishedAt", "lastCycleOk", "cycle"] as const) assert.deepEqual(beat[key], previous[key]);
  runInContext("standingBeatAt -= STANDING_BEAT_MS", context);
  context.RUNNING_CODE_SHA = "b".repeat(40);
  await runInContext("standingBeat()", context);
  assert.equal((await repos.runnerHeartbeat.read("pilot-runner"))!.value.testedSha, "b".repeat(40), "the next minute writes again");
  context.INTERVAL_MIN = 60;
  context.jobRuns.register("platform-census", 600_000);
  context.jobRuns.failed("platform-census", "Platform census stopped: exit 1; Error: source unavailable");
  await context.writeLiveCycleBeat("2026-10-27T00:00:00Z");
  const active = (await repos.runnerHeartbeat.read("pilot-runner"))!.value as CycleHeartbeat;
  assert.equal(active.cycle?.finishedAt, null);
  assert.equal(active.jobs?.["platform-census"]?.lastError, "Platform census stopped: exit 1; Error: source unavailable");
  await context.writeLiveCycleBeat("2026-10-27T00:00:00Z", { code: 1, signal: null });
  const finished = (await repos.runnerHeartbeat.read("pilot-runner"))!.value;
  assert.equal(finished.lastCycleOk, false);
  assert.deepEqual(finished.jobs, active.jobs, "finishing research keeps the standing jobs and their real errors");
});
