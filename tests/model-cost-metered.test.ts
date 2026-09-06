/**
 * **THE METERED PRICE, FROM EXACTLY FIVE TOKEN QUANTITIES.** (Prompt-caching
 * session, 2026-09-06. Acceptance rows PC-9 and PC-10.)
 *
 * Claude Opus 5 list prices: $5 / MTok base input, $6.25 5-minute cache write
 * (1.25×), $10 1-hour cache write (2×), $0.50 cache read (0.1×), $25 output;
 * the Batches API halves every one of them, once.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { ZERO_COST, type AttemptCost } from "../lib/control-plane/attempt.ts";
import { COST_METRICS, cacheMeteringOf, sumMetric, type CostEntry } from "../lib/control-plane/cost.ts";
import {
  CACHE_RATE_MULTIPLIERS,
  meteredCostFields,
  priceMeteredUsage,
  readMeteredUsage,
  sumMeteredUsage,
  usdForModelUsage,
  type MeteredUsage,
} from "../lib/control-plane/model-cost.ts";

const known: MeteredUsage = {
  uncachedInputTokens: 1_000_000,
  outputTokens: 100_000,
  cacheReadInputTokens: 2_000_000,
  cacheCreationInputTokens: 300_000, // the aggregate: 200k at 5m + 100k at 1h
  cacheCreation5mInputTokens: 200_000,
  cacheCreation1hInputTokens: 100_000,
  batch: false,
};
/* 1M × $5 + 200k × $6.25 + 100k × $10 + 2M × $0.50 + 100k × $25 = 5 + 1.25 + 1 + 1 + 2.5 */
const KNOWN_USD = 5 + 1.25 + 1 + 1 + 2.5;

test("PC-10: a known usage with a 5m/1h split prices to known dollars at Claude Opus 5's multipliers", () => {
  const priced = priceMeteredUsage("claude-opus-5", known, "5m");
  assert.ok(Math.abs((priced.usd ?? 0) - KNOWN_USD) < 1e-9, `expected $${KNOWN_USD}, priced $${priced.usd}`);
  assert.equal(priced.cacheWritePricedFrom, "SPLIT");
  assert.equal(priced.aggregateTtl, null);
});

test("PC-10: the same usage through the Batches API is exactly half, applied once", () => {
  const priced = priceMeteredUsage("claude-opus-5", { ...known, batch: true }, "5m");
  assert.ok(Math.abs((priced.usd ?? 0) - KNOWN_USD * CACHE_RATE_MULTIPLIERS.batch) < 1e-9);
  assert.equal(CACHE_RATE_MULTIPLIERS.batch, 0.5);
});

test("PC-10: the aggregate cache_creation_input_tokens contributes NOTHING on top of its split", () => {
  const inflated = priceMeteredUsage("claude-opus-5", { ...known, cacheCreationInputTokens: 300_000 * 10 }, "5m");
  assert.ok(Math.abs((inflated.usd ?? 0) - KNOWN_USD) < 1e-9, "an aggregate ten times the split changes nothing while the split is present");
  const zeroAggregate = priceMeteredUsage("claude-opus-5", { ...known, cacheCreationInputTokens: 0 }, "5m");
  assert.ok(Math.abs((zeroAggregate.usd ?? 0) - KNOWN_USD) < 1e-9);
});

test("PC-10: with no split the aggregate is priced at the TTL the request asked for, and the result says so", () => {
  const noSplit: MeteredUsage = { ...known, cacheCreation5mInputTokens: null, cacheCreation1hInputTokens: null };
  const at5m = priceMeteredUsage("claude-opus-5", noSplit, "5m");
  const at1h = priceMeteredUsage("claude-opus-5", noSplit, "1h");
  const base = 5 + 1 + 2.5; // uncached + reads + output, in dollars
  assert.ok(Math.abs((at5m.usd ?? 0) - (base + 0.3 * 6.25)) < 1e-9, "300k aggregate at the 5-minute write price");
  assert.ok(Math.abs((at1h.usd ?? 0) - (base + 0.3 * 10)) < 1e-9, "300k aggregate at the 1-hour write price");
  assert.equal(at5m.cacheWritePricedFrom, "AGGREGATE");
  assert.equal(at5m.aggregateTtl, "5m");
  assert.equal(at1h.aggregateTtl, "1h");
  assert.equal(priceMeteredUsage("claude-opus-5", { ...noSplit, cacheCreationInputTokens: 0 }, "5m").cacheWritePricedFrom, "NONE");
});

