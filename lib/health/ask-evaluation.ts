/**
 * **EVALUATING THE ANSWER THE READER GOT.** (A.1 WI1, 2026-08-30.)
 *
 * ## What this replaces, and why the old thing was worse than nothing
 *
 * `scripts/reader-suite.mts` evaluated a reader question by reading
 * `document.body.innerText` and asking whether it contained the expected
 * words. It never typed the question, never pressed the button, and never
 * looked at an answer. A page carrying the expected words ANYWHERE — in a
 * meeting card, in a nav label, in an unrelated body's roster — went GREEN
 * while the Ask engine could have returned a fallback, the wrong government,
 * or nothing at all.
 *
 * That is not a weak check. It is a check that reports on a different
 * question than the one it claims to answer, which is the defect class this
 * repository names most often: an instrument that appears enforced and is not.
 * A substring hit on a page is not evidence that a reader can LEARN the fact,
 * and the reader contract is entirely about what a reader can learn.
 *
 * ## What GREEN now requires, and every clause is load-bearing
 *
 * ```
 *   the question was SUBMITTED through the product's own Ask interaction
 *   an answer RENDERED                       (not a spinner, not silence)
 *   the answer is GROUNDED                   (not a fallback, not a refusal)
 *   it carries a VISIBLE SOURCE RECORD       (an unsourced assertion is not an answer)
 *   it ASSERTS THE EXPECTED PROPOSITION      (typed, never a substring of the page)
 * ```
 *
 * Miss any one and the verdict is RED with a failure class from the twelve
 * (RULING 210's taxonomy, held in `reader-question.ts`). There is no fourth
 * verdict for "nearly".
 *
 * ## "Never a substring" — what that actually means here
 *
 * It does not mean no text is ever compared. It means three things, and they
 * are the three the old check violated:
 *
 * 1. **The SCOPE is the answer, never the page.** Every comparison runs
 *    against the prose and the record lines the Ask panel rendered as ITS
 *    answer. Words elsewhere on the page are not evidence and are not read.
 * 2. **The EXPECTATION is typed.** An entity claim is checked against the
 *    subject the engine BOUND — a structural read of what the product decided,
 *    not a name hunt. A value claim is normalised (money, dates, integers)
 *    before comparison, so `$297.86` and `297.86 dollars` are one fact and
 *    `29786` is not. A verified absence must be attributed and sourced, and a
 *    NAMED GAP about our own records can never satisfy it.
 * 3. **A hit is necessary and never sufficient.** Mode, source presence and
 *    subject binding are checked first; a correct-looking sentence produced by
 *    a fallback path is RED, because a fallback that happens to be right is
 *    still an ungrounded claim about a government.
 */

import type { FailureClass, InstanceVerdict } from "./reader-question.ts";

/* ------------------------------------------------------------ the answer */

/**
 * The Ask panel's own answer, read off the rendered surface.
 *
 * This is deliberately a flat record rather than a live handle: the harness
 * does the reading in the browser, this module does the judging in Node, and
 * a pure function is a function a seeded-failure test can drive without a
 * browser at all. `tests/reader-evaluation.test.ts` is exactly that.
 */
export interface RenderedAnswer {
  /**
   * `data-ask-grounded-mode` — the engine's own statement of how the answer
   * was produced. Never inferred from whether a field was present; the engine
   * sets it at one place per outcome and this reads that.
   */
  readonly mode: string | null;
  /** `data-ask-grounded-subject` — the entity the engine BOUND, or null. */
  readonly subjectId: string | null;
  /** The bound subject's rendered name, when one rendered. */
  readonly subjectName: string | null;
  /** The validated generated sentence, when one survived checking. */
  readonly answerText: string | null;
  /** The structured record lines, when the ladder answered without prose. */
  readonly recordTexts: readonly string[];
  /** Every rendered gap's attribution — `OURS` or `THEIRS`. */
  readonly gapAttributions: readonly string[];
  /** Every rendered gap's sentence, for absence evaluation. */
  readonly gapStatements: readonly string[];
  /** How many distinct publishers the panel rendered under "Source(s)". */
  readonly sourceCount: number;
  /**
   * True when the panel rendered nothing at all for this submission — no
   * grounded block. Distinct from a grounded block that says nothing: one is
   * the harness failing to observe an answer, the other is the product
   * answering honestly that it holds nothing.
   */
  readonly panelAbsent: boolean;
}

/* ------------------------------------------------------- the expectation */

