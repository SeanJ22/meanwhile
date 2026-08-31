/**
 * **OBSERVING A CONTROL THROUGH THE REAL PATH.** (A.1 WI4, 2026-08-30.)
 *
 * ## What the control runner did instead
 *
 * `scripts/control-set.mts --prove-fixture` scored a SIMULATED result set: an
 * array of `ControlObservation` values written by hand in the script. With
 * real owner controls the other branch reported *"no audit has produced
 * observations yet"* and `score: null`. So the truth contract had two modes,
 * and neither of them was a measurement of the product: one scored numbers the
 * script invented, and the other scored nothing.
 *
 * ## What an observation is now
 *
 * A control fact is turned into a reader-shaped question, submitted through
 * the SAME `openAskAt` / `askAndRead` path an ordinary reader question uses,
 * and the rendered answer is classified into one of the three observations the
 * scorer already understands:
 *
 * ```
 *   FACT_STATED       the surface asserted the fact
 *   GAP_NAMED         the surface said WE have not recorded it
 *   ABSENCE_ASSERTED  the surface said the thing does not exist
 * ```
 *
 * The third is the dangerous one and it is the reason both classes of control
 * exist. On a `known_present` fact it is a FALSE ABSENCE — denying something
 * we can source. On a `known_absence` fact `FACT_STATED` is a FALSE PRESENCE —
 * asserting a fact where absence is verified, which in this product is a false
 * claim about a government.
 *
 * ## Blindness, and why it is satisfied by construction (RULING 211)
 *
 * The measured pipeline receives one thing: a question string, in the same
 * input, from the same harness, in the same shape as any other. There is no
 * field in which control identity could travel, because the transport is a
 * text input a reader types into. The grader's metadata never leaves this
 * module and `assembleWorkerItem` remains the boundary for anything that does
 * reach a work item.
 *
 * ## The honest limit of proposition matching, stated
 *
 * The owner's workbook states facts as PROSE, so most loaded facts arrive as
 * `expected_truth.kind === "proposition"`. There is no way to check prose
 * against prose without a heuristic, and this one is deliberately narrow: the
 * SALIENT TERMS of the proposition — proper nouns, numbers and dates, the
 * parts that carry the claim — must all be asserted by the answer. Function
 * words are ignored because they match everything.
 *
 * It is weaker than a `value` or `predicate` expectation and it is labelled
 * weaker in the run record. Where the owner wants a deterministic reading they
 * state `accepted_forms`, and those are checked exactly.
 */

import type { ControlFact, ControlObservation } from "./control-fact.ts";
import { answerSurface, normaliseValue, type RenderedAnswer } from "./ask-evaluation.ts";

/**
 * The question a control fact is asked as.
 *
 * Derived mechanically and stated out loud, because a hand-written question
 * per fact would be a second answer key nobody reviewed. `[DRAFT]` is stripped
 * — it is the workbook's marker for a row the owner had not yet confirmed, and
 * a confirmed row should not carry it into a reader-shaped question.
 *
 * The phrasing is deliberately an OPEN question rather than a yes/no one: a
 * yes/no question invites the surface to agree, and a control that leads its
 * subject measures agreeableness rather than truth.
 */
export function controlQuestion(fact: ControlFact): string {
  const statement = fact.statement.replace(/^\s*\[DRAFT\]\s*/i, "").trim();
  return `What do you have on record about this: ${statement}`;
}

/** Words that carry no claim and would match any answer. */
const STOPWORDS = new Set([
  "the", "a", "an", "of", "on", "in", "at", "for", "to", "and", "or", "is", "are", "was",
  "were", "has", "have", "had", "its", "it", "that", "this", "with", "by", "from", "no",
  "not", "any", "all", "held", "published", "filed", "there", "their", "as", "per", "be",
]);

/**
 * The parts of a proposition that actually carry the claim.
 *
 * Proper nouns (a capitalised word not at the start), numbers, money and
 * dates. Everything else is grammar.
 */
