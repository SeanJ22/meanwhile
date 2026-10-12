/**
 * Joins the cost ledger, attempts, cycle cache metrics, lane share and verified
 * record count into the cost panel figures. Pure: records in, rows out.
 *
 * A role is MEASURED (model attempts reported dollars), FREE_BY_DESIGN (every
 * attempt ran without a paid model; measured in time, requests and bytes) or
 * UNMEASURED (model attempts reported no dollars).
 */
import type { WorkerRole } from "./attempt.ts";
import {
  DISCOVERY_SEARCH_ROLE,
  SEARCH_SOURCE_NOT_ON_RECORD,
  cacheMeteringOf,
  costPortionsByModel,
  entriesInWindow,
  sumMetric,
  utcMonthWindow,
  type CostEntry,
  type LedgerWindow,
  type MeasuredTotal,
} from "./cost.ts";
import { cacheSavingUsd } from "./model-cost.ts";
import { gap, held, measured, type Held, type Measured, type RenderedNumber } from "./owner-surface.ts";
import { modelName, usdCents, usdOf } from "./plain-words.ts";
import { scoutCapacity, type CacheHitRate, type ScoutCapacity, type ShareTrend } from "./research-metrics.ts";
import { RESEARCH_BOUNDS } from "./scheduler/research-policy.ts";

export type CostRowKind = "MEASURED" | "FREE_BY_DESIGN" | "UNMEASURED";

export interface NonDollarMeasures {
  readonly requests: number;
  readonly bytes: number;
  readonly durationMs: number;
  /** Entries that carried at least one of the three. */
  readonly entries: number;
}

export interface CostRow {
  readonly key: string;
  readonly usd: Held<Measured>;
  /** Attempts whose usd was reported / not reported. Never coerced to zero. */
  readonly attemptsMeasured: number;
  readonly attemptsUnmeasured: number;
  /** Absent on older snapshots. */
  readonly kind?: CostRowKind;
  /** Absent on older snapshots. */
  readonly nonDollar?: NonDollarMeasures;
  /** Absent on older snapshots. */
  readonly meaning?: string;
  /**
   * How many of the row's entries can say anything about cache and batch use.
   * A row recorded before the metering fields existed is never a zero. Absent
   * on older snapshots, where absent means unknown.
   */
  readonly metering?: MeteringCounts;
}

/** Ledger rows by what their cache/batch fields can say. Mirrors `cacheMeteringOf`. */
export interface MeteringCounts {
  /** Rows carrying the six metering fields with numbers in them. */
  readonly measured: number;
  /** Rows written before the fields existed: nothing about their cache use was measured. */
  readonly predatesFields: number;
  /** Rows carrying the fields as nulls: the request ran and the provider reported no usage. */
  readonly unreported: number;
  /** Measured rows served through the Message Batches API. */
  readonly batched: number;
}

/** Cache health carried from the cycle's `CacheHitRate`; null is an untaken measurement, never a zero. */
export interface CacheCallerHealth {
  /** Turns after the first that read ZERO cached tokens, over turns after the first. */
  readonly zeroReadTurns: number | null;
  readonly turnsExamined: number | null;
  /** Turns matching the stationary-breakpoint signature: the conversation re-sent at full price. */
  readonly stationaryTurns: number | null;
  readonly measuredRows: number;
  readonly predatesFieldRows: number;
  readonly providerReportedNothingRows: number;
  /** Requests served through the Batches API, over requests, on measured rows. */
  readonly batchShare: number | null;
  /** What cache reads saved against sending the same tokens uncached. */
  readonly savedUsd: number | null;
  /** Measured rows whose cache write had to be priced from the aggregate because the response carried no TTL split. */
  readonly aggregatePricedRows: number;
}

export interface CacheCallerRow {
  readonly callerKey: string;
  readonly hitRate: Held<Measured>;
  readonly health?: CacheCallerHealth;
}

export interface CostPanel {
  readonly costByRole: readonly CostRow[];
  readonly costByModel: readonly CostRow[];
  readonly cacheHitRateByCaller: readonly CacheCallerRow[];
  readonly deterministicShare: Held<Measured>;
  readonly costPerVerifiedRecord: Held<Measured>;
  readonly summary: {
    /** Sum of every measured usd in the ledger. Null when nothing was measured. */
    readonly measuredUsd: number | null;
    readonly attemptsMeasured: number;
    readonly attemptsUnmeasured: number;
    readonly entries: number;
  };
  /** What the daily ceiling buys at the measured mean. Null when no clock was passed. */
  readonly capacity: ScoutCapacity | null;
  /** The UTC calendar month's spend. Null when no clock was passed. */
  readonly monthlySpend: MonthlySpendView | null;
}

export interface CostPanelInput {
  readonly costs: readonly CostEntry[];
  /** Every Attempt on record, for the model join (worker.version is the model). */
  readonly attempts: readonly { readonly id: string; readonly worker: { readonly version: string; readonly provider: string } }[];
  /** The newest cycle's cache hit rates by model role, or null when no cycle computed them. */
  readonly cacheByRole: readonly CacheHitRate[] | null;
  /** The lane share the newest cycle recorded, or null when no cycle carries it. */
  readonly share: ShareTrend | null;
  /** Records that reached VERIFIED in the promotion pipeline; null when the pipeline could not be read. */
  readonly verifiedRecords: number | null;
  /** Needed for capacity and monthly spend; both are null without it, since this module never reads a clock. */
  readonly nowIso?: string;
  /** The rolling ceiling the capacity sentence is stated against. Defaults to the research daily ceiling. */
  readonly dailyCeilingUsd?: number;
}

export const NO_MODEL_KEY = "no model (deterministic work)";
export const PROD_ASK_KEY = "prod-ask (reader questions)";
/** By-model key for a ledger row whose Attempt is not in the attempts list: unknown, not free. */
export const ATTEMPT_NOT_ON_RECORD = "(attempt not on record)";
const LEDGER = "cp_log_costs (control-plane cost ledger)";

