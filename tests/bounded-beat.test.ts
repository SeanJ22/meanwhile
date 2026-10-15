import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { boundedBeat } from "../lib/ops/bounded-beat.ts";

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
  assert.match(runner, /releaseDrain \?\?= requestQueuedReleaseDrain\(\)/);
  assert.match(runner, /boundedBeat\(\(\) => writeLiveCycleBeat\(null\), BEAT_BOUND_MS, lateBeat\);\s+const beatTimer = setInterval\(\(\) => \{ if \(!researchCycleActive\) void beat\(\); \}, 60_000\);/);
  assert.match(runner, /const BEAT_BOUND_MS = 45_000;/);
});
