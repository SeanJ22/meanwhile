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
  /** A 5-minute cache write. */
  cacheCreation: 1.25,
  /** A 1-hour cache write (2026-09-06; the reference's prompt-caching page: "2× for 1-hour TTL"). */
  cacheCreation1h: 2,
  cacheRead: 0.1,
  /** The Message Batches API: 50% of standard prices on every token category (2026-09-06). */
  batch: 0.5,
  statedOn: "2026-09-06",
  source: "Anthropic first-party API rates, read from the claude-api reference (prompt caching; Message Batches)",
} as const;

/* -------------------------------------------------- the metered usage (2026-09-06) */

/**
 * **THE FIVE QUANTITIES THE PROVIDER BILLS, AS ONE RECORD.**
 *
 * `uncachedInputTokens` is the API's `input_tokens` — the remainder after
 * cache reads and writes, at the base price. `cacheCreationInputTokens` is
 * the AGGREGATE the API defines as `ephemeral_5m_input_tokens +
 * ephemeral_1h_input_tokens`; the split is carried beside it because the two
 * TTLs bill at different multipliers, and the aggregate is never priced on top
 * of its split. A response that carries the aggregate and no split leaves the
 * split null, and `priceMeteredUsage` then prices the aggregate at the TTL the
 * request asked for and says so on its result.
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

/**
 * Read the API's `usage` block. Every field is read from the response and
 * never inferred from the request: a missing base count is null (unmeasured),
 * a missing cache field beside a reported base count is a measured zero (a
 * provider that reported `input_tokens` and omitted the cache fields reported
 * no cache use), and a missing `cache_creation` split leaves the split null.
 */
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
 * **THE PRICE, FROM EXACTLY FIVE TOKEN QUANTITIES AND THE OUTPUT.**
 * (2026-09-06. This replaces pricing the whole prompt at the base rate.)
 *
 *   uncached input                       × base input price
 *   5-minute cache writes                × base × 1.25
 *   1-hour cache writes                  × base × 2
 *   cache reads                          × base × 0.1
 *   output                               × output price
 *   then, once, × 0.5 when the request went through the Batches API
 *
 * The aggregate `cacheCreationInputTokens` contributes NOTHING on top of its
 * split; it is priced only when the split is absent, at `requestedTtl`.
 * Null when the model has no stated rate or the base counts are absent — a
 * number that looks measured and is not is worse than a named gap.
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
  const base = rate.inputUsdPerMillion / 1_000_000;
  const read = usage.cacheReadInputTokens ?? 0;
  const aggregate = usage.cacheCreationInputTokens ?? 0;
  const hasSplit = usage.cacheCreation5mInputTokens !== null && usage.cacheCreation1hInputTokens !== null;
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
    read * base * CACHE_RATE_MULTIPLIERS.cacheRead +
    (usage.outputTokens / 1_000_000) * rate.outputUsdPerMillion;
  return { usd: usage.batch ? full * CACHE_RATE_MULTIPLIERS.batch : full, cacheWritePricedFrom: pricedFrom, aggregateTtl };
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

/**
 * The dollar cost of a run whose provider usage split cached from uncached
 * input. Null when the base counts are absent; cached counts default to zero
 * ONLY when the provider reported the base counts, because a provider that
 * reported `input_tokens` and omitted the cache fields reported no cache use.
 *
 * Since 2026-09-06 this is `priceMeteredUsage` over a usage with no TTL split:
 * the aggregate cache write is priced at the 5-minute multiplier, which is
 * every request this lane has ever sent. Callers that hold the split call
 * `priceMeteredUsage` directly.
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