/** A version string names a model when it is one of the provider's model ids. */
export function modelKeyOf(worker: { readonly version: string; readonly provider: string }): string {
  return /^claude-/i.test(worker.version) || worker.provider === "anthropic" ? worker.version : NO_MODEL_KEY;
}

/** Tolerates older snapshots without `kind`, whose free-role gap sentence said "without a paid model". */
export function costRowKind(row: { readonly kind?: CostRowKind; readonly usd: Held<Measured> }): CostRowKind {
  if (row.kind) return row.kind;
  if (row.usd.held) return "MEASURED";
  return /without a paid model/.test(row.usd.gap.says) ? "FREE_BY_DESIGN" : "UNMEASURED";
}

function nonDollarOf(entries: readonly CostEntry[]): NonDollarMeasures {
  let requests = 0;
  let bytes = 0;
  let durationMs = 0;
  let carrying = 0;
  for (const e of entries) {
    const r = e.cost.requestCount ?? 0;
    const b = e.cost.bytesFetched ?? 0;
    const d = e.cost.durationMs ?? 0;
    if (r > 0 || b > 0 || d > 0) carrying += 1;
    requests += Number.isFinite(r) ? r : 0;
    bytes += Number.isFinite(b) ? b : 0;
    durationMs += Number.isFinite(d) ? d : 0;
  }
  return { requests, bytes, durationMs, entries: carrying };
}

/** The row's cache/batch metering, counted through the ledger's own parser. */
function meteringOf(entries: readonly CostEntry[]): MeteringCounts {
  let measuredRows = 0;
  let predatesFields = 0;
  let unreported = 0;
  let batched = 0;
  for (const e of entries) {
    const m = cacheMeteringOf(e.cost);
    if (m.status === "PREDATES_FIELDS") predatesFields += 1;
    else if (m.status === "UNREPORTED") unreported += 1;
    else {
      measuredRows += 1;
      if (m.batch) batched += 1;
    }
  }
  return { measured: measuredRows, predatesFields, unreported, batched };
}

function usdRow(
  key: string,
  entries: readonly CostEntry[],
  grandTotal: number | null,
  modelOf: ReadonlyMap<string, string>,
): CostRow {
  const measuredCount = entries.filter((e) => typeof e.cost.usd === "number").length;
  const unmeasuredCount = entries.length - measuredCount;
  const total = measuredCount === 0 ? null : entries.reduce((n, e) => n + (e.cost.usd ?? 0), 0);
  const modelAttempts = entries.filter((e) => (modelOf.get(e.attemptId) ?? NO_MODEL_KEY) !== NO_MODEL_KEY).length;
  const nonDollar = nonDollarOf(entries);
  const metering = meteringOf(entries);
  const n = entries.length;
  const plural = n === 1 ? "" : "s";

  if (total === null || grandTotal === null) {
    if (modelAttempts === 0 && key !== PROD_ASK_KEY) {
      // Every attempt ran without a paid model: $0 by design, not a gap.
      return {
        key,
        usd: held(
          measured(
            0,
            grandTotal ?? 0,
            "this work runs without a paid model, so its dollar cost is $0 by design; it is measured in time, requests and bytes instead",
            LEDGER,
          ),
        ),
        attemptsMeasured: measuredCount,
        attemptsUnmeasured: unmeasuredCount,
        kind: "FREE_BY_DESIGN",
        nonDollar,
        metering,
        meaning: `$0 by design — ${n} attempt${plural} ran deterministic code with no paid model. Not a gap: there is nothing in dollars to measure here.`,
      };
    }
    return {
      key,
      usd: gap(
        "OURS",
        `${modelAttempts} model attempt${modelAttempts === 1 ? "" : "s"} of ${n} reported no dollar cost.`,
      ),
      attemptsMeasured: measuredCount,
      attemptsUnmeasured: unmeasuredCount,
      kind: "UNMEASURED",
      nonDollar,
      metering,
      meaning: `${modelAttempts} attempt${modelAttempts === 1 ? "" : "s"} used a paid model and reported no dollar figure, so this cost is unmeasured — not zero, and not free.`,
    };
  }
  return {
    key,
    usd: held(
      measured(
        round(total),
        round(Math.max(grandTotal, total)),
        "measured dollars spent by this key, out of all measured dollars in the ledger; attempts that reported no cost are counted beside, never as zero",
        LEDGER,
      ),
    ),
    attemptsMeasured: measuredCount,
    attemptsUnmeasured: unmeasuredCount,
    kind: "MEASURED",
    nonDollar,
    metering,
    meaning:
      unmeasuredCount === 0
        ? `Every one of the ${n} attempt${plural} reported its dollar cost.`
        : `${measuredCount} of ${n} attempt${plural} reported a dollar cost; ${unmeasuredCount} reported none${modelAttempts <= measuredCount ? " (deterministic steps, $0 by design)" : ""}.`,
  };
}

function round(usd: number): number {
  return Math.round(usd * 10_000) / 10_000;
}

