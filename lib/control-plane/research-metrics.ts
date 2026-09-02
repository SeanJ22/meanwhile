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
 * is now READER IMPACT, in three bands, oldest due first within a band:
 *
 * ```
 *   band 1   feeds a pilot surface or an open red reader question:
 *            readerImpactAt is set on the obligation, OR the subject is in a
 *            pilot jurisdiction, OR an open red reader question names the
 *            subject's pilot ZIP
 *   band 2   source-universe completion (RULING 229): the statewide and
 *            per-jurisdiction universe providers
 *   band 3   the long tail — everything else
 * ```
 *
 * Every input is NAMED on the record (`DispatchOrdering.inputs`) so the order
 * is auditable, and the band counts travel on the run record and the research
 * state.
 */

import type { CostEntry } from "./cost.ts";
import type { ScoutResult, ScoutStep } from "./scheduler/scout-result.ts";

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
  /** ZIPs an open RED reader question applies to, from the latest reader-suite run and the question corpus. */
  readonly openRedQuestionZips: readonly string[];
  /** The count behind `openRedQuestionZips`, for the record. */
  readonly openRedQuestions: number;
  readonly readerSuiteRun: string | null;
  /** The pilot ZIPs in force. */
  readonly pilotZips: readonly string[];
}

export interface OrderableObligation {
  readonly id: string;
  readonly subjectId: string;
  readonly readerImpactAt: string | null;
  readonly providerId: string | null;
  readonly nextDueAt: string;
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
    readonly openRedQuestions: { readonly count: number; readonly zips: readonly string[]; readonly run: string | null };
    readonly universeProviders: readonly string[];
    readonly tieBreak: "oldest nextDueAt first within a band";
  };
  readonly bands: { readonly 1: number; readonly 2: number; readonly 3: number };
  /** The lane the order applied to. The deterministic lane keeps oldest-first. */
  readonly appliesTo: "BOUNDED_MODEL_WORKER";
}

export const ORDERING_RULE =
  "band 1 = feeds a pilot surface or an open red reader question (readerImpactAt set, pilot jurisdiction, or a red question's ZIP); " +
  "band 2 = source-universe completion (RULING 229 universe providers); band 3 = long tail; within a band, oldest due first";

export const ORDERING_SCOPE =
  "decides WHICH due model-class rows are opened under the per-cycle Scout ceiling; the in-cycle pool then starts the opened rows " +
  "oldest-first (shadow-loop dueNow), so with a ceiling of three the order chooses the three and not their start sequence. The deterministic lane keeps oldest-first";

function pilotKeysFor(zips: readonly string[]): string[] {
  return [...new Set(zips.flatMap((z) => PILOT_JURISDICTION_KEYS[z] ?? []))];
}

/** Which band one obligation falls in, and why. Pure. */
export function bandFor(row: OrderableObligation, inputs: OrderingInputs): { readonly band: ReaderImpactBand; readonly why: string } {
  const hay = `${row.id} ${row.subjectId}`.toLowerCase();
  if (row.readerImpactAt !== null) return { band: 1, why: `readerImpactAt ${row.readerImpactAt} is set by the provider` };
  const pilotKey = pilotKeysFor(inputs.pilotZips).find((k) => hay.includes(k));
  if (pilotKey !== undefined) return { band: 1, why: `subject is in a pilot jurisdiction (${pilotKey})` };
  const redKey = pilotKeysFor(inputs.openRedQuestionZips).find((k) => hay.includes(k));
  if (redKey !== undefined) return { band: 1, why: `an open red reader question names this subject's ZIP (${redKey})` };
  if (row.providerId !== null && UNIVERSE_PROVIDERS.includes(row.providerId)) {
    return { band: 2, why: `provider ${row.providerId} is a source-universe denominator (RULING 229)` };
  }
  return { band: 3, why: "no reader-impact signal and not a universe provider: the long tail" };
}

