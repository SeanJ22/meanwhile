/**
 * `scout:efficiency` — WHAT EVERY PERSISTED SCOUT ATTEMPT COST, BY TOKEN
 * CATEGORY, AND HOW MUCH OF IT WAS A REPEATED PREFIX.
 * (Worker Efficiency Law baseline, 2026-09-02. RULING 244.)
 *
 * A separate process that only reads. It joins every persisted Scout result
 * to its Attempt and its cost-ledger entries and writes ONE record: per
 * Attempt the tokens by category, turns, tool calls, model, usd, outcome; the
 * totals; the cost per outcome class; the cache hit rate; and the attribution
 * of each Attempt's input to REPEATED PREFIX versus new content.
 *
 * ## The repeated-prefix attribution, and what it rests on
 *
 * Results recorded before RULING 244 carry only TOTALS (the executor summed
 * usage over turns), so per-turn sizes are not in the record. For those the
 * attribution is MODELLED and the model is stated: with a stable prefix and a
 * roughly constant per-turn increment, the uncached input over T turns is the
 * arithmetic series C(T+1)/2 where C is the final conversation size, so
 * C = 2U/(T+1) and the repeated prefix is U - C. Results recorded WITH
 * per-turn `steps` are MEASURED: the repeated prefix on turn N is what turn N
 * read from the cache plus whatever it re-sent uncached that turn N-1 had
 * already sent. The record says which of the two each Attempt used.
 *
 * ```
 *   node --env-file=.env.local --experimental-strip-types scripts/scout-efficiency-baseline.mts \
 *        [--label=baseline|after] [--out=<path>] [--attempts=<id,id>] [--last=N]
 * ```
 *
 * Default output: data/ops/scout-efficiency-<label>.json. Env var names only.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import {
  controlPlaneUrlFromEnv,
  createPgRepositories,
  CONTROL_PLANE_URL_VAR,
} from "../lib/control-plane/repository/pg-store.ts";
import type { ControlPlaneRepositories } from "../lib/control-plane/repository/types.ts";
import type { CostEntry } from "../lib/control-plane/cost.ts";
import type { ScoutResult, ScoutStep } from "../lib/control-plane/scheduler/scout-result.ts";
import { MODEL_RATES, CACHE_RATE_MULTIPLIERS, rateFor } from "../lib/control-plane/model-cost.ts";
import { cacheHitRateByRole, costPerUsefulOutcome } from "../lib/control-plane/research-metrics.ts";
import { RESEARCH_BOUNDS, ceilingPermits, scoutSpendInWindow } from "../lib/control-plane/scheduler/research-policy.ts";
import { floorLine, floored } from "../lib/ops/denominator-floor.ts";
import { candidateStoreCounts } from "../lib/control-plane/scheduler/scout-candidates.ts";
import { headSha } from "../lib/ops/git-facts.ts";

const ROOT = process.cwd();
const NOW = new Date().toISOString();

const argv = process.argv.slice(2);
const labelArg = argv.find((a) => a.startsWith("--label="));
const LABEL = labelArg ? labelArg.slice("--label=".length) : "baseline";
const outArg = argv.find((a) => a.startsWith("--out="));
const OUT = outArg ? resolve(ROOT, outArg.slice("--out=".length)) : join(ROOT, "data", "ops", `scout-efficiency-${LABEL}.json`);
const attemptsArg = argv.find((a) => a.startsWith("--attempts="));
const ATTEMPTS = attemptsArg ? new Set(attemptsArg.slice("--attempts=".length).split(",").map((s) => s.trim()).filter(Boolean)) : null;
const lastArg = argv.find((a) => a.startsWith("--last="));
const LAST = lastArg ? Number(lastArg.slice("--last=".length)) : null;
/** Only results recorded at or after this stamp: the "after" reading scopes to Attempts run under the new lane. */
const sinceArg = argv.find((a) => a.startsWith("--since="));
const SINCE = sinceArg ? sinceArg.slice("--since=".length) : null;

const redact = (s: string): string => s.replace(/postgres(?:ql)?:\/\/\S+/gi, "<connection string redacted>");
const line = (s: string): void => console.log(`  ${s}`);

/* ------------------------------------------------------------------ types */

