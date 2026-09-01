/**
 * **ASK MODEL ECONOMICS — the candidates, their published rates, and the rule
 * that decides a switch.** (Session C, lane W6, H2, 2026-08-31.)
 *
 * ## The rule, and why it is written down rather than argued each time
 *
 * ```
 *   SWITCH ONLY IF EVERY QUESTION HOLDS.
 *   ONE MODEL FOR ALL ASK TRAFFIC — never per-caller, never per-question.
 * ```
 *
 * Both halves are load-bearing and neither is about money.
 *
 * The first is the constitution's order of trade applied to a model choice:
 * *correct first, fast second, nothing third.* A cheaper model that degrades
 * ONE of the canonical reader questions is a model that makes this product
 * wrong about a government somewhere, and a saving bought with that is not a
 * saving. So the criterion is affirmative and total — every question holds —
 * and it is deliberately not "the average score is no worse". An average lets
 * a regression on one government be paid for by an improvement on another.
 *
 * The second keeps the answer a reader gets independent of which door they came
 * through. It also happens to be what makes H1's prompt cache work at all:
 * **caches are model-scoped**, so a per-caller model choice would split one
 * warm prefix into several cold ones and forfeit every hit.
 *
 * ## What our failure to measure is NOT
 *
 * The acquisition doctrine's rule transfers exactly: *our failure to retrieve
 * is never the evidence.* An inability to run the comparison is not evidence
 * that a candidate holds, and it is not evidence that it fails either. It
 * leaves the criterion unmet, and an unmet criterion means NO SWITCH — the
 * incumbent stays because nothing displaced it, not because the challenger was
 * tried and lost.
 */

import type { ModelRate } from "../control-plane/model-cost.ts";

import { ASK_SYNTHESIS_MODEL } from "./synthesize.ts";

/**
 * The published first-party rates for the two candidates.
 *
 * A price is DATA WITH A DATE — the shape and the reasoning are inherited from
 * `lib/control-plane/model-cost.ts`, which this deliberately reuses rather than
 * re-deciding. A rate hardcoded with no provenance is indistinguishable from a
 * rate somebody remembered.
 */
export const ASK_MODEL_RATES: Readonly<Record<string, ModelRate>> = {
  "claude-opus-5": {
    model: "claude-opus-5",
    inputUsdPerMillion: 5.0,
    outputUsdPerMillion: 25.0,
    statedOn: "2026-08-31",
    source: "Anthropic first-party API rates, read from the claude-api reference",
  },
  "claude-sonnet-5": {
    model: "claude-sonnet-5",
    inputUsdPerMillion: 2.0,
    outputUsdPerMillion: 10.0,
    statedOn: "2026-08-31",
    source: "Anthropic first-party API rates, read from the claude-api reference",
  },
};

/** The model Ask runs today, read from the code that runs it. */
export const ASK_INCUMBENT_MODEL = ASK_SYNTHESIS_MODEL;

/** The model H2 was asked to evaluate against it. */
export const ASK_CHALLENGER_MODEL = "claude-sonnet-5";

/**
 * How much cheaper the challenger's tokens are, on the published rates alone.
 *
 * **This is a rate ratio and NOT a bill ratio**, and the difference matters
 * enough to name: the actual saving depends on the token mix, and with H1's
 * prompt cache live a large share of Ask input tokens are billed at the cache
 * READ rate (~0.1x) rather than the base rate on both models. A switch decided
 * on this number alone would be sized against a bill the product no longer has.
 */
export function rateRatio(
  incumbent: ModelRate,
  challenger: ModelRate,
): { input: number; output: number } {
  return {
    input: incumbent.inputUsdPerMillion / challenger.inputUsdPerMillion,
    output: incumbent.outputUsdPerMillion / challenger.outputUsdPerMillion,
  };
}

/* ── the comparison, and the verdict it is allowed to reach ──────────────── */

