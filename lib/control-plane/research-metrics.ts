/**
 * **THE RESEARCH LANE'S NUMBERS — CAPACITY, THE QUEUE BY BAND, THE
 * GRADUATION FUNNEL, THE MODEL-VS-DETERMINISTIC SHARE, THE CACHE HIT RATE,
 * AND THE COST PER USEFUL OUTCOME.** (Work Item 5 and 6, 2026-09-02.
 * RULING 229, RULING 244.)
 *
 * Every function here is PURE over records the caller read: cost-ledger
 * entries, Scout results, the due queue, run records. Nothing reads a clock,
 * a file or a store. Every number carries its denominator and the rule it
 * was computed under, because a research digest that printed "capacity 17"
 * with no denominator would be a statistic looking for a story.
 *
 * ## The dispatch order (Work Item 5)
 *
 * OLDEST-FIRST answered "what has waited longest", which is the wrong
 * question for a lane whose whole purpose is what a reader can see. The order
 * is now READER IMPACT, in three bands, and within a band the longest wait
 * first. A row that failed waits from the end of its backoff (`waitingSince`),
 * not from its first next-due (2026-09-25):
 *
 * ```
 *   band 1   feeds a pilot surface: readerImpactAt is set on the canonical
 *            obligation, OR the subject is in a release-pinned pilot
 *            jurisdiction
 *   band 2   source-universe completion (RULING 229): the statewide and
 *            per-jurisdiction universe providers
 *   band 3   the long tail — everything else
 * ```
 *
 * Every input is NAMED on the record (`DispatchOrdering.inputs`) so the order
 * is auditable, and the band counts travel on the run record and the research
 * state.
 */

import { MODELS, canonicalModelId, modelTierFor } from "../models.ts";
import { cacheMeteringOf, costPortionsByModel, type CostEntry } from "./cost.ts";
import { CACHE_RATE_MULTIPLIERS, cacheSavingUsd } from "./model-cost.ts";
import type { ScoutResult, ScoutStep } from "./scheduler/scout-result.ts";
import { SCOUT_PREWARM_ROUTE_ID } from "./scheduler/research-policy.ts";
import { waitingSince, type QueueDebt } from "./scheduler/obligation.ts";

/* ------------------------------------------------------------- capacity */

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

/**
 * Attempts per day the rolling ceiling supports at the measured mean cost.
 * The mean is over MEASURED Scout entries inside the window; an unmeasured
 * Attempt is counted beside it and never coerced to zero (cost.ts).
 */
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
    /* A pre-warm request is a cache write for the cycle's Attempts, never an Attempt itself (2026-09-06). */
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

/* -------------------------------------------------------------- ordering */

export type ReaderImpactBand = 1 | 2 | 3;

/**
 * The pilot jurisdictions, as the committed jurisdiction registries name
 * them, keyed by the pilot ZIP each serves. `PILOT_ZIPS` is
 * `lib/health/owner-corpus-compile.ts`'s list; the ids are
 * `data/jurisdictions/<state>.json` entries and the OCD divisions the meeting
 * corpus keys bodies on. A subject id or obligation id containing one of these
 * keys belongs to a pilot jurisdiction.
 */
export const PILOT_JURISDICTION_KEYS: Readonly<Record<string, readonly string[]>> = {
  /* Tucson, Pima County. Jurisdiction-shaped keys only: a bare place name would match a candidate's surname. */
  "85701": ["county-of-pima", "county:pima", "county-pima", "city-of-tucson", "place:tucson", "place-tucson"],
  "85641": ["county-of-pima", "county:pima", "county-pima", "place:vail", "place-vail", "vail-unified"],
  "07866": ["county-of-morris", "county:morris", "county-morris", "place:rockaway", "place-rockaway"],
  "03255": ["county-of-merrimack", "county:merrimack", "county-merrimack", "place:newbury", "place-newbury"],
};

/** Providers whose obligations are a source-universe denominator (RULING 229). */
export const UNIVERSE_PROVIDERS: readonly string[] = ["candidate-enrichment", "local-jurisdictions", "campaign-finance"];

export interface OrderingInputs {
  /** The pilot ZIPs in force. */
  readonly pilotZips: readonly string[];
}

