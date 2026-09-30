/** Execution tiers, cheapest first. Prices are USD per million tokens. */
export const MODELS = {
  haiku: {
    model: "claude-haiku-4-5", name: "Claude Haiku 4.5",
    inputUsdPerMillion: 1, outputUsdPerMillion: 5,
    minimumCacheablePrefixTokens: 4096, cacheReadMultiplier: 0.1,
  },
  sonnet: {
    model: "claude-sonnet-5-5", name: "Claude Sonnet 5.5",
    inputUsdPerMillion: 2, outputUsdPerMillion: 10,
    minimumCacheablePrefixTokens: 512, cacheReadMultiplier: 0.1,
  },
  opus: {
    model: "claude-opus-5-5", name: "Claude Opus 5.5",
    inputUsdPerMillion: 4, outputUsdPerMillion: 20,
    minimumCacheablePrefixTokens: 512, cacheReadMultiplier: 0.05,
  },
} as const;

export type ModelTier = keyof typeof MODELS;
export const MODEL_TIERS = ["haiku", "sonnet", "opus"] as const;
export const MODEL_PRICE_SOURCE = "https://platform.claude.com/docs/en/about-claude/pricing";
export const MODEL_PRICES_STATED_ON = "2026-09-29";

export function modelTierFor(model: string): ModelTier | null {
  return MODEL_TIERS.find((tier) => tier === model || MODELS[tier].model === model) ?? null;
}
