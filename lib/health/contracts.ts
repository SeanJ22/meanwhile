/**
 * THE THREE PILOT CONTRACTS AND THE ROLLUP (Session A, WS-CONTRACT).
 *
 * Machine-readable definitions of READER, TRUTH and FRESHNESS, and the pilot
 * health rollup over them. The states are exactly four, and two of them exist
 * so that honesty has somewhere to stand that is neither green nor failure:
 *
 *   GREEN               the contract's own bar is met on its own denominator.
 *   RED                 the bar is measurably not met.
 *   AWAITING_OWNER_DATA the denominator is empty because the owner has not
 *                       loaded the corpus/answer key. Not green — nothing was
 *                       proven — and not red-as-failure — nothing failed.
 *   NOT_READY           the contract's measuring instrument does not exist
 *                       yet. Stated with the transition rule, never widened
 *                       into a vacuous green.
 *
 * NO CONTRACT MAY CERTIFY ANOTHER. Each reading is a pure function of its own
 * inputs; the rollup takes all three and is green ONLY when all three are —
 * it never averages, and no single contract stands in for pilot health.
 */

import type { ControlScore } from "./control-fact.ts";
import type { EvaluationTarget } from "./reader-question.ts";

export const CONTRACT_STATES = ["GREEN", "RED", "AWAITING_OWNER_DATA", "NOT_READY"] as const;
export type ContractState = (typeof CONTRACT_STATES)[number];

export const CONTRACT_NAMES = ["READER", "TRUTH", "FRESHNESS"] as const;
export type ContractName = (typeof CONTRACT_NAMES)[number];

export interface ContractReading {
  readonly contract: ContractName;
  readonly state: ContractState;
  /** Why the state is what it is, with the denominator in the sentence. */
  readonly reason: string;
}

/* ----------------------------------------------------------------- READER */

export interface ReaderContractInput {
  /** Templates the owner has loaded. Zero means the corpus is not here yet. */
  readonly questionsLoaded: number;
  /** Denominator: active (non-retired, applicable) instances across pilot ZIPs. */
  readonly activeInstances: number;
  readonly evaluatedGreen: number;
  readonly evaluatedRed: number;
  /** Instances with a recorded verdict that is neither green nor red. */
  readonly notEvaluable: number;
  /** Where the last evaluation looked, when one has run. */
  readonly target: EvaluationTarget | null;
  /**
   * **WHY A ZERO DENOMINATOR IS LEGITIMATE, WHEN IT IS.** (A.1 WI5.)
   *
   * A nonempty corpus that produced zero active instances is normally a
   * DEFECT — the generator matched nothing, the registry is empty for these
   * ZIPs, the applicability rule is wrong — and the old contract read it as
   * `0 < 0`, which is false, and returned GREEN.
   *
   * There is exactly one honest way for it to be a real zero: an independent
   * enumeration established that the universe genuinely holds nothing to ask
   * about. That is a claim someone has to make with evidence, so it arrives
   * as a sentence naming the evidence, and `null` — the default — refuses.
   */
  readonly establishedZeroDenominator: string | null;
  /**
   * Why this reading cannot be treated as current, when it cannot: no run
   * record, a stale one, or one tested on a tree the release does not
   * contain. Non-null forces NOT_READY and can never be widened to green.
   */
  readonly notCurrent: string | null;
}

/**
 * READER: green when every active instance evaluates green on the recorded
 * target. An unevaluated or not-evaluable instance is not a green one — the
 * denominator is the ACTIVE set, never the evaluated set.
 */
export function readerContract(input: ReaderContractInput): ContractReading {
  if (input.questionsLoaded === 0) {
    return {
      contract: "READER",
      state: "AWAITING_OWNER_DATA",
      reason: "0 questions loaded — awaiting owner corpus",
    };
  }

  /*
   * THE EVIDENCE MUST BE CURRENT. A green measured against a tree that is not
   * this one is evidence about different code, and an old green is evidence
   * about a different day. Neither is a reading about now, and both used to
   * be indistinguishable from one because there was no run record at all.
   */
  if (input.notCurrent !== null) {
    return {
      contract: "READER",
      state: "NOT_READY",
      reason: input.notCurrent,
    };
  }

  /*
   * THE VACUOUS GREEN, CLOSED. A nonempty corpus with no active instances is
   * a defect unless an independent enumeration says the zero is real. The old
   * arithmetic reached "all 0 active instances evaluated green" through
   * `0 < 0 === false`, which is the shape of every vacuous truth.
   */
  if (input.activeInstances === 0) {
    if (input.establishedZeroDenominator === null) {
      return {
        contract: "READER",
        state: "RED",
        reason:
          `${input.questionsLoaded} question(s) are loaded and 0 instances are active. A ` +
          "corpus that generates nothing to ask is a defect in generation or applicability, " +
          "not a contract that is satisfied — and an empty denominator can never be green " +
          "without independently established evidence that the zero is real.",
      };
    }
    return {
      contract: "READER",
      state: "GREEN",
      reason:
        `0 active instances over ${input.questionsLoaded} loaded question(s), and the zero ` +
        `is independently established: ${input.establishedZeroDenominator}`,
    };
  }

  const evaluated = input.evaluatedGreen + input.evaluatedRed + input.notEvaluable;
  const target = input.target ?? "no recorded target";
  if (input.evaluatedRed > 0) {
    return {
      contract: "READER",
      state: "RED",
      reason:
        `${input.evaluatedRed} of ${input.activeInstances} active instances evaluated red ` +
        `on ${target}`,
    };
  }
  if (input.evaluatedGreen < input.activeInstances) {
    return {
      contract: "READER",
      state: "RED",
      reason:
        `${input.evaluatedGreen} of ${input.activeInstances} active instances evaluated ` +
        `green on ${target} (${input.activeInstances - evaluated} unevaluated, ` +
        `${input.notEvaluable} not evaluable) — an instance without a green verdict is ` +
        "not a green instance",
    };
  }
  return {
    contract: "READER",
    state: "GREEN",
    reason:
      `all ${input.activeInstances} active instances evaluated green on ${target}`,
  };
}

