import type { AnswerMode } from "./trace.ts";
import type { ValidationVerdict } from "./validate.ts";

/**
 * **AN ANSWER THAT IS ONLY TOO LONG IS NOT A WRONG ANSWER.** (2026-09-25, R13.)
 *
 * The length contract (`lib/ask/length-contract.ts`, 700 characters, five
 * sentences) rejects rather than truncates, and that stays: half a sentence
 * about a government is a claim nobody made. But a model answer rejected ONLY
 * for length used to end exactly like one that invented a source or named the
 * wrong government — `REJECTED_FELL_BACK`, no prose, the mode that says the
 * prose failed on substance. A 726-character answer that passed every other
 * check was reported to the measurement as a grounding failure.
 *
 * So a length-only rejection falls back down the ordinary ladder instead:
 * first to prose code composes from the same structured evidence (a topic
 * timeline — `composeTopicAnswer` / `composeAreaTopicAnswer`, written inside
 * the budget and held to the same validator), reported `GROUNDED_COMPOSED`;
 * otherwise to the structured records the reader sees anyway, reported as
 * what they are (`STRUCTURED_GROUNDED`, or `NO_EVIDENCE` for an empty pack).
 * Any other failure — alone or beside a length failure — stays
 * `REJECTED_FELL_BACK`: a URL that is not in the pack is never excused by the
 * answer also being long.
 */
export function lengthOnlyRejection(verdict: ValidationVerdict): boolean {
  return verdict.kind === "FAILED" &&
    verdict.failed.length > 0 &&
    verdict.failed.every((reason) => reason.startsWith("too-long:"));
}

export interface RejectedModelAnswerSettlement {
  readonly mode: AnswerMode;
  /** The prose the reader receives: the composed fallback, or none. */
  readonly answer: string | null;
  /** The composed fallback's own verdict, when one was composed. */
  readonly composedVerdict: ValidationVerdict | null;
}

export function settleRejectedModelAnswer(input: {
  readonly verdict: Extract<ValidationVerdict, { kind: "FAILED" }>;
  /** Prose code composes from the same evidence, or null where none can be. */
  readonly composeFallback: () => { answer: string; citedUrls: string[] } | null;
  /** The same validator the model answer faced. */
  readonly validate: (answer: string, citedUrls: readonly string[]) => ValidationVerdict;
  /** What the records alone are: STRUCTURED_GROUNDED, or NO_EVIDENCE for an empty pack. */
  readonly structuredMode: AnswerMode;
}): RejectedModelAnswerSettlement {
  if (!lengthOnlyRejection(input.verdict)) {
    return { mode: "REJECTED_FELL_BACK", answer: null, composedVerdict: null };
  }
  const composed = input.composeFallback();
  if (composed) {
    const composedVerdict = input.validate(composed.answer, composed.citedUrls);
    if (composedVerdict.kind === "PASSED") {
      return { mode: "GROUNDED_COMPOSED", answer: composed.answer, composedVerdict };
    }
    return { mode: input.structuredMode, answer: null, composedVerdict };
  }
  return { mode: input.structuredMode, answer: null, composedVerdict: null };
}
