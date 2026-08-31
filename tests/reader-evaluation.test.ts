/**
 * **THE SEEDED FAILURES FOR THE READER EVALUATOR.** (A.1 WI1–WI3, 2026-08-30.)
 *
 * Each test here is a defect that WAS possible against the Session A harness
 * and is refused by construction now. They are seeded rather than incidental:
 * the point is not that the evaluator works on happy inputs, it is that the
 * specific ways it could be fed a false green are closed.
 *
 * The evaluator is pure over a `RenderedAnswer`, which is what lets every one
 * of these run without a browser. The browser half — that the question is
 * actually typed into `[data-ask-box]` and the answer read out of
 * `[data-ask-grounded]` — is `scripts/ask-harness.mts`, exercised by
 * `pnpm reader:suite` against a local production build.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateAnswer,
  normaliseValue,
  type ReaderExpectation,
} from "../lib/health/ask-evaluation.ts";
import { groundedAnswer as answer } from "./rendered-answer-fixture.ts";


const VALUE_297: ReaderExpectation = {
  kind: "VALUE",
  subject: "the Vail school-board committee filing",
  value: "$297.86",
};

/* ---------------------------------------------------------------------- *
 * THE SEEDED FAILURE THE BRIEF NAMES BY NAME.
 * ---------------------------------------------------------------------- */

test("SEEDED: a page whose body text contains the expected words but whose Ask returns a fallback is RED", () => {
  /*
   * This is the exact defect. The old harness read `document.body.innerText`,
   * so a page rendering "$297.86" anywhere — in a funding card, in an
   * unrelated committee's row — satisfied the check while Ask fell back.
   *
   * The evaluator never sees page text. It sees the ANSWER, and a fallback
   * answer is red no matter what words are elsewhere on the screen. The
   * `answerText` below deliberately CONTAINS the expected value, so a
   * substring test would pass this and the evaluator must not.
   */
  const fallback = answer({
    mode: "NO_EVIDENCE",
    answerText: "We hold Vail, but nothing recorded that answers that. ($297.86 appears on this page.)",
  });
  const result = evaluateAnswer(fallback, VALUE_297);
  assert.equal(result.verdict.kind, "RED");
  assert.equal(result.failureClass, "acquisition");
  assert.match(
    result.verdict.kind === "RED" ? result.verdict.detail : "",
    /not a grounded answer/,
  );
});

test("SEEDED: every non-grounded mode is RED, and each carries its own failure class", () => {
  /* A denylist would let a mode added tomorrow be silently green. This is an
     allowlist, so an UNKNOWN mode is red too — the safe direction. */
  const expected: Record<string, string> = {
    CLARIFY: "identity",
    UNRESOLVED: "identity",
    NO_EVIDENCE: "acquisition",
    REJECTED_FELL_BACK: "validation",
    OFF: "retrieval",
    TRANSPORT_FAILED: "retrieval",
  };
  for (const [mode, failureClass] of Object.entries(expected)) {
    const result = evaluateAnswer(answer({ mode }), VALUE_297);
    assert.equal(result.verdict.kind, "RED", `${mode} must be red`);
    assert.equal(result.failureClass, failureClass, `${mode} class`);
  }
  const unknown = evaluateAnswer(answer({ mode: "SOME_NEW_MODE" }), VALUE_297);
  assert.equal(unknown.verdict.kind, "RED");
  assert.equal(unknown.failureClass, "rendering");
});

test("SEEDED: a grounded answer with no visible source record is RED", () => {
  const unsourced = evaluateAnswer(answer({ sourceCount: 0 }), VALUE_297);
  assert.equal(unsourced.verdict.kind, "RED");
  assert.equal(unsourced.failureClass, "evidence_selection");
  assert.match(
    unsourced.verdict.kind === "RED" ? unsourced.verdict.detail : "",
    /no visible source record/,
  );
});

test("SEEDED: no rendered answer at all is RED as an interaction failure, not a wrong answer", () => {
  const absent = evaluateAnswer(answer({ panelAbsent: true }), VALUE_297);
  assert.equal(absent.verdict.kind, "RED");
  assert.equal(absent.failureClass, "interaction");
});

test("SEEDED: a grounded mode that renders an empty body is RED — the empty-panel defect", () => {
  const empty = evaluateAnswer(answer({ answerText: null, recordTexts: [] }), VALUE_297);
  assert.equal(empty.verdict.kind, "RED");
  assert.equal(empty.failureClass, "rendering");
});

