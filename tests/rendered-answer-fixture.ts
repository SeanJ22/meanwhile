/**
 * **ONE GROUNDED ANSWER, SHARED BY EVERY TEST THAT VARIES ONE THING OFF IT.**
 * (Session B, WI1.)
 *
 * `reader-evaluation.test.ts` (A.1) and `instrument-hardening.test.ts`
 * (Session B) each need the same baseline: a grounded, sourced answer about
 * Pima, so a test can change exactly one field and assert what that change
 * does. Two copies of it is what `pnpm dupes` named, and RULING 103 is right
 * to name it — a baseline that drifts between two files makes two tests that
 * look comparable and are not.
 *
 * It is a `.ts` rather than a `.test.ts` deliberately: the test runner globs
 * test files, and a fixture that registered zero tests would be counted as a
 * file that ran and found nothing.
 */

import type { RenderedAnswer } from "../lib/health/ask-evaluation.ts";

/**
 * A grounded, sourced answer bound to the Pima County Board of Supervisors.
 *
 * Every clause of the reader contract holds on it, so any test that overrides
 * one field is testing exactly that field.
 */
export function groundedAnswer(over: Partial<RenderedAnswer> = {}): RenderedAnswer {
  return {
    mode: "GROUNDED_CLAUDE",
    subjectId: "wtp-body/pima#governing",
    subjectName: "Pima County Board of Supervisors",
    answerText: "The board reported a $297.86 contribution dated February 27, 2025.",
    recordTexts: [],
    gapAttributions: [],
    gapStatements: [],
    sourceCount: 1,
    panelAbsent: false,
    ...over,
  };
}
