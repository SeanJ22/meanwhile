/** The research lane's numbers: capacity, queue order, funnel, model share, cache hit rate and cost per useful outcome, each with its denominator. */

import { MODELS, canonicalModelId, modelTierFor } from "../models.ts";
import { cacheMeteringOf, costPortionsByModel, type CostEntry } from "./cost.ts";
import { CACHE_RATE_MULTIPLIERS, cacheSavingUsd } from "./model-cost.ts";
import type { ScoutResult, ScoutStep } from "./scheduler/scout-result.ts";
import { SCOUT_PREWARM_ROUTE_ID } from "./scheduler/research-policy.ts";
import { waitingSince, type QueueDebt } from "./scheduler/obligation.ts";

export interface ScoutCapacity {
  /** Mean measured usd per Scout Attempt over the window. Null when none measured. */
  readonly meanUsdPerAttempt: number | null;
  readonly measuredAttempts: number;
  readonly unmeasuredAttempts: number;
  readonly windowHours: number;
  readonly ceilingUsd: number;
  /** Attempts per rolling day the ceiling supports at the measured mean. Null when the mean is unmeasured or zero. */
  readonly attemptsPerDayAtCap: number | null;
  readonly denominator: string;
}

/** The mean is over measured Scout entries in the window; an unmeasured Attempt is counted beside it, never as zero. */
export function scoutCapacity(input: {
  readonly costs: readonly CostEntry[];
  readonly nowIso: string;
  readonly windowHours: number;
  readonly ceilingUsd: number;
}): ScoutCapacity {
  const since = Date.parse(input.nowIso) - input.windowHours * 3_600_000;
  let total = 0;
  let measured = 0;
  let unmeasured = 0;
  for (const c of input.costs) {
    if (c.role !== "SCOUT") continue;
    /* A pre-warm request is a cache write for the cycle's Attempts, never an Attempt itself. */
    if (c.routeId === SCOUT_PREWARM_ROUTE_ID) continue;
    if (Date.parse(c.recordedAt) < since) continue;
    if (c.cost.usd === null || c.cost.usd === undefined || Number.isNaN(c.cost.usd)) {
      unmeasured += 1;
      continue;
    }
    total += c.cost.usd;
    measured += 1;
  }
  const mean = measured === 0 ? null : total / measured;
  return {
    meanUsdPerAttempt: mean,
    measuredAttempts: measured,
    unmeasuredAttempts: unmeasured,
    windowHours: input.windowHours,
    ceilingUsd: input.ceilingUsd,
    attemptsPerDayAtCap: mean === null || mean <= 0 ? null : Math.floor((input.ceilingUsd / mean) * (24 / input.windowHours)),
    denominator: `measured SCOUT cost-ledger entries in the trailing ${input.windowHours}h window (${measured} measured, ${unmeasured} unmeasured)`,
  };
}

export type ReaderImpactBand = 1 | 2 | 3;

/** Providers whose obligations are a source-universe denominator. */
export const UNIVERSE_PROVIDERS: readonly string[] = ["candidate-enrichment", "local-jurisdictions", "campaign-finance"];

export interface OrderingInputs {
  /** Ignored: order comes from sends and place targets only. */
  readonly pilotZips?: readonly string[];
}

export interface OrderableObligation {
  readonly id: string;
  readonly subjectId: string;
  readonly readerImpactAt: string | null;
  readonly providerId: string | null;
  readonly nextDueAt: string;
  /** When the row joined the queue: its next-due, or after a failed attempt the end of its backoff. The order key within a band. */
  readonly queuedSince?: string;
}

/** One due row as the Scout order reads it; the recorded queue and the live pool both build rows here. */
export function orderableDueRow(
  row: {
    readonly obligation: { readonly id: string; readonly subjectId: string; readonly readerImpactAt: string | null };
    readonly nextDueAt: string;
  },
  providerId: string | null,
  debt: QueueDebt | null | undefined,
): OrderableObligation {
  return {
    id: row.obligation.id,
    subjectId: row.obligation.subjectId,
    readerImpactAt: row.obligation.readerImpactAt,
    providerId,
    nextDueAt: row.nextDueAt,
    queuedSince: waitingSince(row, debt),
  };
}

