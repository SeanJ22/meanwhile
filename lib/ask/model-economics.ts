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
 *
 * ## RULING 230 — ONE CANONICAL VERDICT (2026-09-01)
 *
 * ```
 *   SWITCH only if EVERY required challenger question is measured AND holds.
 *   Any required question measured and not held -> HOLD / retain incumbent.
 *   Any required question unmeasured           -> NOT_MEASURED / retain.
 *   NO SECOND FUNCTION MAY EMIT A SwitchVerdict.
 * ```
 *
 * This module used to carry two rules that could disagree — an absolute one
 * and a relative non-regression one — and the 2026-08-31 run record recorded
 * both, so it said `RETAIN` and `SWITCH` in the same file. The absolute rule
 * is now the only verdict; the relative reading survives as
 * `relativeNonRegressionAnalysis`, a diagnostic with its own type.
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
 * The challenger questions that did NOT hold — a question that ran and failed
 * and a question that never ran are both in here, because neither is a hold.
 *
 * Empty means every required question held over the runs supplied, which is a
 * claim about THAT DENOMINATOR and never about the corpus.
 */
export function challengerQuestionsNotHolding(
  challengerRuns: readonly QuestionRun[],
): readonly string[] {
  return challengerRuns.filter((r) => r.held !== true).map((r) => r.questionId);
}

export type SwitchVerdict =
  /** Every required question was measured and every one of them HELD. */
  | { kind: "SWITCH"; to: string; questions: number }
  /** Every required question was measured and at least one did not hold. */
  | { kind: "HOLD"; notHolding: readonly string[] }
  /** At least one required question was never measured. Never a switch. */
  | { kind: "NOT_MEASURED"; unmeasured: readonly string[]; why: string };

/**
 * **RULING 230 — ONE CANONICAL MODEL-SWITCH VERDICT.** (Adopted 2026-09-01.)
 *
 * ```
 *   SWITCH        every required challenger question is MEASURED and HOLDS
 *   HOLD          any required question is measured and does NOT hold
 *   NOT_MEASURED  any required question is unmeasured — retain the incumbent
 * ```
 *
 * **This is the only function in the repository that returns a
 * `SwitchVerdict`**, and that is the point of the ruling rather than a
 * side-effect of it.
 *
 * ## What this supersedes, and why
 *
 * Until 2026-09-01 this function implemented a RELATIVE non-regression rule: a
 * challenger question blocked the switch only where the INCUMBENT held it and
 * the challenger did not, so two arms failing the SAME question read as "no
 * degradation" and derived SWITCH. The owner's criterion — *switch only if
 * every required question holds* — was implemented separately, in
 * `challengerQuestionsNotHolding`, and the run record carried both. On the
 * 2026-08-31 measurement they disagreed: the record says
 * `decision: RETAIN:claude-opus-5`, `ownerCriterionMet: false`, and
 * `verdict.kind: "SWITCH"`, all three at once.
 *
 * A machine-readable verdict that contradicts the human decision in the same
 * artifact is not a represented conflict — it is a record that will be read by
 * whichever field the next reader happens to look at. RULING 230 collapses the
 * two into this one, on the ABSOLUTE rule, for the reason the header above
 * already gives: *correct first, fast second.* A question neither model
 * answers is a real unanswered reader question, and a switch taken while one
 * is open is a switch taken on a comparison that never finished.
 *
 * The relative derivation survives as `relativeNonRegressionAnalysis` below —
 * a DIAGNOSTIC, with its own return type, which cannot be mistaken for or
 * assigned to a switching verdict.
 *
 * ## `NOT_MEASURED` is not a polite `HOLD`
 *
 * They carry different obligations. HOLD means the challenger was tried and
 * lost, and the question is closed until something changes. NOT_MEASURED means
 * the comparison is still owed — the obligation stays live, exactly as a
 * blocked route never closes a record obligation. *Our failure to measure is
 * never evidence about the challenger.*
 *
 * An EMPTY challenger set is NOT_MEASURED and never a vacuous SWITCH: zero
 * questions all holding is the classic vacuous truth and it would read as a
 * clean sweep.
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

  /* THE ABSOLUTE RULE. Not "did the challenger degrade anything the incumbent
     held" — "did EVERY required question hold on the challenger". A question
     both arms fail is counted here, deliberately: it is exactly the case the
     relative rule used to wave through. */
  const notHolding = challengerQuestionsNotHolding(challengerRuns);
  if (notHolding.length > 0) return { kind: "HOLD", notHolding };
  return { kind: "SWITCH", to: ASK_CHALLENGER_MODEL, questions: challengerRuns.length };
}

/* ── the diagnostic that used to be a verdict ────────────────────────────── */

/**
 * The RELATIVE non-regression reading, and it is a DIAGNOSTIC.
 *
 * Its own type, deliberately unassignable to `SwitchVerdict` and carrying no
 * member named SWITCH, HOLD or NOT_MEASURED. It answers one narrow question —
 * *did the challenger lose any question the incumbent won?* — which is useful
 * for attributing a failure to the MODEL rather than to retrieval, and which
 * RULING 230 says may never by itself decide a switch.
 *
 * `bothArmsFailed` is the field the 2026-08-31 run needed and did not have:
 * questions that failed on BOTH arms, which are a claim about the pipeline
 * (there, the ASK-19 length budget) and not about either model.
 */
export interface RelativeNonRegressionAnalysis {
  readonly kind: "NO_DEGRADATION" | "DEGRADED" | "INCOMPLETE";
  /** Held on the incumbent, did not hold on the challenger. */
  readonly degraded: readonly string[];
  /** Did not hold on EITHER arm — not a model result. */
  readonly bothArmsFailed: readonly string[];
  /** Never ran on one arm or the other. */
  readonly unmeasured: readonly string[];
  /** Stated in the type so no caller has to remember it. */
  readonly isNotASwitchVerdict: true;
}

export function relativeNonRegressionAnalysis(
  incumbentRuns: readonly QuestionRun[],
  challengerRuns: readonly QuestionRun[],
): RelativeNonRegressionAnalysis {
  const unmeasured = [
    ...incumbentRuns.filter((r) => r.held === null),
    ...challengerRuns.filter((r) => r.held === null),
  ].map((r) => `${r.questionId}@${r.model}`);

  const incumbentHeld = new Map(incumbentRuns.map((r) => [r.questionId, r.held]));
  const degraded = challengerRuns
    .filter((r) => incumbentHeld.get(r.questionId) === true && r.held !== true)
    .map((r) => r.questionId);
  const bothArmsFailed = challengerRuns
    .filter((r) => incumbentHeld.get(r.questionId) === false && r.held === false)
    .map((r) => r.questionId);

  const kind =
    unmeasured.length > 0 || challengerRuns.length === 0 || incumbentRuns.length === 0
      ? "INCOMPLETE"
      : degraded.length > 0
        ? "DEGRADED"
        : "NO_DEGRADATION";

  return { kind, degraded, bothArmsFailed, unmeasured, isNotASwitchVerdict: true };
}