interface AttemptEfficiency {
  readonly attemptId: string;
  readonly obligationId: string;
  readonly recordedAt: string;
  readonly model: string;
  readonly effort: string | null;
  readonly outcome: string;
  readonly refused: boolean;
  readonly attemptOutcome: string | null;
  readonly turns: number;
  readonly toolCalls: number;
  readonly tokens: { readonly uncachedInput: number | null; readonly cacheRead: number | null; readonly cacheWrite: number | null; readonly output: number | null; readonly totalInput: number | null };
  readonly usd: number | null;
  readonly ledgerUsd: number | null;
  /** cacheRead / (cacheRead + cacheWrite + uncachedInput). Null when unreported. */
  readonly cacheHitRate: number | null;
  readonly repeatedPrefix: {
    readonly method: "MEASURED_FROM_STEPS" | "MODELLED_ARITHMETIC_SERIES" | "UNMEASURED";
    /** Input tokens that were a re-send (uncached) or a re-read (cached) of an earlier turn's prefix. */
    readonly tokens: number | null;
    /** Of those, the tokens re-sent UNCACHED — the waste the breakpoints remove. */
    readonly uncachedRepeat: number | null;
    readonly shareOfTotalInput: number | null;
    readonly finalConversationEstimate: number | null;
    readonly detail: string;
  };
  readonly perTurn: readonly { readonly turn: number; readonly cacheRead: number; readonly cacheWrite: number; readonly uncachedInput: number; readonly output: number; readonly usd: number | null }[] | null;
  readonly cacheDefectTurns: readonly number[] | null;
  readonly deterministicSteps: readonly { readonly step: string; readonly count: number; readonly representationBytes: number }[] | null;
  readonly guardRefusals: number | null;
  readonly representationOverruns: number | null;
}

interface EfficiencyRecord {
  readonly formatVersion: 1;
  readonly label: string;
  readonly measuredAt: string;
  readonly testedSha: string | null;
  readonly store: string;
  readonly rates: typeof MODEL_RATES;
  readonly cacheMultipliers: typeof CACHE_RATE_MULTIPLIERS;
  readonly resultsInLog: number;
  readonly shown: number;
  readonly since: string | null;
  readonly liveWindow: {
    readonly asOf: string;
    readonly windowUsd: number | null;
    readonly ceilingUsd: number;
    readonly measuredAttempts: number;
    readonly unmeasuredAttempts: number;
    readonly permits: boolean;
    readonly reason: string;
    readonly meanUsdPerAttempt: number | null;
    readonly nextPermitsOneAt: string | null;
    readonly nextPermitsTwoAt: string | null;
    readonly rule: string;
  };
  readonly attempts: readonly AttemptEfficiency[];
  readonly totals: {
    readonly attempts: number;
    readonly measuredAttempts: number;
    readonly uncachedInput: number;
    readonly cacheRead: number;
    readonly cacheWrite: number;
    readonly output: number;
    readonly usd: number;
    readonly cacheHitRate: number | null;
    readonly repeatedPrefixTokens: number;
    readonly repeatedPrefixUncached: number;
    readonly repeatedPrefixShare: number | null;
    /** What the same tokens would cost if every repeated-prefix token were a cache read instead of an uncached send. */
    readonly usdIfPrefixCached: number | null;
    readonly denominator: string;
  };
  readonly cacheByRole: ReturnType<typeof cacheHitRateByRole>;
  readonly costPerOutcome: ReturnType<typeof costPerUsefulOutcome>;
  readonly costPerOutcomeClass: readonly { readonly outcome: string; readonly attempts: number; readonly usd: number; readonly meanUsd: number | null }[];
  readonly avondale: AttemptEfficiency | null;
}

/* ------------------------------------------------------------- the store */

const url = controlPlaneUrlFromEnv();
if (url === null) {
  console.error(`scout:efficiency · ${CONTROL_PLANE_URL_VAR} is not set. Refusing to read a different store than the Scouts write to.`);
  process.exit(1);
}
let repos: ControlPlaneRepositories;
try {
  repos = await createPgRepositories(url, NOW);
} catch (error) {
  console.error(`scout:efficiency · could not open the control plane: ${redact(error instanceof Error ? error.message : String(error))}`);
  process.exit(1);
}

