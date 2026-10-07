/** Cost informs scheduling, never truth. An unmeasured count yields null, never zero, and a model with no rate row costs null. */

import { MODELS, MODEL_TIERS, MODEL_PRICE_SOURCE, MODEL_PRICES_STATED_ON, canonicalModelId, modelTierFor } from "../models.ts";

export const MODEL_WORKER_MODEL = MODELS.opus.model;
export interface ModelRate {
  readonly model: string;
  readonly inputUsdPerMillion: number;
  readonly outputUsdPerMillion: number;
  /** The rate card for a request whose prompt is above `aboveInputTokens`; absent where one card covers every length. */
  readonly longPrompt?: { readonly aboveInputTokens: number; readonly inputUsdPerMillion: number; readonly outputUsdPerMillion: number };
  readonly statedOn: string;
  readonly source: string;
}
export const MODEL_WORKER_RATES: ModelRate = {
  ...MODELS.opus, statedOn: MODEL_PRICES_STATED_ON, source: MODEL_PRICE_SOURCE,
};
export const MODEL_RATES: readonly ModelRate[] = [
  ...MODEL_TIERS.map((tier) => ({ ...MODELS[tier], statedOn: MODEL_PRICES_STATED_ON, source: MODEL_PRICE_SOURCE })),
  // Historical ledger rows retain their original prices.
  { model: "claude-opus-5", inputUsdPerMillion: 5, outputUsdPerMillion: 25,
    statedOn: "2026-08-31", source: "Anthropic first-party API rates (legacy Opus 5)" },
  { model: "claude-sonnet-5", inputUsdPerMillion: 2, outputUsdPerMillion: 10,
    statedOn: "2026-09-02", source: "Anthropic first-party API rates (legacy Sonnet 5)" },
  { model: "claude-haiku-4-5", inputUsdPerMillion: 1, outputUsdPerMillion: 5,
    statedOn: "2026-09-29", source: "Anthropic first-party API rates (legacy Haiku 4.5)" },
];

/** The id a rate row is keyed by: a tier's model, or the undated id. */
const rowId = (model: string): string => {
  const tier = modelTierFor(model);
  return tier ? MODELS[tier].model : canonicalModelId(model);
};

/** The rate row for a model id (dated aliases resolved), or null when no row is stated. */
export function rateFor(model: string): ModelRate | null {
  const id = rowId(model);
  return MODEL_RATES.find((r) => r.model === id) ?? null;
}

type PriceCard = Pick<ModelRate, "inputUsdPerMillion" | "outputUsdPerMillion" | "longPrompt">;

/** The input and output prices that apply to one request, by the size of its prompt. */
export function ratesForPrompt(rate: PriceCard, promptTokens: number): { readonly inputUsdPerMillion: number; readonly outputUsdPerMillion: number } {
  return rate.longPrompt && promptTokens > rate.longPrompt.aboveInputTokens ? rate.longPrompt : rate;
}

/** The highest input and output prices a row can charge. */
export function highestRates(rate: PriceCard): { readonly inputUsdPerMillion: number; readonly outputUsdPerMillion: number } {
  return rate.longPrompt ?? rate;
}

/** The dearest input and output prices any active tier can charge, for bounds that do not know the model. */
export const DEAREST_ACTIVE_RATES = {
  inputUsdPerMillion: Math.max(...MODEL_TIERS.map((tier) => highestRates(MODELS[tier]).inputUsdPerMillion)),
  outputUsdPerMillion: Math.max(...MODEL_TIERS.map((tier) => highestRates(MODELS[tier]).outputUsdPerMillion)),
} as const;

/**
 * Minimum cacheable prefix per model; below it a `cache_control` breakpoint is silently ignored.
 * Non-monotonic across models, so look it up by the model the attempt actually ran. No row means unknown.
 */
export const MODEL_CACHE_MINIMUMS = {
  values: {
    ...Object.fromEntries(MODEL_TIERS.map((tier) => [MODELS[tier].model, MODELS[tier].minimumCacheablePrefixTokens])),
    "claude-opus-5": 512,
    "claude-sonnet-5": 1024,
    "claude-haiku-4-5": 4096,
  } as Readonly<Record<string, number>>,
  statedOn: "2026-09-22",
  source: "Anthropic first-party prompt-caching reference (per-model minimum cacheable prefix)",
} as const;

/** Cache-read multiplier overrides; a model with no row uses the standard 0.1x. */
export const MODEL_CACHE_READ_MULTIPLIER: Readonly<Record<string, number>> = {
  ...Object.fromEntries(MODEL_TIERS.map((tier) => [MODELS[tier].model, MODELS[tier].cacheReadMultiplier])),
};

/** The minimum cacheable prefix for a model id (dated aliases resolved), or null when no row states one. */
export function minimumCacheablePrefixTokensFor(model: string): number | null {
  return MODEL_CACHE_MINIMUMS.values[rowId(model)] ?? null;
}