export function buildCostPanel(input: CostPanelInput): CostPanel {
  const measuredEntries = input.costs.filter((e) => typeof e.cost.usd === "number");
  const grandTotal = measuredEntries.length === 0 ? null : measuredEntries.reduce((n, e) => n + (e.cost.usd ?? 0), 0);
  const modelOf = new Map(input.attempts.map((a) => [a.id, modelKeyOf(a.worker)]));

  /* ---- by role, from the ledger's own role field ---- */
  const byRole = new Map<string, CostEntry[]>();
  for (const e of input.costs) byRole.set(e.role, [...(byRole.get(e.role) ?? []), e]);
  const costByRole = [...byRole.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([role, entries]) => usdRow(role, entries, grandTotal, modelOf));

  /* By model via the Attempt's worker version; a multi-model Attempt is split by its own `byModel`. */
  const byModel = new Map<string, CostEntry[]>();
  for (const e of input.costs) {
    for (const part of costPortionsByModel(e, modelOf.get(e.attemptId) ?? ATTEMPT_NOT_ON_RECORD)) {
      byModel.set(part.model, [...(byModel.get(part.model) ?? []), part.entry]);
    }
  }
  const costByModel = [...byModel.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([model, entries]) => usdRow(model, entries, grandTotal, modelOf));

  /* ---- cache hit rate: model workers from the cycle metrics; the reader path is a named gap ---- */
  const cacheRows: CacheCallerRow[] = (input.cacheByRole ?? []).map((c) => {
    const denominator = c.cacheRead + c.cacheWrite + c.uncachedInput;
    return {
      callerKey: `${c.role} (control-plane model workers)`,
      hitRate:
        denominator === 0
          ? gap<Measured>("OURS", `${c.attempts} attempt${c.attempts === 1 ? "" : "s"} reported no input tokens.`)
          : held(
              measured(
                c.cacheRead,
                denominator,
                "cache-read input tokens, out of every input token these workers sent (cache reads + cache writes + uncached)",
                "cp_research_state metrics.cacheByRole, computed by the newest cycle from Scout results",
              ),
            ),
      /* Carried from the cycle rather than recomputed, so the two cannot disagree. */
      health: {
        zeroReadTurns: c.repeatedPrefixMisses ?? null,
        turnsExamined: c.repeatedPrefixTurns ?? null,
        stationaryTurns: c.stationaryTurns ?? null,
        measuredRows: c.measuredRows ?? 0,
        predatesFieldRows: c.predatingRows ?? 0,
        providerReportedNothingRows: c.unreportedRows ?? 0,
        batchShare: c.batchShare ?? null,
        savedUsd: c.savedUsd ?? null,
        aggregatePricedRows: c.aggregatePricedRows ?? 0,
      },
    };
  });
  const cacheHitRateByCaller = [
    ...cacheRows,
    {
      callerKey: PROD_ASK_KEY,
      hitRate: gap<Measured>(
        "OURS",
        "the reader Ask path records no cache observation to the control plane yet.",
      ),
    },
  ];

  /* ---- lane share, from the newest cycle ---- */
  const share = input.share?.thisCycle ?? null;
  const deterministicShare: Held<Measured> =
    share === null
      ? gap("OURS", "no cycle has recorded its lane split yet.")
      : share.deterministic + share.model === 0
        ? gap("OURS", "the newest cycle dispatched nothing, so there is no split to show.")
        : held(
            measured(
              share.deterministic,
              share.deterministic + share.model,
              "attempts the deterministic lane dispatched, out of every attempt the newest cycle dispatched (a count share, not a dollar share)",
              "cp_research_state metrics.share.thisCycle",
            ),
          );

  /* ---- cost per verified record ---- */
  const costPerVerifiedRecord: Held<Measured> =
    input.verifiedRecords === null
      ? gap("OURS", "the promotion pipeline could not be read.")
      : grandTotal === null
        ? gap("OURS", "no attempt in the ledger reported a dollar cost.")
        : input.verifiedRecords === 0
          ? gap("OURS", "no record has passed the validation stage yet; a cost over zero records is not a number.")
          : held({
              // Built directly: a ratio is not a count, and measured() would
              // refuse a per-record cost larger than the record count.
              value: round(grandTotal / input.verifiedRecords),
              denominator: input.verifiedRecords,
              contract:
                "measured dollars per record that passed the validation stage (VERIFIED); audit and publication may remain, so this is not cost per verified result delivered to readers",
              denominatorSource: "cp_log_promotion_pipeline via stageCounts().byStage.VERIFIED",
            });

  return {
    costByRole,
    costByModel,
    cacheHitRateByCaller,
    deterministicShare,
    costPerVerifiedRecord,
    summary: {
      measuredUsd: grandTotal === null ? null : round(grandTotal),
      attemptsMeasured: measuredEntries.length,
      attemptsUnmeasured: input.costs.length - measuredEntries.length,
      entries: input.costs.length,
    },
    /* Reuses `scoutCapacity` so every surface agrees on what an Attempt costs. */
    capacity:
      input.nowIso === undefined
        ? null
        : scoutCapacity({
            costs: input.costs,
            nowIso: input.nowIso,
            windowHours: 24,
            ceilingUsd: input.dailyCeilingUsd ?? DEFAULT_DAILY_CEILING_USD,
          }),
    monthlySpend: input.nowIso === undefined ? null : buildMonthlySpend({ costs: input.costs, attempts: input.attempts, nowIso: input.nowIso }),
  };
}

/** "3.2 MB", "412 KB", "9 B". */
export function bytesText(bytes: number): string {
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

/** "2 h 14 min", "38 min", "12 s". */
export function durationText(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s >= 3600) return `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min`;
  if (s >= 60) return `${Math.round(s / 60)} min`;
  return `${s} s`;
}

/**
 * Whether each role can reach a paid model, read from the executor that runs it.
 * `tests/cost-section-adm-c14.test.ts` re-derives this from the cited files.
 */
export type RoleModelAccess = "ROUTED_TO_A_PAID_MODEL" | "NO_MODEL_STEP_ROUTED";

export interface RoleCostPolicy {
  readonly role: WorkerRole;
  readonly access: RoleModelAccess;
  /** The exact file whose declaration decides it. Rendered in the disclosure, never on the face. */
  readonly provenIn: string;
}