export interface BandedObligation<T extends OrderableObligation> {
  readonly row: T;
  readonly band: ReaderImpactBand;
  readonly why: string;
}

export interface DispatchOrdering {
  readonly rule: string;
  readonly scope: string;
  readonly inputs: {
    readonly readerImpactAt: "FreshnessObligation.readerImpactAt";
    /** Retired (CH-12). Records written before it was removed still carry it. */
    readonly pilotJurisdictions?: string;
    readonly universeProviders: readonly string[];
    /** A record written before 2026-09-25 carries the older rule, which ordered by next-due alone. */
    readonly tieBreak: typeof TIE_BREAK | "oldest nextDueAt first within a band";
  };
  readonly bands: { readonly 1: number; readonly 2: number; readonly 3: number };
  /** The lane the order applied to. The plain-code lane has its own order (`plainCodeQueueOrder`). */
  readonly appliesTo: "BOUNDED_MODEL_WORKER";
}

export const TIE_BREAK = "longest wait first within a band: the next-due, or the end of the backoff after a failed attempt";

export const ORDERING_RULE =
  "band 1 = a reader is waiting on it (canonical FreshnessObligation.readerImpactAt set); " +
  "band 2 = source-universe completion (universe providers); band 3 = long tail; within a band, the longest wait first " +
  "(a row that failed waits from the end of its backoff)";

export const ORDERING_SCOPE =
  "orders every due model-class row before admission to the bounded Scout pool, so reader-impact priority decides both which rows fit the per-cycle ceiling and which one starts first. The plain-code lane has its own longest-wait-first order";

/** Which band one obligation falls in, and why. Pure. */
export function bandFor(row: OrderableObligation, _inputs: OrderingInputs): { readonly band: ReaderImpactBand; readonly why: string } {
  if (row.readerImpactAt !== null) return { band: 1, why: `readerImpactAt ${row.readerImpactAt} is set by the provider` };
  if (row.providerId !== null && UNIVERSE_PROVIDERS.includes(row.providerId)) {
    return { band: 2, why: `provider ${row.providerId} is a source-universe denominator` };
  }
  return { band: 3, why: "no reader-impact signal and not a universe provider: the long tail" };
}

/** The one comparator behind both the recorded queue and the live Scout pool. */
export function compareReaderImpact(
  left: OrderableObligation,
  right: OrderableObligation,
  inputs: OrderingInputs,
): number {
  /* Within a band, the longest wait first, so failing rows cannot hold the head with their first next-due. */
  const leftSince = left.queuedSince ?? left.nextDueAt;
  const rightSince = right.queuedSince ?? right.nextDueAt;
  return (
    bandFor(left, inputs).band - bandFor(right, inputs).band ||
    (leftSince < rightSince ? -1 : leftSince > rightSince ? 1 : 0) ||
    (left.nextDueAt < right.nextDueAt ? -1 : left.nextDueAt > right.nextDueAt ? 1 : 0) ||
    left.id.localeCompare(right.id)
  );
}

/** Order a due queue by reader impact. Returns the ordered rows and the record of the rule. */
export function orderByReaderImpact<T extends OrderableObligation>(
  rows: readonly T[],
  inputs: OrderingInputs,
): { readonly ordered: BandedObligation<T>[]; readonly ordering: DispatchOrdering } {
  const banded = rows.map((row) => ({ row, ...bandFor(row, inputs) }));
  banded.sort((a, b) => compareReaderImpact(a.row, b.row, inputs));
  const count = (band: ReaderImpactBand): number => banded.filter((b) => b.band === band).length;
  return {
    ordered: banded,
    ordering: {
      rule: ORDERING_RULE,
      scope: ORDERING_SCOPE,
      inputs: {
        readerImpactAt: "FreshnessObligation.readerImpactAt",
        universeProviders: UNIVERSE_PROVIDERS,
        tieBreak: TIE_BREAK,
      },
      bands: { 1: count(1), 2: count(2), 3: count(3) },
      appliesTo: "BOUNDED_MODEL_WORKER",
    },
  };
}