const all = await repos.scoutResults.readAll();
const costs = await repos.costs.readAll();
const ledgerByAttempt = new Map<string, CostEntry[]>();
for (const c of costs) {
  const rows = ledgerByAttempt.get(c.attemptId) ?? [];
  rows.push(c);
  ledgerByAttempt.set(c.attemptId, rows);
}

const ordered = [...all]
  .filter((r) => ATTEMPTS === null || ATTEMPTS.has(r.attemptId))
  .filter((r) => SINCE === null || r.recordedAt >= SINCE)
  .sort((a, b) => (a.recordedAt > b.recordedAt ? -1 : a.recordedAt < b.recordedAt ? 1 : 0));
const shown = LAST === null ? ordered : ordered.slice(0, LAST);

console.log(`scout:efficiency · ${LABEL} · READ BACK FROM ${repos.describe()} at ${NOW}`);
line(`results in log ${all.length}; in scope ${shown.length}${ATTEMPTS ? ` (--attempts ${ATTEMPTS.size})` : ""}${LAST ? ` (--last=${LAST})` : ""}${SINCE ? ` (--since=${SINCE})` : ""}`);

/*
 * THE LIVE WINDOW. Whether the rolling ceiling permits a live Attempt right
 * now, and when it next permits one and two at the measured mean — so a
 * reading taken while the cap holds records the deferral BY NAME (the
 * ceiling's own reason string) rather than an absence of proof.
 */
const spendNow = scoutSpendInWindow(costs, NOW, RESEARCH_BOUNDS.windowHours);
const capNow = ceilingPermits(spendNow.windowUsd, RESEARCH_BOUNDS.dailyCeilingUsd);
const meanNow = spendNow.measured === 0 ? null : (spendNow.windowUsd ?? 0) / spendNow.measured;
function nextPermits(attempts: number): string | null {
  if (meanNow === null) return null;
  const since = Date.parse(NOW) - RESEARCH_BOUNDS.windowHours * 3_600_000;
  const entries = costs
    .filter((c) => c.role === "SCOUT" && Date.parse(c.recordedAt) >= since)
    .sort((a, b) => (a.recordedAt < b.recordedAt ? -1 : 1));
  let running = spendNow.windowUsd ?? 0;
  if (RESEARCH_BOUNDS.dailyCeilingUsd - running >= attempts * meanNow) return NOW;
  for (const c of entries) {
    running -= c.cost.usd ?? 0;
    if (RESEARCH_BOUNDS.dailyCeilingUsd - running >= attempts * meanNow) {
      return new Date(Date.parse(c.recordedAt) + RESEARCH_BOUNDS.windowHours * 3_600_000).toISOString();
    }
  }
  return null;
}
const liveWindow = {
  asOf: NOW,
  windowUsd: spendNow.windowUsd,
  ceilingUsd: RESEARCH_BOUNDS.dailyCeilingUsd,
  measuredAttempts: spendNow.measured,
  unmeasuredAttempts: spendNow.unmeasured,
  permits: capNow.permits,
  reason: capNow.why,
  meanUsdPerAttempt: meanNow,
  nextPermitsOneAt: nextPermits(1),
  nextPermitsTwoAt: nextPermits(2),
  rule: "the window next permits N Attempts when ceiling - (spend after the oldest entries age out) >= N x the measured mean; entries age out 24h after recordedAt",
};
line(`live window: $${spendNow.windowUsd === null ? "UNMEASURED" : spendNow.windowUsd.toFixed(4)} of $${RESEARCH_BOUNDS.dailyCeilingUsd} -> ${capNow.permits ? "PERMITS" : "DEFERS"}: ${capNow.why}`);
line(`  mean $${meanNow === null ? "UNMEASURED" : meanNow.toFixed(4)}/Attempt · next permits one at ${liveWindow.nextPermitsOneAt ?? "UNKNOWN"} · two at ${liveWindow.nextPermitsTwoAt ?? "UNKNOWN"}`);

/* --------------------------------------------------------------- per row */