export interface OrderableObligation {
  readonly id: string;
  readonly subjectId: string;
  readonly readerImpactAt: string | null;
  readonly providerId: string | null;
  readonly nextDueAt: string;
  /**
   * When the row joined the queue (`waitingSince`): its next-due, or after a
   * failed attempt the end of its backoff. Absent, the next-due. Within a band
   * this is the order key, so a failing row cannot hold its first next-due and
   * go back to the head each time its backoff ends (2026-09-25).
   */
  readonly queuedSince?: string;
}

/**
 * **ONE DUE ROW, AS THE SCOUT ORDER READS IT.** (2026-09-25.) Both the recorded
 * queue and the live Scout pool build their rows here, so the waiting key
 * cannot be dropped from one of them. `debt` is the row's debt carried into
 * the cycle.
 */
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
  /** What the order decides, and what it does not. */
  readonly scope: string;
  readonly inputs: {
    readonly readerImpactAt: "FreshnessObligation.readerImpactAt";
    readonly pilotJurisdictions: string;
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
  "band 1 = feeds a pilot surface (canonical FreshnessObligation.readerImpactAt set or release-pinned pilot jurisdiction); " +
  "band 2 = source-universe completion (RULING 229 universe providers); band 3 = long tail; within a band, the longest wait first " +
  "(a row that failed waits from the end of its backoff)";

export const ORDERING_SCOPE =
  "orders every due model-class row before admission to the bounded Scout pool, so reader-impact priority decides both which rows fit the per-cycle ceiling and which one starts first. The plain-code lane has its own longest-wait-first order";

function pilotKeysFor(zips: readonly string[]): string[] {
  return [...new Set(zips.flatMap((z) => PILOT_JURISDICTION_KEYS[z] ?? []))];
}

/** Which band one obligation falls in, and why. Pure. */
export function bandFor(row: OrderableObligation, inputs: OrderingInputs): { readonly band: ReaderImpactBand; readonly why: string } {
  const hay = `${row.id} ${row.subjectId}`.toLowerCase();
  if (row.readerImpactAt !== null) return { band: 1, why: `readerImpactAt ${row.readerImpactAt} is set by the provider` };
  const pilotKey = pilotKeysFor(inputs.pilotZips).find((k) => hay.includes(k));
  if (pilotKey !== undefined) return { band: 1, why: `subject is in a pilot jurisdiction (${pilotKey})` };
  if (row.providerId !== null && UNIVERSE_PROVIDERS.includes(row.providerId)) {
    return { band: 2, why: `provider ${row.providerId} is a source-universe denominator (RULING 229)` };
  }
  return { band: 3, why: "no reader-impact signal and not a universe provider: the long tail" };
}

/**
 * The one comparator behind both the recorded queue and the live Scout pool.
 * Keeping it here prevents the standing loop from growing a second band table
 * that can disagree with the owner-visible ordering record.
 */
export function compareReaderImpact(
  left: OrderableObligation,
  right: OrderableObligation,
  inputs: OrderingInputs,
): number {
  /*
   * Within a band, the longest wait first (2026-09-25). Before, the key was
   * the next-due, with ties broken by id. A failing row keeps its first
   * next-due, so on 2026-09-25 329 failing and 49 never-tried authored-site
   * rows shared one next-due (2026-09-15T17:58:43.627Z). The failing rows
   * whose ids sorted first went back to the head each time their backoff
   * ended.
   */
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
        pilotJurisdictions: `PILOT_ZIPS ${inputs.pilotZips.join(", ")} -> PILOT_JURISDICTION_KEYS (lib/control-plane/research-metrics.ts)`,
        universeProviders: UNIVERSE_PROVIDERS,
        tieBreak: TIE_BREAK,
      },
      bands: { 1: count(1), 2: count(2), 3: count(3) },
      appliesTo: "BOUNDED_MODEL_WORKER",
    },
  };
}

/* ---------------------------------------------------------------- funnel */

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

