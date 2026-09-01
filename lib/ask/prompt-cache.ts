/**
 * **PROMPT CACHING FOR THE ASK SYNTHESIS RUNG — the breakpoint, the TTL, and
 * the per-caller accounting.** (Session C, lane W6, 2026-08-31.)
 *
 * ## What is cached, and why the boundary is where it is
 *
 * Prompt caching is a PREFIX MATCH. The API keys on the exact bytes of
 * `model` + `system` + every message content block up to and including the one
 * carrying `cache_control`. One byte earlier in that span differs and every
 * breakpoint at or after it misses.
 *
 * The synthesis request has exactly one stable span and one volatile tail:
 *
 * ```
 *   STABLE    the system rules (constitutional prohibitions, the length
 *             contract, today's date) + the ZIP CIVIC CONTEXT — the bound
 *             subject, the retrieved records, the named gaps, the denominators
 *   VOLATILE  the reader's QUESTION, and the intent and timeframe read off it
 * ```
 *
 * The question used to sit at byte 0 of the message payload, ahead of the
 * records. That ordering makes the prefix unstable by construction: two
 * questions about the same government share nothing the API can key on, and
 * every call re-processes the same agenda text at full price. Moving the
 * question to its own trailing block — after the breakpoint — is the entire
 * mechanism. Nothing is added to the prompt and nothing is removed from it;
 * the same fields are partitioned differently.
 *
 * ## Why the breakpoint is NOT on the system block
 *
 * Measured, not assumed: `synthesisPrompt()` renders 1,503 characters ≈ 418
 * tokens. **Claude Opus 5's minimum cacheable prefix is 512 tokens.** A
 * breakpoint on a prefix below the minimum does not error — it silently never
 * caches, reporting `cache_creation_input_tokens: 0` forever. A marker that
 * can never fire is worse than no marker, because it reads as a guarantee to
 * the next session. So there is ONE breakpoint, at the end of the civic
 * context, and the prefix it covers is system + context, which clears the
 * minimum for any pack carrying real records.
 *
 * (`synthesizeAnswer` refuses an empty pack before it ever reaches the
 * network, so the "pack too small to cache" case is not a live path.)
 *
 * ## The honest limit of the win
 *
 * The records in a pack are RETRIEVED PER QUESTION. So the prefix is stable
 * across questions for one ZIP exactly as far as retrieval returns the same
 * evidence set — which it does for a repeated question, a rephrasing, a retry,
 * and successive questions about one bound subject, and does NOT for two
 * questions that bind different subjects in the same ZIP. This is a real bound
 * and it is stated rather than papered over: the cache is not claimed to make
 * every second question in a ZIP free.
 */

/* ── the TTL ─────────────────────────────────────────────────────────────── */

/**
 * **THE TTL CHOICE, AND THE ARGUMENT FOR IT.**
 *
 * Five minutes — the default `ephemeral` marker, sent bare.
 */
