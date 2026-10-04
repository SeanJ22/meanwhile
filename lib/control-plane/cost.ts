/**
 * THE COST LEDGER — what a run spent, rolled up along the dimensions a
 * SCHEDULER needs.
 *
 * ============================================================================
 * THE INVARIANT OF THIS MODULE, and the reason it is a module rather than a few
 * fields on `Attempt`:
 *
 *     COST INFORMS SCHEDULING. COST NEVER INFORMS TRUTH.
 *
 * Nothing in this file may answer, or help answer, whether a fact is right,
 * whether a record should stand, or whether a correction is worth making. There
 * is no cheap wrong answer and no expensive right one; a claim about a
 * government is right or it is not, and what it cost to establish that has no
 * standing in the question. Cost decides what runs NEXT, how much of it runs at
 * once, and when a run stops — and nothing else.
 *
 * That prohibition is enforced mechanically, not by good intentions: a sweep in
 * `tests/control-plane-policy.test.ts` reads this file's own source and fails if
 * any EXPORTED function is named in the shape of a truth judgement. The sweep
 * ships with a positive control, because a detector nobody has seen fire is a
 * detector nobody has tested.
 * ============================================================================
 *
 * THE OTHER LOAD-BEARING RULE: an unmeasured field is NOT zero.
 *
 * `AttemptCost` fields are nullable because a provider may not report tokens, a
 * transport may not report bytes, and an aborted attempt may report neither.
 * Coercing those nulls to 0 produces a total that LOOKS complete and is not, and
 * a scheduler that believes a run was free will happily schedule a thousand more
 * of them. Every total here therefore travels with `measured` and `unmeasured`
 * counts, and a total over nothing measured is `null` rather than `0`.
 *
 * TIME IS A PARAMETER. Nothing here reads a clock.
 */

import type { Attempt, AttemptCost, WorkerRole } from "./attempt.ts";
import type { WorkQuestion } from "./work-question.ts";
import { canonicalModelId, modelTierFor, MODEL_TIERS, MODELS, type ModelTier } from "../models.ts";
import { CACHE_RATE_MULTIPLIERS, rateFor } from "./model-cost.ts";
/* Re-exported so a cost reader keys on the one constant (2026-09-23). */
export { DISCOVERY_SEARCH_ROLE } from "./attempt.ts";

/** The invariant, as a string a report can print verbatim. */
export const COST_SCHEDULING_INVARIANT =
  "Cost informs SCHEDULING (what runs next, how much runs at once, when a run stops). " +
  "Cost never informs TRUTH: what a fact cost has no bearing on whether it is right.";

/*
 * The discovery search rung's charges (2026-09-23) carry DISCOVERY_SEARCH_ROLE
 * (above, from attempt.ts): one row per request, `source` the API host
 * (api.search.brave.com, api.exa.ai), `usd` the published price — or null when
 * none is known, never 0. Search money is not model money; every view that
 * counts model spend leaves these rows out and shows them on their own line.
 */
/** The key a search charge with no host recorded is grouped under. */
export const SEARCH_SOURCE_NOT_ON_RECORD = "(host not recorded)";

/** ------------------------------------------------------------------ entries */

export const COST_METRICS = [
  "inputTokens",
  "outputTokens",
  "usd",
  "durationMs",
  "bytesFetched",
  "requestCount",
  /* The prompt-cache metering (2026-09-06). Absent on rows recorded before, which `sumMetric` counts as unmeasured. */
  "cacheReadInputTokens",
  "cacheCreationInputTokens",
  "cacheCreation5mInputTokens",
  "cacheCreation1hInputTokens",
  "uncachedInputTokens",
] as const;
export type CostMetric = (typeof COST_METRICS)[number];

/**
 * **THE PARSER FOR THE CACHE FIELDS, AND THE THREE THINGS A ROW CAN SAY.**
 * (2026-09-06.)
 *
 * The ledger is JSON in an append-only log, so a row written before the cache
 * fields existed simply lacks the keys. That row is `PREDATES_FIELDS`: nothing
 * about its cache behaviour was measured, and a digest prints NOT MEASURED for
 * it by name. A row that carries the keys with `null` values is `UNREPORTED`:
 * the request ran and the provider reported no usage (a refusal before any
 * completion). Only a `MEASURED` row contributes token counts to a rate.
 */
