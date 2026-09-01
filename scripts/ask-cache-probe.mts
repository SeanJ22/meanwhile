/**
 * `pnpm ask:cache-probe` — **THE MEASURED CACHE HIT RATE, PER CALLER KEY.**
 * (Session C, lane W6, H1.)
 *
 * ## What this exists to settle
 *
 * `tests/ask-prompt-cache.test.ts` proves our REQUEST SHAPE earns a cache read
 * under the documented rules, against a double. It cannot prove Anthropic's
 * production cache behaved as documented on a given day, because no test in
 * this repository makes a live call. This script is the other half: it drives
 * the product's own Ask endpoint over real questions and reads the numbers back
 * out of the API's own `usage` block, which is the ONLY ground truth that
 * caching is working.
 *
 * ## Why the rate is per caller key, and never pooled
 *
 * `prod-ask` and `local-dev` are different deployments with different prefixes
 * and different arrival rates. A local build with a warm cache and a cold
 * production one average to a number that is true of neither, and that blended
 * number is exactly what would hide a production regression. So the report has
 * one row per caller key and there is deliberately no total.
 *
 * ## Two refusals, both of them boundaries rather than crashes
 *
 * THE TARGET IS LOCAL — RULING 125, mirrored from `reader-suite.mts`. A
 * non-local `SHOOT_BASE_URL` is refused: production is the delivery truck, not
 * the test bench.
 *
 * And with no `ANTHROPIC_API_KEY` in the environment the synthesis rung returns
 * `UNAVAILABLE: no-key` before it touches the network, so every call would
 * report zero cache activity. **That is a fact about this machine, not about
 * the cache.** Reporting it as a 0% hit rate would be asserting an absence, so
 * the script names the wall and exits without writing a run record.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  cacheHitRates,
  cacheReportLines,
  emptyCacheLedger,
  isAskCallerKey,
  recordCacheUsage,
  SYNTHESIS_CACHE_TTL,
  type CacheLedger,
} from "../lib/ask/prompt-cache.ts";
import { divisionIndexFor } from "../lib/health/body-denominator.ts";
import { loadJsonArray } from "../lib/health/json-store.ts";
import { headSha } from "../lib/ops/git-facts.ts";
import { EVERYDAY_ZIPS } from "../lib/routing/everyday.ts";

import { today } from "./doc-dates.mjs";

const DEFAULT_BASE = "http://localhost:3000";
const BASE = (process.env.SHOOT_BASE_URL ?? DEFAULT_BASE).replace(/\/$/, "");
const ROOT = process.cwd();
const RUNS_DIR = join(ROOT, "data", "health", "ask-cache-runs");

/* ── refusal 1: the target must be local ─────────────────────────────────── */

{
  let host: string;
  try {
    host = new URL(BASE).hostname;
  } catch {
    console.error(`ask:cache-probe · SHOOT_BASE_URL is not a URL: ${BASE}`);
    process.exit(1);
  }
  const local = host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1";
  if (!local) {
    console.error(
      [
        "",
        `ask:cache-probe · REFUSED — the target is ${host}, which is not a local build.`,
        "",
        "  RULING 125: every walk and check runs against the LOCAL production build.",
        "",
      ].join("\n"),
    );
    process.exit(1);
  }
}

/* ── refusal 2: no credential is a WALL, never a 0% hit rate ─────────────── */

if (!process.env.ANTHROPIC_API_KEY) {
  console.error(
    [
      "",
      "ask:cache-probe · BOUNDARY — ANTHROPIC_API_KEY is not set in this environment.",
      "",
      "  The synthesis rung returns UNAVAILABLE: no-key before it reaches the network,",
      "  so every call would report zero cache activity. That is a fact about this",
      "  machine, not about the cache, and reporting it as a 0% hit rate would be",
      "  asserting an absence.",
      "",
      "  This is a failed measurement with the wall named — not an empty success.",
      "  Set the variable (the NAME only ever appears here; no value is read, logged",
      "  or written by this script) and re-run.",
      "",
    ].join("\n"),
  );
  process.exit(1);
}

/* ── the questions ───────────────────────────────────────────────────────── */

interface QuestionTemplate {
  readonly id: string;
  readonly templateText: string;
  readonly applicability?: { readonly zips?: readonly string[] };
}

/**
 * The canonical corpus. Each ZIP's questions are asked TWICE in order: the
 * first pass writes the prefixes, the second reads them. That is the shape the
 * hit rate is a measurement OF — a single cold pass would report 0% correctly
 * and prove nothing.
 */
function questionsFor(zip: string, templates: readonly QuestionTemplate[]): string[] {
  return templates
    .filter((t) => !t.applicability?.zips || t.applicability.zips.includes(zip))
    .map((t) => t.templateText);
}

interface CacheTrace {
  callerKey: string;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  uncachedInputTokens: number;
}

interface CallObservation {
  readonly zip: string;
  readonly pass: 1 | 2;
  readonly question: string;
  readonly synthesisRan: boolean;
  readonly why: string | null;
  readonly cache: CacheTrace | null;
}