export const SYNTHESIS_CACHE_TTL = {
  ttl: "5m",
  milliseconds: 5 * 60 * 1000,
  /**
   * The wire form. A 5-minute TTL is the DEFAULT and is expressed by omitting
   * `ttl` entirely; `{"ttl":"5m"}` is not a documented wire value and writing
   * one would be a guess dressed as precision.
   */
  cacheControl: { type: "ephemeral" } as const,
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

/* ── the caller key ──────────────────────────────────────────────────────── */

/**
 * **THE CALLER KEY NAMES A DEPLOYMENT, NEVER A READER.**
 *
 * The vocabulary is CLOSED and every member is a plain deployment label. This
 * is the one field in the synthesis path that could carry an identifier out to
 * a third party, and a free-form key is how a session id or a resolved address
 * would eventually get into one. `tests/ask-prompt-cache.test.ts` asserts the
 * closure.
 *
 * The keys are reported SEPARATELY and are never pooled into a single rate: a
 * local development run and production traffic have different prefixes,
 * different arrival rates and different cache behaviour, and one blended
 * number describes neither.
 */
export const ASK_CALLER_KEYS = ["prod-ask", "local-dev", "synthetic-run"] as const;

export type AskCallerKey = (typeof ASK_CALLER_KEYS)[number];

export function isAskCallerKey(value: unknown): value is AskCallerKey {
  return typeof value === "string" && (ASK_CALLER_KEYS as readonly string[]).includes(value);
}

/**
 * Which caller this is.
 *
 * **`NODE_ENV` ALONE IS THE WRONG DISCRIMINATOR, AND GETTING THIS WRONG WOULD
 * HAVE DEFEATED THE WHOLE MEASUREMENT.** `pnpm start` sets
 * `NODE_ENV=production`, and RULING 125 says every walk and check runs against
 * a LOCAL PRODUCTION BUILD — so an env-only rule labels the reader suite,
 * `walk:all` and the cache probe `prod-ask` and pools harness traffic with real
 * readers under one key. The harness asks the same questions over and over and
 * would post a spectacular hit rate on top of whatever production was actually
 * doing.
 *
 * So the first question is not "which environment" but "is this a declared
 * automated run", which the product already answers for the sold search log
 * via `lib/db/run-marker.ts`. A synthetic run is its own caller key on every
 * deployment, because a synthetic run against production must not be pooled
 * with production readers either.
 *
 * An unrecognised `WTP_ASK_CALLER` falls back rather than being trusted
 * through: an unknown value is not a new caller key, it is a typo or an
 * injection, and inventing a key for it would put an unvetted string on the
 * wire.
 */
export function askCallerKey(
  env: NodeJS.ProcessEnv = process.env,
  runClass: "ORGANIC" | "SYNTHETIC" | "UNKNOWN" = "ORGANIC",
): AskCallerKey {
  const declared = env.WTP_ASK_CALLER;
  if (isAskCallerKey(declared)) return declared;
  if (runClass === "SYNTHETIC") return "synthetic-run";
  return env.NODE_ENV === "production" ? "prod-ask" : "local-dev";
}

/* ── usage ───────────────────────────────────────────────────────────────── */

/**
 * What the API reported about cache activity on one call.
 *
 * `inputTokens` is the UNCACHED REMAINDER only — the total prompt is the sum of
 * all three. A report that quotes `inputTokens` alone as "the prompt size"
 * after caching is switched on is reading a different number than it thinks.
 */
export interface CacheUsage {
  readonly inputTokens: number;
  readonly cacheCreationInputTokens: number;
  readonly cacheReadInputTokens: number;
}

export const ZERO_CACHE_USAGE: CacheUsage = {
  inputTokens: 0,
  cacheCreationInputTokens: 0,
  cacheReadInputTokens: 0,
};

/**
 * Read the `usage` block off a Messages API response body.
 *
 * A missing field reads as zero MEASURED, never as an assumed hit. This is the
 * only ground truth that caching is working, so it is parsed defensively and
 * never inferred from the request we sent.
 */
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

/* ── the ledger ──────────────────────────────────────────────────────────── */

export interface CallerCacheStats {
  readonly callerKey: AskCallerKey;
  readonly calls: number;
  readonly callsWithCacheRead: number;
  /** Calls that read a cached prefix, over calls. Never pooled across keys. */
  readonly hitRate: number;
  readonly cacheReadInputTokens: number;
  readonly cacheCreationInputTokens: number;
  readonly uncachedInputTokens: number;
}

/** Per-caller-key totals. A plain record so it serialises into a run record. */
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

/**
 * The rates, one row per caller key that actually made a call.
 *
 * There is deliberately no total row. Pooling `prod-ask` with `local-dev`
 * produces a number that is true of no deployment, and a blended cache hit
 * rate is exactly the kind of plausible summary that hides a production
 * regression behind a warm local cache.
 */
export function cacheHitRates(ledger: CacheLedger): CallerCacheStats[] {
  return ASK_CALLER_KEYS.map((key) => ledger[key]).filter(
    (stats): stats is CallerCacheStats => stats !== undefined,
  );
}

/**
 * One call, as one server-console line.
 *
 * Carries the caller key and three token counts and NOTHING ELSE — no
 * question, no subject, no division, no reader identifier of any kind. A log
 * line is the easiest place in a request path for a reader fact to escape into
 * a durable store nobody audits, so the fields here are fixed rather than
 * spread from the request.
 *
 * `read=0 write=0` on a call that reached the model is the signature worth
 * watching: it means the prefix broke upstream of the breakpoint, and the only
 * symptom otherwise is a larger bill.
 */
export function cacheCallLine(callerKey: AskCallerKey, usage: CacheUsage): string {
  return (
    `ask:cache · ${callerKey} · read=${usage.cacheReadInputTokens} ` +
    `write=${usage.cacheCreationInputTokens} uncached=${usage.inputTokens}`
  );
}

/**
 * One line per caller key, for the server console.
 *
 * Cache activity is visible in two places and they answer different questions:
 * the Anthropic Console's usage view shows cache-read and cache-write tokens
 * for the workspace as a whole, and THIS shows them split by deployment, which
 * the Console cannot do because a caller key is our concept.
 */
export function cacheReportLines(ledger: CacheLedger): string[] {
  const rates = cacheHitRates(ledger);
  if (rates.length === 0) return ["ask:cache · no calls recorded"];
  return rates.map(
    (r) =>
      `ask:cache · ${r.callerKey} · ${r.callsWithCacheRead}/${r.calls} calls read a cached ` +
      `prefix (${(r.hitRate * 100).toFixed(1)}%) · ${r.cacheReadInputTokens} read · ` +
      `${r.cacheCreationInputTokens} written · ${r.uncachedInputTokens} uncached`,
  );
}
