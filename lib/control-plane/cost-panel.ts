/**
 * **THE COST PANEL, WITH NUMBERS IN IT.** (ADM-6, 9.4.26 admin feedback;
 * free-by-design rows and non-dollar measures added for the evening pass,
 * ADM-17.)
 *
 * The owner's words: "there are no numbers next to cost, by caller role, by
 * model, cache hits. None of it really makes sense." The section rendered
 * three headings over empty lists and a paragraph of architecture under each,
 * because the publisher never opened the cost ledger it wrote about.
 *
 * The ledger EXISTS (`cp_log_costs`, one `CostEntry` per Attempt with its
 * role and measured usd), the model per Attempt EXISTS (`cp_attempts`
 * `worker.version`), the cache split for model workers EXISTS on the research
 * state's per-cycle metrics, the lane share EXISTS on the newest run record,
 * and the verified-record count EXISTS in the promotion pipeline. This module
 * joins them into the five panel figures. PURE: records in, `Held<Measured>`
 * rows out, so a test pins every row without a store.
 *
 * ## Free by design is not a gap (ADM-17)
 *
 * The evening pass found 5 of 7 roles reading "not measured", and the owner
 * was surprised only two were measured. The ledger had told the truth badly:
 * a role whose every attempt ran deterministic code has no dollar cost BY
 * DESIGN, and rendering that as a gap invited a hunt for a measurement that
 * does not exist. So a role is now one of three things, decided from the
 * attempts' own worker identity, never assumed:
 *
 *   MEASURED        model attempts reported dollars — a real figure
 *   FREE_BY_DESIGN  every attempt ran without a paid model — $0, measured in
 *                   time, requests and bytes instead, which ARE recorded
 *   UNMEASURED      model attempts exist and reported no dollars — a gap of
 *                   ours, named as such, one short line
 */
import type { WorkerRole } from "./attempt.ts";
import {
  DISCOVERY_SEARCH_ROLE,
  SEARCH_SOURCE_NOT_ON_RECORD,
  cacheMeteringOf,
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
  /** Absent on a snapshot published before ADM-17. */
  readonly kind?: CostRowKind;
  /** The measures a deterministic role does carry. Absent before ADM-17. */
  readonly nonDollar?: NonDollarMeasures;
  /** One plain sentence about the row. Absent before ADM-17. */
  readonly meaning?: string;
  /**
   * How many of the row's entries can say anything about cache and batch use
   * (ADM-C14, 2026-09-06). A row recorded before the metering fields existed
   * reports PREDATES, and §9A.4 forbids rendering that as a zero. Absent on a
   * snapshot published before this field existed, where absent means unknown.
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

/**
 * The cache health beside a caller's hit rate (ADM-C14: *"cache hit / miss
 * health; malformed/unmeasured rows; cache-defect warnings"*). Every field is
 * carried straight from the cycle's own `CacheHitRate` reading; a null is a
 * measurement nobody took, never a zero. Absent on a snapshot published before
 * this field existed.
 */
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
  /**
   * What the daily ceiling buys at the measured mean (§9A.4 capacity). Null
   * when the caller passed no clock — a capacity figure needs a window, and a
   * window needs an instant this module may not read for itself.
   */
  readonly capacity: ScoutCapacity | null;
  /** The UTC calendar month's spend (§9A.23). Null for the same reason. */
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
  /**
   * The instant of the publish, for the two figures that need a window: the
   * capacity reading and the UTC monthly spend. OPTIONAL because this module
   * has never read a clock and a publisher written before §9A.23 does not pass
   * one; both figures are then null and the console says the publisher has not
   * been wired, which is true, rather than showing a total over a window
   * nobody dated.
   */
  readonly nowIso?: string;
  /** The rolling ceiling the capacity sentence is stated against. Defaults to the research daily ceiling. */
  readonly dailyCeilingUsd?: number;
}