/** One canonical question, run on one model. */
export interface QuestionRun {
  readonly questionId: string;
  readonly model: string;
  /**
   * Did the rendered answer satisfy the question's typed proposition? Null when
   * the question was never actually run — which is NOT a failure and NOT a
   * pass, and the verdict below refuses to treat it as either.
   */
  readonly held: boolean | null;
  readonly ms: number | null;
  readonly usd: number | null;
}

/**
 * **THE OWNER'S CRITERION, ABSOLUTE, AND WHY IT LIVES BESIDE `switchVerdict`
 * RATHER THAN INSIDE IT.** (H2, measured 2026-08-31.)
 *
 * `switchVerdict` below implements a RELATIVE rule — a challenger question
 * blocks the switch only where the incumbent held it and the challenger did
 * not — and it is argued, tested and deliberate: *a question neither model
 * answers is a retrieval gap, and holding the model choice hostage to it would
 * make every future switch impossible for a reason unrelated to the model.*
 *
 * The owner's instruction for this comparison is ABSOLUTE:
 *
 * > Switch only if every required question holds; otherwise retain the
 * > incumbent.
 *
 * On the 2026-08-31 measurement the two rules DISAGREE IN OUTCOME. Two of the
 * four questions that reached the synthesis contract (Q3, Q5) failed on BOTH
 * models, for the same reason on both — the ASK-19 length budget. Nothing
 * degraded, so the relative rule derives SWITCH; nothing like "every question
 * holds" is true, so the absolute rule derives RETAIN.
 *
 * Neither is deleted and neither silently wins. Under RULING 185 the author's
 * current directive is precedence 1 and the prior implementation decision is
 * lower, so the DECISION is taken on this function and the relative derivation
 * is reported beside it as what it is. Representing the conflict is the rule;
 * resolving it by whichever function was called last is what the precedence
 * model exists to forbid.
 *
 * Returns the challenger questions that did NOT hold — empty means the
 * criterion is met over the runs supplied, which is a claim about that
 * denominator and never about the corpus.
 */
export function challengerQuestionsNotHolding(
  challengerRuns: readonly QuestionRun[],
): readonly string[] {
  return challengerRuns.filter((r) => r.held !== true).map((r) => r.questionId);
}

export type SwitchVerdict =
  /** Every question ran and every question held on the challenger. */
  | { kind: "SWITCH"; to: string; questions: number }
  /** At least one question ran and degraded. */
  | { kind: "HOLD"; degraded: readonly string[] }
  /** The comparison did not produce a complete result. Never a switch. */
  | { kind: "NOT_MEASURED"; unmeasured: readonly string[]; why: string };

/**
 * The verdict, DERIVED from the runs. A session does not award itself this.
 *
 * Three outcomes, and `NOT_MEASURED` is a real one rather than a polite way of
 * saying HOLD: they carry different obligations. HOLD means the challenger was
 * tried and lost, and the question is closed until something changes.
 * NOT_MEASURED means the comparison is still owed — the obligation stays live,
 * exactly as a blocked route never closes a record obligation.
 */
export function switchVerdict(
  incumbentRuns: readonly QuestionRun[],
  challengerRuns: readonly QuestionRun[],
  why: string,
): SwitchVerdict {
  const unmeasured = [
    ...incumbentRuns.filter((r) => r.held === null),
    ...challengerRuns.filter((r) => r.held === null),
  ].map((r) => `${r.questionId}@${r.model}`);

  if (unmeasured.length > 0 || challengerRuns.length === 0 || incumbentRuns.length === 0) {
    return { kind: "NOT_MEASURED", unmeasured, why };
  }

  const incumbentHeld = new Map(incumbentRuns.map((r) => [r.questionId, r.held]));
  const degraded = challengerRuns
    .filter((r) => incumbentHeld.get(r.questionId) === true && r.held !== true)
    .map((r) => r.questionId);

  if (degraded.length > 0) return { kind: "HOLD", degraded };
  return { kind: "SWITCH", to: ASK_CHALLENGER_MODEL, questions: challengerRuns.length };
}