test("SEEDED: a sourced, grounded answer about the WRONG entity is RED", () => {
  const wrongBody: ReaderExpectation = {
    kind: "ENTITY",
    entityId: "wtp-body/vail-usd#governing",
    entityName: "Vail Unified School District Governing Board",
  };
  const result = evaluateAnswer(answer(), wrongBody);
  assert.equal(result.verdict.kind, "RED");
  assert.equal(result.failureClass, "identity");
});

/* ---------------------------------------------------------------------- *
 * VALUES ARE NORMALISED, NOT STRING-MATCHED.
 * ---------------------------------------------------------------------- */

test("a value is matched on its NUMBER, so formatting agrees and magnitude does not", () => {
  assert.equal(normaliseValue("$297.86"), "297.86");
  assert.equal(normaliseValue("297.860"), "297.86");
  assert.equal(normaliseValue("$1,234.50"), "1234.5");
  assert.notEqual(normaliseValue("29786"), normaliseValue("297.86"));

  assert.equal(
    evaluateAnswer(answer({ answerText: "A contribution of 297.86 dollars." }), VALUE_297)
      .verdict.kind,
    "GREEN",
  );
  /* Off by a hundredfold. A looser compare would call this the same fact. */
  assert.equal(
    evaluateAnswer(answer({ answerText: "A contribution of $29,786.00." }), VALUE_297).verdict.kind,
    "RED",
  );
});

test("a shorter number inside a longer one does not satisfy the expectation", () => {
  const expects97: ReaderExpectation = { kind: "VALUE", subject: "x", value: "97.86" };
  /* "297.86" contains "97.86" as a substring. It is a different amount. */
  assert.equal(evaluateAnswer(answer(), expects97).verdict.kind, "RED");
});

/* ---------------------------------------------------------------------- *
 * VERIFIED ABSENCE — the direction where being generous is dangerous.
 * ---------------------------------------------------------------------- */

const ABSENCE: ReaderExpectation = {
  kind: "VERIFIED_ABSENCE",
  authority: "Pima County Elections",
  period: "2026",
};

test("SEEDED: a NAMED GAP about our own records never satisfies a verified absence", () => {
  /*
   * "We haven't recorded this yet" is a fact about US. "None on file with
   * Pima County Elections" is a fact about THEM. The constitution forbids
   * them rendering as one sentence, and the evaluator refuses to accept one
   * as evidence of the other — which is the difference between an honest gap
   * and a false absence.
   */
  const ourGap = answer({
    answerText: null,
    recordTexts: [],
    gapAttributions: ["OURS"],
    gapStatements: ["We haven't recorded any independent-expenditure reports for that race yet."],
  });
  const result = evaluateAnswer(ourGap, ABSENCE);
  assert.equal(result.verdict.kind, "RED");
  assert.equal(result.failureClass, "rendering");
});

test("an absence stated without naming the authority is RED", () => {
  const unattributed = answer({
    answerText: "There are no independent-expenditure reports for that race.",
  });
  const result = evaluateAnswer(unattributed, ABSENCE);
  assert.equal(result.verdict.kind, "RED");
  assert.equal(result.failureClass, "synthesis");
});

test("a sourced absence naming its authority is GREEN", () => {
  const sourced = answer({
    answerText:
      "None on file with Pima County Elections for that race as of August 2026.",
  });
  assert.equal(evaluateAnswer(sourced, ABSENCE).verdict.kind, "GREEN");
});

/* ---------------------------------------------------------------------- *
 * NOT_EVALUABLE IS NOT GREEN.
 * ---------------------------------------------------------------------- */

test("an instance with no stated expectation is NOT_EVALUABLE and carries no failure class", () => {
  const result = evaluateAnswer(answer(), null);
  assert.equal(result.verdict.kind, "NOT_EVALUABLE");
  assert.equal(result.failureClass, null);
});

test("a LIST expectation names every member it did not find", () => {
  const roster: ReaderExpectation = {
    kind: "LIST",
    subject: "the Pima County Board of Supervisors",
    members: ["Rex Scott", "Matt Heinz", "Jennifer Allen", "Steve Christy", "Andres Cano"],
    exhaustive: true,
  };
  const partial = answer({
    answerText: "The board includes Rex Scott and Matt Heinz.",
  });
  const result = evaluateAnswer(partial, roster);
  assert.equal(result.verdict.kind, "RED");
  assert.equal(result.failureClass, "synthesis");
  const detail = result.verdict.kind === "RED" ? result.verdict.detail : "";
  assert.match(detail, /omits 3 of 5/);
  assert.match(detail, /Jennifer Allen/);
});