/**
 * SCOUTED -> CONFIRMED -> VERIFIED -> AUDITED -> APPROVED, and beside it the
 * candidate lifecycle VALIDATED -> ADMITTED -> deterministic replays.
 * SCOUTED counts distinct obligations with a non-refused Scout result; the
 * pipeline stages come from the injected reader (none recorded by default);
 * replays count deterministic dispatches on routes an ADMITTED candidate
 * learned, from the run records the caller read.
 */
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

/* ----------------------------------------------------------------- share */

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

/* ----------------------------------------------------------------- cache */


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
    // Current shares inherit the row's batch flag. Retained explicit flags must
    // be actual booleans and agree; conflicting metadata is not a price estimate.
    if (share && "batch" in share && (typeof share.batch !== "boolean" || share.batch !== metering.batch)) return null;
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
  /*
   * ---- the ledger columns (2026-09-06). Always set by `cacheHitRateByRole`;
   * OPTIONAL on the type because a row persisted on a research-state record
   * before that date carries none of them, and the digest prints such a row
   * as it always did rather than crashing on it. ----
   */
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

/**
 * **THE CACHE HIT RATE BY ROLE, FROM THE COST LEDGER.** (2026-09-06.)
 *
 * Until this session the rate was computed from the Scout results' own usage
 * block — a parallel store of the same quantities the ledger should have
 * carried, which is why one instrument printed 18.6% while the digest's COST
 * section printed NOT MEASURED. Both now read the ledger: every row inside the
 * window, per role, through `cacheMeteringOf`. A row that predates the cache
 * fields counts as PREDATING and contributes no tokens; a row the provider
 * left null counts as UNREPORTED. The per-turn columns still come from the
 * Scout results' `steps`, which is the only per-turn record there is; the
 * results are matched to the window by their attempt ids.
 */
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

/* ------------------------------------------------------ cost per outcome */

export interface CostPerOutcome {
  readonly outcome: string;
  readonly count: number;
  /** Total measured usd across ALL Attempts in scope, divided by count. Null when count is zero or spend unmeasured. */
  readonly usdPerOutcome: number | null;
  readonly denominator: string;
}

/**
 * Cost per useful outcome: the whole measured spend in scope over the number
 * of each useful outcome class. The spend is shared across classes on
 * purpose — a NO_PROGRESS Attempt cost real money, and hiding it inside its
 * own bucket would make every useful outcome look cheaper than it was.
 */
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

/* --------------------------------------------------------------- record */

/** Everything the digest and the admin page report, computed once per cycle and stored on the research state. */
export interface ResearchMetrics {
  readonly computedAt: string;
  readonly capacity: ScoutCapacity;
  readonly ordering: DispatchOrdering | null;
  readonly funnel: GraduationFunnel;
  readonly share: ShareTrend;
  readonly cacheByRole: readonly CacheHitRate[];
  readonly costPerOutcome: readonly CostPerOutcome[];
  /**
   * Results with a recorded cache defect, of results carrying steps; and the
   * two signatures counted apart (2026-09-06). A result carries `stationary`
   * when a turn paid for more uncached input than it appended, `zeroRead`
   * when a turn read nothing; one result can carry both.
   */
  readonly cacheDefects: { readonly defective: number; readonly instrumented: number; readonly stationary?: number; readonly zeroRead?: number };
  /** The window the cache-by-role rows were computed over (2026-09-06). Absent on a record computed before. */
  readonly cacheWindow?: { readonly sinceIso: string | null; readonly untilIso: string | null };
}

export function cacheDefectCounts(results: readonly ScoutResult[]): ResearchMetrics["cacheDefects"] {
  const instrumented = results.filter((r) => r.steps !== undefined);
  const defective = instrumented.filter((r) => r.cacheDefect !== null && r.cacheDefect !== undefined);
  return {
    defective: defective.length,
    instrumented: instrumented.length,
    stationary: defective.filter((r) => (r.cacheDefect?.stationaryTurns?.length ?? 0) > 0).length,
    /* A result recorded before 2026-09-06 carries only `turns`, which were zero-read turns by construction. */
    zeroRead: defective.filter((r) => (r.cacheDefect?.zeroReadTurns?.length ?? (r.cacheDefect?.stationaryTurns === undefined ? r.cacheDefect?.turns.length ?? 0 : 0)) > 0).length,
  };
}