export const NO_MODEL_KEY = "no model (deterministic work)";
export const PROD_ASK_KEY = "prod-ask (reader questions)";
/**
 * The by-model key for a ledger row whose Attempt is not in the attempts list.
 * A NAMED join gap: we do not know what ran, and §9A.4 forbids reading that as
 * a role that never spends.
 */
export const ATTEMPT_NOT_ON_RECORD = "(attempt not on record)";
const LEDGER = "cp_log_costs (control-plane cost ledger)";

/** A version string names a model when it is one of the provider's model ids. */
export function modelKeyOf(worker: { readonly version: string; readonly provider: string }): string {
  return /^claude-/i.test(worker.version) || worker.provider === "anthropic" ? worker.version : NO_MODEL_KEY;
}

/**
 * The kind of a published cost row, tolerating a snapshot written before the
 * field existed: the old publisher's gap sentence for a deterministic role
 * said in so many words that the work "runs without a paid model", and that
 * sentence is the fact the kind now names.
 */
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

  /* ---- by model, joined through the Attempt's worker version ---- */
  const byModel = new Map<string, CostEntry[]>();
  for (const e of input.costs) {
    const key = modelOf.get(e.attemptId) ?? ATTEMPT_NOT_ON_RECORD;
    byModel.set(key, [...(byModel.get(key) ?? []), e]);
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
      /*
       * ADM-C14's health columns, carried rather than recomputed: the cycle
       * already read them from the ledger through `cacheHitRateByRole`, and a
       * second derivation here is a second answer waiting to disagree.
       */
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
          ? gap("OURS", "no record has reached VERIFIED yet; a cost over zero records is not a number.")
          : held({
              // Built directly: a ratio is not a count, and measured() would
              // refuse a per-record cost larger than the record count.
              value: round(grandTotal / input.verifiedRecords),
              denominator: input.verifiedRecords,
              contract:
                "measured dollars per record that reached VERIFIED: the value is dollars per record, the denominator is how many records reached VERIFIED",
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
    /*
     * CAPACITY reuses `scoutCapacity` rather than averaging the ledger again
     * here: the digest, the research page and this panel must not be able to
     * disagree about what an Attempt costs (RULING 103).
     */
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

/* ================================================================== *
 * §9A.4 — WHAT A ROLE'S COST IS, AND WHAT THE PAGE MAY CLAIM ABOUT IT
 * ================================================================== */

/**
 * **"FREE BY DESIGN" WAS AN INFERENCE FROM ONE PUBLISH, NOT A POLICY.**
 * (ADM-33 and §9A.4 of the Admin C brief, 2026-09-06.)
 *
 * The console said *"Free by design: Acquirer, Detective, Engineering, Parser,
 * Validator"* and the owner did not believe it of Detective. He was right to
 * doubt the sentence, because it was not making the claim it looked like it was
 * making. {@link costRowKind} decides FREE_BY_DESIGN from the Attempts in ONE
 * publish: a role lands there when no row of its own carried an Anthropic
 * worker identity. That is a statement about those rows — and an Attempt
 * missing from the attempts list falls into the very same branch
 * (`usdRow` reads `modelOf.get(id) ?? NO_MODEL_KEY`), so a join gap reads as
 * evidence of frugality. §9A.4 forbids precisely this: *do not say a role is
 * free by design unless current canonical execution policy proves that role
 * never makes a paid-model request.*
 *
 * ## What the execution policy proves, read on 2026-09-06
 *
 * Model spend in the control plane passes one gate — `assertStepMayInvokeModel`
 * (`scheduler/model-routing.ts`) over a CLOSED step registry — and there are
 * exactly two executors on the other side of it:
 *
 * ```
 *   SCOUT                scheduler/scout-executor.ts: assertStepMayInvokeModel(SCOUT_LOOP_STEP)
 *                        and a declared { provider: "anthropic", version: model }
 *   ADVERSARIAL_AUDITOR  workers/model-audit.ts: assertStepMayInvokeModel("adversarial-audit"),
 *                        reachable only through workers/runtime.ts's `assisted` line,
 *                        which names ADVERSARIAL_AUDITOR and no other role
 * ```
 *
 * Every other role runs through an executor that DECLARES the deterministic
 * lane and `provider: "we-the-people"` before an Attempt is opened, and no
 * model transport is reachable from inside it: PARSER, VALIDATOR and
 * RELEASE_ORCHESTRATOR through `workers/runtime.ts`; ACQUIRER, DETECTIVE and
 * ENGINEERING through `workers/research-runtime.ts`.
 *
 * So this table is a READING OF THE CODE, and each row carries the file that
 * proves it so a later session can check it instead of trusting it.
 * `tests/cost-section-adm-c14.test.ts` re-derives the table from those files
 * and fails the moment a new executor hands a model to a role named here as
 * plain code. That guard is what makes the claim a proof rather than a habit.
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
    provenIn: "lib/control-plane/workers/model-audit.ts — the adversarial audit is a MODEL step; lib/control-plane/workers/runtime.ts routes this role, and only this role, to it",
  },
  ACQUIRER: {
    role: "ACQUIRER",
    access: "NO_MODEL_STEP_ROUTED",
    provenIn: "lib/control-plane/workers/research-runtime.ts — the executor declares the deterministic lane and no model transport reaches it",
  },
  DETECTIVE: {
    role: "DETECTIVE",
    access: "NO_MODEL_STEP_ROUTED",
    provenIn: "lib/control-plane/workers/research-runtime.ts — the executor declares the deterministic lane and no model transport reaches it",
  },
  ENGINEERING: {
    role: "ENGINEERING",
    access: "NO_MODEL_STEP_ROUTED",
    provenIn: "lib/control-plane/workers/research-runtime.ts — the executor declares the deterministic lane and no model transport reaches it",
  },
  PARSER: {
    role: "PARSER",
    access: "NO_MODEL_STEP_ROUTED",
    provenIn: "lib/control-plane/workers/runtime.ts — only the adversarial auditor is model-assisted; every other role takes the deterministic worker identity",
  },
  VALIDATOR: {
    role: "VALIDATOR",
    access: "NO_MODEL_STEP_ROUTED",
    provenIn: "lib/control-plane/workers/runtime.ts — only the adversarial auditor is model-assisted; every other role takes the deterministic worker identity",
  },
  RELEASE_ORCHESTRATOR: {
    role: "RELEASE_ORCHESTRATOR",
    access: "NO_MODEL_STEP_ROUTED",
    provenIn: "lib/control-plane/promotion/fact-chain.ts — the fact approver is declared deterministic and opens no Attempt against a provider",
  },
};

/** The policy for a ledger key when the key is a worker role; null for a model key. */
export function roleCostPolicy(key: string): RoleCostPolicy | null {
  return (ROLE_COST_POLICY as Record<string, RoleCostPolicy | undefined>)[key] ?? null;
}

/**
 * **THE SIX THINGS A COST ROW CAN HONESTLY BE.** (§9A.4, verbatim.)
 *
 * The old trichotomy answered "did dollars arrive?"; these answer the question
 * the owner is actually asking, which is *why is this number what it is*. The
 * distinction that matters most is the one the old wording collapsed: a role
 * that CAN spend and did not spend in these rows is `$0 this run`, and it is
 * not the same statement as a role that could never spend at all.
 *
 * SUBSCRIPTION_JOB is never returned from the API ledger. It exists here so
 * that the one surface naming these classes names all six, and it is assigned
 * only from the Agent Bridge job log — a job that ran on the owner's
 * subscription left no row in this ledger by construction.
 */
export type CostClass =
  | "PAID_MODEL"
  | "PLAIN_CODE"
  | "SUBSCRIPTION_JOB"
  | "ZERO_THIS_RUN"
  | "NOT_MEASURED"
  | "PREDATES_MEASUREMENT";

/**
 * The words for each class. These are the owner's own strings from §9A.4;
 * two of them match `plain-words.ts` exactly (`BOUNDED_MODEL_WORKER` reads
 * "Paid model", `DETERMINISTIC` reads "Plain code"), which is the point — the
 * lane a worker ran in and the cost class it produces say the same word.
 */
export const COST_CLASS_WORDS: Readonly<Record<CostClass, string>> = {
  PAID_MODEL: "Paid model",
  PLAIN_CODE: "Plain code",
  SUBSCRIPTION_JOB: "Subscription job",
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

/**
 * Classify one published cost row under §9A.4.
 *
 * The order is deliberate. Measured dollars settle the row first, because a
 * row that spent money is a paid-model row whatever else is true of it. Then
 * comes the only policy question — CAN this key reach a paid model — and only
 * a key that cannot is allowed to read "Plain code". A key that can, and shows
 * nothing, reads `$0 this run` and says so in as many words; that is the exact
 * sentence ADM-33 was asking for.
 */
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

/* ================================================================== *
 * ADM-26 / §9A.4 — THE SPEND WINDOWS AS A TABLE, TO THE CENT
 * ================================================================== */

/**
 * **ONE IMPLEMENTATION OF THE WINDOW TABLE, RENDERED IN TWO PLACES.**
 * (ADM-26, 2026-09-06.)
 *
 * The console used to state the three ceilings as one run-on sentence with
 * four-decimal dollars in it. §9A.4 replaces it with a `| Window | Spend |`
 * table, and the runner card shows the same three figures — so the rows are
 * built here, once, and both surfaces render the same array. Two surfaces
 * computing the same three sentences is exactly the drift RULING 103 forbids.
 *
 * A window whose spend could not be measured is NOT rendered as `$0.00`: the
 * admission controller returns null for a window containing an Attempt that
 * reported no cost, and a zero there would say the runner spent nothing when
 * what happened is that nobody can tell.
 */
export interface SpendWindowRow {
  /** "Current cycle", "Operational night", "Last 24 hours". */
  readonly window: string;
  readonly spentUsd: number | null;
  readonly ceilingUsd: number;
  /** `$0.44 of $25.00`, or the named gap. Always to the cent. */
  readonly shown: string;
  /** True when the figure is a gap rather than a total. */
  readonly unmeasured: boolean;
  /** One sentence defining the window, where the name alone does not. */
  readonly defines: string | null;
}

/** The ceilings, taken structurally so this module never imports the admission controller. */
export interface SpendCeilings {
  /**
   * The one spend ceiling. Every spend window is framed against it now that the
   * per-cycle and operational-night model-spend caps are retired — a number
   * still gets a denominator (RULING: no bare number), and that denominator is
   * the only limit that stands.
   */
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

/* ================================================================== *
 * §9A.4 — CAPACITY, AND A ZERO THAT SAYS WHY
 * ================================================================== */

/** The rolling research ceiling, read from the canonical bounds rather than restated as a second 25. */
export const DEFAULT_DAILY_CEILING_USD = RESEARCH_BOUNDS.dailyCeilingUsd;

/**
 * **THE SENTENCE THE COST SECTION LEADS WITH.** (§9A.4.)
 *
 * *"At the current average cost, the $25 daily limit buys about 79 Scout
 * attempts at roughly $0.31 each."* Every number in it comes from
 * {@link scoutCapacity} over the ledger — the same reading the research digest
 * and the research page print, so three surfaces cannot disagree about what an
 * attempt costs. A ceiling nobody can divide by is stated as such: a mean of
 * null means no attempt in the window reported a cost, which is not $0.
 */
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

/**
 * **A ZERO SAYS WHY.** (ADM-47.)
 *
 * `0%` on the model/deterministic split is one of three different facts and
 * the ring drew all three the same: nothing was dispatched at all; things were
 * dispatched and every one of them was plain code; or no cycle has recorded a
 * split. The first two are good news and the third is a gap, so the sentence
 * beside the ring names which one it is.
 */
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

/* ================================================================== *
 * §9A.23 — THE MONTHLY UTC SPEND WINDOW
 * ================================================================== */

/**
 * **THE OWNER'S FUNDS RESET ON THE FIRST OF THE MONTH, UTC.** (§9A.23.)
 *
 * Nothing in the control plane had ever computed a calendar month. The three
 * enforced windows are a per-cycle counter, a Phoenix operational night and a
 * SLIDING 24 hours; the console's spend bars bucket by Eastern day; the
 * politeness ledger rolls over at UTC midnight but counts REQUESTS, not
 * dollars. So the window is new ({@link utcMonthWindow}) and the arithmetic
 * over it is the ledger's own {@link sumMetric} — a second cost calculator is
 * exactly what ADM-C14 forbids.
 *
 * Rows that measured nothing are counted OUT of every dollar figure and
 * reported separately, split by what they can and cannot say: a row written
 * before the metering fields existed, a row whose provider reported no usage,
 * and a row that reported usage but no dollars are three different facts and
 * none of them is zero.
 */
/**
 * The billed quantities ADM-C14 names, in the order it names them. These are
 * ledger metric keys, so the totals come from `sumMetric` and nothing here
 * re-derives a token count.
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

/** What each billed quantity is, in the owner's words. Rendered beside the number. */
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

/**
 * **THE ONE STAMP ON THIS CONSOLE THAT IS NOT EASTERN, AND WHY.**
 *
 * Every timestamp the owner reads is Eastern (`eastern-time.ts`), and this is
 * the single exception the brief requires: §9A.23 defines the window as
 * *00:00 UTC on the 1st* and asks for `Resets <date/time UTC>`, because the
 * boundary is a fact about the provider's clock rather than about his day.
 * Rendering that instant only as "September 30, 8:00 PM" would make a UTC rule
 * look like an Eastern one, so the section prints BOTH: this stamp, and the
 * Eastern one beside it. Neither replaces the other.
 */
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
  /** A provider id, a model id or a role code — RAW. The face renders it through `modelName`/`roleWords`. */
  readonly key: string;
  readonly usd: number | null;
  readonly measuredRows: number;
  readonly unmeasuredRows: number;
  readonly predatesFieldRows: number;
  /** Measured rows for this key served through the Message Batches API. */
  readonly batchedRows: number;
  /**
   * The billed quantities for this key alone (ADM-C14 asks for them BY
   * provider/model, not only in aggregate: a hit rate that looks healthy
   * across the month can hide one model re-sending its whole prompt).
   */
  readonly tokens: Readonly<Record<MonthlyTokenMetric, MeasuredTotal>>;
  /**
   * Cache hit rate for this key alone: cache-read input tokens out of every
   * input token it sent (reads + writes + uncached), the SAME denominator
   * `cacheHitRateByCaller` uses. Carried, not recomputed in the render — a
   * second derivation is a second answer waiting to disagree. A gap (never a
   * 0%) when the key's rows carried no cache metering, so a model that predates
   * the fields does not read as a cache miss.
   */
  readonly cacheHitRate: Held<Measured>;
  /**
   * What this key's cache reads saved against sending the same tokens uncached
   * at list price (`cacheSavingUsd` in model-cost.ts). Non-null only where the
   * key is itself a priced model — a per-model saving needs a model's rate, so
   * it is null on the by-provider and by-role groupings and on any key with no
   * priced cache read. The month's aggregate saving stays `cacheSavingUsd` on
   * the view.
   */
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
  /** Model charges by model. Search charges (`DISCOVERY_SEARCH`) are not model charges and are not here. */
  readonly byModel: readonly MonthlyBreakdownRow[];
  readonly byRole: readonly MonthlyBreakdownRow[];
  /**
   * Search charges by API host. Absent from snapshots published before
   * 2026-09-23 — a reader treats absence as "not broken down", never as none.
   */
  readonly bySearchSource?: readonly MonthlyBreakdownRow[];
  /**
   * What cache reads saved against sending the same tokens uncached, at the
   * list prices in `model-cost.ts`. A counterfactual, stated as one; null when
   * no row in the window carried a measured cache read on a priced model.
   */
  readonly cacheSavingUsd: number | null;
  readonly cacheSavingRows: number;
  /**
   * The month's cache hit rate across every model: cache-read input tokens out
   * of every input token (reads + writes + uncached). The "All models" figure
   * beside the per-model column, carried rather than recomputed in the render.
   */
  readonly cacheHitRate: Held<Measured>;
  /**
   * What the Batches API's 50% saved. A batched row was charged half, so what
   * it saved equals what it cost. Null when no row went through batching.
   */
  readonly batchSavingUsd: number | null;
  readonly batchRows: number;
  /** Rows carried by no dollar figure above, each named by why. */
  readonly unmeasured: {
    readonly predatesFields: number;
    readonly providerReportedNothing: number;
    readonly noDollarFigure: number;
  };
  /**
   * The billed quantities behind the dollars (ADM-C14: request count, input,
   * uncached input, cache create with its 5m/1h split, cache read, output).
   * Each is a `MeasuredTotal`, so a metric no row reported is null with its
   * unmeasured count beside it rather than a zero.
   */
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

/**
 * Cache hit rate from a token breakdown: reads / (reads + writes + uncached) —
 * the same denominator `cacheHitRateByCaller` states, so the two never
 * disagree. A gap (never a 0%) when any of the three is unmeasured, so a group
 * that predates the cache fields reads as our named gap rather than a cache
 * miss; and a gap when the group sent no input at all.
 */
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
    const model = modelOf.get(e.attemptId) ?? NO_MODEL_KEY;
    const saved = model === NO_MODEL_KEY ? null : cacheSavingUsd(metering.cacheReadInputTokens, model);
    if (saved !== null && metering.cacheReadInputTokens > 0) {
      cacheSaving += saved;
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
    /* A month entirely before the ledger's first row is not history that exists to compare against. */
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
    byModel: breakdown(
      rows.filter((e) => !isSearchCharge(e)),
      (e) => modelOf.get(e.attemptId) ?? ATTEMPT_NOT_ON_RECORD,
      /* Per-model saving needs the model's own list price; `cacheSavingUsd`
         returns null for an unpriced or unknown key, so a stray non-model key
         yields null rather than a wrong number. */
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

/* ================================================================== *
 * SPEND BY PLACE — "WHAT DID WE SPEND AT PIMA COUNTY?" (MW-013)
 *
 * The section already answers by role and by model. It could not answer the
 * owner's own question — what a given government or place cost — because the
 * ledger keys spend to a source/jurisdiction id, not to a place the owner
 * names. This rolls those ids up: state, then the jurisdictions under it, over
 * the WHOLE ledger (the cumulative "what have we ever spent here"; the month
 * has its own panel). Same honesty as every other total here: an unmeasured
 * row is counted out, never as a zero, and a charge whose source names no
 * place (a scout pre-warm, a bare api.anthropic.com call) lands in a named
 * bucket rather than being dropped or hidden inside a state.
 * ================================================================== */

/** A charge's source/jurisdiction id parsed to a state and the jurisdiction under it, or null when it names no place. */
function placeIdOf(entry: CostEntry): { readonly state: string; readonly place: string } | null {
  const raw = entry.source ?? entry.jurisdiction;
  if (raw === null) return null;
  const parts = raw.split(":");
  /* The civic id shape is `<st>:<yyyy>:<jurisdiction>:<office>:<subject>`; anything else is overhead, not a place. */
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

/**
 * Roll the whole cost ledger up by place: state, then jurisdiction. PURE.
 *
 * Whole-ledger on purpose — the by-role and by-model tables beside it are
 * whole-ledger too, and "what have we spent at this county" is a cumulative
 * question, not a this-month one. Every dollar is `round`ed to the cent and
 * every bucket keeps its measured/unmeasured counts, so a place all of whose
 * charges were deterministic shows $0.00 with its attempt count rather than
 * vanishing.
 */
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

/**
 * A by-model key as the owner reads it (ADM-33). `modelName` handles the model
 * ids and the deterministic bucket; the join gap is named here because it is a
 * cost-panel key rather than a model, and `plain-words.ts` is the dictionary
 * for constants, not for this module's own row labels.
 */
export function modelLabel(key: string): string {
  return key === ATTEMPT_NOT_ON_RECORD ? "Attempt not on record" : modelName(key);
}

/* ================================================================== *
 * ADM-C14 — SUBSCRIPTION JOBS, SHOWN APART FROM API SPEND
 * ================================================================== */

/**
 * **A SUBSCRIPTION JOB IS NOT A CHEAP API CALL, AND THE PAGE MAY NOT IMPLY IT
 * IS.** (ADM-C14: *"Do not pretend subscription jobs are free API calls or
 * vice versa."*)
 *
 * Work the owner runs on his Claude subscription leaves NO row in
 * `cp_log_costs` — the ledger records what the API metered, and a subscription
 * job never touched the API. Showing those jobs inside the API totals would
 * inflate them; leaving them out silently would let the console report a
 * quiet night that was in fact a busy one.
 *
 * So the section renders a separate block over the Agent Bridge job log, and
 * this is the projection it reads. The LOG ITSELF IS NOT BUILT HERE — it is
 * being added by the repository lane, and until it exists the reading is
 * `NOT_WIRED`, which the page states in those words. `EMPTY` and `NOT_WIRED`
 * are different facts and are never collapsed: one says no job ran, the other
 * says nobody is writing them down.
 */
export interface SubscriptionJobRow {
  /** What the job was, in ordinary words. Never a command line. */
  readonly what: string;
  /** ISO. Rendered Eastern by the section. */
  readonly at: string;
  /** How it ended, as the log recorded it. */
  readonly outcome: string;
}

export type SubscriptionJobsReading =
  | { readonly state: "NOT_WIRED"; readonly says: string }
  | { readonly state: "EMPTY"; readonly says: string }
  | { readonly state: "HELD"; readonly says: string; readonly jobs: readonly SubscriptionJobRow[] };

const OUTSIDE_THE_API_LEDGER =
  "These ran on a subscription and are outside the API ledger, so none of their work appears in any dollar figure above.";

/** Turn whatever the Agent Bridge log yielded into one of three honest readings. */
export function subscriptionJobsReading(jobs: readonly SubscriptionJobRow[] | null): SubscriptionJobsReading {
  if (jobs === null) {
    return {
      state: "NOT_WIRED",
      says:
        "Subscription work is not being recorded yet: there is no Agent Bridge job log to read. That is a missing recording path, not a finding that no subscription job has run.",
    };
  }
  if (jobs.length === 0) {
    return { state: "EMPTY", says: `The Agent Bridge job log is readable and holds no job. ${OUTSIDE_THE_API_LEDGER}` };
  }
  return { state: "HELD", says: OUTSIDE_THE_API_LEDGER, jobs };
}

/* ================================================================== *
 * ADM-36 — RESTRAINED SEMANTIC COLOUR, AS CLASS NAMES ONLY
 * ================================================================== */

/**
 * The bar class for a worker role (ADM-36). Colour is carried by the class and
 * defined in the console stylesheet, which this lane does not write: the
 * required declarations are reported to the integrator instead. A role with no
 * class falls back to the neutral lit bar, which is the current appearance.
 */
export function roleBarClass(roleCode: string): string {
  const role = roleCode.replace(/ \(.*\)$/, "").trim();
  return roleCostPolicy(role) === null ? "role-other" : `role-${role.toLowerCase().replace(/_/g, "-")}`;
}

/* ================================================================== *
 * THE PAGE'S OWN NUMBER AUDIT
 * ================================================================== */

/**
 * Every figure this section renders, as audit rows.
 *
 * `app/(admin)/admin/page.tsx` refuses to render the whole console if any
 * number it pushed lacks a denominator and a contract, and a section that
 * draws its numbers outside that list is a section outside the guarantee. This
 * lives in the `.ts` module rather than the component so a test can read it
 * without importing a `.tsx`.
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