function repeatedPrefixOf(r: ScoutResult, modelSteps: readonly ScoutStep[]): AttemptEfficiency["repeatedPrefix"] {
  const U = r.usage.inputTokens;
  const R = r.usage.cacheReadInputTokens ?? 0;
  const W = r.usage.cacheCreationInputTokens ?? 0;
  const T = r.usage.turns;
  if (U === null || T === 0) return { method: "UNMEASURED", tokens: null, uncachedRepeat: null, shareOfTotalInput: null, finalConversationEstimate: null, detail: "no usage reported" };
  const total = U + R + W;
  if (modelSteps.length >= 2) {
    /* MEASURED: on turn N everything turn N-1 sent is a repeat. */
    let repeat = 0;
    let uncachedRepeat = 0;
    let prevTotal = 0;
    for (const s of [...modelSteps].sort((a, b) => (a.turn ?? 0) - (b.turn ?? 0))) {
      const sent = s.tokens.uncachedInput + s.tokens.cacheRead + s.tokens.cacheWrite;
      const rep = Math.min(prevTotal, sent);
      repeat += rep;
      /* The uncached repeat is the part of the repeat the cache did NOT serve. */
      uncachedRepeat += Math.max(0, rep - s.tokens.cacheRead);
      prevTotal = sent;
    }
    return {
      method: "MEASURED_FROM_STEPS",
      tokens: repeat,
      uncachedRepeat,
      shareOfTotalInput: total === 0 ? null : repeat / total,
      finalConversationEstimate: prevTotal,
      detail: `per-turn steps recorded; turn N's repeat = min(what turn N-1 sent, what turn N sent); uncached repeat = repeat - turn N's cache reads`,
    };
  }
  const C = (2 * U) / (T + 1);
  const repeatUncached = Math.max(0, U - C);
  return {
    method: "MODELLED_ARITHMETIC_SERIES",
    tokens: repeatUncached + R,
    uncachedRepeat: repeatUncached,
    shareOfTotalInput: total === 0 ? null : (repeatUncached + R) / total,
    finalConversationEstimate: Math.round(C),
    detail: `totals only (pre-RULING 244): C = 2U/(T+1) = ${Math.round(C)} estimates the final conversation; uncached repeat = U - C = ${Math.round(repeatUncached)}; cache reads ${R} are the prefix the provider served`,
  };
}

const rows: AttemptEfficiency[] = [];
for (const r of shown) {
  let attemptOutcome: string | null = null;
  try {
    attemptOutcome = (await repos.attempts.read(r.attemptId))?.value.outcome ?? null;
  } catch {
    attemptOutcome = null;
  }
  const ledger = (ledgerByAttempt.get(r.attemptId) ?? []).filter((c) => c.role === "SCOUT");
  const ledgerUsd = ledger.length === 0 ? null : ledger.reduce((n, c) => n + (c.cost.usd ?? 0), 0);
  const u = r.usage;
  const modelSteps = (r.steps ?? []).filter((s) => s.kind === "MODEL");
  const detSteps = (r.steps ?? []).filter((s) => s.kind === "DETERMINISTIC");
  const totalInput = u.inputTokens === null ? null : u.inputTokens + (u.cacheReadInputTokens ?? 0) + (u.cacheCreationInputTokens ?? 0);
  const cacheDen = u.inputTokens === null ? 0 : u.inputTokens + (u.cacheReadInputTokens ?? 0) + (u.cacheCreationInputTokens ?? 0);
  rows.push({
    attemptId: r.attemptId,
    obligationId: r.obligationId,
    recordedAt: r.recordedAt,
    model: r.worker.modelReported ?? r.worker.model,
    effort: r.effort ?? null,
    outcome: r.outcome,
    refused: r.refusal !== null,
    attemptOutcome,
    turns: u.turns,
    toolCalls: u.toolCalls,
    tokens: { uncachedInput: u.inputTokens, cacheRead: u.cacheReadInputTokens, cacheWrite: u.cacheCreationInputTokens, output: u.outputTokens, totalInput },
    usd: r.usd,
    ledgerUsd,
    cacheHitRate: cacheDen === 0 ? null : (u.cacheReadInputTokens ?? 0) / cacheDen,
    repeatedPrefix: repeatedPrefixOf(r, modelSteps),
    perTurn: modelSteps.length === 0 ? null : modelSteps.map((s) => ({ turn: s.turn ?? 0, cacheRead: s.tokens.cacheRead, cacheWrite: s.tokens.cacheWrite, uncachedInput: s.tokens.uncachedInput, output: s.tokens.output, usd: s.usd })),
    cacheDefectTurns: r.steps === undefined ? null : (r.cacheDefect?.turns ?? []),
    deterministicSteps: detSteps.length === 0 ? null : detSteps.map((s) => ({ step: s.step, count: s.count, representationBytes: s.representationBytes })),
    guardRefusals: r.guardRefusals === undefined ? null : r.guardRefusals.length,
    representationOverruns: r.representationOverruns === undefined ? null : r.representationOverruns.length,
  });
}

