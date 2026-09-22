/**
 * **THE METERED PRICE, FROM EXACTLY FIVE TOKEN QUANTITIES.** (Prompt-caching
 * session, 2026-09-06. Acceptance rows PC-9 and PC-10.)
 *
 * Claude Opus 5 (now LEGACY, kept to price historical billing) list prices:
 * $5 / MTok base input, $6.25 5-minute cache write (1.25×), $10 1-hour cache
 * write (2×), $0.50 cache read (0.1×), $25 output; the Batches API halves every
 * one of them, once.
 *
 * Claude Opus 5.5 (the CURRENT frontier; verified platform.claude.com 2026-09-22)
 * is cheaper: $4 / MTok base input, $5 5-minute cache write (1.25×), $8 1-hour
 * cache write (2×), $0.20 cache read — a NON-STANDARD 0.05× where every other
 * model reads at 0.1× — $20 output; minimum cacheable prefix 512.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { ZERO_COST, type AttemptCost } from "../lib/control-plane/attempt.ts";
import { COST_METRICS, cacheMeteringOf, sumMetric, type CostEntry } from "../lib/control-plane/cost.ts";
import {
  CACHE_RATE_MULTIPLIERS,
  MODEL_CACHE_MINIMUMS,
  MODEL_RATES,
  cacheSavingUsd,
  meteredCostFields,
  minimumCacheablePrefixTokensFor,
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

/**
 * §9A.23 (2026-09-06) asks the monthly window for "cache savings where
 * measurable". The saving is a COUNTERFACTUAL at list price — what the same
 * tokens would have cost uncached — and it is priced through the one rate
 * table, so a model with no stated rate saves an unmeasured amount rather than
 * a plausible one.
 */
test("§9A.23: a cache read saved 0.9 of the base input rate, and an unpriced model saves null rather than a guess", () => {
  /* 2,000,000 read tokens on Claude Opus 5: $5/MTok × 2 × (1 − 0.1) = $9.00. */
  assert.equal(cacheSavingUsd(2_000_000, "claude-opus-5"), 9);
  assert.equal(cacheSavingUsd(0, "claude-opus-5"), 0, "reading nothing saved nothing, and that IS measured");
  assert.equal(cacheSavingUsd(1_000_000, "claude-haiku-4-5"), 0.9, "the cheaper model saves less, at its own rate");
  assert.equal(cacheSavingUsd(1_000_000, "some-model-nobody-priced"), null);
  assert.equal(cacheSavingUsd(Number.NaN, "claude-opus-5"), null);
  /* The saving and the charge agree: reads are billed at the tenth that is left. */
  const readsOnly: MeteredUsage = { uncachedInputTokens: 0, outputTokens: 0, cacheReadInputTokens: 2_000_000, cacheCreationInputTokens: 0, cacheCreation5mInputTokens: 0, cacheCreation1hInputTokens: 0, batch: false };
  const charged = priceMeteredUsage("claude-opus-5", readsOnly, "5m").usd ?? 0;
  assert.ok(Math.abs(charged + (cacheSavingUsd(2_000_000, "claude-opus-5") ?? 0) - 10) < 1e-9, "charged plus saved is the uncached price");
});

/**
 * Opus 5.5 through the SAME priced fields, at the verified rates. The load-
 * bearing new fact is the 0.05× cache-read multiplier: legacy Opus 5 and every
 * other model read at 0.1×, so a flat multiplier would over-charge Opus 5.5
 * reads by 2×. Same `known` usage; only the model id changes.
 */
const KNOWN_USD_55 = 4 + 1 + 0.8 + 0.4 + 2; // 1M×$4 + 200k×$5 + 100k×$8 + 2M×$0.20 + 100k×$20 = $8.20