export interface FunnelStage {
  readonly stage: string;
  readonly count: number;
  readonly source: string;
}

/** The pipeline stages beyond SCOUTED, read from the promotion pipeline when one exists. */
export type PipelineStageReader = () => Promise<readonly { readonly stage: string; readonly count: number }[]>;

/** The default reader: the pipeline records nothing yet, and says so. */
export const NO_PIPELINE_RECORDED: PipelineStageReader = async () => [];

export const PIPELINE_STAGES = ["CONFIRMED", "VERIFIED", "AUDITED", "APPROVED"] as const;

export interface GraduationFunnel {
  readonly stages: readonly FunnelStage[];
  readonly pipelineSource: string;
}

/** SCOUTED counts distinct obligations with a non-refused Scout result. */
export function graduationFunnel(input: {
  readonly results: readonly ScoutResult[];
  readonly candidateCounts: { readonly validated: number; readonly admitted: number; readonly rejected: number; readonly proposed: number } | null;
  readonly pipeline: readonly { readonly stage: string; readonly count: number }[];
  readonly pipelineSource: string;
  readonly deterministicReplays: number;
}): GraduationFunnel {
  const scouted = new Set(input.results.filter((r) => r.refusal === null).map((r) => r.obligationId)).size;
  const byStage = new Map(input.pipeline.map((p) => [p.stage, p.count]));
  const stages: FunnelStage[] = [
    { stage: "SCOUTED", count: scouted, source: "distinct obligations with a non-refused Scout result in repos.scoutResults" },
    ...PIPELINE_STAGES.map((stage) => ({
      stage,
      count: byStage.get(stage) ?? 0,
      source: byStage.has(stage) ? input.pipelineSource : `${input.pipelineSource} (none recorded for ${stage})`,
    })),
    { stage: "VALIDATED", count: input.candidateCounts?.validated ?? 0, source: "cp_method_candidates/live lifecycle counts" },
    { stage: "ADMITTED", count: input.candidateCounts?.admitted ?? 0, source: "cp_method_candidates/live lifecycle counts" },
    { stage: "DETERMINISTIC_REPLAYS", count: input.deterministicReplays, source: "deterministic dispatches on routes an ADMITTED candidate learned, from the run records read" },
  ];
  return { stages, pipelineSource: input.pipelineSource };
}

export interface LaneShare {
  readonly deterministic: number;
  readonly model: number;
  /** model / (deterministic + model). Null when nothing dispatched. */
  readonly modelShare: number | null;
}

export interface ShareTrend {
  readonly thisCycle: LaneShare;
  readonly window: LaneShare & { readonly cycles: number; readonly since: string | null };
  /** Positive when this cycle's model share is above the window's. Null when either is unmeasured. */
  readonly delta: number | null;
}

function share(d: number, m: number): LaneShare {
  return { deterministic: d, model: m, modelShare: d + m === 0 ? null : m / (d + m) };
}

/** The model-vs-deterministic dispatch share, this cycle against the trailing window of cycles. */
export function modelShareTrend(input: {
  readonly thisCycle: { readonly deterministic: number; readonly model: number };
  readonly windowCycles: readonly { readonly startedAt: string; readonly deterministic: number; readonly model: number }[];
}): ShareTrend {
  const t = share(input.thisCycle.deterministic, input.thisCycle.model);
  const d = input.windowCycles.reduce((n, c) => n + c.deterministic, 0);
  const m = input.windowCycles.reduce((n, c) => n + c.model, 0);
  const w = share(d, m);
  const since = input.windowCycles.map((c) => c.startedAt).sort()[0] ?? null;
  return {
    thisCycle: t,
    window: { ...w, cycles: input.windowCycles.length, since },
    delta: t.modelShare === null || w.modelShare === null ? null : t.modelShare - w.modelShare,
  };
}


/** Historical model roles stay in the denominator when their identity is missing.
 * Roles that also run plain code require recorded model evidence. */
const LEGACY_MODEL_CACHE_ROLES = new Set(["SCOUT", "ADVERSARIAL_AUDITOR", "ASK"]);