export type CacheMetering =
  | { readonly status: "PREDATES_FIELDS" }
  | { readonly status: "UNREPORTED" }
  | {
      readonly status: "MEASURED";
      readonly cacheReadInputTokens: number;
      readonly cacheCreationInputTokens: number;
      /** Null when the response carried the aggregate but no split. */
      readonly cacheCreation5mInputTokens: number | null;
      readonly cacheCreation1hInputTokens: number | null;
      readonly uncachedInputTokens: number;
      readonly batch: boolean;
    };

export function cacheMeteringOf(cost: AttemptCost): CacheMetering {
  const c = cost as Partial<AttemptCost>;
  if (
    c.cacheReadInputTokens === undefined ||
    c.cacheCreationInputTokens === undefined ||
    c.uncachedInputTokens === undefined
  ) {
    return { status: "PREDATES_FIELDS" };
  }
  if (c.cacheReadInputTokens === null || c.cacheCreationInputTokens === null || c.uncachedInputTokens === null) {
    return { status: "UNREPORTED" };
  }
  return {
    status: "MEASURED",
    cacheReadInputTokens: c.cacheReadInputTokens,
    cacheCreationInputTokens: c.cacheCreationInputTokens,
    cacheCreation5mInputTokens: c.cacheCreation5mInputTokens ?? null,
    cacheCreation1hInputTokens: c.cacheCreation1hInputTokens ?? null,
    uncachedInputTokens: c.uncachedInputTokens,
    batch: c.batch === true,
  };
}

export interface CostEntry {
  /** Absent only on older rows. Null is plain code or an unreported model. */
  readonly model?: string | null;
  readonly tier?: ModelTier | "none" | null;
  /** Requested identity stays separate from the provider's returned identity. */
  readonly requestedModel?: string | null;
  readonly servedModel?: string | null;
  /** Maximum bill for this exact send, with no prompt or prompt hash retained.
   * These quantities are conservative limits, not measured provider usage. */
  readonly modelRequestBound?: ModelRequestBound;
  /** Exact durable budget job that covered this attempt; never inferred from geography. */
  readonly spendHoldJobId?: string;
  readonly attemptId: string;
  readonly workItemId: string;
  readonly routeTaskId: string | null;
  /** The route walked, e.g. "INSITE_CALENDAR_GRID". Null for non-route work. */
  readonly routeId: string | null;
  /** The publisher/adapter the spend was against. Null when not attributable. */
  readonly source: string | null;
  /** OCD id or equivalent. Null when the work spans jurisdictions. */
  readonly jurisdiction: string | null;
  readonly project: string;
  readonly role: WorkerRole | "ASK";
  readonly cost: AttemptCost;
  /** Caller-supplied ISO stamp. This module never reads a clock. */
  readonly recordedAt: string;
  /*
   * WHAT THE CHARGE WAS FOR (MW-001, MW-013, MW-024; 2026-09-25). Each is
   * optional and absent on every row written before it existed, which a reader
   * names as "recorded before purpose was kept" — never as a purpose of its own.
   * The body the work was for is `jurisdiction`, as it always was.
   */
  /** The standing obligation (or task) the dispatch was a round of. */
  readonly obligationId?: string;
  /** The owner's Sends that obligation belonged to when the charge was written; empty when none reached it. */
  readonly assignmentKeys?: readonly string[];
  /** Exact active instruction receipts at dispatch; absent on historical rows.
   * A key or matching geography alone cannot assign a charge to a new hunt. */
  readonly assignmentRefs?: readonly { readonly key: string; readonly ref: string }[];
  /** The record class the work kept fresh. */
  readonly recordClass?: string;
  /** The question the work asked (MW-002), when the round recorded one. */
  readonly question?: WorkQuestion;
  /**
   * What the attempt came to: the disposition it committed (`INGESTED`,
   * `WALKED_NO_YIELD`, …), or `NO_DISPOSITION`, `SIMULATED`,
   * `DISPOSITION_REFUSED`, `LANE_MISMATCH` when it committed none.
   */
  readonly resultKind?: string;
  /**
   * A proof or test run's charge (MW-024). Real money: it stays inside every
   * total and every ceiling, and is kept out of what production work produced.
   */
  readonly nonProduction?: true;
  /**
   * WHICH MODEL EACH PART OF THE CHARGE WAS FOR (MW-031, 2026-09-25). Written
   * only when one Attempt ran more than one model — a Scout that started on
   * Sonnet 5 and escalated to Opus 5.5. `cost` stays the Attempt's one combined
   * charge; these shares split it, each priced at its own model's rate, and sum
   * to it. Absent: the whole charge is the Attempt's worker model, as before.
   * Read through `costPortionsByModel`, never summed beside `cost`.
   */
  readonly byModel?: readonly CostModelShare[];
}