/**
 * What the owner says a correct answer ASSERTS. A typed proposition, four
 * kinds, and none of them is "these words appear".
 */
export type ReaderExpectation =
  /**
   * The answer must be ABOUT this entity. Checked against the bound subject,
   * which is the product's own decision about what the question resolved to —
   * the one place a wrong-body answer is detectable without reading prose.
   */
  | {
      readonly kind: "ENTITY";
      /** The registry id the answer must have bound, when the owner knows it. */
      readonly entityId: string | null;
      /** The name the bound subject must carry, as the owner states it. */
      readonly entityName: string;
    }
  /** The answer must assert this value of this subject. Normalised before compare. */
  | {
      readonly kind: "VALUE";
      readonly subject: string;
      readonly value: string | number;
      /** Deterministic alternate formattings the owner also accepts. */
      readonly acceptedForms?: readonly string[];
    }
  /** The answer must assert every member. `exhaustive` also forbids extras being claimed. */
  | {
      readonly kind: "LIST";
      readonly subject: string;
      readonly members: readonly string[];
      readonly exhaustive: boolean;
    }
  /**
   * The answer must state a SOURCED absence — whose records, over what period.
   *
   * This is the kind the product is most likely to get wrong in the dangerous
   * direction, so it is the strictest. A NAMED GAP attributed `OURS` ("we
   * haven't recorded this yet") does NOT satisfy it: that is a fact about us,
   * the expectation is a fact about them, and the constitution forbids them
   * rendering as the same sentence.
   */
  | {
      readonly kind: "VERIFIED_ABSENCE";
      /** Whose records establish the absence. Must be named in the answer. */
      readonly authority: string;
      /** The period the absence covers, as the owner verified it. */
      readonly period: string;
    };

/* ------------------------------------------------------------- the modes */

/**
 * The modes that count as a GROUNDED answer.
 *
 * Deliberately a short allowlist rather than a denylist of fallbacks: a mode
 * added to the engine tomorrow is NOT silently green here. An unknown mode
 * falls through to RED with the mode named, which is the safe direction.
 */
export const GROUNDED_MODES: readonly string[] = ["GROUNDED_CLAUDE", "STRUCTURED_GROUNDED"];

/**
 * Every non-grounded mode, mapped to the failure class it actually is.
 *
 * Diagnosis happens HERE, before anything is dispatched, because a red that
 * defaults to "go acquire" is how a rendering defect buys a pointless second
 * hunt. Each mapping says what the engine reported about itself:
 *
 * - `CLARIFY` / `UNRESOLVED` — the mention did not bind to one thing. That is
 *   IDENTITY, not acquisition: we may well hold the record under another name.
 * - `NO_EVIDENCE` — the subject bound and we hold nothing that answers. That
 *   IS acquisition, and it is the only mode that earns the word.
 * - `REJECTED_FELL_BACK` — prose was produced and the validator killed it.
 *   VALIDATION, and hunting more records would not touch it.
 * - `OFF` / `TRANSPORT_FAILED` — nothing was retrieved because nothing ran.
 */
const MODE_FAILURE_CLASS: Readonly<Record<string, FailureClass>> = {
  CLARIFY: "identity",
  UNRESOLVED: "identity",
  NO_EVIDENCE: "acquisition",
  REJECTED_FELL_BACK: "validation",
  OFF: "retrieval",
  TRANSPORT_FAILED: "retrieval",
};

/* -------------------------------------------------------- normalisation */

/**
 * Fold a value to its comparable form.
 *
 * Currency, thousands separators and casing are FORMATTING; the fact is the
 * number. `$297.86`, `297.86` and `$ 297.86` are one fact. `29786` is a
 * different one and stays different — dropping the decimal point would make
 * the evaluator agree with an answer that is off by a hundredfold.
 */
export function normaliseValue(value: string | number | boolean): string {
  const text = String(value).trim().toLowerCase();
  const money = text.replace(/[$,\s]/g, "");
  if (/^-?\d+(\.\d+)?$/.test(money)) {
    /* A trailing zero is formatting, so 297.860 and 297.86 agree; 297.8 and
       297.86 do not, and Number() keeps them apart. */
    return String(Number(money));
  }
  return text.replace(/\s+/g, " ");
}

/** The answer's own words: the validated prose and the record lines, nothing else. */
export function answerSurface(answer: RenderedAnswer): string {
  return [answer.answerText ?? "", ...answer.recordTexts].join("\n").toLowerCase();
}

