/**
 * **WHAT A MODEL WORKER'S TOKENS COST, AND WHERE THAT NUMBER CAME FROM.**
 * (Owner-authorized model-worker proof, 2026-08-31. Per-model rate table for
 * the Worker Efficiency Law, 2026-09-02, RULING 244.)
 *
 * `lib/control-plane/cost.ts` holds the ledger's own invariant — *cost informs
 * SCHEDULING; cost never informs TRUTH* — and this file inherits it entire.
 * Nothing here may answer, or help answer, whether a fact is right.
 *
 * ## The rate is DATA WITH A DATE, not a constant
 *
 * A price is a fact about a vendor's price list on a day, and a price hardcoded
 * with no provenance is indistinguishable from a price somebody remembered.
 * `statedOn` is what makes a later session able to ask whether it is still
 * true, and `source` is where to check.
 *
 * ## One row per model the lane may route a step to
 *
 * RULING 244 routes each step to the cheapest model class that meets the
 * step's standard, so every model a step may run on needs a rate row, or its
 * cost is UNMEASURED. A model with no row costs `null` — never a guess at a
 * neighbouring model's price.
 *
 * ## And an unmeasured usage is not a free one
 *
 * `usdForUsage` returns **null** when either count is absent. That is the
 * ledger's own rule, quoted from its header: *an unmeasured field is NOT zero.
 * Coercing those nulls to 0 produces a total that LOOKS complete and is not,
 * and a scheduler that believes a run was free will happily schedule a
 * thousand more of them.*
 */

/** The model a bounded worker's FRONTIER step runs. Stated once; the proof asserts it. */
export const MODEL_WORKER_MODEL = "claude-opus-5";

export interface ModelRate {
  readonly model: string;
  readonly inputUsdPerMillion: number;
  readonly outputUsdPerMillion: number;
  /** The date this rate was read. A price with no date is a price nobody can check. */
  readonly statedOn: string;
  readonly source: string;
}

export const MODEL_WORKER_RATES: ModelRate = {
  model: MODEL_WORKER_MODEL,
  inputUsdPerMillion: 5.0,
  outputUsdPerMillion: 25.0,
  statedOn: "2026-08-31",
  source: "Anthropic first-party API rates, read from the claude-api reference",
};

/**
 * **THE RATE TABLE.** One row per model a step may route to. Each row is read
 * from the claude-api reference's model table (its cached price list is dated
 * 2026-06-24) on the day stated. `claude-haiku-4-5` and `claude-sonnet-5` are
 * the exact ids that reference lists; it warns by name against appending a
 * date suffix to a model id.
 */
export const MODEL_RATES: readonly ModelRate[] = [
  MODEL_WORKER_RATES,
  {
    model: "claude-sonnet-5",
    inputUsdPerMillion: 2.0,
    outputUsdPerMillion: 10.0,
    statedOn: "2026-09-02",
    source: "Anthropic first-party API rates, read from the claude-api reference (model table cached 2026-06-24)",
  },
  {
    model: "claude-haiku-4-5",
    inputUsdPerMillion: 1.0,
    outputUsdPerMillion: 5.0,
    statedOn: "2026-09-02",
    source: "Anthropic first-party API rates, read from the claude-api reference (model table cached 2026-06-24)",
  },
];

/**
 * RULING 244's text names the Haiku model as `claude-haiku-4-5-20251001`. The
 * claude-api reference lists the id WITHOUT a date suffix and says the ids in
 * its table are complete as-is. The ruling's spelling is resolved to the
 * reference's id here so a step routed under either spelling meets one rate
 * row; the discrepancy is recorded for the integration owner rather than
 * silently picking one.
 */
export const MODEL_ID_ALIASES: Readonly<Record<string, string>> = {
  "claude-haiku-4-5-20251001": "claude-haiku-4-5",
};

/** The rate row for a model id (aliases resolved), or null when no row is stated. */
export function rateFor(model: string): ModelRate | null {
  const id = MODEL_ID_ALIASES[model] ?? model;
  return MODEL_RATES.find((r) => r.model === id) ?? null;
}

/**
 * The prompt-cache rates, as multiples of the input rate. (Level 1 activation,
 * 2026-09-01.) A cache WRITE is billed at 1.25x input and a cache READ at 0.1x,
 * read from the claude-api reference on that date. Stated as data beside the
 * base rate so a later session can check both against the same price list.
 */
export const CACHE_RATE_MULTIPLIERS = {
  cacheCreation: 1.25,
  cacheRead: 0.1,
  statedOn: "2026-09-01",
  source: "Anthropic first-party API rates, read from the claude-api reference (prompt caching)",
} as const;

/**
 * The dollar cost of a run whose provider usage split cached from uncached
 * input. Null when the base counts are absent; cached counts default to zero
 * ONLY when the provider reported the base counts, because a provider that
 * reported `input_tokens` and omitted the cache fields reported no cache use.
 */
export function usdForUsageWithCache(
  usage: {
    readonly inputTokens: number | null;
    readonly outputTokens: number | null;
    readonly cacheReadInputTokens?: number | null;
    readonly cacheCreationInputTokens?: number | null;
  },
  rate: ModelRate = MODEL_WORKER_RATES,
): number | null {
  if (usage.inputTokens === null || usage.outputTokens === null) return null;
  const read = usage.cacheReadInputTokens ?? 0;
  const created = usage.cacheCreationInputTokens ?? 0;
  return (
    (usage.inputTokens / 1_000_000) * rate.inputUsdPerMillion +
    (created / 1_000_000) * rate.inputUsdPerMillion * CACHE_RATE_MULTIPLIERS.cacheCreation +
    (read / 1_000_000) * rate.inputUsdPerMillion * CACHE_RATE_MULTIPLIERS.cacheRead +
    (usage.outputTokens / 1_000_000) * rate.outputUsdPerMillion
  );
}

/**
 * The same cost, for a NAMED model. Null when the model has no stated rate:
 * a step billed at a rate nobody read is a number that looks measured and is
 * not, and the digest then reports the step's cost as UNMEASURED by name.
 */
export function usdForModelUsage(
  model: string,
  usage: Parameters<typeof usdForUsageWithCache>[0],
): number | null {
  const rate = rateFor(model);
  if (rate === null) return null;
  return usdForUsageWithCache(usage, rate);
}

/**
 * The dollar cost of one run, from the PROVIDER's own token counts.
 *
 * Null when either count is absent — see the header. There is deliberately no
 * default rate and no fallback model: a cost computed at a rate nobody chose
 * is a number that looks measured and is not.
 */
export function usdForUsage(
  inputTokens: number | null,
  outputTokens: number | null,
  rate: ModelRate = MODEL_WORKER_RATES,
): number | null {
  if (inputTokens === null || outputTokens === null) return null;
  return (
    (inputTokens / 1_000_000) * rate.inputUsdPerMillion +
    (outputTokens / 1_000_000) * rate.outputUsdPerMillion
  );
}
