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
  /**
   * The answer must assert this value OF THIS SUBJECT. Normalised before compare.
   *
   * `subjectId` binds the claim to a canonical government exactly as an ENTITY
   * expectation does, and it is the clause that makes this a proposition about
   * a body rather than about a number. A budget figure is the right answer for
   * exactly one body; an answer carrying it about a different one is grounded,
   * sourced and WRONG. Where the owner states no id, the instance's own
   * `subjectBodyId` supplies it — see `ExpectationSubject`.
   */
  | {
      readonly kind: "VALUE";
      readonly subject: string;
      /** The registry id the answer must have bound, when one governs the claim. */
      readonly subjectId?: string | null;
      readonly value: string | number;
      /** Deterministic alternate formattings the owner also accepts. */
      readonly acceptedForms?: readonly string[];
    }
  /**
   * The answer must assert every member. `exhaustive` also forbids extras.
   *
   * `subjectId` binds the list to its body for the same reason VALUE does: a
   * complete and correct roster of the WRONG council is a wrong answer.
   */
  | {
      readonly kind: "LIST";
      readonly subject: string;
      /** The registry id the answer must have bound, when one governs the claim. */
      readonly subjectId?: string | null;
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

/* ---------------------------------------------- the canonical subject bind */

/**
 * **THE INSTANCE'S OWN SUBJECT.** (B WI1.1, 2026-08-30.)
 *
 * ENTITY expectations have checked the bound subject since A.1. VALUE and LIST
 * did not, and that hole has a name: an answer that carries the expected
 * number, is grounded, is sourced, and is ABOUT A DIFFERENT GOVERNMENT went
 * GREEN. Every clause of the contract held except the one that makes the
 * answer true.
 *
 * The id comes from the expectation when the owner states one, and otherwise
 * from the instance the question was generated for — `subjectBodyId`, the
 * registry id the generator already bound. Null means the question has no body
 * subject (a zip-level question about a whole area), and null is the only
 * thing that legitimately skips the check.
 */
export interface ExpectationSubject {
  /** The registry body id (`<ocdId>#<slug>`) this instance is about, or null. */
  readonly subjectBodyId: string | null;
}

/**
 * The id this expectation must have bound, or null when nothing binds it.
 *
 * Exported so the harness and the tests read the SAME rule rather than two
 * copies of it: the owner's explicit id wins, the instance's supplies it
 * otherwise, and an explicit `null` on the expectation means the owner has
 * said out loud that no body governs this claim.
 */
export function expectedSubjectId(
  expectation: ReaderExpectation,
  subject: ExpectationSubject | null,
): string | null {
  if (expectation.kind !== "VALUE" && expectation.kind !== "LIST") return null;
  if (expectation.subjectId !== undefined) return expectation.subjectId;
  return subject?.subjectBodyId ?? null;
}

/* ------------------------------------------------- exhaustive list members */

/**
 * The members an answer CLAIMS, read off the record lines.
 *
 * `exhaustive` is a claim about extras, and extras can only be counted where
 * the claimed members are enumerable. A record line is one member — that is
 * what the structured ladder renders — so the leading name segment of each
 * line is one claim. Prose is NOT mined for names: a sentence naming a body,
 * a date and a chair alongside five members would manufacture extras out of
 * grammar, and a false RED on an exhaustive list is as much a wrong instrument
 * reading as the false GREEN this replaces.
 *
 * Where there are no record lines the exhaustive clause is NOT EVALUABLE, and
 * `evaluateAnswer` says so rather than passing it.
 */
export function claimedMembers(answer: RenderedAnswer): string[] {
  const out: string[] = [];
  for (const line of answer.recordTexts) {
    /* The name segment: everything before the first structural separator the
       record renderer uses between a member and its role, ward or email. */
    const head = line.split(/\s+[—–|]\s+|,|\(|·/)[0].trim();
    if (head.length > 0) out.push(head);
  }
  return out;
}

/* ---------------------------------------------------------- period scoping */

/**
 * The years a period covers, expanded from ranges.
 *
 * A verified absence is an absence OVER A PERIOD. "No filings in 2025" and
 * "no filings in 2026" are different claims about the same authority, and an
 * evaluator that reads only the absence language and the authority name will
 * accept either for the other — which is how a true statement about last year
 * certifies a false one about this year.
 *
 * Ranges are expanded so an answer covering 2024-2026 satisfies a 2026
 * expectation. An open-ended phrase with no year yields an empty set, and an
 * empty EXPECTED set is what makes the scope check inapplicable rather than
 * failed.
 */
export function periodYears(text: string): Set<string> {
  const years = new Set<string>();
  const source = String(text ?? "");
  for (const match of source.matchAll(/\b(19|20)\d{2}\s*[–—-]\s*((19|20)\d{2})\b/g)) {
    const [a, b] = match[0].split(/\s*[–—-]\s*/).map((n) => Number(n));
    if (Number.isFinite(a) && Number.isFinite(b) && b >= a && b - a <= 50) {
      for (let y = a; y <= b; y += 1) years.add(String(y));
    }
  }
  for (const match of source.matchAll(/\b((19|20)\d{2})\b/g)) years.add(match[1]);
  return years;
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
  subject: ExpectationSubject | null = null,
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

  /*
   * 5. Is it ABOUT the right government? (B WI1.1.)
   *
   * Before any value or member is compared, because a wrong-body answer is not
   * a near miss to be diagnosed as a synthesis problem — it is an identity
   * failure, and reporting it as anything else sends the next session hunting
   * records we already hold. ENTITY runs its own richer bind below (id AND
   * rendered name); this is the clause VALUE and LIST were missing entirely.
   */
  const wantedSubject = expectedSubjectId(expectation, subject);
  if (wantedSubject !== null && answer.subjectId !== wantedSubject) {
    return red(
      `the answer bound ${JSON.stringify(answer.subjectId ?? "nothing")} where this ` +
        `${expectation.kind} expectation is about ${JSON.stringify(wantedSubject)} — a ` +
        "grounded, sourced answer carrying the expected content about the wrong government " +
        "is a wrong answer, not a partial one",
      "identity",
    );
  }

  /* 6. Does it assert the expected proposition? */
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
        /*
         * **EXHAUSTIVE IS A CLAIM ABOUT EXTRAS.** (B WI1.2.)
         *
         * Until now `exhaustive` appeared in exactly one place — the failure
         * message — so an answer carrying every expected member PLUS an
         * invented sixth councillor passed a check whose whole purpose was to
         * forbid the invented sixth. The flag was documentation.
         *
         * It is enforced against the record lines, and where there are none it
         * is NOT_EVALUABLE rather than green: an extras claim needs enumerable
         * members, and a check that cannot see extras may not certify their
         * absence.
         */
        if (!expectation.exhaustive) {
          return { verdict: { kind: "GREEN" }, failureClass: null };
        }
        const claimed = claimedMembers(answer);
        if (claimed.length === 0) {
          return {
            verdict: {
              kind: "NOT_EVALUABLE",
              detail:
                `every expected member of ${expectation.subject} is asserted, but the owner ` +
                "states this list is EXHAUSTIVE and the answer rendered no record lines — " +
                "there is nothing enumerable to check extras against. Prose is deliberately " +
                "not mined for names: manufacturing members out of grammar would trade a " +
                "false green for a false red. Recorded, and never counted green.",
            },
            failureClass: null,
          };
        }
        const expectedForms = expectation.members.map((m) => normaliseValue(m));
        const unexpected = claimed.filter((claim) => {
          const folded = normaliseValue(claim);
          return !expectedForms.some((form) => folded.includes(form) || form.includes(folded));
        });
        if (unexpected.length > 0) {
          return red(
            `the answer asserts ${unexpected.length} member(s) of ${expectation.subject} that ` +
              `the owner's exhaustive list does not contain: ${unexpected.join(", ")}. An ` +
              "exhaustive list is a claim that these and no others hold the seats, so an extra " +
              "is a fabricated officeholder, which is the worse direction of the two",
            answer.answerText ? "synthesis" : "evidence_selection",
          );
        }
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
      /*
       * **AN ABSENCE IS AN ABSENCE OVER A PERIOD.** (B WI1.3.)
       *
       * The expectation has carried `period` since A.1 and nothing read it, so
       * "no filings in 2025" satisfied an expectation scoped to 2026 as long
       * as the authority was named. That is a TRUE sentence about last year
       * certifying a claim about this one, and the reader meets it as a fact
       * about a government.
       *
       * The answer's absence scope must COVER the expected period. A period
       * the owner wrote with no year yields no requirement — inapplicable,
       * never silently satisfied — and an answer with no year against a period
       * that has one is unscoped, which is a synthesis failure rather than a
       * green.
       */
      const wantedYears = periodYears(expectation.period);
      if (wantedYears.size > 0) {
        const statedYears = periodYears(absenceText);
        if (statedYears.size === 0) {
          return red(
            `the answer states a sourced absence in ${expectation.authority}'s records but ` +
              `scopes it to no period, where the owner verified it for ` +
              `${JSON.stringify(expectation.period)} — an unscoped absence is a broader claim ` +
              "than the one that was verified",
            "synthesis",
          );
        }
        const uncovered = [...wantedYears].filter((year) => !statedYears.has(year));
        if (uncovered.length > 0) {
          return red(
            `the answer's absence covers ${[...statedYears].sort().join(", ")} where the ` +
              `expectation is scoped to ${JSON.stringify(expectation.period)}; ` +
              `${uncovered.sort().join(", ")} is not covered. A true absence in one period is ` +
              "not evidence of an absence in another",
            "synthesis",
          );
        }
      }
      return { verdict: { kind: "GREEN" }, failureClass: null };
    }
  }
}