test("Opus 5.5: the known usage prices at the verified $4/$20 rates and is cheaper than legacy Opus 5", () => {
  const priced = priceMeteredUsage("claude-opus-5-5", known, "5m");
  assert.ok(Math.abs((priced.usd ?? 0) - KNOWN_USD_55) < 1e-9, `expected $${KNOWN_USD_55}, priced $${priced.usd}`);
  assert.equal(priced.cacheWritePricedFrom, "SPLIT");
  assert.ok(KNOWN_USD_55 < KNOWN_USD, "Opus 5.5 prices the identical tokens below legacy Opus 5");
  /* Batch still halves the whole, once. */
  assert.ok(Math.abs((priceMeteredUsage("claude-opus-5-5", { ...known, batch: true }, "5m").usd ?? 0) - KNOWN_USD_55 * 0.5) < 1e-9);
});

test("Opus 5.5: the non-standard 0.05× cache-read multiplier is wired end to end (charge + saving = uncached price)", () => {
  /* 2,000,000 read tokens on Opus 5.5: $4/MTok × 2 × (1 − 0.05) = $7.60 saved. */
  assert.equal(cacheSavingUsd(2_000_000, "claude-opus-5-5"), 7.6);
  const readsOnly: MeteredUsage = { uncachedInputTokens: 0, outputTokens: 0, cacheReadInputTokens: 2_000_000, cacheCreationInputTokens: 0, cacheCreation5mInputTokens: 0, cacheCreation1hInputTokens: 0, batch: false };
  const charged = priceMeteredUsage("claude-opus-5-5", readsOnly, "5m").usd ?? 0;
  assert.ok(Math.abs(charged - 0.4) < 1e-9, "reads charged at 0.05×: $0.40, not the $0.80 a 0.1× model would charge on $4/MTok");
  assert.ok(Math.abs(charged + (cacheSavingUsd(2_000_000, "claude-opus-5-5") ?? 0) - 8) < 1e-9, "charged plus saved is the uncached price at $4/MTok");
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

/**
 * The minimum cacheable prefix is a PER-MODEL, NON-MONOTONIC fact: the cheapest
 * model (Haiku 4.5) has the HIGHEST minimum. A cache-defect detector fed one
 * Opus-sized scalar (512) would read a cheaper model's legitimately-uncacheable
 * prefix increment as a stationary-breakpoint defect — so the lane must look it
 * up by the attempt's own model.
 */
test("per-model minimum cacheable prefix: looked up by model, non-monotonic, aliases resolved, unknown is null", () => {
  assert.equal(minimumCacheablePrefixTokensFor("claude-opus-5"), 512);
  assert.equal(minimumCacheablePrefixTokensFor("claude-opus-5-5"), 512, "Opus 5.5 keeps the 512 minimum");
  assert.equal(minimumCacheablePrefixTokensFor("claude-sonnet-5"), 1024);
  assert.equal(minimumCacheablePrefixTokensFor("claude-haiku-4-5"), 4096);
  /* THE LOAD-BEARING PROPERTY: the cheapest model's minimum is the HIGHEST, so
     a single scalar cannot serve a lane that may route to a cheaper class. */
  assert.ok(
    minimumCacheablePrefixTokensFor("claude-haiku-4-5")! > minimumCacheablePrefixTokensFor("claude-opus-5")!,
    "Haiku's minimum exceeds Opus's — a per-model lookup is mandatory, not a convenience",
  );
  /* RULING 244's dated Haiku spelling resolves to the reference id, one minimum. */
  assert.equal(
    minimumCacheablePrefixTokensFor("claude-haiku-4-5-20251001"),
    minimumCacheablePrefixTokensFor("claude-haiku-4-5"),
  );
  /* An unrated model has an UNKNOWN minimum — null, never a guessed neighbour's. */
  assert.equal(minimumCacheablePrefixTokensFor("some-unlisted-model"), null);
  /* Every model with a rate row also states a cache minimum, so no routed model is unmeasurable. */
  for (const rate of MODEL_RATES) {
    assert.equal(typeof minimumCacheablePrefixTokensFor(rate.model), "number", `${rate.model} must state a cache minimum`);
  }
  /* The table carries its own dated provenance, like every rate fact in this file. */
  assert.match(MODEL_CACHE_MINIMUMS.source, /prompt-caching/i);
  assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(MODEL_CACHE_MINIMUMS.statedOn), "the minimum table is data with a date");
});