async function askOnce(
  zip: string,
  divisionIds: readonly string[],
  question: string,
  pass: 1 | 2,
): Promise<CallObservation> {
  const response = await fetch(`${BASE}/api/ask/grounded`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      /* Declared synthetic. An undeclared automated request counts as reader
         signal in a store the business sells from. */
      "x-wtp-synthetic-run": `ask-cache-probe-${today()}`,
      "cache-control": "no-cache",
      /*
       * SAME-ORIGIN, because the route requires it and is right to.
       *
       * `/api/ask/grounded` refuses a cross-origin submission with 403 before
       * it reaches synthesis (`isSameOriginSubmission`, an anti-abuse guard on
       * an endpoint that spends money per call). `fetch` in Node sends no
       * `Origin`, so the first run of this probe made 14 calls, took 14 × 403,
       * and reported `no calls recorded` — correctly refusing to call a wall a
       * 0% hit rate, and measuring nothing.
       *
       * This is the header a browser on this origin would send, and BASE is
       * already forced local by refusal 1 above. It defeats no guard: an
       * attacker can set a header, which is why the guard is defence in depth
       * rather than authentication.
       */
      origin: BASE,
    },
    body: JSON.stringify({ question, ocdIds: [...divisionIds], today: today() }),
  });
  if (!response.ok) {
    return { zip, pass, question, synthesisRan: false, why: `HTTP ${response.status}`, cache: null };
  }
  const body = (await response.json()) as {
    trace?: { synthesis?: { ran?: boolean; why?: string; cache?: CacheTrace } };
  };
  const synthesis = body.trace?.synthesis;
  return {
    zip,
    pass,
    question,
    synthesisRan: synthesis?.ran === true,
    why: synthesis?.why ?? null,
    cache: synthesis?.cache ?? null,
  };
}

async function main(): Promise<void> {
  const startedAt = new Date().toISOString();
  const templates =
    loadJsonArray<QuestionTemplate>(
      join(ROOT, "data", "health", "reader-questions.json"),
      "question templates",
    ) ?? [];

  if (templates.length === 0) {
    console.error("ask:cache-probe · BOUNDARY — the reader-question corpus is empty.");
    process.exit(1);
  }

  const index = divisionIndexFor(ROOT);
  const observations: CallObservation[] = [];
  let ledger: CacheLedger = emptyCacheLedger();

  for (const zip of EVERYDAY_ZIPS) {
    const divisionIds = index[zip] ?? [];
    const questions = questionsFor(zip, templates);
    if (divisionIds.length === 0 || questions.length === 0) continue;

    /* Two passes, in the same order. Pass 1 writes, pass 2 reads. Both are
       inside the TTL by construction: the whole ZIP is walked in seconds and
       a read refreshes the entry's timer at no cost. */
    for (const pass of [1, 2] as const) {
      for (const question of questions) {
        const observation = await askOnce(zip, divisionIds, question, pass);
        observations.push(observation);
        if (observation.cache && isAskCallerKey(observation.cache.callerKey)) {
          ledger = recordCacheUsage(ledger, observation.cache.callerKey, {
            inputTokens: observation.cache.uncachedInputTokens,
            cacheCreationInputTokens: observation.cache.cacheCreationInputTokens,
            cacheReadInputTokens: observation.cache.cacheReadInputTokens,
          });
        }
      }
    }
  }

  const rates = cacheHitRates(ledger);
  const synthesised = observations.filter((o) => o.synthesisRan).length;

  /* ------------------------------------------------------------ report --- */

  console.log(
    `ask:cache-probe · ${BASE} · sha ${headSha()?.slice(0, 8) ?? "unknown"} · ` +
      `TTL ${SYNTHESIS_CACHE_TTL.ttl}`,
  );
  console.log(
    `  ${observations.length} call(s) made · ${synthesised} reached the synthesis rung · ` +
      `${observations.length - synthesised} did not`,
  );

  /* The denominator is stated and the rows equal it. A call that never reached
     synthesis is NOT a cache miss — it is a call with no cache event at all,
     and folding it into the rate would understate the cache and misname the
     cause. */
  const noSynthesis = observations.filter((o) => !o.synthesisRan);
  if (noSynthesis.length > 0) {
    console.log(`\n  ${noSynthesis.length} call(s) never reached synthesis — not counted as misses:`);
    const byWhy = new Map<string, number>();
    for (const o of noSynthesis) byWhy.set(o.why ?? "unknown", (byWhy.get(o.why ?? "unknown") ?? 0) + 1);
    for (const [why, count] of byWhy) console.log(`    ${count} × ${why}`);
  }

  console.log("\n  HIT RATE, PER CALLER KEY (never pooled):");
  for (const line of cacheReportLines(ledger)) console.log(`    ${line}`);

  mkdirSync(RUNS_DIR, { recursive: true });
  const recordPath = join(RUNS_DIR, `${today()}-${Date.now()}.json`);
  writeFileSync(
    recordPath,
    `${JSON.stringify(
      {
        baseUrl: BASE,
        testedSha: headSha(),
        startedAt,
        finishedAt: new Date().toISOString(),
        ttl: SYNTHESIS_CACHE_TTL.ttl,
        callsMade: observations.length,
        callsReachingSynthesis: synthesised,
        ratesByCallerKey: rates,
        observations,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  console.log(`\n  run record: ${recordPath}`);
}

main().catch((error) => {
  console.error(
    `ask:cache-probe · FAILED: ${error instanceof Error ? error.stack : String(error)}`,
  );
  process.exit(1);
});
