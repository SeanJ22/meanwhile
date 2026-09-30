import assert from "node:assert/strict";
import test from "node:test";
import { MODELS, MODEL_TIERS } from "../lib/models.ts";
import { minimumCacheablePrefixTokensFor, priceMeteredUsage, readMeteredUsage } from "../lib/control-plane/model-cost.ts";
test("execution tiers bill their provider IDs and tier names at the same current prices", () => {
  const usage = readMeteredUsage({input_tokens: 1_000_000, output_tokens: 1_000_000});
  for (const tier of MODEL_TIERS) {
    assert.equal(priceMeteredUsage(tier, usage).usd, MODELS[tier].inputUsdPerMillion + MODELS[tier].outputUsdPerMillion);
    assert.equal(priceMeteredUsage(MODELS[tier].model, usage).usd, priceMeteredUsage(tier, usage).usd);
    assert.equal(minimumCacheablePrefixTokensFor(tier), MODELS[tier].minimumCacheablePrefixTokens);
  }
});