test("PC-10: an unmeasured base count or an unpriced model is null, never zero", () => {
  assert.equal(priceMeteredUsage("claude-opus-5", { ...known, uncachedInputTokens: null }, "5m").usd, null);
  assert.equal(priceMeteredUsage("claude-opus-5", { ...known, outputTokens: null }, "5m").usd, null);
  assert.equal(priceMeteredUsage("some-model-nobody-priced", known, "5m").usd, null);
  /* The older entry point prices the aggregate at 5m and agrees with the new one. */
  assert.equal(usdForModelUsage("claude-opus-5", { inputTokens: 1_000_000, outputTokens: 100_000, cacheReadInputTokens: 2_000_000, cacheCreationInputTokens: 300_000 }), priceMeteredUsage("claude-opus-5", { ...known, cacheCreation5mInputTokens: null, cacheCreation1hInputTokens: null }, "5m").usd);
});

test("PC-9: the parser reads the API's usage block, the split included, and never infers from the request", () => {
  const usage = readMeteredUsage({
    input_tokens: 77,
    cache_creation_input_tokens: 4586,
    cache_read_input_tokens: 0,
    cache_creation: { ephemeral_5m_input_tokens: 4586, ephemeral_1h_input_tokens: 0 },
    output_tokens: 0,
    service_tier: "standard",
  });
  assert.deepEqual(usage, { uncachedInputTokens: 77, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 4586, cacheCreation5mInputTokens: 4586, cacheCreation1hInputTokens: 0, batch: false });
  const noSplit = readMeteredUsage({ input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 200, cache_creation_input_tokens: 300 });
  assert.equal(noSplit.cacheCreation5mInputTokens, null, "no cache_creation block: the split is null, never zero");
  assert.equal(noSplit.cacheCreationInputTokens, 300);
  const bare = readMeteredUsage({ input_tokens: 10, output_tokens: 5 });
  assert.equal(bare.cacheReadInputTokens, 0, "base counts reported and cache fields omitted is a measured zero");
  const nothing = readMeteredUsage({});
  assert.equal(nothing.uncachedInputTokens, null);
  assert.equal(nothing.cacheReadInputTokens, null, "nothing reported is unmeasured everywhere");
  assert.equal(readMeteredUsage(undefined, true).batch, true);
});

test("PC-9: the six ledger fields come from one usage, and summing turns keeps a null unmeasured", () => {
  const fields = meteredCostFields(known);
  assert.deepEqual(fields, { cacheReadInputTokens: 2_000_000, cacheCreationInputTokens: 300_000, cacheCreation5mInputTokens: 200_000, cacheCreation1hInputTokens: 100_000, uncachedInputTokens: 1_000_000, batch: false });
  const summed = sumMeteredUsage([known, { ...known, cacheCreation5mInputTokens: null, cacheCreation1hInputTokens: null }]);
  assert.equal(summed.uncachedInputTokens, 2_000_000);
  assert.equal(summed.cacheCreation5mInputTokens, null, "one turn without a split makes the summed split unmeasured");
  assert.equal(summed.cacheCreationInputTokens, 600_000);
  assert.equal(sumMeteredUsage([]).uncachedInputTokens, null);
});

test("PC-9: a ledger row predating the fields reads UNMEASURED by name; a null row reads UNREPORTED; a measured row reads its numbers", () => {
  const predating = { inputTokens: 10, outputTokens: 1, usd: 0.1, durationMs: 1, bytesFetched: null, requestCount: 1 } as unknown as AttemptCost;
  assert.deepEqual(cacheMeteringOf(predating), { status: "PREDATES_FIELDS" });
  assert.deepEqual(cacheMeteringOf(ZERO_COST), { status: "UNREPORTED" });
  const measured: AttemptCost = { ...ZERO_COST, inputTokens: 3_300_000, outputTokens: 100_000, usd: KNOWN_USD, requestCount: 3, ...meteredCostFields(known) };
  assert.deepEqual(cacheMeteringOf(measured), { status: "MEASURED", cacheReadInputTokens: 2_000_000, cacheCreationInputTokens: 300_000, cacheCreation5mInputTokens: 200_000, cacheCreation1hInputTokens: 100_000, uncachedInputTokens: 1_000_000, batch: false });
  /* The rollup treats an absent field as unmeasured, never as zero. */
  const entry = (cost: AttemptCost): CostEntry => ({ attemptId: "a", workItemId: "w", routeTaskId: null, routeId: null, source: null, jurisdiction: null, project: "p", role: "SCOUT", cost, recordedAt: "2026-09-06T00:00:00.000Z" });
  const total = sumMetric([entry(predating), entry(measured)], "cacheReadInputTokens");
  assert.deepEqual(total, { total: 2_000_000, measured: 1, unmeasured: 1, complete: false });
  for (const metric of ["cacheReadInputTokens", "cacheCreationInputTokens", "cacheCreation5mInputTokens", "cacheCreation1hInputTokens", "uncachedInputTokens"] as const) {
    assert.ok((COST_METRICS as readonly string[]).includes(metric), `${metric} is a ledger metric`);
  }
});