/** Order a due queue by reader impact. Returns the ordered rows and the record of the rule. */
export function orderByReaderImpact<T extends OrderableObligation>(
  rows: readonly T[],
  inputs: OrderingInputs,
): { readonly ordered: BandedObligation<T>[]; readonly ordering: DispatchOrdering } {
  const banded = rows.map((row) => ({ row, ...bandFor(row, inputs) }));
  banded.sort((a, b) => a.band - b.band || (a.row.nextDueAt < b.row.nextDueAt ? -1 : a.row.nextDueAt > b.row.nextDueAt ? 1 : 0) || a.row.id.localeCompare(b.row.id));
  const count = (band: ReaderImpactBand): number => banded.filter((b) => b.band === band).length;
  return {
    ordered: banded,
    ordering: {
      rule: ORDERING_RULE,
      scope: ORDERING_SCOPE,
      inputs: {
        readerImpactAt: "FreshnessObligation.readerImpactAt",
        pilotJurisdictions: `PILOT_ZIPS ${inputs.pilotZips.join(", ")} -> PILOT_JURISDICTION_KEYS (lib/control-plane/research-metrics.ts)`,
        openRedQuestions: { count: inputs.openRedQuestions, zips: inputs.openRedQuestionZips, run: inputs.readerSuiteRun },
        universeProviders: UNIVERSE_PROVIDERS,
        tieBreak: "oldest nextDueAt first within a band",
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
    { stage: "VALIDATED", count: input.candidateCounts?.validated ?? 0, source: "data/method/candidates.json lifecycle counts" },
    { stage: "ADMITTED", count: input.candidateCounts?.admitted ?? 0, source: "data/method/candidates.json lifecycle counts" },
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
}

/**
 * The cache hit rate BY ROLE, from the Scout results' usage (the ledger's
 * AttemptCost carries no cache fields). Per-turn misses come from `steps`,
 * which results recorded before RULING 244 do not carry; for those the
 * per-turn columns are null rather than zero.
 */
export function cacheHitRateByRole(results: readonly ScoutResult[]): CacheHitRate[] {
  const byRole = new Map<string, { read: number; write: number; uncached: number; attempts: number; turns: number | null; misses: number | null }>();
  const roleOf = (step: ScoutStep): string => (step.step === "scout-research-loop" ? "SCOUT" : "SUB_STEP");
  for (const r of results) {
    const u = r.usage;
    const read = u.cacheReadInputTokens ?? 0;
    const write = u.cacheCreationInputTokens ?? 0;
    const uncached = u.inputTokens ?? 0;
    const modelSteps = (r.steps ?? []).filter((s) => s.kind === "MODEL");
    const roles = modelSteps.length > 0 ? [...new Set(modelSteps.map(roleOf))] : ["SCOUT"];
    for (const role of roles) {
      const acc = byRole.get(role) ?? { read: 0, write: 0, uncached: 0, attempts: 0, turns: null, misses: null };
      if (modelSteps.length > 0) {
        const own = modelSteps.filter((s) => roleOf(s) === role);
        acc.read += own.reduce((n, s) => n + s.tokens.cacheRead, 0);
        acc.write += own.reduce((n, s) => n + s.tokens.cacheWrite, 0);
        acc.uncached += own.reduce((n, s) => n + s.tokens.uncachedInput, 0);
        const later = own.filter((s) => (s.turn ?? 0) >= 2);
        acc.turns = (acc.turns ?? 0) + later.length;
        acc.misses = (acc.misses ?? 0) + later.filter((s) => s.tokens.cacheRead === 0).length;
      } else {
        acc.read += read;
        acc.write += write;
        acc.uncached += uncached;
      }
      acc.attempts += 1;
      byRole.set(role, acc);
    }
  }
  return [...byRole.entries()].map(([role, a]) => {
    const total = a.read + a.write + a.uncached;
    return {
      role,
      cacheRead: a.read,
      cacheWrite: a.write,
      uncachedInput: a.uncached,
      hitRate: total === 0 ? null : a.read / total,
      repeatedPrefixTurns: a.turns,
      repeatedPrefixMisses: a.misses,
      attempts: a.attempts,
      denominator: `cacheRead over cacheRead + cacheWrite + uncachedInput across ${a.attempts} ${role} Attempt(s); per-turn misses from steps where recorded`,
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
  /** Results with a recorded cache defect, of results carrying steps. */
  readonly cacheDefects: { readonly defective: number; readonly instrumented: number };
}

export function cacheDefectCounts(results: readonly ScoutResult[]): ResearchMetrics["cacheDefects"] {
  const instrumented = results.filter((r) => r.steps !== undefined);
  return { defective: instrumented.filter((r) => r.cacheDefect !== null && r.cacheDefect !== undefined).length, instrumented: instrumented.length };
}