export interface ModelRequestBound {
  readonly model: string;
  /** Serialized UTF-8 request bytes bound the billed text input tokens. */
  readonly inputTokens: number;
  /** The request's own max_tokens. Thinking counts inside this quantity. */
  readonly outputTokens: number;
  readonly usd: number;
  readonly basis: "REQUEST_UTF8_BYTES";
  readonly measured: false;
}

function boundedTokenCount(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/** Maximum synchronous text-request bill. Charge all input at the dearest
 * cache-write rate; no cache hit or batch discount is assumed. */
export function modelRequestBoundFor(model: string, inputTokens: number, outputTokens: number): ModelRequestBound | null {
  const rate = rateFor(canonicalModelId(model));
  if (!rate || !boundedTokenCount(inputTokens) || !boundedTokenCount(outputTokens)) return null;
  const usd = (inputTokens * rate.inputUsdPerMillion * CACHE_RATE_MULTIPLIERS.cacheCreation1h +
    outputTokens * rate.outputUsdPerMillion) / 1_000_000;
  return Number.isFinite(usd) ? { model, inputTokens, outputTokens, usd, basis: "REQUEST_UTF8_BYTES", measured: false } : null;
}

/** Scheduling bound, never an invented measured charge. Future rows carry an
 * exact send limit. Older Ask rows use reported aggregate usage, or the known
 * requested model's provider context/output maxima, at the dearest active
 * tier's prices. An unknown request with missing usage stays unbounded. */
export function costEntryModelRequestBound(entry: CostEntry): number | null {
  const bound = entry.modelRequestBound;
  if (bound) {
    if (entry.cost.requestCount !== 1 || (entry.byModel?.length ?? 0) > 1 ||
      bound.basis !== "REQUEST_UTF8_BYTES" || bound.measured !== false ||
      !boundedTokenCount(bound.inputTokens) || !boundedTokenCount(bound.outputTokens) ||
      typeof bound.usd !== "number" || !Number.isFinite(bound.usd) || bound.usd < 0 ||
      typeof entry.requestedModel !== "string" || canonicalModelId(entry.requestedModel) !== canonicalModelId(bound.model)) return null;
    return modelRequestBoundFor(bound.model, bound.inputTokens, bound.outputTokens)?.usd ?? null;
  }
  if (entry.role !== "ASK" || entry.source !== "api.anthropic.com" || !entry.routeId?.startsWith("ask:")) return null;
  const tier = modelTierFor(canonicalModelId(entry.requestedModel ?? entry.model ?? ""));
  const requests = entry.cost.requestCount;
  const protocol = tier ? MODELS[tier] : null;
  let input = entry.cost.inputTokens;
  if (!boundedTokenCount(input) && [entry.cost.uncachedInputTokens, entry.cost.cacheReadInputTokens, entry.cost.cacheCreationInputTokens].every(boundedTokenCount)) {
    input = entry.cost.uncachedInputTokens! + entry.cost.cacheReadInputTokens! + entry.cost.cacheCreationInputTokens!;
  }
  if (!boundedTokenCount(input)) {
    if (!protocol || !boundedTokenCount(requests) || requests === 0) return null;
    input = protocol.contextWindowTokens * requests;
  }
  let output = entry.cost.outputTokens;
  if (!boundedTokenCount(output)) {
    if (!protocol || !boundedTokenCount(requests) || requests === 0) return null;
    output = protocol.maxOutputTokens * requests;
  }
  const maxInputRate = Math.max(...MODEL_TIERS.map(tier => MODELS[tier].inputUsdPerMillion));
  const maxOutputRate = Math.max(...MODEL_TIERS.map(tier => MODELS[tier].outputUsdPerMillion));
  const usd = (input * maxInputRate * CACHE_RATE_MULTIPLIERS.cacheCreation1h + output * maxOutputRate) / 1_000_000;
  return Number.isFinite(usd) ? usd : null;
}

/** CH-02: what an unpriced model charge is counted at when nothing tighter
 * bounds it. The row's own token counts (or, where it recorded none, the dearest
 * model's context and output limits for every request it made, at least one),
 * all at the dearest listed price. Never a measured charge. */
export function costEntryWorstCaseUsd(entry: CostEntry): number {
  const requests = boundedTokenCount(entry.cost.requestCount) && entry.cost.requestCount > 0 ? entry.cost.requestCount : 1;
  const summed = [entry.cost.uncachedInputTokens, entry.cost.cacheReadInputTokens, entry.cost.cacheCreationInputTokens];
  const input = boundedTokenCount(entry.cost.inputTokens) ? entry.cost.inputTokens
    : summed.every(boundedTokenCount) ? summed.reduce<number>((n, part) => n + part!, 0)
      : Math.max(...MODEL_TIERS.map(tier => MODELS[tier].contextWindowTokens)) * requests;
  const output = boundedTokenCount(entry.cost.outputTokens) ? entry.cost.outputTokens
    : Math.max(...MODEL_TIERS.map(tier => MODELS[tier].maxOutputTokens)) * requests;
  const maxInputRate = Math.max(...MODEL_TIERS.map(tier => MODELS[tier].inputUsdPerMillion));
  const maxOutputRate = Math.max(...MODEL_TIERS.map(tier => MODELS[tier].outputUsdPerMillion));
  return (input * maxInputRate * CACHE_RATE_MULTIPLIERS.cacheCreation1h + output * maxOutputRate) / 1_000_000;
}

/** One model's part of a charge (`CostEntry.byModel`): the billed quantities of the requests sent to it. */
export interface CostModelShare {
  readonly model: string;
  readonly tier?: ModelTier | null;
  /** Model requests (provider turns) sent to this model. */
  readonly requestCount: number;
  readonly usd: number | null;
  /** The whole prompt: uncached + cache reads + cache writes, as on the ledger row. */
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly cacheReadInputTokens: number | null;
  readonly cacheCreationInputTokens: number | null;
  readonly cacheCreation5mInputTokens: number | null;
  readonly cacheCreation1hInputTokens: number | null;
  readonly uncachedInputTokens: number | null;
}

/** Every new charge records its model; historical identities are never rewritten. */
export function costEntryWithModel(entry: CostEntry, model: string | null): CostEntry {
  const selected = entry.model ?? (entry.byModel?.length === 1 ? entry.byModel[0].model : model);
  return { ...entry, model: selected,
    tier: selected === null ? "none" : modelTierFor(canonicalModelId(selected)),
    ...(entry.byModel ? { byModel: entry.byModel.map(share => ({ ...share, tier: modelTierFor(canonicalModelId(share.model)) })) } : {}) };
}

/** Inclusive start, exclusive end. No model is inferred for an older charge. */
export function spendByTier(entries: readonly CostEntry[], range: { readonly since: string; readonly until: string }) {
  const since = Date.parse(range.since), until = Date.parse(range.until);
  if (!Number.isFinite(since) || !Number.isFinite(until) || since >= until) throw new Error("COST_RANGE_INVALID");
  const totals = new Map<string, { tier: ModelTier | "none" | "unrecorded"; label: string; usd: number | null; rows: number; requests: number }>(
    [...MODEL_TIERS.map(tier => ({ tier, label: MODELS[tier].name, usd: 0, rows: 0, requests: 0 })),
      { tier: "none" as const, label: "Plain code", usd: 0, rows: 0, requests: 0 },
      { tier: "unrecorded" as const, label: "Model not recorded", usd: 0, rows: 0, requests: 0 }].map(row => [row.tier, row]));
  for (const entry of entries) {
    const at = Date.parse(entry.recordedAt);
    if (!(at >= since && at < until)) continue;
    const shares = entry.byModel && splitMatchesCharge(entry.cost, entry.byModel) ? entry.byModel : null;
    const parts = shares?.length ? shares.map(share => ({ tier: share.tier, usd: share.usd, requests: share.requestCount }))
      : [{ tier: entry.tier, usd: entry.cost.usd, requests: entry.cost.requestCount ?? 0 }];
    for (const part of parts) {
      const total = totals.get(part.tier ?? "unrecorded") ?? totals.get("unrecorded")!;
      total.rows++; total.requests += part.requests;
      total.usd = total.usd === null || part.usd === null ? null : total.usd + part.usd;
    }
  }
  return { ...range, tiers: [...totals.values()] };
}

/**
 * **A CHARGE, SPLIT BY THE MODEL EACH PART WAS FOR — WITHOUT COUNTING IT TWICE.**
 * (MW-031, 2026-09-25.) A row with no `byModel` is one portion under
 * `attemptModel` (the Attempt's worker model), exactly as every by-model view
 * read it before. A row with a split gives one portion per share: the share's
 * dollars and billed tokens replace the row's, and the Attempt's non-model
 * quantities (its duration, the bytes it fetched, its non-model requests) stay
 * on the FIRST share — the model the Attempt started on — so every portion's
 * figures sum back to the row's. A split that does not sum to the row's
 * dollars (a share unmeasured under a measured total, or a different sum) is
 * not trusted: the row is read whole under `attemptModel`, never guessed.
 */
export function costPortionsByModel(entry: CostEntry, attemptModel: string): readonly { readonly model: string; readonly entry: CostEntry }[] {
  const shares = entry.byModel;
  if (shares === undefined || shares.length === 0 || !splitMatchesCharge(entry.cost, shares)) return [{ model: entry.model ?? attemptModel, entry }];
  const otherRequests = shares.slice(1).reduce((n, s) => n + s.requestCount, 0);
  return shares.map((s, i) => ({
    model: s.model,
    entry: {
      ...entry,
      cost: {
        ...entry.cost,
        usd: s.usd,
        inputTokens: s.inputTokens,
        outputTokens: s.outputTokens,
        cacheReadInputTokens: s.cacheReadInputTokens,
        cacheCreationInputTokens: s.cacheCreationInputTokens,
        cacheCreation5mInputTokens: s.cacheCreation5mInputTokens,
        cacheCreation1hInputTokens: s.cacheCreation1hInputTokens,
        uncachedInputTokens: s.uncachedInputTokens,
        requestCount: i === 0 ? (entry.cost.requestCount === null ? null : entry.cost.requestCount - otherRequests) : s.requestCount,
        durationMs: i === 0 ? entry.cost.durationMs : 0,
        bytesFetched: i === 0 ? entry.cost.bytesFetched : 0,
      },
    },
  }));
}

function splitMatchesCharge(cost: AttemptCost, shares: readonly CostModelShare[]): boolean {
  if (shares.some((s) => typeof s.model !== "string" || s.model === "" || !Number.isFinite(s.requestCount) || s.requestCount < 0)) return false;
  if (cost.usd === null) return true;
  if (shares.some((s) => s.usd === null || !Number.isFinite(s.usd))) return false;
  const sum = shares.reduce((n, s) => n + (s.usd ?? 0), 0);
  return Math.abs(sum - cost.usd) <= 1e-9 * Math.max(1, Math.abs(cost.usd));
}

/** What the dispatcher writes on a charge's `resultKind` when no disposition was committed. */
export const COST_RESULT_WITHOUT_DISPOSITION = ["NO_DISPOSITION", "SIMULATED", "DISPOSITION_REFUSED", "LANE_MISMATCH"] as const;

/** The project the autonomous-fleet proof scripts run and charge under (MW-024): never `freshness`. */
export const AUTONOMOUS_FLEET_PROOF_PROJECT = "autonomous-fleet-proof";

/**
 * A charge from a proof or test run: marked so, or written under a proof or
 * conformance project. Real money all the same — this only decides which
 * productivity figure it may enter.
 */
export function isNonProductionCost(entry: Pick<CostEntry, "project" | "nonProduction">): boolean {
  return entry.nonProduction === true || isProofProject(entry.project);
}

/** The projects conformance tests and proof runs write under. */
export function isProofProject(project: string | null | undefined): boolean {
  const p = project ?? "";
  return /^conformance(-|$)/.test(p) || p === "control-plane-proof" || p === AUTONOMOUS_FLEET_PROOF_PROJECT;
}

/**
 * Lift an Attempt into a ledger entry.
 *
 * The Attempt's own `cost` is copied UNCHANGED, nulls included. This function
 * has no defaulting behaviour on purpose — the one place a null could quietly
 * become a zero is the place that reads the measurement, so it does not.
 */
export function costEntryFromAttempt(
  attempt: Attempt,
  context: {
    routeId?: string | null;
    source?: string | null;
    jurisdiction?: string | null;
    project: string;
    recordedAt: string;
  },
): CostEntry {
  return {
    attemptId: attempt.id,
    workItemId: attempt.workItemId,
    routeTaskId: attempt.routeTaskId,
    routeId: context.routeId ?? null,
    source: context.source ?? null,
    jurisdiction: context.jurisdiction ?? null,
    project: context.project,
    role: attempt.worker.role,
    cost: attempt.cost,
    recordedAt: context.recordedAt,
  };
}

/** ------------------------------------------------------------------ rollup */

export const ROLLUP_DIMENSIONS = [
  "workItem",
  "route",
  "source",
  "jurisdiction",
  "project",
  "role",
] as const;
export type RollupDimension = (typeof ROLLUP_DIMENSIONS)[number];

/** The bucket a null dimension key lands in. Named, never silently dropped. */
export const UNATTRIBUTED = "(unattributed)";

/**
 * A total that knows what it does not know.
 *
 * `total` is the sum of the MEASURED values only, and is `null` when nothing was
 * measured — because the sum of no measurements is not zero, it is nothing.
 */
export interface MeasuredTotal {
  readonly total: number | null;
  readonly measured: number;
  readonly unmeasured: number;
  /** True only when every contributing entry reported this metric. */
  readonly complete: boolean;
}

export interface RollupBucket {
  readonly dimension: RollupDimension;
  readonly key: string;
  readonly entryCount: number;
  readonly totals: Readonly<Record<CostMetric, MeasuredTotal>>;
}

function keyOf(entry: CostEntry, dimension: RollupDimension): string {
  switch (dimension) {
    case "workItem":
      return entry.workItemId;
    case "route":
      return entry.routeId ?? UNATTRIBUTED;
    case "source":
      return entry.source ?? UNATTRIBUTED;
    case "jurisdiction":
      return entry.jurisdiction ?? UNATTRIBUTED;
    case "project":
      return entry.project;
    case "role":
      return entry.role;
  }
}

/** Sum one metric across entries, keeping the measured/unmeasured split. */
export function sumMetric(
  entries: readonly CostEntry[],
  metric: CostMetric,
): MeasuredTotal {
  let total = 0;
  let measured = 0;
  let unmeasured = 0;
  for (const entry of entries) {
    const value = entry.cost[metric];
    if (value === null || value === undefined || Number.isNaN(value)) {
      unmeasured += 1;
      continue;
    }
    total += value;
    measured += 1;
  }
  return {
    total: measured === 0 ? null : total,
    measured,
    unmeasured,
    complete: unmeasured === 0 && measured > 0,
  };
}

/**
 * Roll entries up along one dimension.
 *
 * Buckets come back sorted by key so a report is stable across runs, which
 * matters because these reports get diffed.
 */
export function rollup(
  entries: readonly CostEntry[],
  dimension: RollupDimension,
): RollupBucket[] {
  const grouped = new Map<string, CostEntry[]>();
  for (const entry of entries) {
    const key = keyOf(entry, dimension);
    const bucket = grouped.get(key);
    if (bucket) bucket.push(entry);
    else grouped.set(key, [entry]);
  }

  return [...grouped.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([key, bucketEntries]) => {
      const totals = {} as Record<CostMetric, MeasuredTotal>;
      for (const metric of COST_METRICS) totals[metric] = sumMetric(bucketEntries, metric);
      return { dimension, key, entryCount: bucketEntries.length, totals };
    });
}

/** ------------------------------------------------------------------- caps */

export interface BudgetCheck {
  readonly within: boolean;
  /**
   * False when the check could not actually be made — no cap set, or the spend
   * is unmeasured. An unenforceable check is REPORTED, never quietly passed off
   * as a pass, because "we did not exceed the cap" and "we cannot tell whether
   * we exceeded the cap" are different sentences.
   */
  readonly enforceable: boolean;
  readonly spent: number | null;
  readonly cap: number | null;
  readonly reason: string;
}

/**
 * Is `spent` still under `cap`?
 *
 * The cap FIRES AT the cap: spending exactly the cap is spent, not spare. An
 * off-by-one here is a cap that is never quite reached.
 */
export function withinBudget(
  spent: number | null,
  cap: number | null,
  label = "spend",
): BudgetCheck {
  if (cap === null) {
    return {
      within: true,
      enforceable: false,
      spent,
      cap,
      reason: `No cap is set for ${label}; nothing was enforced.`,
    };
  }
  if (spent === null) {
    return {
      within: true,
      enforceable: false,
      spent,
      cap,
      reason:
        `${label} is UNMEASURED, so the cap of ${cap} could not be enforced. ` +
        "This is reported rather than treated as zero spend.",
    };
  }
  if (spent >= cap) {
    return {
      within: false,
      enforceable: true,
      spent,
      cap,
      reason: `${label} reached its cap: ${spent} of ${cap}.`,
    };
  }
  return {
    within: true,
    enforceable: true,
    spent,
    cap,
    reason: `${label} is within budget: ${spent} of ${cap}.`,
  };
}

export class CostCapExceeded extends Error {
  readonly label: string;
  readonly spent: number | null;
  readonly cap: number | null;

  constructor(check: BudgetCheck, label: string) {
    super(
      `HARD CAP: ${check.reason} Further work under this cap is refused. ` +
        "A hard cap stops SCHEDULING; it says nothing about the work already done.",
    );
    this.name = "CostCapExceeded";
    this.label = label;
    this.spent = check.spent;
    this.cap = check.cap;
  }
}

/** Throw at a hard cap. An unenforceable check never throws — it cannot. */
export function assertWithinHardCap(
  spent: number | null,
  cap: number | null,
  label = "spend",
): void {
  const check = withinBudget(spent, cap, label);
  if (!check.within && check.enforceable) throw new CostCapExceeded(check, label);
}

/** ------------------------------------------------------------- scheduling */

export interface ScheduleDecision {
  /** Whether to START more work now. Purely an ordering/throttling answer. */
  readonly schedule: boolean;
  readonly reason: string;
  /** Every cap that refused, named. */
  readonly refusedBy: readonly string[];
  /** Every cap that could not be enforced, named. Surfaced, never hidden. */
  readonly unenforceable: readonly string[];
}

/**
 * The ONLY question this module answers about work: should more of it START now?
 *
 * Note what is absent and will stay absent: there is no function here that takes
 * a cost and returns anything about whether a record is right, whether a
 * disposition should stand, or whether a correction is worth its price. A
 * cheaply obtained wrong answer is still wrong, and an expensive correction is
 * still owed. See COST_SCHEDULING_INVARIANT.
 */
export function shouldScheduleMoreWork(input: {
  spent: Partial<Record<CostMetric, number | null>>;
  caps: Partial<Record<CostMetric, number | null>>;
}): ScheduleDecision {
  const refusedBy: string[] = [];
  const unenforceable: string[] = [];

  for (const metric of COST_METRICS) {
    const cap = input.caps[metric] ?? null;
    if (cap === null) continue;
    const spent = input.spent[metric] ?? null;
    const check = withinBudget(spent, cap, metric);
    if (!check.enforceable) unenforceable.push(metric);
    else if (!check.within) refusedBy.push(`${metric} (${check.spent} of ${check.cap})`);
  }

  if (refusedBy.length > 0) {
    return {
      schedule: false,
      reason: `Scheduling paused at: ${refusedBy.join("; ")}.`,
      refusedBy,
      unenforceable,
    };
  }
  return {
    schedule: true,
    reason:
      unenforceable.length > 0
        ? `Scheduling permitted; ${unenforceable.join(", ")} could not be enforced (unmeasured).`
        : "Scheduling permitted; every set cap is under its limit.",
    refusedBy,
    unenforceable,
  };
}

/** ------------------------------------------------------- calendar windows */

/**
 * **THE UTC CALENDAR MONTH, AS A LEDGER WINDOW.** (§9A.23 of the Admin C
 * brief, 2026-09-06.)
 *
 * The owner's Claude API funds reset on the first day of each month **UTC**,
 * and no other window in this codebase is that window. The three enforced
 * spend windows are a per-cycle counter, a Phoenix 18:00→06:00 operational
 * night and a *sliding* 24 hours (`fleet-safety.ts`); the console's spend bars
 * are bucketed by EASTERN calendar day; the politeness ledger rolls its
 * request counts over at UTC midnight. None of them is a calendar month, and
 * three of them are in the wrong zone, so this had to be its own window rather
 * than a reuse of any of them.
 *
 * PURE, with the clock as a parameter — the whole reason this is testable at a
 * month boundary and across the UTC/Eastern day edge, where "today" in New York
 * and "today" in UTC name different months for five hours of every month's
 * first day.
 *
 * `until` is INCLUSIVE and is the moment the reading was taken for the current
 * month, or the last millisecond of the month for a past one. Adjacent months
 * therefore neither overlap nor leave a gap, and a row stamped exactly at `now`
 * is counted rather than lost to an exclusive bound.
 */
export interface LedgerWindow {
  /** 00:00:00.000Z on the 1st. Inclusive. */
  readonly since: string;
  /** Inclusive: `nowIso` for the open month, the month's last millisecond for a closed one. */
  readonly until: string;
  /** 00:00:00.000Z on the 1st of the FOLLOWING month — when the funds reset. */
  readonly resetsAt: string;
  /** "September 2026". */
  readonly label: string;
  /** False while the month is still running: a total from it is a running total, not a final one. */
  readonly complete: boolean;
}

const UTC_MONTH_LABEL = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "long", year: "numeric" });