function recordedCacheSaving(entry: CostEntry): number | null {
  const aggregate = cacheMeteringOf(entry.cost);
  if (aggregate.status !== "MEASURED") return null;
  const portions = costPortionsByModel(entry, "");
  const split = portions[0].entry !== entry;
  // A contradictory split cannot assign the aggregate cache reads to one model.
  if (entry.byModel?.length && !split) return null;
  let read = 0, write = 0, uncached = 0, saved = 0;
  for (const [index, portion] of portions.entries()) {
    const share = split ? entry.byModel![index] : undefined;
    const tier = share ? share.tier : entry.tier;
    if (typeof portion.model !== "string") return null;
    const identity = portion.model.trim() || (tier && tier !== "none" && modelTierFor(tier) === tier ? MODELS[tier].model : "");
    const model = canonicalModelId(identity);
    if (!model || (tier != null && modelTierFor(model) !== tier)) return null;
    const metering = cacheMeteringOf(portion.entry.cost);
    if (metering.status !== "MEASURED") return null;
    // Current shares inherit the row's batch flag; conflicting explicit flags are not a price estimate.
    if (share && "batch" in share && (typeof share.batch !== "boolean" ||
      (share.batch !== entry.cost.batch && (share.batchRequestCount == null || entry.cost.batchRequestCount == null)))) return null;
    const amount = cacheSavingUsd(metering.cacheReadInputTokens, model);
    if (amount === null) return null;
    saved += amount * (metering.batch ? CACHE_RATE_MULTIPLIERS.batch : 1);
    read += metering.cacheReadInputTokens;
    write += metering.cacheCreationInputTokens;
    uncached += metering.uncachedInputTokens;
  }
  return read === aggregate.cacheReadInputTokens && write === aggregate.cacheCreationInputTokens &&
    uncached === aggregate.uncachedInputTokens ? saved : null;
}

export interface CacheHitRate {
  readonly role: string;
  readonly cacheRead: number;
  readonly cacheWrite: number;
  readonly uncachedInput: number;
  /** cacheRead / (cacheRead + cacheWrite + uncachedInput). Null when no input was reported. */
  readonly hitRate: number | null;
  /** Turns after the first that read zero cached tokens, over turns after the first. Null before per-turn steps exist. */
  readonly repeatedPrefixTurns: number | null;
  readonly repeatedPrefixMisses: number | null;
  readonly attempts: number;
  readonly denominator: string;
  /* Optional: a row persisted before these columns existed carries none. */
  /** Turns after the first whose uncached input exceeded what they appended by more than the model minimum — the stationary-breakpoint signature. Null before per-turn steps exist. */
  readonly stationaryTurns?: number | null;
  /** Ledger rows in the window for this role: measured, predating the cache fields, and reported null by the provider. */
  readonly measuredRows?: number;
  readonly predatingRows?: number;
  readonly unreportedRows?: number;
  /** Uncached input tokens per measured Attempt. Null when nothing was measured. */
  readonly uncachedPerAttempt?: { readonly mean: number; readonly max: number } | null;
  /** Requests served through the Batches API, over requests, on measured rows. Null when nothing was measured. */
  readonly batchShare?: number | null;
  /** Saved cache-read cost at each recorded model's rate and batch discount.
   * Null when any included row's usage or model portions are unknown. */
  readonly savedUsd?: number | null;
  /** Measured rows whose cache write was priced from the aggregate at the requested TTL because the response carried no split. */
  readonly aggregatePricedRows?: number;
}