/* ---------------------------------------------------------------- totals */

const measured = rows.filter((x) => x.tokens.uncachedInput !== null);
const sum = (f: (x: AttemptEfficiency) => number | null): number => measured.reduce((n, x) => n + (f(x) ?? 0), 0);
const tUncached = sum((x) => x.tokens.uncachedInput);
const tRead = sum((x) => x.tokens.cacheRead);
const tWrite = sum((x) => x.tokens.cacheWrite);
const tOut = sum((x) => x.tokens.output);
const tUsd = rows.reduce((n, x) => n + (x.usd ?? 0), 0);
const tRepeat = sum((x) => x.repeatedPrefix.tokens);
const tRepeatUncached = sum((x) => x.repeatedPrefix.uncachedRepeat);
const totalInputAll = tUncached + tRead + tWrite;
/* The counterfactual: every uncached repeat becomes a cache read at the frontier rate. */
const frontier = rateFor("claude-opus-5");
const usdIfPrefixCached =
  frontier === null
    ? null
    : tUsd - (tRepeatUncached / 1e6) * frontier.inputUsdPerMillion * (1 - CACHE_RATE_MULTIPLIERS.cacheRead);

const classes = [...new Set(rows.map((x) => (x.refused ? "REFUSED" : x.outcome)))].sort();
const costPerOutcomeClass = classes.map((outcome) => {
  const inClass = rows.filter((x) => (x.refused ? "REFUSED" : x.outcome) === outcome);
  const usdSum = inClass.reduce((n, x) => n + (x.usd ?? 0), 0);
  const measuredIn = inClass.filter((x) => x.usd !== null).length;
  return { outcome, attempts: inClass.length, usd: usdSum, meanUsd: measuredIn === 0 ? null : usdSum / measuredIn };
});

const record: EfficiencyRecord = {
  formatVersion: 1,
  label: LABEL,
  measuredAt: NOW,
  testedSha: headSha(ROOT),
  store: repos.describe(),
  rates: MODEL_RATES,
  cacheMultipliers: CACHE_RATE_MULTIPLIERS,
  resultsInLog: all.length,
  shown: shown.length,
  since: SINCE,
  liveWindow,
  attempts: rows,
  totals: {
    attempts: rows.length,
    measuredAttempts: measured.length,
    uncachedInput: tUncached,
    cacheRead: tRead,
    cacheWrite: tWrite,
    output: tOut,
    usd: tUsd,
    cacheHitRate: totalInputAll === 0 ? null : tRead / totalInputAll,
    repeatedPrefixTokens: tRepeat,
    repeatedPrefixUncached: tRepeatUncached,
    repeatedPrefixShare: totalInputAll === 0 ? null : tRepeat / totalInputAll,
    usdIfPrefixCached,
    denominator: `${measured.length} Attempt(s) with reported usage of ${rows.length} in scope; cache hit rate = cacheRead / (cacheRead + cacheWrite + uncachedInput); usdIfPrefixCached reprices every uncached repeated-prefix token as a cache read at ${frontier?.inputUsdPerMillion ?? "?"} x ${CACHE_RATE_MULTIPLIERS.cacheRead}`,
  },
  cacheByRole: cacheHitRateByRole({ costs, results: shown }),
  costPerOutcome: costPerUsefulOutcome({
    results: shown,
    candidateCounts: (() => {
      const counts = candidateStoreCounts(ROOT);
      return counts === null ? null : { validated: counts.VALIDATED, admitted: counts.ADMITTED };
    })(),
    confirmed: null,
  }),
  costPerOutcomeClass,
  avondale: rows.find((x) => x.obligationId === "freshness:jurisdiction:az:city:city-of-avondale#meetings-1") ?? null,
};

