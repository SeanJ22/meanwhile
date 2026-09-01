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
 *
 * ## `--production`, and why RULING 125 does not forbid it (2026-09-01, H1)
 *
 * **The measurement this script exists to take does not exist on a local
 * build.** Anthropic isolates prompt caches PER WORKSPACE, so a hit rate is
 * evidence about the workspace whose credential served the calls and about no
 * other. The local build calls Anthropic with THIS MACHINE's
 * `ANTHROPIC_API_KEY`; the deployed site calls it with the Netlify
 * `ANTHROPIC_API_KEY`, which is a different variable in a different place and
 * is marked `is_secret` — **Netlify returns a 20-character MASK on read, never
 * the value**, so nothing on this machine can compare the two credentials and
 * a comparison against the mask is a comparison of nothing.
 *
 * What CAN be measured is whether the two share a cache namespace, and it was,
 * on 2026-09-01, without either value being read: production answered a
 * question and reported `cache_creation_input_tokens: 1266`, then this machine
 * sent the BYTE-IDENTICAL synthesis request under the local key and Anthropic
 * returned `cache_read_input_tokens: 1266`. A prefix written by one key was
 * read by the other, and caches do not cross workspaces, so **the deployed
 * site and this machine are in ONE workspace.** (The same test puts
 * `WTP_WORKERS_ANTHROPIC_API_KEY` in that workspace too: 7,922 tokens written
 * by one key, read by the other.)
 *
 * That result is what makes a production reading NECESSARY rather than
 * redundant: it was NOT known before it was measured, the repository had been
 * asserting a local 62.5% as though it settled the production question, and
 * "the two keys happen to share a workspace" is a fact that a key rotation can
 * silently reverse.
 *
 * RULING 125 is about grading the PRODUCT against a controlled build — a walk,
 * a check, a regression. This is not that. It is a measurement of a VENDOR-SIDE
 * property of the production deployment, and reporting a local number as if it
 * settled the production question is the thing the ruling actually forbids.
 *
 * Two conditions hold on the production path and neither is optional. Every
 * request carries `x-wtp-synthetic-run`, so its row is SYNTHETIC and is
 * excluded from every aggregate the business sells. And the run record states
 * the row count, because an automated request to production writes one signal
 * row per call and a probe that does not count them is not counting the whole
 * cost of the measurement.
 *
 * **The caller key on those rows is `synthetic-run`, NEVER `prod-ask`, and
 * that is correct rather than a shortfall.** `askCallerKey` resolves a declared
 * synthetic run to `synthetic-run` on every deployment precisely so a harness
 * asking the same question fourteen times cannot be pooled with readers. It
 * follows that **`prod-ask` rows are producible only by an organic reader** —
 * no lawful automated action can create one — while the Anthropic-side cache
 * this probe measures is keyed on workspace + model + prefix bytes and knows
 * nothing about our caller key. The production synthesis path, the production
 * credential, the production workspace and the production prefix are all
 * identical between the two keys; only our own label differs.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  ASK_INCUMBENT_MODEL,
  ASK_MODEL_RATES,
} from "../lib/ask/model-economics.ts";
import {
  cacheHitRates,
  cacheReportLines,
  cacheSavings,
  emptyCacheLedger,
  isAskCallerKey,
  recordCacheUsage,
  SYNTHESIS_CACHE_TTL,
  type CacheLedger,
} from "../lib/ask/prompt-cache.ts";
import { SYNTHETIC_RUN_HEADER } from "../lib/db/run-marker.ts";
import { divisionIndexFor } from "../lib/health/body-denominator.ts";
import { loadJsonArray } from "../lib/health/json-store.ts";
import { headSha } from "../lib/ops/git-facts.ts";
import { EVERYDAY_ZIPS } from "../lib/routing/everyday.ts";

import { today } from "./doc-dates.mjs";

const DEFAULT_BASE = "http://localhost:3000";
const BASE = (process.env.SHOOT_BASE_URL ?? DEFAULT_BASE).replace(/\/$/, "");
const ROOT = process.cwd();
const RUNS_DIR = join(ROOT, "data", "health", "ask-cache-runs");

/**
 * `--production` — measure the DEPLOYED workspace's cache, which is the only
 * place it exists. See the header. Default is off and the refusal below stands.
 */
const PRODUCTION_TARGET = process.argv.slice(2).includes("--production");

/* ── refusal 1: the target must be local, unless --production ────────────── */