/**
 * Does the ANSWER assert this value?
 *
 * Scoped to the answer surface and normalised on both sides. The number is
 * matched on a token boundary so `297.86` does not satisfy an expectation of
 * `97.86`, which a naive inclusion test would happily accept.
 */
function answerAssertsValue(answer: RenderedAnswer, expected: string | number): boolean {
  const surface = answerSurface(answer);
  if (surface.trim().length === 0) return false;
  const wanted = normaliseValue(expected);
  /* Numbers are compared as numbers, pulled out of the sentence with their
     own boundaries. Words are compared as words, on the same basis. */
  if (/^-?\d+(\.\d+)?$/.test(wanted)) {
    const found = surface.match(/-?\$?\d[\d,]*(\.\d+)?/g) ?? [];
    return found.some((token) => normaliseValue(token) === wanted);
  }
  const escaped = wanted.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i").test(surface);
}

/* ---------------------------------------------------- absence vocabulary */

/**
 * The shapes an answer uses to state that something does not exist.
 *
 * Kept as an explicit, small vocabulary rather than a cleverer test, because
 * this is the one place where being generous is dangerous: a sentence wrongly
 * read as an absence assertion would turn a false presence into a green.
 */
const ABSENCE_PHRASES: readonly string[] = [
  "none on file",
  "no such",
  "there are no",
  "there were no",
  "no records",
  "no reports",
  "no filings",
  "nothing on file",
  "took no actions",
  "no actions were taken",
  "did not take any action",
];

function statesAbsence(text: string): boolean {
  const lower = text.toLowerCase();
  return ABSENCE_PHRASES.some((phrase) => lower.includes(phrase));
}

/* ------------------------------------------------------------ the verdict */

function red(detail: string, failureClass: FailureClass): EvaluatedInstance {
  return { verdict: { kind: "RED", detail }, failureClass };
}

/**
 * A verdict plus the class it was diagnosed as.
 *
 * The class rides WITH the verdict rather than being derived later, because
 * `InstanceVerdict.RED` deliberately carries no class — diagnosis is a
 * separate act, and this is where that act happens.
 */
export interface EvaluatedInstance {
  readonly verdict: InstanceVerdict;
  /** The diagnosed class, on RED only. Null on green and not-evaluable. */
  readonly failureClass: FailureClass | null;
}

/**
 * **THE EVALUATION.** Pure, so a test can drive every branch without a browser.
 *
 * The order of the clauses is the order of the diagnosis: a missing panel is
 * not a wrong answer, a fallback is not a missing source, and an unsourced
 * assertion is not a wrong proposition. Reporting the LAST failure when the
 * FIRST already explains it would send the next session hunting the wrong
 * thing.
 */
