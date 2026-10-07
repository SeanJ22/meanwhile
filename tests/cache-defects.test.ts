/** The cache-defect detector replayed over recorded per-turn usage: a healthy sequence, a stationary breakpoint, and a bound turn that re-wrote the prefix. */

import assert from "node:assert/strict";
import test from "node:test";

import { describeCacheDefects, detectCacheDefects } from "../lib/control-plane/cache-defects.ts";

const OPUS_5_MINIMUM = 512;

test("PC-12: the healthy shape (recorded 2026-09-06, at-6ba0dac8) fires neither signature", () => {
  const healthy = [
    { turn: 1, uncachedInput: 2, cacheRead: 0, cacheWrite: 8804 },
    { turn: 2, uncachedInput: 2, cacheRead: 8804, cacheWrite: 7852 },
    { turn: 3, uncachedInput: 2, cacheRead: 16656, cacheWrite: 812 },
  ];
  const reading = detectCacheDefects(healthy, OPUS_5_MINIMUM);
  assert.deepEqual(reading.stationaryTurns, []);
  assert.deepEqual(reading.zeroReadTurns, []);
  assert.deepEqual(reading.turns, []);
  assert.equal(reading.examinedTurns, 2, "the denominator is the turns after the first");
});

test("PC-12: the stationary-breakpoint shape (every 2026-09-02 Attempt) fires on every later turn while the zero-read check stays silent", () => {
  const stationary = [
    { turn: 1, uncachedInput: 6000, cacheRead: 0, cacheWrite: 4082 },
    { turn: 2, uncachedInput: 14000, cacheRead: 4082, cacheWrite: 0 },
    { turn: 3, uncachedInput: 25000, cacheRead: 4082, cacheWrite: 0 },
  ];
  const reading = detectCacheDefects(stationary, OPUS_5_MINIMUM);
  assert.deepEqual(reading.stationaryTurns, [2, 3], "turn 2 appended 8,000 tokens and paid for 14,000 uncached; turn 3 appended 11,000 and paid for 25,000");
  assert.deepEqual(reading.zeroReadTurns, [], "the static prefix was read every turn — the old detector's clean bill");
  assert.deepEqual(reading.turns, [2, 3]);
  assert.match(describeCacheDefects(reading), /STATIONARY-BREAKPOINT signature/);
  assert.match(describeCacheDefects(reading), /turn\(s\) 2, 3/);
});

test("PC-12: a zero read over an identical prefix is the second signature, counted apart", () => {
  /* Turn 2 found nothing in the cache and re-wrote the whole prefix plus what it appended; its uncached tail stayed tiny. */
  const cold = [
    { turn: 1, uncachedInput: 2, cacheRead: 0, cacheWrite: 4000 },
    { turn: 2, uncachedInput: 2, cacheRead: 0, cacheWrite: 5000 },
    { turn: 3, uncachedInput: 2, cacheRead: 5000, cacheWrite: 1000 },
  ];
  const reading = detectCacheDefects(cold, OPUS_5_MINIMUM);
  assert.deepEqual(reading.zeroReadTurns, [2]);
  assert.deepEqual(reading.stationaryTurns, [], "uncached did not grow past what the turn appended");
  assert.match(describeCacheDefects(reading), /read ZERO cached tokens/);
});

test("PC-12: the bound turn's forced tool_choice rewrite (harness 2026-09-06, turn 4) is a write, not a stationary breakpoint and not a zero read", () => {
  const before = [
    { turn: 1, uncachedInput: 2, cacheRead: 0, cacheWrite: 4978 },
    { turn: 2, uncachedInput: 2, cacheRead: 4978, cacheWrite: 1288 },
    { turn: 3, uncachedInput: 2, cacheRead: 6266, cacheWrite: 14799 },
    { turn: 4, uncachedInput: 16, cacheRead: 4586, cacheWrite: 24369 },
  ];
  const reading = detectCacheDefects(before, OPUS_5_MINIMUM);
  assert.deepEqual(reading.turns, [], "the conversation was re-written at the write price, which the ledger's cacheCreation column carries; the detector reads only the two signatures");
});

test("PC-12: the slack is exactly one model minimum — an uncached remainder inside it is a legitimate sub-minimum increment", () => {
  const edge = [
    { turn: 1, uncachedInput: 10, cacheRead: 0, cacheWrite: 5000 },
    { turn: 2, uncachedInput: 512 + 100, cacheRead: 5000, cacheWrite: 0 },
    { turn: 3, uncachedInput: 512 + 100 + 1, cacheRead: 5000, cacheWrite: 0 },
  ];
  /* turn 2 appended 100 tokens; 612 uncached is inside 100 + 512. turn 3 appended 1 and paid 613: over by one. */
  const reading = detectCacheDefects(edge, OPUS_5_MINIMUM);
  assert.deepEqual(reading.stationaryTurns, [3]);
});

test("PC-12: turns arrive in any order and a single turn has nothing to compare", () => {
  assert.deepEqual(detectCacheDefects([{ turn: 1, uncachedInput: 9, cacheRead: 0, cacheWrite: 9 }], OPUS_5_MINIMUM).examinedTurns, 0);
  const shuffled = detectCacheDefects(
    [
      { turn: 3, uncachedInput: 25000, cacheRead: 4082, cacheWrite: 0 },
      { turn: 1, uncachedInput: 6000, cacheRead: 0, cacheWrite: 4082 },
      { turn: 2, uncachedInput: 14000, cacheRead: 4082, cacheWrite: 0 },
    ],
    OPUS_5_MINIMUM,
  );
  assert.deepEqual(shuffled.stationaryTurns, [2, 3]);
});