/** Computed from the cost ledger. */
export function cacheHitRateByRole(input: {
  readonly costs: readonly CostEntry[];
  readonly results: readonly ScoutResult[];
  /** Rows recorded at or after this instant. Omit for every row. */
  readonly sinceIso?: string;
  readonly untilIso?: string;
}): CacheHitRate[] {
  const since = input.sinceIso === undefined ? -Infinity : Date.parse(input.sinceIso);
  const until = input.untilIso === undefined ? Infinity : Date.parse(input.untilIso);
  interface Acc {
    read: number; write: number; uncached: number; attempts: number; measured: number; predating: number; unreported: number;
    uncachedPerRow: number[]; batched: number; requests: number; aggregatePriced: number;
    turns: number | null; misses: number | null; stationary: number | null; saved: number | null;
  }
  const byRole = new Map<string, Acc>();
  const fresh = (): Acc => ({ read: 0, write: 0, uncached: 0, attempts: 0, measured: 0, predating: 0, unreported: 0, uncachedPerRow: [], batched: 0, requests: 0, aggregatePriced: 0, turns: null, misses: null, stationary: null, saved: 0 });
  const inWindow = new Set<string>();
  for (const c of input.costs) {
    const at = Date.parse(c.recordedAt);
    if (at < since || at > until) continue;
    if (c.routeId === SCOUT_PREWARM_ROUTE_ID) continue;
    /* A deterministic parser/engineer is not missing model usage. Recorded
     * identities include actual model rows without assigning a model by role. */
    if (!LEGACY_MODEL_CACHE_ROLES.has(c.role) && !c.model && (!c.tier || c.tier === "none") && !c.byModel?.length) continue;
    const acc = byRole.get(c.role) ?? fresh();
    acc.attempts += 1;
    inWindow.add(c.attemptId);
    const saving = recordedCacheSaving(c);
    acc.saved = acc.saved === null || saving === null ? null : acc.saved + saving;
    const m = cacheMeteringOf(c.cost);
    if (m.status === "PREDATES_FIELDS") acc.predating += 1;
    else if (m.status === "UNREPORTED") acc.unreported += 1;
    else {
      acc.measured += 1;
      acc.read += m.cacheReadInputTokens;
      acc.write += m.cacheCreationInputTokens;
      acc.uncached += m.uncachedInputTokens;
      acc.uncachedPerRow.push(m.uncachedInputTokens);
      const requests = c.cost.requestCount ?? 1;
      acc.requests += requests;
      if (m.batch) acc.batched += requests;
      if (m.cacheCreationInputTokens > 0 && m.cacheCreation5mInputTokens === null && m.cacheCreation1hInputTokens === null) acc.aggregatePriced += 1;
    }
    byRole.set(c.role, acc);
  }
  /* Per-turn columns: the Scout results' steps, for the Attempts the window holds. */
  const roleOf = (step: ScoutStep): string => (step.step === "scout-research-loop" ? "SCOUT" : "SUB_STEP");
  for (const r of input.results) {
    if (!inWindow.has(r.attemptId)) continue;
    const modelSteps = (r.steps ?? []).filter((s) => s.kind === "MODEL");
    if (modelSteps.length === 0) continue;
    for (const role of new Set(modelSteps.map(roleOf))) {
      const acc = byRole.get(role) ?? fresh();
      const later = modelSteps.filter((s) => roleOf(s) === role && (s.turn ?? 0) >= 2);
      acc.turns = (acc.turns ?? 0) + later.length;
      acc.misses = (acc.misses ?? 0) + later.filter((s) => s.tokens.cacheRead === 0).length;
      const stationary = r.cacheDefect?.stationaryTurns?.length ?? 0;
      acc.stationary = (acc.stationary ?? 0) + stationary;
      byRole.set(role, acc);
    }
  }
  return [...byRole.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([role, a]) => {
    const total = a.read + a.write + a.uncached;
    const mean = a.uncachedPerRow.length === 0 ? null : a.uncachedPerRow.reduce((n, v) => n + v, 0) / a.uncachedPerRow.length;
    return {
      role,
      cacheRead: a.read,
      cacheWrite: a.write,
      uncachedInput: a.uncached,
      hitRate: total === 0 ? null : a.read / total,
      repeatedPrefixTurns: a.turns,
      repeatedPrefixMisses: a.misses,
      stationaryTurns: a.stationary,
      attempts: a.attempts,
      measuredRows: a.measured,
      predatingRows: a.predating,
      unreportedRows: a.unreported,
      uncachedPerAttempt: mean === null ? null : { mean, max: Math.max(...a.uncachedPerRow) },
      batchShare: a.requests === 0 ? null : a.batched / a.requests,
      savedUsd: a.measured === 0 ? null : a.saved,
      aggregatePricedRows: a.aggregatePriced,
      denominator:
        `cacheRead over cacheRead + cacheWrite + uncachedInput across ${a.measured} measured ${role} ledger row(s) of ${a.attempts} in the window` +
        (a.predating > 0 ? ` (${a.predating} predate the cache fields and are NOT MEASURED)` : "") +
        (a.unreported > 0 ? ` (${a.unreported} reported no usage)` : "") +
        "; per-turn columns from Scout steps where recorded",
    };
  });
}