/* --------------------------------------------------------------- print */

console.log();
line("attempt                     turns tools   uncached   cacheRead cacheWrite   output      usd  hit%  repeat%  method");
for (const x of rows) {
  const t = x.tokens;
  line(
    `${x.attemptId.padEnd(27)} ${String(x.turns).padStart(5)} ${String(x.toolCalls).padStart(5)} ${String(t.uncachedInput ?? "null").padStart(10)} ` +
      `${String(t.cacheRead ?? "null").padStart(11)} ${String(t.cacheWrite ?? "null").padStart(10)} ${String(t.output ?? "null").padStart(8)} ` +
      `${x.usd === null ? "   null" : x.usd.toFixed(4).padStart(8)} ${x.cacheHitRate === null ? " null" : (x.cacheHitRate * 100).toFixed(1).padStart(5)} ` +
      `${x.repeatedPrefix.shareOfTotalInput === null ? "   null" : (x.repeatedPrefix.shareOfTotalInput * 100).toFixed(1).padStart(7)}  ${x.repeatedPrefix.method}  ${x.refused ? "REFUSED" : x.outcome}`,
  );
  if (x.perTurn) {
    for (const p of x.perTurn) line(`    turn ${p.turn}: read ${p.cacheRead} write ${p.cacheWrite} uncached ${p.uncachedInput} out ${p.output} usd ${p.usd === null ? "null" : p.usd.toFixed(4)}`);
  }
}
console.log();
const T = record.totals;
/* RULING 159: the count is floored on its population; an empty scope says so rather than printing a zero. */
line(
  floorLine(
    floored(
      "Attempts with reported usage",
      "the Scout results in scope",
      rows.length,
      measured.length,
      rows.length === 0 ? `no Scout result is in scope${SINCE ? ` since ${SINCE}` : ""}; the live window block above says whether one could have run` : undefined,
    ),
  ),
);
line(`TOTALS ${T.attempts} attempt(s), ${T.measuredAttempts} measured: uncached ${T.uncachedInput} · cacheRead ${T.cacheRead} · cacheWrite ${T.cacheWrite} · output ${T.output} · usd ${T.usd.toFixed(4)}`);
line(`cache hit rate ${T.cacheHitRate === null ? "UNMEASURED" : `${(T.cacheHitRate * 100).toFixed(1)}%`} · repeated prefix ${T.repeatedPrefixTokens} tokens (${T.repeatedPrefixShare === null ? "UNMEASURED" : `${(T.repeatedPrefixShare * 100).toFixed(1)}%`} of input), of which ${T.repeatedPrefixUncached} re-sent UNCACHED`);
line(`usd if every uncached repeat had been a cache read: ${T.usdIfPrefixCached === null ? "UNMEASURED" : `$${T.usdIfPrefixCached.toFixed(4)}`} (actual $${T.usd.toFixed(4)})`);
for (const c of costPerOutcomeClass) line(`cost per outcome class ${c.outcome}: ${c.attempts} attempt(s), $${c.usd.toFixed(4)}, mean ${c.meanUsd === null ? "UNMEASURED" : `$${c.meanUsd.toFixed(4)}`}`);
for (const c of record.costPerOutcome) line(`cost per useful outcome ${c.outcome}: ${c.usdPerOutcome === null ? "UNMEASURED" : `$${c.usdPerOutcome.toFixed(4)}`} over ${c.count}`);
if (record.avondale) {
  const a = record.avondale;
  line(
    `AVONDALE ${a.attemptId}: total input ${a.tokens.totalInput} (uncached ${a.tokens.uncachedInput}, cacheRead ${a.tokens.cacheRead}), usd ${a.usd}; ` +
      `repeated prefix ${a.repeatedPrefix.tokens} tokens (${a.repeatedPrefix.shareOfTotalInput === null ? "?" : (a.repeatedPrefix.shareOfTotalInput * 100).toFixed(1)}%), ` +
      `${a.repeatedPrefix.uncachedRepeat} re-sent uncached — ${a.repeatedPrefix.method}: ${a.repeatedPrefix.detail}`,
  );
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify(record, null, 2)}\n`, "utf8");
line(`wrote: ${OUT}`);