export const ROLE_COST_POLICY: Readonly<Record<WorkerRole, RoleCostPolicy>> = {
  SCOUT: {
    role: "SCOUT",
    access: "ROUTED_TO_A_PAID_MODEL",
    provenIn: "lib/control-plane/scheduler/scout-executor.ts — the research loop is a MODEL step and the executor declares the Anthropic provider",
  },
  ADVERSARIAL_AUDITOR: {
    role: "ADVERSARIAL_AUDITOR",
    access: "ROUTED_TO_A_PAID_MODEL",
    provenIn: "lib/control-plane/workers/model-audit.ts — the adversarial audit can use a model after deterministic validation",
  },
  ACQUIRER: {
    role: "ACQUIRER",
    access: "NO_MODEL_STEP_ROUTED",
    provenIn: "lib/control-plane/workers/research-runtime.ts — the executor declares the deterministic lane and no model transport reaches it",
  },
  DETECTIVE: {
    role: "DETECTIVE",
    access: "ROUTED_TO_A_PAID_MODEL",
    provenIn: "lib/control-plane/workers/detective.ts — failure response can use the shared Scout model and source tools after held evidence",
  },
  ENGINEERING: {
    role: "ENGINEERING",
    access: "NO_MODEL_STEP_ROUTED",
    provenIn: "lib/control-plane/workers/research-runtime.ts — no executor runs this role, so no model transport reaches it",
  },
  PARSER: {
    role: "PARSER",
    access: "ROUTED_TO_A_PAID_MODEL",
    provenIn: "lib/control-plane/workers/runtime.ts — usesModelParse selects quote extraction by model when the held document has no parsing rule",
  },
  VALIDATOR: {
    role: "VALIDATOR",
    access: "NO_MODEL_STEP_ROUTED",
    provenIn: "lib/control-plane/workers/runtime.ts — validation runs deterministic checks on the saved source and quoted fields",
  },
  RELEASE_ORCHESTRATOR: {
    role: "RELEASE_ORCHESTRATOR",
    access: "NO_MODEL_STEP_ROUTED",
    provenIn: "lib/control-plane/promotion/fact-chain.ts — the fact approver is declared deterministic and opens no Attempt against a provider",
  },
  DISCOVERY_SEARCH: {
    role: "DISCOVERY_SEARCH",
    access: "NO_MODEL_STEP_ROUTED",
    provenIn: "lib/control-plane/discovery/meetings-discovery-executor.ts — pointer-only search-API requests priced per query (lib/hunt/discovery-search.ts); no model transport is reachable from the executor",
  },
};

/** The policy for a ledger key when the key is a worker role; null for a model key. */
export function roleCostPolicy(key: string): RoleCostPolicy | null {
  return (ROLE_COST_POLICY as Record<string, RoleCostPolicy | undefined>)[key] ?? null;
}

/**
 * Why a cost row's number is what it is. A role that can spend and did not is
 * `$0 this run`, which is not the same as a role that can never spend.
 */
export type CostClass =
  | "PAID_MODEL"
  | "PLAIN_CODE"
  | "ZERO_THIS_RUN"
  | "NOT_MEASURED"
  | "PREDATES_MEASUREMENT";

/** Two of these match `plain-words.ts` lane words exactly ("Paid model", "Plain code"). */
export const COST_CLASS_WORDS: Readonly<Record<CostClass, string>> = {
  PAID_MODEL: "Paid model",
  PLAIN_CODE: "Plain code",
  ZERO_THIS_RUN: "$0 this run",
  NOT_MEASURED: "Not measured",
  PREDATES_MEASUREMENT: "Predates measurement fields",
};

export interface CostClassReading {
  readonly cls: CostClass;
  readonly words: string;
  /** One sentence for the owner, which always says what the class does NOT claim. */
  readonly says: string;
  /** Where the policy behind the class is checkable. Null when the key is a model rather than a role. */
  readonly provenIn: string | null;
}

/** The shape both a live `CostRow` and a published `OwnerCostRow` satisfy. */
export interface CostRowLike {
  readonly key: string;
  readonly usd: Held<Measured>;
  readonly kind?: CostRowKind;
  readonly attemptsMeasured?: number;
  readonly attemptsUnmeasured?: number;
  readonly metering?: MeteringCounts;
}

/** Measured dollars settle the row first; only a key that cannot reach a paid model may read "Plain code". */
export function costClassOf(row: CostRowLike): CostClassReading {
  const policy = roleCostPolicy(row.key);
  const kind = costRowKind(row);
  const usd = row.usd.held ? row.usd.value.value : null;
  const rows = (row.attemptsMeasured ?? 0) + (row.attemptsUnmeasured ?? 0);
  const metering = row.metering;
  const provenIn = policy?.provenIn ?? null;
  const read = (cls: CostClass, says: string): CostClassReading => ({ cls, words: COST_CLASS_WORDS[cls], says, provenIn });

  if (row.key === ATTEMPT_NOT_ON_RECORD) {
    return read(
      "NOT_MEASURED",
      `${rows} ledger row(s) name an Attempt that is not in the attempts list, so what ran is unknown — which is not the same as nothing having run.`,
    );
  }
  /* A key that cannot reach a paid model at all: a role the policy names, or the deterministic model bucket. */
  const canSpend = policy === null ? row.key !== NO_MODEL_KEY : policy.access === "ROUTED_TO_A_PAID_MODEL";

  if (kind === "MEASURED" && usd !== null && usd > 0) {
    return read("PAID_MODEL", `${usdCents(usd)} measured across ${rows} row(s) in the ledger.`);
  }
  if (!canSpend) {
    return read(
      "PLAIN_CODE",
      policy === null
        ? "These rows record work that ran with no model at all, so there is no dollar cost to measure."
        : "Current execution policy routes no model step to this role, so it never makes a paid-model request. Not a reading of these rows: a reading of the code that runs them.",
    );
  }
  if (metering !== undefined && metering.measured === 0 && metering.unreported === 0 && metering.predatesFields > 0) {
    return read(
      "PREDATES_MEASUREMENT",
      `All ${metering.predatesFields} row(s) were written before cache and batch use were recorded, so nothing here is a zero — it is a measurement nobody took.`,
    );
  }
  if (kind === "UNMEASURED") {
    return read("NOT_MEASURED", `${row.usd.held ? "" : row.usd.gap.says} A paid model ran and reported no dollar figure, so this is unmeasured — not zero, and not free.`.trim());
  }
  return read(
    "ZERO_THIS_RUN",
    `This work can run on a paid model and none of these ${rows} row(s) did, so $0.00 is what was recorded — not a claim the role is free.`,
  );
}