/* ------------------------------------------------------------------ TRUTH */

export interface TruthContractInput {
  /** Loaded ControlFacts, both classes. Zero means no answer key yet. */
  readonly controlsLoaded: number;
  /** The scorer's reading over the last audit, when one has run. */
  readonly score: ControlScore | null;
  /** Why the audit cannot be read as current. Non-null forces NOT_READY. */
  readonly notCurrent: string | null;
}

/**
 * TRUTH: green requires trustworthy readings on BOTH failure directions —
 * a false-absence rate of zero over a nonzero known-present denominator AND a
 * false-presence rate of zero over a nonzero known-absence denominator. With
 * zero controls loaded the state is AWAITING_OWNER_DATA: never green (nothing
 * was measured) and never red-as-failure (nothing failed).
 *
 * Recall below 1 with zero false absences does not itself redden TRUTH: a
 * named gap on a verified-present fact is honest, and closing it is hunt
 * work the READER contract already owns.
 */
export function truthContract(input: TruthContractInput): ContractReading {
  if (input.controlsLoaded === 0) {
    return {
      contract: "TRUTH",
      state: "AWAITING_OWNER_DATA",
      reason: "0 controls loaded — awaiting owner answer key",
    };
  }
  if (input.notCurrent !== null) {
    return { contract: "TRUTH", state: "NOT_READY", reason: input.notCurrent };
  }
  const score = input.score;
  if (score === null) {
    return {
      contract: "TRUTH",
      state: "RED",
      reason: `${input.controlsLoaded} controls loaded and no audit has scored them`,
    };
  }
  if (score.knownPresentCount === 0 || score.knownAbsenceCount === 0) {
    return {
      contract: "TRUTH",
      state: "RED",
      reason:
        `both failure directions need a denominator: ${score.knownPresentCount} ` +
        `known-present and ${score.knownAbsenceCount} known-absence controls — a reading ` +
        "with an empty direction is not trustworthy on that direction",
    };
  }
  if (score.falseAbsences > 0 || score.falsePresences > 0) {
    return {
      contract: "TRUTH",
      state: "RED",
      reason:
        `${score.falseAbsences} false absence(s) of ${score.knownPresentCount} ` +
        `known-present and ${score.falsePresences} false presence(s) of ` +
        `${score.knownAbsenceCount} known-absence`,
    };
  }
  if (score.unobserved > 0) {
    return {
      contract: "TRUTH",
      state: "RED",
      reason:
        `${score.unobserved} loaded control(s) were never observed — an unmeasured ` +
        "control is not a passed one",
    };
  }
  return {
    contract: "TRUTH",
    state: "GREEN",
    reason:
      `0 false absences of ${score.knownPresentCount} known-present, 0 false presences ` +
      `of ${score.knownAbsenceCount} known-absence`,
  };
}

/* -------------------------------------------------------------- FRESHNESS */

/**
 * FRESHNESS: staleness risk against reader-risk tolerance.
 *
 * For Session A this reports NOT_READY, and that is the correct reading, not
 * a placeholder to widen: the runtime freshness scheduler is intentionally
 * not built yet, and the existing GitHub Actions refresh jobs are legacy and
 * non-authoritative — a green computed from them would certify freshness on
 * an instrument this architecture has already ruled out.
 */
export function freshnessContract(): ContractReading {
  return {
    contract: "FRESHNESS",
    state: "NOT_READY",
    reason:
      "the runtime freshness scheduler is a Session B deliverable; this contract " +
      "transitions out of NOT_READY when Session B ships that scheduler as the " +
      "authoritative instrument (the existing GitHub refresh jobs are legacy and " +
      "non-authoritative), at which point staleness risk is computed against " +
      "reader-risk tolerance",
  };
}

/* ----------------------------------------------------------------- rollup */

export interface PilotHealthRollup {
  /** Green ONLY when all three contracts are green. */
  readonly green: boolean;
  /** Every reading, stated individually — the rollup never averages. */
  readonly readings: readonly ContractReading[];
  /** The non-green contracts, by name and state, so the blocker is named. */
  readonly blocking: readonly { readonly contract: ContractName; readonly state: ContractState }[];
}

/**
 * PILOT HEALTH: all three green, or not green — with each blocker named.
 * No contract certifies another; a green TRUTH says nothing about READER,
 * and the rollup logic is exactly the conjunction below.
 */
export function pilotHealth(
  reader: ContractReading,
  truth: ContractReading,
  freshness: ContractReading,
): PilotHealthRollup {
  const readings = [reader, truth, freshness] as const;
  for (const [i, expected] of CONTRACT_NAMES.entries()) {
    if (readings[i].contract !== expected) {
      throw new Error(
        `pilotHealth expects readings in order READER, TRUTH, FRESHNESS; position ${i} ` +
          `carries ${readings[i].contract}`,
      );
    }
  }
  const blocking = readings
    .filter((r) => r.state !== "GREEN")
    .map((r) => ({ contract: r.contract, state: r.state }));
  return { green: blocking.length === 0, readings, blocking };
}