/**
 * The UTC calendar month containing `nowIso`, or one `monthsBack` before it
 * (1 = the previous month). Throws on an unreadable stamp rather than
 * returning a window over the epoch, which would render as a confident total
 * for a month nobody asked about.
 */
export function utcMonthWindow(nowIso: string, monthsBack = 0): LedgerWindow {
  const now = Date.parse(nowIso);
  if (!Number.isFinite(now)) {
    throw new Error(`utcMonthWindow() cannot read the stamp "${nowIso}". A spend window over an unreadable clock is a total nobody can check.`);
  }
  if (!Number.isInteger(monthsBack) || monthsBack < 0) {
    throw new Error(`utcMonthWindow() counts months BACK from the current one and got ${monthsBack}. There is no spend to report from a month that has not happened.`);
  }
  const d = new Date(now);
  const start = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - monthsBack, 1);
  const next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - monthsBack + 1, 1);
  const open = monthsBack === 0;
  return {
    since: new Date(start).toISOString(),
    until: open ? new Date(now).toISOString() : new Date(next - 1).toISOString(),
    resetsAt: new Date(next).toISOString(),
    label: UTC_MONTH_LABEL.format(new Date(start)),
    complete: !open,
  };
}

/**
 * The ledger rows recorded inside a window, both bounds inclusive.
 *
 * A row whose `recordedAt` cannot be parsed is DROPPED and never silently
 * counted at the epoch — an unreadable stamp is an unattributable row, and
 * placing it in January 1970 would quietly deflate every month that has one.
 */
export function entriesInWindow(entries: readonly CostEntry[], window: Pick<LedgerWindow, "since" | "until">): readonly CostEntry[] {
  const since = Date.parse(window.since);
  const until = Date.parse(window.until);
  return entries.filter((e) => {
    const at = Date.parse(e.recordedAt);
    return Number.isFinite(at) && at >= since && at <= until;
  });
}

/** ----------------------------------------------------------------- report */

export function describeRollup(buckets: readonly RollupBucket[]): string {
  if (buckets.length === 0) return "COST ROLLUP — no entries.";
  const lines = buckets.map((bucket) => {
    const metrics = COST_METRICS.map((metric) => {
      const t = bucket.totals[metric];
      const value = t.total === null ? "unmeasured" : String(t.total);
      return `${metric}=${value} (measured ${t.measured}, unmeasured ${t.unmeasured})`;
    });
    return `  ${bucket.key} [${bucket.entryCount} entr${bucket.entryCount === 1 ? "y" : "ies"}]\n      ${metrics.join("\n      ")}`;
  });
  return [`COST ROLLUP by ${buckets[0].dimension} — ${buckets.length} bucket(s)`, ...lines].join(
    "\n",
  );
}