/**
 * Spend window rows, rendered by both the console and the runner card. An
 * unmeasured window is never shown as `$0.00`.
 */
export interface SpendWindowRow {
  /** "Current cycle", "Operational night", "Last 24 hours". */
  readonly window: string;
  readonly spentUsd: number | null;
  readonly ceilingUsd: number;
  /** The spend against the ceiling, or the named gap. Always to the cent. */
  readonly shown: string;
  /** True when the figure is a gap rather than a total. */
  readonly unmeasured: boolean;
  /** One sentence defining the window, where the name alone does not. */
  readonly defines: string | null;
}

/** The ceilings, taken structurally so this module never imports the admission controller. */
export interface SpendCeilings {
  /** The one spend ceiling every window is framed against. */
  readonly rolling24HourModelUsd: number;
}

const UNMEASURED_WINDOW = "not measured — a model reply reported no cost, so this window has no total";

export function spendWindowRows(input: {
  readonly cycleUsd: number | null;
  readonly operationalNightUsd: number | null;
  readonly rolling24HourUsd: number | null;
  readonly ceilings: SpendCeilings;
}): readonly SpendWindowRow[] {
  const ceilingUsd = input.ceilings.rolling24HourModelUsd;
  const row = (window: string, spentUsd: number | null, defines: string | null): SpendWindowRow => ({
    window,
    spentUsd,
    ceilingUsd,
    shown: spentUsd === null ? UNMEASURED_WINDOW : usdOf(spentUsd, ceilingUsd),
    unmeasured: spentUsd === null,
    defines,
  });
  return [
    row("Current cycle", input.cycleUsd, "One pass of the runner through the work that is due. No per-cycle spend cap — the rolling daily ceiling is the limit."),
    row(
      "Operational night",
      input.operationalNightUsd,
      "The overnight working window: 6pm to 6am Phoenix time, the stretch in which the runner does paid model work.",
    ),
    row("Last 24 hours", input.rolling24HourUsd, "A sliding day ending now, not a calendar day — the one spend ceiling."),
  ];
}

/** The rolling research ceiling, read from the canonical bounds. */
export const DEFAULT_DAILY_CEILING_USD = RESEARCH_BOUNDS.dailyCeilingUsd;

/** The capacity sentence the cost section leads with. A null mean means no attempt reported a cost, not $0. */
export function capacitySentence(capacity: ScoutCapacity | null): string {
  if (capacity === null) {
    return "How much the daily limit buys is not published on this snapshot yet — the publisher passes no clock, so no window could be dated.";
  }
  if (capacity.meanUsdPerAttempt === null || capacity.attemptsPerDayAtCap === null) {
    return (
      `No hunt in the last ${capacity.windowHours} hours reported what it cost` +
      (capacity.unmeasuredAttempts > 0 ? ` (${capacity.unmeasuredAttempts} ran and reported nothing)` : "") +
      `, so how much the ${usdCents(capacity.ceilingUsd)} daily limit buys is not measured — which is not the same as it buying nothing.`
    );
  }
  return (
    `At the current average cost, the ${usdCents(capacity.ceilingUsd)} daily limit buys about ${capacity.attemptsPerDayAtCap} ` +
    `hunt${capacity.attemptsPerDayAtCap === 1 ? "" : "s"} at roughly ${usdCents(capacity.meanUsdPerAttempt)} each.`
  );
}

/** `0%` model work can mean nothing dispatched, all plain code, or no split recorded; the sentence names which. */
export function shareSentence(share: Held<Measured>): string {
  if (!share.held) return share.gap.says;
  const { value, denominator } = share.value;
  if (denominator === 0) return "0% model work this cycle — nothing was dispatched.";
  const modelJobs = denominator - value;
  if (modelJobs === 0) {
    return `0% model work this cycle — all ${denominator} job${denominator === 1 ? "" : "s"} ran as plain code, with no paid model.`;
  }
  const pct = Math.round((value / denominator) * 100);
  return `${pct}% of this cycle's ${denominator} job${denominator === 1 ? "" : "s"} ran as plain code; ${modelJobs} used a paid model.`;
}

/**
 * The month's billed quantities, as ledger metric keys summed by `sumMetric`.
 * Unmeasured rows are counted out of every dollar figure and reported apart.
 */
export const MONTHLY_TOKEN_METRICS = [
  "requestCount",
  "inputTokens",
  "uncachedInputTokens",
  "cacheCreationInputTokens",
  "cacheCreation5mInputTokens",
  "cacheCreation1hInputTokens",
  "cacheReadInputTokens",
  "outputTokens",
] as const;
export type MonthlyTokenMetric = (typeof MONTHLY_TOKEN_METRICS)[number];

/** Rendered beside the number. */
export const MONTHLY_TOKEN_WORDS: Readonly<Record<MonthlyTokenMetric, string>> = {
  requestCount: "Requests",
  inputTokens: "Input tokens (whole prompt)",
  uncachedInputTokens: "Uncached input (billed at full price)",
  cacheCreationInputTokens: "Written to the cache",
  cacheCreation5mInputTokens: "Written for 5 minutes",
  cacheCreation1hInputTokens: "Written for 1 hour",
  cacheReadInputTokens: "Read from the cache (a tenth of the price)",
  outputTokens: "Output tokens",
};