export interface CostPerOutcome {
  readonly outcome: string;
  readonly count: number;
  /** Total measured usd across ALL Attempts in scope, divided by count. Null when count is zero or spend unmeasured. */
  readonly usdPerOutcome: number | null;
  readonly denominator: string;
}

/** The whole measured spend in scope over each useful outcome's count, so a NO_PROGRESS Attempt's cost is not hidden. */
export function costPerUsefulOutcome(input: {
  readonly results: readonly ScoutResult[];
  readonly candidateCounts: { readonly validated: number; readonly admitted: number } | null;
  readonly confirmed: number | null;
}): CostPerOutcome[] {
  const measured = input.results.filter((r) => r.usd !== null);
  const spend = measured.reduce((n, r) => n + (r.usd ?? 0), 0);
  const unmeasured = input.results.length - measured.length;
  const accepted = input.results.filter((r) => r.refusal === null);
  const denominator = `total measured Scout spend $${spend.toFixed(4)} over ${measured.length} measured Attempt(s) (${unmeasured} unmeasured), divided by the outcome count`;
  const per = (outcome: string, count: number | null): CostPerOutcome => ({
    outcome,
    count: count ?? 0,
    usdPerOutcome: count === null || count === 0 || measured.length === 0 ? null : spend / count,
    denominator: count === null ? `${outcome}: not recorded by any pipeline yet` : denominator,
  });
  return [
    per("ROUTE_CANDIDATE", accepted.filter((r) => r.outcome === "ROUTE_CANDIDATE").length),
    per("EVIDENCE_FOUND", accepted.filter((r) => r.outcome === "EVIDENCE_FOUND").length),
    per("CONFIRMED", input.confirmed),
    per("GRADUATED_ROUTE", input.candidateCounts === null ? null : input.candidateCounts.admitted),
  ];
}

/** Everything the digest and the admin page report, computed once per cycle and stored on the research state. */
export interface ResearchMetrics {
  readonly computedAt: string;
  readonly capacity: ScoutCapacity;
  readonly ordering: DispatchOrdering | null;
  readonly funnel: GraduationFunnel;
  readonly share: ShareTrend;
  readonly cacheByRole: readonly CacheHitRate[];
  readonly costPerOutcome: readonly CostPerOutcome[];
  /** Results with a recorded cache defect, of results carrying steps, with the stationary and zero-read signatures counted apart. */
  readonly cacheDefects: { readonly defective: number; readonly instrumented: number; readonly stationary?: number; readonly zeroRead?: number };
  /** The window the cache-by-role rows were computed over. Absent on older records. */
  readonly cacheWindow?: { readonly sinceIso: string | null; readonly untilIso: string | null };
}

export function cacheDefectCounts(results: readonly ScoutResult[]): ResearchMetrics["cacheDefects"] {
  const instrumented = results.filter((r) => r.steps !== undefined);
  const defective = instrumented.filter((r) => r.cacheDefect !== null && r.cacheDefect !== undefined);
  return {
    defective: defective.length,
    instrumented: instrumented.length,
    stationary: defective.filter((r) => (r.cacheDefect?.stationaryTurns?.length ?? 0) > 0).length,
    /* An older result carries only `turns`, which were zero-read turns by construction. */
    zeroRead: defective.filter((r) => (r.cacheDefect?.zeroReadTurns?.length ?? (r.cacheDefect?.stationaryTurns === undefined ? r.cacheDefect?.turns.length ?? 0 : 0)) > 0).length,
  };
}
