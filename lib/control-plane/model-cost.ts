/**
 * **WHAT A MODEL WORKER'S TOKENS COST, AND WHERE THAT NUMBER CAME FROM.**
 * (Owner-authorized model-worker proof, 2026-08-31.)
 *
 * `lib/control-plane/cost.ts` holds the ledger's own invariant — *cost informs
 * SCHEDULING; cost never informs TRUTH* — and this file inherits it entire.
 * Nothing here may answer, or help answer, whether a fact is right.
 *
 * ## The rate is DATA WITH A DATE, not a constant
 *
 * A price is a fact about a vendor's price list on a day, and a price hardcoded
 * with no provenance is indistinguishable from a price somebody remembered.
 * `statedOn` is what makes a later session able to ask whether it is still
 * true, and `source` is where to check.
 *
 * ## And an unmeasured usage is not a free one
 *
 * `usdForUsage` returns **null** when either count is absent. That is the
 * ledger's own rule, quoted from its header: *an unmeasured field is NOT zero.
 * Coercing those nulls to 0 produces a total that LOOKS complete and is not,
 * and a scheduler that believes a run was free will happily schedule a
 * thousand more of them.*
 */

/** The model a bounded worker runs. Stated once; the proof asserts it. */
export const MODEL_WORKER_MODEL = "claude-opus-5";

export interface ModelRate {
  readonly model: string;
  readonly inputUsdPerMillion: number;
  readonly outputUsdPerMillion: number;
  /** The date this rate was read. A price with no date is a price nobody can check. */
  readonly statedOn: string;
  readonly source: string;
}

export const MODEL_WORKER_RATES: ModelRate = {
  model: MODEL_WORKER_MODEL,
  inputUsdPerMillion: 5.0,
  outputUsdPerMillion: 25.0,
  statedOn: "2026-08-31",
  source: "Anthropic first-party API rates, read from the claude-api reference",
};

/**
 * The dollar cost of one run, from the PROVIDER's own token counts.
 *
 * Null when either count is absent — see the header. There is deliberately no
 * default rate and no fallback model: a cost computed at a rate nobody chose
 * is a number that looks measured and is not.
 */
export function usdForUsage(
  inputTokens: number | null,
  outputTokens: number | null,
  rate: ModelRate = MODEL_WORKER_RATES,
): number | null {
  if (inputTokens === null || outputTokens === null) return null;
  return (
    (inputTokens / 1_000_000) * rate.inputUsdPerMillion +
    (outputTokens / 1_000_000) * rate.outputUsdPerMillion
  );
}
