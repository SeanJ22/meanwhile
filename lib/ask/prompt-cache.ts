export const SYNTHESIS_CACHE_TTL = {
  ttl: "5m",
  milliseconds: 5 * 60 * 1000,
  // A 5-minute TTL is the API default and is sent by omitting `ttl`.
  cacheControl: { type: "ephemeral" } as const,
  // Shared role instructions have no ZIP, evidence, date or question and survive between jobs.
  stableCacheControl: { type: "ephemeral", ttl: "1h" } as const,
  why:
    "Five minutes, for three reasons that are about THIS traffic rather than about caching in " +
    "general. First, a cache read refreshes the entry's timer at no additional cost, and the " +
    "gap that decides the TTL is start-to-start between requests sharing the prefix — a reader " +
    "asking successive questions about one government, and the reader suite asking every " +
    "question of a ZIP on one seeded page, both land well inside five minutes, so the entry " +
    "stays warm indefinitely without anyone paying for retention. Second, the 1-hour TTL costs " +
    "2x on write against 1.25x for five minutes and needs at least three requests over the same " +
    "prefix to break even; this prefix is specific to one ZIP AND one retrieved evidence set, so " +
    "most prefixes are touched two or three times at most and the doubled write would frequently " +
    "never amortise. Third, the records inside the prefix are refreshed on a schedule, so buying " +
    "an hour of retention on bytes that can go stale inside that hour is paying for retention " +
    "the product cannot use. Revisit this if Ask ever serves sustained traffic whose same-ZIP " +
    "gaps exceed five minutes — that is the one condition under which the 1-hour TTL wins.",
} as const;

/** A closed vocabulary: a caller key names a deployment, never a reader, and keys are never pooled. */
export const ASK_CALLER_KEYS = ["prod-ask", "local-dev", "synthetic-run"] as const;

export type AskCallerKey = (typeof ASK_CALLER_KEYS)[number];

export function isAskCallerKey(value: unknown): value is AskCallerKey {
  return typeof value === "string" && (ASK_CALLER_KEYS as readonly string[]).includes(value);
}

/** A declared synthetic run keeps its own key on every deployment, so `NODE_ENV` alone never decides it. */
export function askCallerKey(
  env: NodeJS.ProcessEnv = process.env,
  runClass: "ORGANIC" | "SYNTHETIC" | "UNKNOWN" = "ORGANIC",
): AskCallerKey {
  const declared = env.WTP_ASK_CALLER;
  if (isAskCallerKey(declared)) return declared;
  if (runClass === "SYNTHETIC") return "synthetic-run";
  return env.NODE_ENV === "production" ? "prod-ask" : "local-dev";
}

export interface CacheUsage {
  /** The uncached remainder only; the whole prompt is the sum of all three counts. */
  readonly inputTokens: number;
  readonly cacheCreationInputTokens: number;
  readonly cacheReadInputTokens: number;
}

export const ZERO_CACHE_USAGE: CacheUsage = {
  inputTokens: 0,
  cacheCreationInputTokens: 0,
  cacheReadInputTokens: 0,
};

export function readCacheUsage(body: unknown): CacheUsage {
  const usage = (body as { usage?: Record<string, unknown> } | null)?.usage;
  if (!usage || typeof usage !== "object") return ZERO_CACHE_USAGE;
  const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  return {
    inputTokens: num(usage.input_tokens),
    cacheCreationInputTokens: num(usage.cache_creation_input_tokens),
    cacheReadInputTokens: num(usage.cache_read_input_tokens),
  };
}

export interface CallerCacheStats {
  readonly callerKey: AskCallerKey;
  readonly calls: number;
  readonly callsWithCacheRead: number;
  readonly hitRate: number;
  readonly cacheReadInputTokens: number;
  readonly cacheCreationInputTokens: number;
  readonly uncachedInputTokens: number;
}

export type CacheLedger = Readonly<Partial<Record<AskCallerKey, CallerCacheStats>>>;

export function emptyCacheLedger(): CacheLedger {
  return {};
}

export function recordCacheUsage(
  ledger: CacheLedger,
  callerKey: AskCallerKey,
  usage: CacheUsage,
): CacheLedger {
  const prior =
    ledger[callerKey] ??
    ({
      callerKey,
      calls: 0,
      callsWithCacheRead: 0,
      hitRate: 0,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
      uncachedInputTokens: 0,
    } satisfies CallerCacheStats);

  const calls = prior.calls + 1;
  const callsWithCacheRead = prior.callsWithCacheRead + (usage.cacheReadInputTokens > 0 ? 1 : 0);
  return {
    ...ledger,
    [callerKey]: {
      callerKey,
      calls,
      callsWithCacheRead,
      hitRate: calls === 0 ? 0 : callsWithCacheRead / calls,
      cacheReadInputTokens: prior.cacheReadInputTokens + usage.cacheReadInputTokens,
      cacheCreationInputTokens: prior.cacheCreationInputTokens + usage.cacheCreationInputTokens,
      uncachedInputTokens: prior.uncachedInputTokens + usage.inputTokens,
    },
  };
}

export function cacheHitRates(ledger: CacheLedger): CallerCacheStats[] {
  return ASK_CALLER_KEYS.map((key) => ledger[key]).filter(
    (stats): stats is CallerCacheStats => stats !== undefined,
  );
}

export const CACHE_WRITE_MULTIPLIER = 1.25;
export const CACHE_READ_MULTIPLIER = 0.1;

export interface CacheSavings {
  readonly callerKey: AskCallerKey;
  readonly billedUsd: number;
  readonly uncachedBaselineUsd: number;
  readonly savedUsd: number;
  readonly savedFraction: number;
  readonly cachedShareOfInput: number;
}

export function cacheSavings(
  stats: CallerCacheStats,
  inputUsdPerMillion: number,
): CacheSavings {
  const per = inputUsdPerMillion / 1_000_000;
  const total =
    stats.cacheReadInputTokens + stats.cacheCreationInputTokens + stats.uncachedInputTokens;
  const billed =
    stats.cacheReadInputTokens * per * CACHE_READ_MULTIPLIER +
    stats.cacheCreationInputTokens * per * CACHE_WRITE_MULTIPLIER +
    stats.uncachedInputTokens * per;
  const baseline = total * per;
  return {
    callerKey: stats.callerKey,
    billedUsd: billed,
    uncachedBaselineUsd: baseline,
    savedUsd: baseline - billed,
    savedFraction: baseline === 0 ? 0 : (baseline - billed) / baseline,
    cachedShareOfInput:
      total === 0
        ? 0
        : (stats.cacheReadInputTokens + stats.cacheCreationInputTokens) / total,
  };
}

export function cacheCallLine(callerKey: AskCallerKey, usage: CacheUsage): string {
  return (
    `ask:cache · ${callerKey} · read=${usage.cacheReadInputTokens} ` +
    `write=${usage.cacheCreationInputTokens} uncached=${usage.inputTokens}`
  );
}
