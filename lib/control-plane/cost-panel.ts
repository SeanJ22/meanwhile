/**
 * **THE COST PANEL, WITH NUMBERS IN IT.** (ADM-6, 9.4.26 admin feedback.)
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
 * Where a figure is genuinely not measured, the row is a short named gap —
 * one line, whose gap it is — not a paragraph. The section is for reading
 * costs, not for reading about why costs cannot be read.
 */
import type { CostEntry } from "./cost.ts";
import { gap, held, measured, type Held, type Measured } from "./owner-surface.ts";
import type { CacheHitRate, ShareTrend } from "./research-metrics.ts";

export interface CostRow {
  readonly key: string;
  readonly usd: Held<Measured>;
  /** Attempts whose usd was reported / not reported. Never coerced to zero. */
  readonly attemptsMeasured: number;
  readonly attemptsUnmeasured: number;
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

function usdRow(
  key: string,
  entries: readonly CostEntry[],
  grandTotal: number | null,
): CostRow {
  const measuredCount = entries.filter((e) => typeof e.cost.usd === "number").length;
  const unmeasuredCount = entries.length - measuredCount;
  const total = measuredCount === 0 ? null : entries.reduce((n, e) => n + (e.cost.usd ?? 0), 0);
  if (total === null || grandTotal === null) {
    return {
      key,
      usd: gap(
        "OURS",
        `not measured — ${entries.length} attempt${entries.length === 1 ? "" : "s"}, none reported a dollar cost (this work runs without a paid model).`,
      ),
      attemptsMeasured: measuredCount,
      attemptsUnmeasured: unmeasuredCount,
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
  };
}

function round(usd: number): number {
  return Math.round(usd * 10_000) / 10_000;
}

export function buildCostPanel(input: CostPanelInput): CostPanel {
  const measuredEntries = input.costs.filter((e) => typeof e.cost.usd === "number");
  const grandTotal = measuredEntries.length === 0 ? null : measuredEntries.reduce((n, e) => n + (e.cost.usd ?? 0), 0);

  /* ---- by role, from the ledger's own role field ---- */
  const byRole = new Map<string, CostEntry[]>();
  for (const e of input.costs) byRole.set(e.role, [...(byRole.get(e.role) ?? []), e]);
  const costByRole = [...byRole.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([role, entries]) => usdRow(role, entries, grandTotal));

  /* ---- by model, joined through the Attempt's worker version ---- */
  const modelOf = new Map(input.attempts.map((a) => [a.id, modelKeyOf(a.worker)]));
  const byModel = new Map<string, CostEntry[]>();
  for (const e of input.costs) {
    const key = modelOf.get(e.attemptId) ?? "(attempt not on record)";
    byModel.set(key, [...(byModel.get(key) ?? []), e]);
  }
  const costByModel = [...byModel.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([model, entries]) => usdRow(model, entries, grandTotal));

  /* ---- cache hit rate: model workers from the cycle metrics; the reader path is a named gap ---- */
  const cacheRows = (input.cacheByRole ?? []).map((c) => {
    const denominator = c.cacheRead + c.cacheWrite + c.uncachedInput;
    return {
      callerKey: `${c.role} (control-plane model workers)`,
      hitRate:
        denominator === 0
          ? gap<Measured>("OURS", `not measured — ${c.attempts} attempt${c.attempts === 1 ? "" : "s"} reported no input tokens.`)
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
        "not measured yet — the reader Ask path records no cache observation to the control plane.",
      ),
    },
  ];

  /* ---- lane share, from the newest cycle ---- */
  const share = input.share?.thisCycle ?? null;
  const deterministicShare: Held<Measured> =
    share === null
      ? gap("OURS", "not measured yet — no cycle has recorded its lane split.")
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
      ? gap("OURS", "not measured yet — the promotion pipeline could not be read.")
      : grandTotal === null
        ? gap("OURS", "not measured — no attempt in the ledger reported a dollar cost.")
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