/** Prompt-cache rates as multiples of the input rate. `cacheRead` is the default; `cacheReadMultiplierFor` overrides it per model. */
export const CACHE_RATE_MULTIPLIERS = {
  /** A 5-minute cache write. */
  cacheCreation: 1.25,
  /** A 1-hour cache write. */
  cacheCreation1h: 2,
  cacheRead: 0.1,
  /** The Message Batches API: 50% of standard prices on every token category. */
  batch: 0.5,
  statedOn: "2026-09-06",
  source: "Anthropic first-party API rates, read from the claude-api reference (prompt caching; Message Batches)",
} as const;

/** The cache-read multiplier for a model id (dated aliases resolved); the standard 0.1x default unless the model states its own (Opus 5.5 = 0.05x). */
export function cacheReadMultiplierFor(model: string): number {
  return MODEL_CACHE_READ_MULTIPLIER[rowId(model)] ?? CACHE_RATE_MULTIPLIERS.cacheRead;
}

/**
 * `uncachedInputTokens` is the API's `input_tokens`. `cacheCreationInputTokens` is the aggregate of the
 * 5m and 1h writes; the split is carried beside it, and the aggregate is never priced on top of its split.
 */
export interface MeteredUsage {
  readonly uncachedInputTokens: number | null;
  readonly outputTokens: number | null;
  readonly cacheReadInputTokens: number | null;
  readonly cacheCreationInputTokens: number | null;
  readonly cacheCreation5mInputTokens: number | null;
  readonly cacheCreation1hInputTokens: number | null;
  readonly batch: boolean;
}

export type CacheWriteTtl = "5m" | "1h";

/** Read from the response, never inferred: a missing base count is null; a missing cache field beside a reported base count is a measured zero. */
export function readMeteredUsage(usage: unknown, batch = false): MeteredUsage {
  const u = usage && typeof usage === "object" ? (usage as Record<string, unknown>) : {};
  const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const base = num(u.input_tokens);
  const output = num(u.output_tokens);
  const reported = base !== null || output !== null;
  const split = u.cache_creation && typeof u.cache_creation === "object" ? (u.cache_creation as Record<string, unknown>) : null;
  return {
    uncachedInputTokens: base,
    outputTokens: output,
    cacheReadInputTokens: reported ? (num(u.cache_read_input_tokens) ?? 0) : null,
    cacheCreationInputTokens: reported ? (num(u.cache_creation_input_tokens) ?? 0) : null,
    cacheCreation5mInputTokens: split ? (num(split.ephemeral_5m_input_tokens) ?? 0) : null,
    cacheCreation1hInputTokens: split ? (num(split.ephemeral_1h_input_tokens) ?? 0) : null,
    batch,
  };
}

export interface PricedUsage {
  readonly usd: number | null;
  /**
   * SPLIT: the two TTL writes were priced at their own multipliers.
   * AGGREGATE: the response carried no split, so the aggregate was priced at
   * the multiplier of the TTL the request asked for (`aggregateTtl`).
   * NONE: nothing was written to the cache, or nothing was measured.
   */
  readonly cacheWritePricedFrom: "SPLIT" | "AGGREGATE" | "NONE";
  readonly aggregateTtl: CacheWriteTtl | null;
}

/**
 *   uncached input  x base input price
 *   5m cache writes x base x 1.25
 *   1h cache writes x base x 2
 *   cache reads     x base x the model's read multiplier
 *   output          x output price
 *   then x 0.5 once for the Batches API
 * Base and output prices are the rate card for the prompt's size: uncached input, cache reads and cache writes together.
 * The aggregate cache write is priced only when its split is absent, at `requestedTtl`.
 */
export function priceMeteredUsage(
  model: string,
  usage: MeteredUsage,
  requestedTtl: CacheWriteTtl = "5m",
  /** An explicit rate row, for a caller that already resolved one. Defaults to the table's row for `model`. */
  rateOverride: ModelRate | null = null,
): PricedUsage {
  const rate = rateOverride ?? rateFor(model);
  if (rate === null || usage.uncachedInputTokens === null || usage.outputTokens === null) {
    return { usd: null, cacheWritePricedFrom: "NONE", aggregateTtl: null };
  }
  const read = usage.cacheReadInputTokens ?? 0;
  const aggregate = usage.cacheCreationInputTokens ?? 0;
  const hasSplit = usage.cacheCreation5mInputTokens !== null && usage.cacheCreation1hInputTokens !== null;
  const written = hasSplit ? (usage.cacheCreation5mInputTokens ?? 0) + (usage.cacheCreation1hInputTokens ?? 0) : aggregate;
  const card = ratesForPrompt(rate, usage.uncachedInputTokens + read + written);
  const base = card.inputUsdPerMillion / 1_000_000;
  let writes: number;
  let pricedFrom: PricedUsage["cacheWritePricedFrom"];
  let aggregateTtl: CacheWriteTtl | null = null;
  if (hasSplit) {
    writes =
      (usage.cacheCreation5mInputTokens ?? 0) * base * CACHE_RATE_MULTIPLIERS.cacheCreation +
      (usage.cacheCreation1hInputTokens ?? 0) * base * CACHE_RATE_MULTIPLIERS.cacheCreation1h;
    pricedFrom = (usage.cacheCreation5mInputTokens ?? 0) + (usage.cacheCreation1hInputTokens ?? 0) > 0 ? "SPLIT" : "NONE";
  } else if (aggregate > 0) {
    const multiplier = requestedTtl === "1h" ? CACHE_RATE_MULTIPLIERS.cacheCreation1h : CACHE_RATE_MULTIPLIERS.cacheCreation;
    writes = aggregate * base * multiplier;
    pricedFrom = "AGGREGATE";
    aggregateTtl = requestedTtl;
  } else {
    writes = 0;
    pricedFrom = "NONE";
  }
  const full =
    usage.uncachedInputTokens * base +
    writes +
    read * base * cacheReadMultiplierFor(rate.model) +
    (usage.outputTokens / 1_000_000) * card.outputUsdPerMillion;
  return { usd: usage.batch ? full * CACHE_RATE_MULTIPLIERS.batch : full, cacheWritePricedFrom: pricedFrom, aggregateTtl };
}