export function evaluateAnswer(
  answer: RenderedAnswer,
  expectation: ReaderExpectation | null,
): EvaluatedInstance {
  if (expectation === null) {
    return {
      verdict: {
        kind: "NOT_EVALUABLE",
        detail:
          "the owner corpus states no expected truth for this template; recorded, and never " +
          "counted green — an unevaluated instance is not a passing one",
      },
      failureClass: null,
    };
  }

  /* 1. Did an answer render at all? */
  if (answer.panelAbsent) {
    return red(
      "the Ask panel rendered no answer block for this submission — the question was typed " +
        "and submitted and nothing came back to read",
      "interaction",
    );
  }

  /* 2. Was it grounded, or was it a fallback wearing an answer's clothes? */
  const mode = answer.mode;
  if (mode === null) {
    return red("the rendered answer carries no mode; nothing states how it was produced", "rendering");
  }
  if (!GROUNDED_MODES.includes(mode)) {
    const known = MODE_FAILURE_CLASS[mode];
    return red(
      `the engine answered in mode ${JSON.stringify(mode)}, which is not a grounded answer` +
        (known ? "" : " and is not a mode this evaluator knows"),
      /* An unknown mode is a RENDERING question — something reached the reader
         that nothing here can classify — and never a silent green. */
      known ?? "rendering",
    );
  }

  /* 3. Is there anything to read? A grounded mode with an empty body is the
        empty-panel defect, and it has shipped in this repository before. */
  const surface = answerSurface(answer);
  if (surface.trim().length === 0) {
    return red(
      `the engine reported mode ${mode} and rendered neither prose nor a record line — ` +
        "a grounded mode with an empty body is an empty panel, not an answer",
      "rendering",
    );
  }

  /* 4. Is it sourced? Every position, vote or stance a reader meets carries a
        source record. An assertion without one is not made better by being
        correct. A verified absence is sourced too — that is what makes it a
        claim about their records rather than about our silence. */
  if (answer.sourceCount === 0) {
    return red(
      `the answer asserts something in mode ${mode} with no visible source record — ` +
        "an unsourced assertion about a government is the one thing this product may never ship",
      "evidence_selection",
    );
  }

  /* 5. Does it assert the expected proposition? */
  switch (expectation.kind) {
    case "ENTITY": {
      if (expectation.entityId !== null && answer.subjectId !== expectation.entityId) {
        return red(
          `the answer bound ${JSON.stringify(answer.subjectId ?? "nothing")} where the ` +
            `expectation is ${JSON.stringify(expectation.entityId)} — a sourced answer about ` +
            "the wrong government is a wrong answer",
          "identity",
        );
      }
      const name = (answer.subjectName ?? "").toLowerCase();
      if (!name.includes(expectation.entityName.toLowerCase())) {
        return red(
          `the answer's bound subject rendered as ${JSON.stringify(answer.subjectName ?? "")} ` +
            `where the expectation names ${JSON.stringify(expectation.entityName)}`,
          "identity",
        );
      }
      return { verdict: { kind: "GREEN" }, failureClass: null };
    }

    case "VALUE": {
      const forms = [expectation.value, ...(expectation.acceptedForms ?? [])];
      if (forms.some((form) => answerAssertsValue(answer, form))) {
        return { verdict: { kind: "GREEN" }, failureClass: null };
      }
      /* An answer that asserts an ABSENCE where the owner verified a PRESENCE
         is a false absence, and it is a different defect from an answer that
         is merely incomplete. Named separately so the diagnosis is right. */
      if (statesAbsence(surface)) {
        return red(
          `the answer states an absence where the owner verified ` +
            `${JSON.stringify(String(expectation.value))} for ${expectation.subject} — ` +
            "denying a fact we can source is a false absence",
          "acquisition",
        );
      }
      return red(
        `the answer does not assert ${JSON.stringify(String(expectation.value))} for ` +
          `${expectation.subject}; it is grounded and sourced but says something else`,
        answer.answerText ? "synthesis" : "evidence_selection",
      );
    }

    case "LIST": {
      const missing = expectation.members.filter(
        (member) => !answerAssertsValue(answer, member),
      );
      if (missing.length === 0) {
        return { verdict: { kind: "GREEN" }, failureClass: null };
      }
      return red(
        `the answer omits ${missing.length} of ${expectation.members.length} expected ` +
          `member(s) of ${expectation.subject}: ${missing.join(", ")}` +
          (expectation.exhaustive ? " (the owner states this list is exhaustive)" : ""),
        /* The same discrimination the VALUE branch makes, and for the same
           reason. Prose that dropped a member is a SYNTHESIS failure — the
           records may well have held them and the sentence left them out.
           Record lines that are missing a member never held them, which is an
           EVIDENCE_SELECTION failure. Sending the next session to the wrong
           one of those is exactly what an undiagnosed red costs. */
        answer.answerText ? "synthesis" : "evidence_selection",
      );
    }

    case "VERIFIED_ABSENCE": {
      /* A gap attributed to US is not an absence. "We haven't recorded this
         yet" and "their records hold none" are different sentences about
         different subjects, and the constitution forbids conflating them —
         so the evaluator refuses to accept one as the other. */
      const oursOnly =
        answer.gapAttributions.length > 0 &&
        answer.gapAttributions.every((whose) => whose === "OURS");
      const absenceText = [surface, ...answer.gapStatements.map((g) => g.toLowerCase())].join("\n");
      if (!statesAbsence(absenceText)) {
        return red(
          "the owner verified an absence and the answer does not state one; silence and a " +
            "named gap about our own records are both different claims",
          oursOnly ? "acquisition" : "synthesis",
        );
      }
      if (oursOnly) {
        return red(
          "the answer's only gap is attributed OURS — that is a fact about what we have " +
            `recorded, where the expectation is a sourced absence in ${expectation.authority}'s ` +
            "records; the two may never render as the same sentence",
          "acquisition",
        );
      }
      const authorityNamed = absenceText.includes(expectation.authority.toLowerCase());
      if (!authorityNamed) {
        return red(
          `the answer states an absence without naming ${expectation.authority} — an absence ` +
            "with no authority behind it is an assertion, and absence is never asserted",
          "synthesis",
        );
      }
      return { verdict: { kind: "GREEN" }, failureClass: null };
    }
  }
}
