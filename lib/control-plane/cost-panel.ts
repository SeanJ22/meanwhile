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
import type { CostEntry } from "./cost.ts";
import { gap, held, measured, type Held, type Measured } from "./owner-surface.ts";
import type { CacheHitRate, ShareTrend } from "./research-metrics.ts";

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
}

export interface CostPanel {
  readonly costByRole: readonly CostRow[];
  readonly costByModel: readonly CostRow[];
  readonly cacheHitRateByCaller: readonly { readonly callerKey: string; readonly hitRate: Held<Measured> }[];
  readonly deterministicShare: Held<Measured>;
  readonly costPerVerifiedRecord: Held<Measured>;
  readonly summary: {
    /** Sum of every measured usd in the ledger. Null when nothing was measured. */
    readonly measuredUsd: number | null;
    readonly attemptsMeasured: number;
    readonly attemptsUnmeasured: number;
    readonly entries: number;
  };
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
}

export const NO_MODEL_KEY = "no model (deterministic work)";
export const PROD_ASK_KEY = "prod-ask (reader questions)";
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
    const key = modelOf.get(e.attemptId) ?? "(attempt not on record)";
    byModel.set(key, [...(byModel.get(key) ?? []), e]);
  }
  const costByModel = [...byModel.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([model, entries]) => usdRow(model, entries, grandTotal, modelOf));

  /* ---- cache hit rate: model workers from the cycle metrics; the reader path is a named gap ---- */
  const cacheRows = (input.cacheByRole ?? []).map((c) => {
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