/** A counterfactual, not a measurement: what the cached tokens would have cost uncached. */
export function cacheSavingUsd(cacheReadInputTokens: number, model: string, rateOverride: ModelRate | null = null): number | null {
  const rate = rateOverride ?? rateFor(model);
  if (rate === null || !Number.isFinite(cacheReadInputTokens)) return null;
  return (cacheReadInputTokens / 1_000_000) * rate.inputUsdPerMillion * (1 - cacheReadMultiplierFor(rate.model));
}

/** The six ledger fields, from one metered usage. The shape `AttemptCost` carries. */
export function meteredCostFields(usage: MeteredUsage): {
  readonly cacheReadInputTokens: number | null;
  readonly cacheCreationInputTokens: number | null;
  readonly cacheCreation5mInputTokens: number | null;
  readonly cacheCreation1hInputTokens: number | null;
  readonly uncachedInputTokens: number | null;
  readonly batch: boolean;
} {
  return {
    cacheReadInputTokens: usage.cacheReadInputTokens,
    cacheCreationInputTokens: usage.cacheCreationInputTokens,
    cacheCreation5mInputTokens: usage.cacheCreation5mInputTokens,
    cacheCreation1hInputTokens: usage.cacheCreation1hInputTokens,
    uncachedInputTokens: usage.uncachedInputTokens,
    batch: usage.batch,
  };
}

/** Sum metered usages turn by turn. A null in any turn's base count makes that field null (unmeasured), never zero. */
export function sumMeteredUsage(turns: readonly MeteredUsage[]): MeteredUsage {
  const add = (pick: (u: MeteredUsage) => number | null): number | null => {
    let total = 0;
    for (const t of turns) {
      const v = pick(t);
      if (v === null) return null;
      total += v;
    }
    return turns.length === 0 ? null : total;
  };
  return {
    uncachedInputTokens: add((u) => u.uncachedInputTokens),
    outputTokens: add((u) => u.outputTokens),
    cacheReadInputTokens: add((u) => u.cacheReadInputTokens),
    cacheCreationInputTokens: add((u) => u.cacheCreationInputTokens),
    cacheCreation5mInputTokens: add((u) => u.cacheCreation5mInputTokens),
    cacheCreation1hInputTokens: add((u) => u.cacheCreation1hInputTokens),
    batch: turns.length > 0 && turns.every((u) => u.batch),
  };
}

/** Null when the base counts are absent. The aggregate cache write is priced at the 5-minute multiplier. */
export function usdForUsageWithCache(
  usage: {
    readonly inputTokens: number | null;
    readonly outputTokens: number | null;
    readonly cacheReadInputTokens?: number | null;
    readonly cacheCreationInputTokens?: number | null;
  },
  rate: ModelRate = MODEL_WORKER_RATES,
): number | null {
  return priceMeteredUsage(
    rate.model,
    {
      uncachedInputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheReadInputTokens: usage.cacheReadInputTokens ?? 0,
      cacheCreationInputTokens: usage.cacheCreationInputTokens ?? 0,
      cacheCreation5mInputTokens: null,
      cacheCreation1hInputTokens: null,
      batch: false,
    },
    "5m",
    rate,
  ).usd;
}

/** Null when the model has no stated rate, so the cost reads as unmeasured. */
export function usdForModelUsage(
  model: string,
  usage: Parameters<typeof usdForUsageWithCache>[0],
): number | null {
  const rate = rateFor(model);
  if (rate === null) return null;
  return usdForUsageWithCache(usage, rate);
}

/** Null when either count is absent. No default rate and no fallback model. */
export function usdForUsage(
  inputTokens: number | null,
  outputTokens: number | null,
  rate: ModelRate = MODEL_WORKER_RATES,
): number | null {
  if (inputTokens === null || outputTokens === null) return null;
  const card = ratesForPrompt(rate, inputTokens);
  return (
    (inputTokens / 1_000_000) * card.inputUsdPerMillion +
    (outputTokens / 1_000_000) * card.outputUsdPerMillion
  );
}
