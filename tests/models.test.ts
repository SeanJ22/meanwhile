import assert from "node:assert/strict";
import test from "node:test";
import { MODELS, MODEL_TIERS, activeModelOverrideId, modelRefusal } from "../lib/models.ts";
import { minimumCacheablePrefixTokensFor, priceMeteredUsage, rateFor, readMeteredUsage, usdForUsage } from "../lib/control-plane/model-cost.ts";
test("execution tiers bill their provider IDs and tier names at the same current prices", () => {
  const usage = readMeteredUsage({input_tokens: 100_000, output_tokens: 1_000_000});
  for (const tier of MODEL_TIERS) {
    assert.equal(priceMeteredUsage(tier, usage).usd, MODELS[tier].inputUsdPerMillion / 10 + MODELS[tier].outputUsdPerMillion);
    assert.equal(priceMeteredUsage(MODELS[tier].model, usage).usd, priceMeteredUsage(tier, usage).usd);
    assert.equal(minimumCacheablePrefixTokensFor(tier), MODELS[tier].minimumCacheablePrefixTokens);
  }
});

test("Haiku 5.5 bills a prompt above 100K tokens on its long-prompt card, counting cached and written tokens in the prompt", () => {
  const near = (a: number | null, b: number) => assert.ok(a !== null && Math.abs(a - b) < 1e-12, `${a} vs ${b}`);
  near(priceMeteredUsage(MODELS.haiku.model, readMeteredUsage({ input_tokens: 100_000, output_tokens: 1_000 })).usd, (100_000 * 0.1 + 1_000 * 0.5) / 1e6);
  near(priceMeteredUsage(MODELS.haiku.model, readMeteredUsage({ input_tokens: 100_001, output_tokens: 1_000 })).usd, (100_001 * 0.5 + 1_000 * 2.5) / 1e6);
  near(priceMeteredUsage(MODELS.haiku.model, readMeteredUsage({ input_tokens: 1_000, cache_read_input_tokens: 90_000, cache_creation_input_tokens: 10_000, output_tokens: 1_000 })).usd,
    (1_000 * 0.5 + 90_000 * 0.5 * 0.1 + 10_000 * 0.5 * 1.25 + 1_000 * 2.5) / 1e6);
  near(usdForUsage(200_000, 10, rateFor(MODELS.haiku.model)!), (200_000 * 0.5 + 10 * 2.5) / 1e6);
  near(priceMeteredUsage("claude-sonnet-5-5", readMeteredUsage({ input_tokens: 500_000, output_tokens: 0 })).usd, 500_000 * 2 / 1e6);
});

test("Haiku 4.5 stays only as a historical price row; a saved setting naming it selects Haiku 5.5", () => {
  near2(priceMeteredUsage("claude-haiku-4-5-20251001", readMeteredUsage({ input_tokens: 1_000, output_tokens: 1_000 })).usd, (1_000 * 1 + 1_000 * 5) / 1e6);
  assert.equal(minimumCacheablePrefixTokensFor("claude-haiku-4-5"), 4096);
  assert.equal(activeModelOverrideId("claude-haiku-4-5"), MODELS.haiku.model);
  assert.equal(activeModelOverrideId("claude-haiku-4-5-20251001"), MODELS.haiku.model);
  assert.equal(modelRefusal(activeModelOverrideId("claude-haiku-4-5")), null);
  assert.match(modelRefusal("claude-haiku-4-5") ?? "", /replaced for active use by claude-haiku-5-5/);
});

function near2(a: number | null, b: number) { assert.ok(a !== null && Math.abs(a - b) < 1e-12, `${a} vs ${b}`); }