export function salientTerms(proposition: string): string[] {
  const terms = new Set<string>();
  for (const match of proposition.match(/\$?\d[\d,]*(\.\d+)?/g) ?? []) {
    terms.add(normaliseValue(match));
  }
  const words = proposition.split(/\s+/);
  for (const [i, raw] of words.entries()) {
    const word = raw.replace(/[^A-Za-z0-9'-]/g, "");
    if (word.length < 3) continue;
    if (STOPWORDS.has(word.toLowerCase())) continue;
    /* A capitalised word that is not merely sentence-initial is a name. */
    if (i > 0 && /^[A-Z]/.test(word)) terms.add(word.toLowerCase());
  }
  return [...terms];
}

/** The shapes an answer uses to say a thing does not exist. */
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

/** How confident the classification is, recorded so a weak read reads weak. */
export type ObservationBasis = "ACCEPTED_FORM" | "TYPED_VALUE" | "SALIENT_TERMS" | "NO_ASSERTION";

export interface ControlObservationResult {
  readonly observation: ControlObservation;
  readonly basis: ObservationBasis;
  /** What was read, for the run record. Never a verdict on the government. */
  readonly detail: string;
}

function assertsAll(surface: string, terms: readonly string[]): boolean {
  if (terms.length === 0) return false;
  return terms.every((term) => {
    if (/^-?\d+(\.\d+)?$/.test(term)) {
      const found = surface.match(/-?\$?\d[\d,]*(\.\d+)?/g) ?? [];
      return found.some((token) => normaliseValue(token) === term);
    }
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i").test(surface);
  });
}

/**
 * Classify one rendered answer against one control fact.
 *
 * The order is not arbitrary. An explicit accepted form beats a typed value
 * beats a salient-term read, and an absence assertion is only reached when the
 * fact was NOT stated — because an answer that states the fact and also names
 * an unrelated gap has stated the fact.
 */
export function observeControl(
  fact: ControlFact,
  answer: RenderedAnswer,
): ControlObservationResult {
  const surface = answerSurface(answer);
  const gapText = answer.gapStatements.join("\n").toLowerCase();

  /* Nothing was rendered, or the engine did not answer. That is OUR gap, and
     it is not the surface asserting anything about a government. */
  if (answer.panelAbsent || surface.trim().length === 0) {
    return {
      observation: { statement: fact.statement, observed: "GAP_NAMED" },
      basis: "NO_ASSERTION",
      detail:
        `the surface rendered no answer body (mode ${JSON.stringify(answer.mode ?? "none")}); ` +
        "recorded as our gap, never as a claim about the record",
    };
  }

  /*
   * **A KNOWN-ABSENCE CONTROL IS ASKED WHETHER A THING EXISTS.** (B WI1.4.)
   *
   * The order below was written for `known_present` facts and applied to both
   * classes, and on a `known_absence` fact it inverted the answer key. The
   * fact's `expected_truth` for an absence row IS the absence — "there were no
   * campaign filings by X in 2025" — so an answer correctly saying exactly
   * that asserts every salient term of the proposition and was classified
   * `FACT_STATED`. `scoreControls` reads `known_absence + FACT_STATED` as a
   * FALSE PRESENCE. The product would have told the truth and the instrument
   * would have recorded it as a lie about a government.
   *
   * It was not yet visible because both loaded controls are `known_present`.
   * An instrument that inverts a verdict on a population of zero is still an
   * instrument that inverts a verdict.
   *
   * So for an absence fact the absence question is asked FIRST, and
   * `FACT_STATED` is reserved for what it means on this class: the surface
   * asserting the thing EXISTS where the owner verified it does not.
   */
  const assertsAbsenceEarly = ABSENCE_PHRASES.some(
    (p) => surface.includes(p) || gapText.includes(p),
  );
  const oursOnlyEarly =
    answer.gapAttributions.length > 0 && answer.gapAttributions.every((w) => w === "OURS");
  if (fact.fact_class === "known_absence" && assertsAbsenceEarly && !oursOnlyEarly) {
    return {
      observation: { statement: fact.statement, observed: "ABSENCE_ASSERTED" },
      basis: "NO_ASSERTION",
      detail:
        "the answer states, with a gap attributed to the record holder rather than to us, " +
        "that the record does not exist — which is the fact this known_absence control " +
        "verified, correctly recalled",
    };
  }

  /* 1 · The owner's own deterministic formattings, checked exactly. */
  const forms = fact.accepted_forms ?? [];
  if (forms.length > 0 && forms.some((form) => surface.includes(form.toLowerCase()))) {
    return {
      observation: { statement: fact.statement, observed: "FACT_STATED" },
      basis: "ACCEPTED_FORM",
      detail: "the answer carries one of the owner's stated accepted forms",
    };
  }

  /* 2 · A typed expectation, checked as a value or a predicate. */
  const expected = fact.expected_truth;
  if (expected.kind === "value") {
    if (assertsAll(surface, [normaliseValue(expected.value)])) {
      return {
        observation: { statement: fact.statement, observed: "FACT_STATED" },
        basis: "TYPED_VALUE",
        detail: `the answer asserts ${JSON.stringify(String(expected.value))}`,
      };
    }
  } else if (expected.kind === "predicate") {
    const args = Object.values(expected.args).map((v) => normaliseValue(v));
    if (assertsAll(surface, args)) {
      return {
        observation: { statement: fact.statement, observed: "FACT_STATED" },
        basis: "TYPED_VALUE",
        detail: `the answer asserts every argument of ${expected.predicate}`,
      };
    }
  } else {
    const terms = salientTerms(expected.proposition);
    if (assertsAll(surface, terms)) {
      return {
        observation: { statement: fact.statement, observed: "FACT_STATED" },
        basis: "SALIENT_TERMS",
        detail:
          `the answer asserts every salient term of the proposition (${terms.join(", ")}) — ` +
          "a prose-against-prose read, and the weakest basis this harness records",
      };
    }
  }

  /* 3 · Did it assert that the thing does not exist? Only reached when the
        fact was not stated, so an answer that did both has already returned.
        On a `known_absence` fact this branch is unreachable — step 0 above has
        already classified it — and that is deliberate: the two classes read
        the same sentence as opposite verdicts, so exactly one of them may own
        the classification. */
  const assertsAbsence = assertsAbsenceEarly;
  const oursOnly = oursOnlyEarly;
  if (assertsAbsence && !oursOnly) {
    return {
      observation: { statement: fact.statement, observed: "ABSENCE_ASSERTED" },
      basis: "NO_ASSERTION",
      detail:
        "the answer states that the record does not exist — a claim about THEIR records, " +
        "which is a false absence when the owner verified the fact is present",
    };
  }

  /* 4 · Otherwise the surface said something about us, not about them. */
  return {
    observation: { statement: fact.statement, observed: "GAP_NAMED" },
    basis: "NO_ASSERTION",
    detail: oursOnly
      ? "the answer named a gap attributed OURS — a fact about what we hold, honestly stated"
      : "the answer neither asserted the fact nor asserted an absence",
  };
}