/** The monthly window resets at 00:00 UTC on the 1st, so its reset is stamped in UTC beside the Eastern stamp. */
export function utcStamp(iso: string): string {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return "an unreadable time";
  const d = new Date(at);
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(d);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${parts}, ${hh}:${mm} UTC`;
}

export interface MonthlyBreakdownRow {
  /** A provider id, a model id or a role code, raw. The face renders it through `modelName`/`roleWords`. */
  readonly key: string;
  readonly usd: number | null;
  readonly measuredRows: number;
  readonly unmeasuredRows: number;
  readonly predatesFieldRows: number;
  /** Measured rows for this key served through the Message Batches API. */
  readonly batchedRows: number;
  /** The billed quantities for this key alone. */
  readonly tokens: Readonly<Record<MonthlyTokenMetric, MeasuredTotal>>;
  /**
   * Cache-read input tokens out of reads + writes + uncached, the same
   * denominator `cacheHitRateByCaller` uses. A gap, never 0%, when the key's
   * rows carried no cache metering.
   */
  readonly cacheHitRate: Held<Measured>;
  /** Cache-read saving at this key's list price. Non-null only when the key is a priced model. */
  readonly cacheSavingUsd: number | null;
}

export interface MonthComparison {
  readonly label: string;
  readonly since: string;
  readonly usd: number | null;
  readonly measuredRows: number;
  readonly rows: number;
  /** False for the month still running: its total is a running total. */
  readonly complete: boolean;
}

export interface MonthlySpendView {
  readonly window: LedgerWindow;
  /** The instant the reading was taken. The window runs from the 1st to here. */
  readonly asOf: string;
  readonly total: MeasuredTotal;
  readonly byProvider: readonly MonthlyBreakdownRow[];
  /**
   * Model charges by model; search charges are excluded. A multi-model charge
   * is a row under each model with that model's part: dollars counted once
   * across rows, row count once per model.
   */
  readonly byModel: readonly MonthlyBreakdownRow[];
  readonly byRole: readonly MonthlyBreakdownRow[];
  /** Search charges by API host. Absent on older snapshots, meaning "not broken down", never none. */
  readonly bySearchSource?: readonly MonthlyBreakdownRow[];
  /** Cache-read saving at `model-cost.ts` list prices. Null when no row measured a cache read on a priced model. */
  readonly cacheSavingUsd: number | null;
  readonly cacheSavingRows: number;
  /** Cache-read input tokens out of every input token, across every model. */
  readonly cacheHitRate: Held<Measured>;
  /** A batched row was charged half, so what it saved equals what it cost. Null when no row was batched. */
  readonly batchSavingUsd: number | null;
  readonly batchRows: number;
  /** Rows carried by no dollar figure above, each named by why. */
  readonly unmeasured: {
    readonly predatesFields: number;
    readonly providerReportedNothing: number;
    readonly noDollarFigure: number;
  };
  /** A metric no row reported is null with its unmeasured count beside it, never zero. */
  readonly tokens: Readonly<Record<MonthlyTokenMetric, MeasuredTotal>>;
  /** Current month first, then as far back as the ledger actually holds rows (up to three). */
  readonly history: readonly MonthComparison[];
  /** The earliest readable stamp in the ledger; null when the ledger is empty. */
  readonly ledgerBeginsAt: string | null;
}

type AttemptRef = { readonly id: string; readonly worker: { readonly version: string; readonly provider: string } };

/** The eight billed quantities over a set of rows, each through the ledger's own `sumMetric`. */
function tokenTotals(rows: readonly CostEntry[]): Readonly<Record<MonthlyTokenMetric, MeasuredTotal>> {
  return Object.fromEntries(MONTHLY_TOKEN_METRICS.map((m) => [m, sumMetric(rows, m)])) as Readonly<Record<MonthlyTokenMetric, MeasuredTotal>>;
}

/** reads / (reads + writes + uncached). A gap, never 0%, when any of the three is unmeasured or no input was sent. */
function hitRateFromTokens(tokens: Readonly<Record<MonthlyTokenMetric, MeasuredTotal>>): Held<Measured> {
  const read = tokens.cacheReadInputTokens.total;
  const write = tokens.cacheCreationInputTokens.total;
  const uncached = tokens.uncachedInputTokens.total;
  if (read === null || write === null || uncached === null) {
    return gap<Measured>("OURS", "these rows carried no cache metering — they predate the fields, or the provider reported none.");
  }
  const denominator = read + write + uncached;
  if (denominator === 0) {
    return gap<Measured>("OURS", "these rows sent no input tokens.");
  }
  return held(
    measured(
      read,
      denominator,
      "cache-read input tokens, out of every input token (cache reads + cache writes + uncached)",
      "cp_log_costs metering, summed over the month's rows for this key",
    ),
  );
}

function breakdown(
  entries: readonly CostEntry[],
  keyOf: (e: CostEntry) => string,
  /** Per-key cache saving, supplied only where the key is itself a priced model. */
  savingFor?: (key: string, tokens: Readonly<Record<MonthlyTokenMetric, MeasuredTotal>>) => number | null,
): readonly MonthlyBreakdownRow[] {
  const grouped = new Map<string, CostEntry[]>();
  for (const e of entries) {
    const key = keyOf(e);
    grouped.set(key, [...(grouped.get(key) ?? []), e]);
  }
  return [...grouped.entries()]
    .map(([key, rows]) => {
      const total = sumMetric(rows, "usd");
      const metering = meteringOf(rows);
      const tokens = tokenTotals(rows);
      return {
        key,
        usd: total.total === null ? null : round(total.total),
        measuredRows: total.measured,
        unmeasuredRows: total.unmeasured,
        predatesFieldRows: metering.predatesFields,
        batchedRows: metering.batched,
        tokens,
        cacheHitRate: hitRateFromTokens(tokens),
        cacheSavingUsd: savingFor ? savingFor(key, tokens) : null,
      };
    })
    .sort((a, b) => (b.usd ?? -1) - (a.usd ?? -1) || a.key.localeCompare(b.key));
}

/** `breakdown` over parts already keyed by model (`costPortionsByModel`): one part of a split charge per model, each counted once. */
function breakdownParts(
  parts: readonly { readonly model: string; readonly entry: CostEntry }[],
  savingFor?: (key: string, tokens: Readonly<Record<MonthlyTokenMetric, MeasuredTotal>>) => number | null,
): readonly MonthlyBreakdownRow[] {
  const keyOf = new Map<CostEntry, string>(parts.map((p) => [p.entry, p.model]));
  return breakdown(parts.map((p) => p.entry), (e) => keyOf.get(e) ?? ATTEMPT_NOT_ON_RECORD, savingFor);
}

/* Search money is not model money: broken down by host on its own and kept out of `byModel`, where a row with no model would read as the cache pre-warm. */
const isSearchCharge = (e: CostEntry): boolean => String(e.role) === DISCOVERY_SEARCH_ROLE;

export function buildMonthlySpend(input: {
  readonly costs: readonly CostEntry[];
  readonly attempts: readonly AttemptRef[];
  readonly nowIso: string;
}): MonthlySpendView {
  const window = utcMonthWindow(input.nowIso);
  const modelOf = new Map(input.attempts.map((a) => [a.id, modelKeyOf(a.worker)]));
  const providerOf = new Map(input.attempts.map((a) => [a.id, a.worker.provider]));
  const rows = entriesInWindow(input.costs, window);
  const total = sumMetric(rows, "usd");

  /* Cache and batch savings, from the rows that actually measured them. */
  let cacheSaving = 0;
  let cacheSavingRows = 0;
  let batchSaving = 0;
  let batchRows = 0;
  let predatesFields = 0;
  let providerReportedNothing = 0;
  for (const e of rows) {
    const metering = cacheMeteringOf(e.cost);
    if (metering.status === "PREDATES_FIELDS") {
      predatesFields += 1;
      continue;
    }
    if (metering.status === "UNREPORTED") {
      providerReportedNothing += 1;
      continue;
    }
    /* Each part of a multi-model charge saved at its own model's cache-read rate. */
    let savedHere: number | null = null;
    for (const part of costPortionsByModel(e, modelOf.get(e.attemptId) ?? NO_MODEL_KEY)) {
      const reads = part.entry.cost.cacheReadInputTokens;
      const saved = part.model === NO_MODEL_KEY || reads === null || reads <= 0 ? null : cacheSavingUsd(reads, part.model);
      if (saved !== null) savedHere = (savedHere ?? 0) + saved;
    }
    if (savedHere !== null) {
      cacheSaving += savedHere;
      cacheSavingRows += 1;
    }
    if (metering.batch) {
      batchRows += 1;
      /* Charged at half, so the amount charged IS the amount saved. */
      if (typeof e.cost.usd === "number" && Number.isFinite(e.cost.usd)) batchSaving += e.cost.usd;
    }
  }

  /* History: this month, then back as far as the ledger holds a readable row. */
  const stamps = input.costs.map((e) => Date.parse(e.recordedAt)).filter((t) => Number.isFinite(t));
  const ledgerBeginsAt = stamps.length === 0 ? null : new Date(Math.min(...stamps)).toISOString();
  const history: MonthComparison[] = [];
  for (let back = 0; back < 3; back += 1) {
    const w = utcMonthWindow(input.nowIso, back);
    if (back > 0 && (ledgerBeginsAt === null || Date.parse(w.until) < Date.parse(ledgerBeginsAt))) break;
    const monthRows = entriesInWindow(input.costs, w);
    const monthTotal = sumMetric(monthRows, "usd");
    history.push({
      label: w.label,
      since: w.since,
      usd: monthTotal.total === null ? null : round(monthTotal.total),
      measuredRows: monthTotal.measured,
      rows: monthRows.length,
      complete: w.complete,
    });
  }

  const monthTokens = tokenTotals(rows);
  return {
    window,
    asOf: input.nowIso,
    total: { ...total, total: total.total === null ? null : round(total.total) },
    byProvider: breakdown(rows, (e) => providerOf.get(e.attemptId) ?? ATTEMPT_NOT_ON_RECORD),
    byModel: breakdownParts(
      rows.filter((e) => !isSearchCharge(e)).flatMap((e) => costPortionsByModel(e, modelOf.get(e.attemptId) ?? ATTEMPT_NOT_ON_RECORD)),
      /* `cacheSavingUsd` returns null for an unpriced or unknown key. */
      (key, tokens) => {
        if (key === ATTEMPT_NOT_ON_RECORD || key === NO_MODEL_KEY) return null;
        const read = tokens.cacheReadInputTokens.total;
        if (read === null || read <= 0) return null;
        const saved = cacheSavingUsd(read, key);
        return saved === null ? null : round(saved);
      },
    ),
    byRole: breakdown(rows, (e) => e.role),
    bySearchSource: breakdown(rows.filter(isSearchCharge), (e) => e.source ?? SEARCH_SOURCE_NOT_ON_RECORD),
    cacheSavingUsd: cacheSavingRows === 0 ? null : round(cacheSaving),
    cacheSavingRows,
    cacheHitRate: hitRateFromTokens(monthTokens),
    batchSavingUsd: batchRows === 0 ? null : round(batchSaving),
    batchRows,
    unmeasured: { predatesFields, providerReportedNothing, noDollarFigure: total.unmeasured },
    tokens: monthTokens,
    history,
    ledgerBeginsAt,
  };
}

/*
 * Whole-ledger spend by state, then jurisdiction. Unmeasured rows are counted
 * out, never as zero; charges whose source names no place go to a named bucket.
 */

/** A charge's source/jurisdiction id parsed to a state and jurisdiction, or null when it names no place. */
function placeIdOf(entry: CostEntry): { readonly state: string; readonly place: string } | null {
  const raw = entry.source ?? entry.jurisdiction;
  if (raw === null) return null;
  const parts = raw.split(":");
    /* Civic id shape: `<st>:<yyyy>:<jurisdiction>:<office>:<subject>`. */
  if (parts.length >= 3 && /^[a-z]{2}$/.test(parts[0]) && /^\d{4}$/.test(parts[1]) && parts[2].length > 0) {
    return { state: parts[0], place: parts[2] };
  }
  return null;
}

/** The jurisdiction segment as words: `state-nh-county-merrimack` under NH reads "county merrimack". */
function placeLabel(state: string, place: string): string {
  const stripped = place.replace(new RegExp(`^state-${state}-`), "");
  const words = stripped.replace(/-/g, " ").trim();
  return words.length > 0 ? words : place;
}

/** The bucket for charges whose source names no place. Named, never folded into a state. */
export const NOT_A_PLACE_KEY = "(not attributed to a place)";

export interface SpendByPlaceRow {
  /** The raw jurisdiction segment, e.g. `state-nh-county-merrimack`. */
  readonly key: string;
  readonly label: string;
  /** Measured dollars, or null when no charge under this place reported one. Never 0-for-unknown. */
  readonly usd: number | null;
  readonly measuredRows: number;
  readonly unmeasuredRows: number;
  readonly attempts: number;
}

export interface SpendByStateRow {
  /** A two-letter state code, or {@link NOT_A_PLACE_KEY}. */
  readonly state: string;
  readonly label: string;
  readonly usd: number | null;
  readonly measuredRows: number;
  readonly unmeasuredRows: number;
  readonly attempts: number;
  /** The jurisdictions under this state, most-spent first. Empty for the overhead bucket. */
  readonly places: readonly SpendByPlaceRow[];
}

export interface SpendByPlaceView {
  /** The whole-ledger total, measured/unmeasured split kept. */
  readonly total: MeasuredTotal;
  /** States most-spent first, then the overhead bucket last. */
  readonly states: readonly SpendByStateRow[];
}

/** Roll the whole cost ledger up by place: state, then jurisdiction. Pure. */
export function buildSpendByPlace(entries: readonly CostEntry[]): SpendByPlaceView {
  const total = sumMetric(entries, "usd");
  const byState = new Map<string, Map<string, CostEntry[]>>();
  const overhead: CostEntry[] = [];
  for (const e of entries) {
    const p = placeIdOf(e);
    if (p === null) {
      overhead.push(e);
      continue;
    }
    const places = byState.get(p.state) ?? new Map<string, CostEntry[]>();
    places.set(p.place, [...(places.get(p.place) ?? []), e]);
    byState.set(p.state, places);
  }

  const stateRow = (
    state: string,
    label: string,
    places: readonly SpendByPlaceRow[],
    rows: readonly CostEntry[],
  ): SpendByStateRow => {
    const t = sumMetric(rows, "usd");
    return {
      state,
      label,
      usd: t.total === null ? null : round(t.total),
      measuredRows: t.measured,
      unmeasuredRows: t.unmeasured,
      attempts: rows.length,
      places,
    };
  };

  const states: SpendByStateRow[] = [...byState.entries()]
    .map(([state, places]) => {
      const placeRows: SpendByPlaceRow[] = [...places.entries()]
        .map(([place, rows]) => {
          const pt = sumMetric(rows, "usd");
          return {
            key: place,
            label: placeLabel(state, place),
            usd: pt.total === null ? null : round(pt.total),
            measuredRows: pt.measured,
            unmeasuredRows: pt.unmeasured,
            attempts: rows.length,
          };
        })
        .sort((a, b) => (b.usd ?? -1) - (a.usd ?? -1) || a.key.localeCompare(b.key));
      const stateEntries = [...places.values()].flat();
      return stateRow(state, state.toUpperCase(), placeRows, stateEntries);
    })
    .sort((a, b) => (b.usd ?? -1) - (a.usd ?? -1) || a.state.localeCompare(b.state));

  if (overhead.length > 0) {
    states.push(stateRow(NOT_A_PLACE_KEY, "Not attributed to a place (pre-warm, bare API calls, misc)", [], overhead));
  }

  return { total: { ...total, total: total.total === null ? null : round(total.total) }, states };
}

/** A by-model key as the owner reads it. */
export function modelLabel(key: string): string {
  return key === ATTEMPT_NOT_ON_RECORD ? "Attempt not on record" : modelName(key);
}

/** Bar class for a worker role; colour is defined in the console stylesheet. */
export function roleBarClass(roleCode: string): string {
  const role = roleCode.replace(/ \(.*\)$/, "").trim();
  return roleCostPolicy(role) === null ? "role-other" : `role-${role.toLowerCase().replace(/_/g, "-")}`;
}

/**
 * Every figure this section renders, as audit rows. The admin page refuses to
 * render if any pushed number lacks a denominator and a contract.
 */
export function costSectionNumbers(input: {
  readonly monthly: MonthlySpendView | null;
  readonly windows: readonly SpendWindowRow[];
  readonly capacity: ScoutCapacity | null;
}): readonly RenderedNumber[] {
  const numbers: RenderedNumber[] = [];
  for (const w of input.windows) {
    if (w.spentUsd === null) continue;
    numbers.push({
      label: `spend window ${w.window}`,
      value: w.spentUsd,
      denominator: w.ceilingUsd,
      contract: `measured model dollars in this window, against the hard ceiling that stops work when it is reached`,
    });
  }
  const m = input.monthly;
  if (m && m.total.total !== null) {
    numbers.push({
      label: `spend this UTC month (${m.window.label})`,
      value: m.total.measured,
      denominator: m.total.measured + m.total.unmeasured,
      contract: `ledger rows recorded since ${m.window.since} that reported a dollar cost, out of every row in the month; the dollar total covers only the rows that reported one`,
    });
  }
  if (input.capacity && input.capacity.attemptsPerDayAtCap !== null) {
    numbers.push({
      label: "hunts the daily limit buys",
      value: input.capacity.measuredAttempts,
      denominator: input.capacity.measuredAttempts + input.capacity.unmeasuredAttempts,
      contract: input.capacity.denominator,
    });
  }
  return numbers;
}