{
  let host: string;
  try {
    host = new URL(BASE).hostname;
  } catch {
    console.error(`ask:cache-probe · SHOOT_BASE_URL is not a URL: ${BASE}`);
    process.exit(1);
  }
  const local = host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1";
  if (!local && !PRODUCTION_TARGET) {
    console.error(
      [
        "",
        `ask:cache-probe · REFUSED — the target is ${host}, which is not a local build.`,
        "",
        "  RULING 125: every walk and check runs against the LOCAL production build.",
        "  Pass --production only to measure the DEPLOYED WORKSPACE's prompt cache, which",
        "  is a vendor-side property no local build can observe (caches are per-workspace",
        "  and the deploy holds a different credential). Every call is declared synthetic.",
        "",
      ].join("\n"),
    );
    process.exit(1);
  }
  if (local && PRODUCTION_TARGET) {
    console.error(
      "ask:cache-probe · REFUSED — --production was passed but SHOOT_BASE_URL is local. " +
        "A production reading must name the production host.",
    );
    process.exit(1);
  }
}

/* ── refusal 2: no credential is a WALL, never a 0% hit rate ─────────────── */

/* On a production target the credential that matters is the DEPLOY's, not this
   machine's; this process never holds it and never needs to. */
if (!PRODUCTION_TARGET && !process.env.ANTHROPIC_API_KEY) {
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
      [SYNTHETIC_RUN_HEADER]: `ask-cache-probe-${today()}`,
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

  /*
   * **EVERY CALL, BY NAME.** A hit rate says how many read; it does not say
   * WHICH request did not cache, and "which exact requests are not caching"
   * is the question this probe is asked. So each call prints its own three
   * token counts and its pass number, and a call that reached the model with
   * `read=0 write=0` is flagged as the signature it is: the prefix broke
   * upstream of the breakpoint, or the prefix is below the model's minimum.
   */
  console.log("\n  EVERY CALL THAT REACHED SYNTHESIS, IN ORDER:");
  for (const o of observations) {
    if (!o.synthesisRan || !o.cache) {
      console.log(`    ${o.zip} pass ${o.pass} · NO SYNTHESIS (${o.why ?? "unknown"}) · ${o.question}`);
      continue;
    }
    const c = o.cache;
    const shape =
      c.cacheReadInputTokens > 0
        ? "READ"
        : c.cacheCreationInputTokens > 0
          ? "WROTE"
          : "NEITHER — no cache event on a call that reached the model";
    console.log(
      `    ${o.zip} pass ${o.pass} · ${c.callerKey} · read=${c.cacheReadInputTokens} ` +
        `write=${c.cacheCreationInputTokens} uncached=${c.uncachedInputTokens} · ${shape}`,
    );
    console.log(`      ${o.question}`);
  }

  console.log("\n  HIT RATE, PER CALLER KEY (never pooled):");
  for (const line of cacheReportLines(ledger)) console.log(`    ${line}`);

  /* The saving, DERIVED from the published rate and the measured tokens. A
     model with no published rate prints no dollar figure rather than $0. */
  const rate = ASK_MODEL_RATES[ASK_INCUMBENT_MODEL];
  console.log("\n  ESTIMATED SAVING ON THE INPUT SIDE, PER CALLER KEY:");
  if (!rate) {
    console.log(`    no published rate recorded for ${ASK_INCUMBENT_MODEL} — no figure is printed.`);
  } else {
    for (const stats of rates) {
      const s = cacheSavings(stats, rate.inputUsdPerMillion);
      console.log(
        `    ${s.callerKey} · billed $${s.billedUsd.toFixed(5)} vs $${s.uncachedBaselineUsd.toFixed(5)} ` +
          `with no cache · saved $${s.savedUsd.toFixed(5)} (${(s.savedFraction * 100).toFixed(1)}%) · ` +
          `${(s.cachedShareOfInput * 100).toFixed(1)}% of input tokens were inside the cached prefix`,
      );
    }
  }

  /*
   * **WHAT THE MEASUREMENT COST THE SOLD STORE.** Every call to a running
   * build writes one Ask signal row. They are declared synthetic and therefore
   * excluded from every aggregate the business sells — but the count is stated
   * rather than left to be inferred, because a probe that does not count its
   * own writes is not counting the whole cost of the measurement.
   */
  console.log(
    `\n  ROWS WRITTEN: ${observations.length} Ask signal row(s) at ${BASE}, every one ` +
      `carrying ${SYNTHETIC_RUN_HEADER} and therefore SYNTHETIC, never reader signal.`,
  );

  mkdirSync(RUNS_DIR, { recursive: true });
  const recordPath = join(RUNS_DIR, `${today()}-${Date.now()}.json`);
  writeFileSync(
    recordPath,
    `${JSON.stringify(
      {
        baseUrl: BASE,
        target: PRODUCTION_TARGET ? "PRODUCTION" : "LOCAL",
        /* Anthropic isolates prompt caches per workspace, so a hit rate is
           evidence about the workspace whose credential served the calls and
           about no other. Which credential that was is a property of the
           TARGET, never of this process. */
        credentialUsedBySynthesis: PRODUCTION_TARGET
          ? "the DEPLOY's ANTHROPIC_API_KEY (Netlify, functions scope) — not this machine's"
          : "this machine's ANTHROPIC_API_KEY",
        syntheticMarker: SYNTHETIC_RUN_HEADER,
        askSignalRowsWritten: observations.length,
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
