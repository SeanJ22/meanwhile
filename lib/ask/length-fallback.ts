import type { AnswerMode } from "./trace.ts";
import type { ValidationVerdict } from "./validate.ts";

/**
 * A model answer rejected only for length falls back down the ordinary
 * ladder: first to prose composed from the same evidence and held to the same
 * validator (`GROUNDED_COMPOSED`), else to the structured records
 * (`STRUCTURED_GROUNDED`, or `NO_EVIDENCE` for an empty pack). Any other
 * failure, alone or beside a length failure, stays `REJECTED_FELL_BACK`.
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
