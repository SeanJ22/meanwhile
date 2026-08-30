/**
 * THE READER'S THREE QUESTIONS, answered from held records or named as a gap.
 *
 * ## Why this file exists
 *
 * `filing-regime.ts` and `authority.ts` answer *which government holds this
 * money's records*. That is the discovery question, and it is not the product.
 * The product is that a reader can ask a bounded question —
 *
 *   1. **"Who has contributed to this campaign?"**
 *   2. **"How much has this committee reported spending?"**
 *   3. **"Are there independent expenditures supporting or opposing this side?"**
 *
 * — and get GROUNDED RECORDS with the limits of the held filing universe
 * stated, or a NAMED GAP that says WHOSE gap it is.
 *
 * ## The three questions are three different facts, and the types say so
 *
 * A contribution is money INTO a committee. An expenditure is money OUT of a
 * committee, spent by that committee. An independent expenditure is money spent
 * ABOUT a race by somebody who gave the campaign nothing. Collapsing any pair
 * misstates who is behind a candidate, and the third collapse is the dangerous
 * one: **an independent expenditure SUPPORTING a candidate is not money that
 * candidate received.**
 *
 * `model.ts` already made that unrepresentable in the aggregation
 * (`totalReceivedBy` throws rather than summing). This file closes the other
 * half — the RENDER. `FinanceAnswer` is a DISCRIMINATED UNION keyed on the
 * question, so:
 *
 *   - the `WHO_CONTRIBUTED` arm's `records` is `readonly Contribution[]`, and an
 *     `IndependentExpenditure` is not assignable to it;
 *   - the `INDEPENDENT_EXPENDITURES` arm has no `records` field a receipts
 *     reader could reach, carries `supporting` and `opposing` as SEPARATE
 *     numbers, and carries `notMoneyReceivedByTheCandidate` as the literal
 *     `true` so no caller reading that boolean can read the wrong answer;
 *   - `assertRecordKind` re-checks `recordKind` at runtime on every row, so a
 *     cast through `any` throws `RenderRefused` instead of quietly printing an
 *     outside group's ad buy under a candidate's name.
 *
 * ## Whose gap is it?
 *
 * `CLAUDE.md`: *a null renders as its NAMED GAP, on every surface, always — and
 * the name says WHOSE gap it is. "We haven't recorded this yet" is a fact about
 * us; "not in this chamber for this vote" is a fact about them. They may never
 * render as the same sentence.*
 *
 * This domain produces both, constantly, and they look identical at the call
 * site. Two real examples from the pilot, both live in this repository today:
 *
 *   - **Iman Bah's committee reported $0 in itemized individual contributions**
 *     for the 2026 cycle through 2026-03-31. Nobody is missing anything. That
 *     is `THE_FILER`'s filed fact.
 *   - **We hold no Pima County contribution rows at all**, because the filing
 *     bodies sit behind HTTP 401 on the route walked. That is `OURS`.
 *
 * Both would render as an empty list. `GapAttribution` is what makes them
 * different sentences, and `attributionsDiffer` is the test hook that proves
 * they never collapse.
 *
 * ## Never imply complete coverage
 *
 * `HeldFilingUniverse.isCompleteFilingSet` is the literal `false`. There is no
 * value of the type that claims to be the whole filing set, and every answer
 * carries the universe, so a rendered figure cannot become an implied total by
 * omission. `periodsExpected: null` is a further honesty: it means we have not
 * read the authority's calendar, so "filings held" has no denominator — which
 * is itself a gap and never a zero.
 *
 * ## Time
 *
 * Nothing here reads a clock. `asOf` is a caller-supplied parameter throughout.
 */

import type {
  Contribution,
  EvidenceBasis,
  Expenditure,
  FilingRecordClass,
  IndependentExpenditure,
  IndependentExpenditureReport,
  MeasureSide,
} from "./model.ts";

/* ── The bounded questions ────────────────────────────────────────────────── */

export const FINANCE_QUESTIONS = [
  /** "Who has contributed to this campaign?" */
  "WHO_CONTRIBUTED",
  /** "How much has this committee reported spending?" */
  "WHAT_WAS_SPENT",
  /** "Are there independent expenditures supporting or opposing this side?" */
  "INDEPENDENT_EXPENDITURES",
] as const;
export type FinanceQuestion = (typeof FINANCE_QUESTIONS)[number];

/**
 * The record kind each question is answered WITH. One question, one kind.
 *
 * Exported so a caller can check the pairing without re-deriving it, and so the
 * test that proves the three questions cannot share a record kind has something
 * mechanical to read.
 */
export const RECORD_KIND_FOR_QUESTION: Readonly<Record<FinanceQuestion, string>> = {
  WHO_CONTRIBUTED: "CONTRIBUTION",
  WHAT_WAS_SPENT: "EXPENDITURE",
  INDEPENDENT_EXPENDITURES: "INDEPENDENT_EXPENDITURE",
};

/* ── Whose gap is it? ─────────────────────────────────────────────────────── */

/**
 * WHO the missing thing is missing FROM. Never decorative.
 *
 *   - `OURS` — we have not retrieved it. A claim about this repository. It is
 *     the ONLY correct attribution for a wall, a blocked route, an unread
 *     calendar or an unwalked rung.
 *   - `THE_FILER` — the committee filed, and what it filed says none. A claim
 *     about the filer, supportable only from a filing we actually hold.
 *   - `THE_AUTHORITY` — the custodian does not publish this class of record, or
 *     does not publish it yet. A claim about a government, and therefore the
 *     one that needs the strongest evidence.
 *   - `THE_LAW` — a legal restriction we are subject to withholds it. Ours in
 *     origin, not the government's silence, and it must say so.
 */
export const GAP_ATTRIBUTIONS = ["OURS", "THE_FILER", "THE_AUTHORITY", "THE_LAW"] as const;
export type GapAttribution = (typeof GAP_ATTRIBUTIONS)[number];

export interface AttributedGap {
  readonly attribution: GapAttribution;
  /** The candidacy, committee, measure side or contest the gap belongs to. */
  readonly subject: string;
  /** What is missing, for an operator. */
  readonly what: string;
  /** What would close it. A gap with no next move is a complaint. */
  readonly nextMove: string;
  /**
   * The sentence a READER sees. Plain language — no OCD-ID, no enum value, no
   * `NO_SOURCE_FOUND`. It must be different for different attributions, which
   * `attributionsDiffer` checks rather than trusting.
   */
  readonly readerSentence: string;
}

/**
 * True when no two gaps in the set with DIFFERENT attributions share a reader
 * sentence.
 *
 * The rule it enforces is `CLAUDE.md`'s: "we haven't recorded this yet" and
 * "they filed none" may never render as the same sentence. A comment cannot
 * enforce that; a set comparison can.
 */
export function attributionsDiffer(gaps: readonly AttributedGap[]): boolean {
  const bySentence = new Map<string, Set<GapAttribution>>();
  for (const gap of gaps) {
    const seen = bySentence.get(gap.readerSentence) ?? new Set<GapAttribution>();
    seen.add(gap.attribution);
    bySentence.set(gap.readerSentence, seen);
  }
  for (const seen of bySentence.values()) if (seen.size > 1) return false;
  return true;
}

/* ── The held filing universe, and its limits ─────────────────────────────── */

/**
 * WHAT WE HOLD, and — the part that matters — what we do not.
 *
 * Every answer carries one. A figure rendered without it is a figure a reader
 * will read as a total.
 */
export interface HeldFilingUniverse {
  /** The custodians whose records these are. Empty means unresolved, not none. */
  readonly authorityIds: readonly string[];
  /** The custodian's own name, for the reader sentence. */
  readonly authorityNames: readonly string[];
  /** WHO SERVES the records — which may be neither the office nor the authority. */
  readonly publisherRoute: string | null;
  readonly recordClassesHeld: readonly FilingRecordClass[];
  /** Named, never counted. Three labels are three next actions; "3 missing" is not. */
  readonly recordClassesNotHeld: readonly FilingRecordClass[];
  /**
   * The authority's own labels for the periods it says are DUE.
   *
   * **Null means we have not read the calendar**, so "filings held" has no
   * denominator. That is a gap in its own right and never a zero.
   */
  readonly periodsExpected: readonly string[] | null;
  readonly periodsHeld: readonly string[];
  readonly periodsNotHeld: readonly string[];
  /** The latest date any held record covers THROUGH. Null when nothing is held. */
  readonly coversThrough: string | null;
  /** What the figures actually came off — a filing, or an authority's arithmetic. */
  readonly evidenceBasis: EvidenceBasis | null;
  /**
   * How the held rows are cut, when they are cut. "The ten largest itemized
   * receipts" is not "the contributors". Null only when nothing is held at all.
   */
  readonly itemizationLimit: string | null;
  /**
   * **Never true.** An answer cannot claim to rest on the complete filing set,
   * because this product never states completeness it has not measured against
   * the authority's own calendar.
   */
  readonly isCompleteFilingSet: false;
  /** Repo paths or URLs. An answer with none is refused. */
  readonly sourceCitations: readonly string[];
}

/* ── Refusals ─────────────────────────────────────────────────────────────── */

export class RenderRefused extends Error {
  /**
   * Explicit field declarations: this repository runs Node with
   * `--experimental-strip-types`, under which a TypeScript parameter property
   * (`constructor(readonly x: string)`) does not parse.
   */
  readonly question: FinanceQuestion;
  readonly offendingKind: string;

  constructor(message: string, question: FinanceQuestion, offendingKind: string) {
    super(message);
    this.name = "RenderRefused";
    this.question = question;
    this.offendingKind = offendingKind;
  }
}

/**
 * Re-check `recordKind` on every row at runtime.
 *
 * The type system already prevents the honest mistake. This catches the cast —
 * and it THROWS rather than filtering, because a silently shorter list is the
 * failure this design exists to prevent and a silently longer one is worse.
 */
function assertRecordKind(
  rows: readonly { recordKind: string }[],
  expected: string,
  question: FinanceQuestion,
): void {
  for (const row of rows) {
    if (row.recordKind !== expected) {
      throw new RenderRefused(
        `A ${row.recordKind} row reached the ${question} answer, which renders ${expected} rows. ` +
          "A contribution, an expenditure and an independent expenditure are three different facts. " +
          "Money spent ABOUT a race by a group that gave the campaign nothing is not money the " +
          "campaign received, and rendering the one as the other misstates who is behind a candidate.",
        question,
        row.recordKind,
      );
    }
  }
}

/** An answer with no citation is not evidence, so building one is refused. */
function assertCited(universe: HeldFilingUniverse, question: FinanceQuestion): void {
  if (universe.sourceCitations.length === 0) {
    throw new RenderRefused(
      `The ${question} answer carries no source citation. Every position, vote, filing or amount ` +
        "rendered to a reader carries a source record pointing at a specific filing. A figure with " +
        "no citation is a generated claim, and this product never generates one.",
      question,
      "UNCITED",
    );
  }
}

/* ── The answers ──────────────────────────────────────────────────────────── */

/** The shape every arm shares. */
interface AnswerBase {
  readonly subjectId: string;
  readonly subjectDisplayName: string;
  readonly universe: HeldFilingUniverse;
  readonly gaps: readonly AttributedGap[];
  /** Plain-language, reader-facing. Never an enum value, never an OCD-ID. */
  readonly readerSentence: string;
}

/**
 * A total the AUTHORITY reported, kept separate from the rows we hold.
 *
 * The two answer different questions and the gap between them is the finding: a
 * committee that reported $6,172,866.72 in receipts while we hold ten itemized
 * rows has not had 6.1 million dollars explained to the reader, and saying so is
 * the honest render.
 */
export interface ReportedTotal {
  readonly amount: number;
  /** The authority's own name for the figure. */
  readonly label: string;
  /** Where the figure came from, and what it does and does not include. */
  readonly basis: string;
  readonly sourceCitation: string;
}

export type FinanceAnswer =
  | (AnswerBase & {
      readonly question: "WHO_CONTRIBUTED";
      readonly recordKind: "CONTRIBUTION";
      /** Itemized receipts we hold. An `IndependentExpenditure` is not assignable here. */
      readonly records: readonly Contribution[];
      /** What the committee itself reported receiving, when the authority publishes it. */
      readonly reportedTotal: ReportedTotal | null;
    })
  | (AnswerBase & {
      readonly question: "WHAT_WAS_SPENT";
      readonly recordKind: "EXPENDITURE";
      readonly records: readonly Expenditure[];
      readonly reportedTotal: ReportedTotal | null;
    })
  | (AnswerBase & {
      readonly question: "INDEPENDENT_EXPENDITURES";
      readonly recordKind: "INDEPENDENT_EXPENDITURE";
      readonly records: readonly IndependentExpenditure[];
      /** Reported SEPARATELY and never added to receipts. */
      readonly supporting: number;
      readonly opposing: number;
      /**
       * **Never true.** Present so a caller reading this boolean cannot read the
       * wrong answer: an independent expenditure supporting a candidate is not
       * money that candidate received, whatever the amount.
       */
      readonly isMoneyReceivedByTheSubject: false;
    });

/* ── 1. Who has contributed to this campaign? ─────────────────────────────── */

export function answerWhoContributed(input: {
  subjectId: string;
  subjectDisplayName: string;
  contributions: readonly Contribution[];
  reportedTotal?: ReportedTotal | null;
  universe: HeldFilingUniverse;
  gaps?: readonly AttributedGap[];
}): FinanceAnswer {
  assertCited(input.universe, "WHO_CONTRIBUTED");
  assertRecordKind(input.contributions, "CONTRIBUTION", "WHO_CONTRIBUTED");

  const gaps = [...(input.gaps ?? [])];
  const held = input.contributions.length;
  const total = input.reportedTotal ?? null;

  /**
   * THE GAP BETWEEN THE ROWS AND THE TOTAL, stated rather than left to arithmetic.
   *
   * A reader shown ten names beside a six-million-dollar figure will read the
   * ten as the donors. They are the ten largest itemized receipts we hold, and
   * the difference is not a rounding error — it is most of the money.
   */
  if (total !== null && held > 0) {
    const shown = input.contributions.reduce((n, c) => n + c.amountReceived, 0);
    if (shown < total.amount) {
      gaps.push({
        attribution: "OURS",
        subject: input.subjectId,
        what:
          `we hold ${held} itemized contribution row(s) totalling ${shown}, against a reported ` +
          `${total.label} of ${total.amount}`,
        nextMove:
          "Acquire the full itemized receipts from the filing authority, or state the cut " +
          "explicitly wherever these rows render.",
        readerSentence:
          `We have recorded ${held} of the contributions to this committee. The committee itself ` +
          `reported ${total.label} of $${total.amount.toLocaleString("en-US")}, so most of that ` +
          "money is not shown here yet.",
      });
    }
  }

  if (held === 0 && total === null) {
    gaps.push({
      attribution: "OURS",
      subject: input.subjectId,
      what: "no contribution record held, and no reported receipts total held either",
      nextMove:
        "Walk the filing authority's route to the filing bodies. Until then this is a gap in our " +
        "collection and says nothing about what was raised.",
      readerSentence:
        "We have not recorded any contributions to this campaign yet. That is a gap in our records, " +
        "not a statement that no money was raised.",
    });
  }

  const readerSentence =
    held > 0
      ? `${held} contribution${held === 1 ? "" : "s"} recorded for ${input.subjectDisplayName}` +
        `${input.universe.itemizationLimit === null ? "" : ` — ${input.universe.itemizationLimit}`}.` +
        `${input.universe.coversThrough === null ? "" : ` Covers money reported through ${input.universe.coversThrough}.`}`
      : `We have no contribution records for ${input.subjectDisplayName} yet.`;

  return {
    question: "WHO_CONTRIBUTED",
    recordKind: "CONTRIBUTION",
    subjectId: input.subjectId,
    subjectDisplayName: input.subjectDisplayName,
    records: input.contributions,
    reportedTotal: total,
    universe: input.universe,
    gaps,
    readerSentence,
  };
}

/* ── 2. How much has this committee reported spending? ────────────────────── */

export function answerWhatWasSpent(input: {
  subjectId: string;
  subjectDisplayName: string;
  expenditures: readonly Expenditure[];
  reportedTotal?: ReportedTotal | null;
  universe: HeldFilingUniverse;
  gaps?: readonly AttributedGap[];
}): FinanceAnswer {
  assertCited(input.universe, "WHAT_WAS_SPENT");
  assertRecordKind(input.expenditures, "EXPENDITURE", "WHAT_WAS_SPENT");

  const gaps = [...(input.gaps ?? [])];
  const total = input.reportedTotal ?? null;

  /**
   * A REPORTED TOTAL WITH NO ITEMIZED ROWS IS STILL AN ANSWER — and it is a
   * different answer from an itemized one, so it says which it is.
   *
   * "How much has this committee reported spending" is answerable from the
   * authority's own total. "What did it spend it on" is not, and conflating them
   * would let a summary figure pass for a description of the spending.
   */
  if (total !== null && input.expenditures.length === 0) {
    gaps.push({
      attribution: "OURS",
      subject: input.subjectId,
      what: `the reported ${total.label} is held; the itemized expenditure rows behind it are not`,
      nextMove: "Acquire the itemized disbursement schedule from the filing authority.",
      readerSentence:
        "We have the total this committee reported spending, but not the individual payments behind " +
        "it. What it spent the money on is not something we have recorded yet.",
    });
  }

  if (total === null && input.expenditures.length === 0) {
    gaps.push({
      attribution: "OURS",
      subject: input.subjectId,
      what: "no spending figure of any kind held for this committee",
      nextMove: "Walk the filing authority's route to this committee's reports.",
      readerSentence:
        "We have not recorded what this committee has spent. That is a gap in our records, not a " +
        "statement that it has spent nothing.",
    });
  }

  const readerSentence =
    total !== null
      ? `${input.subjectDisplayName} reported ${total.label} of ` +
        `$${total.amount.toLocaleString("en-US")}` +
        `${input.universe.coversThrough === null ? "" : `, covering money reported through ${input.universe.coversThrough}`}.` +
        `${input.expenditures.length > 0 ? ` ${input.expenditures.length} individual payment(s) recorded.` : ""}`
      : `We have no spending records for ${input.subjectDisplayName} yet.`;

  return {
    question: "WHAT_WAS_SPENT",
    recordKind: "EXPENDITURE",
    subjectId: input.subjectId,
    subjectDisplayName: input.subjectDisplayName,
    records: input.expenditures,
    reportedTotal: total,
    universe: input.universe,
    gaps,
    readerSentence,
  };
}

/* ── 3. Independent expenditures supporting or opposing this side ─────────── */

/**
 * The third question, and the one whose wrong answer is worst.
 *
 * It takes `IndependentExpenditureReport`s — a container with no `contributions`
 * field — and returns `supporting` and `opposing` as two separate numbers. There
 * is no combined figure and no path from this function's output into a receipts
 * total, because `isMoneyReceivedByTheSubject` is the literal `false` and the
 * arm carries no `reportedTotal` a receipts renderer could pick up.
 */
export function answerIndependentExpenditures(input: {
  subjectId: string;
  subjectDisplayName: string;
  /** The candidacy or the measure SIDE the question is about. */
  aboutSide?: MeasureSide | null;
  reports: readonly IndependentExpenditureReport[];
  universe: HeldFilingUniverse;
  gaps?: readonly AttributedGap[];
}): FinanceAnswer {
  assertCited(input.universe, "INDEPENDENT_EXPENDITURES");

  const records: IndependentExpenditure[] = [];
  for (const report of input.reports) {
    for (const ie of report.independentExpenditures) {
      if (ie.relation.aboutCandidacyId === input.subjectId) records.push(ie);
    }
  }
  assertRecordKind(records, "INDEPENDENT_EXPENDITURE", "INDEPENDENT_EXPENDITURES");

  let supporting = 0;
  let opposing = 0;
  for (const ie of records) {
    if (ie.relation.stance === "SUPPORTS") supporting += ie.amountSpentIndependently;
    else opposing += ie.amountSpentIndependently;
  }

  const gaps = [...(input.gaps ?? [])];
  if (records.length === 0 && !input.universe.recordClassesHeld.includes("INDEPENDENT_EXPENDITURE_REPORT")) {
    gaps.push({
      attribution: "OURS",
      subject: input.subjectId,
      what: "no independent-expenditure report class is held for this subject at all",
      nextMove:
        "Acquire the authority's independent-expenditure reports. Until then this is unmeasured, " +
        "and unmeasured is not zero.",
      readerSentence:
        "We have not recorded any outside spending about this race. Outside spending is money spent " +
        "by groups that gave the campaign nothing, and we have not been able to read those reports " +
        "yet — so this is a gap in our records, not a finding that none exists.",
    });
  }

  const sideWords = input.aboutSide === null || input.aboutSide === undefined
    ? "this candidate"
    : input.aboutSide === "SUPPORT"
      ? "the yes side"
      : "the no side";

  const readerSentence =
    records.length > 0
      ? `${records.length} independent expenditure(s) about ${sideWords}: ` +
        `$${supporting.toLocaleString("en-US")} spent in support and ` +
        `$${opposing.toLocaleString("en-US")} spent in opposition. This is money spent by outside ` +
        `groups. None of it was received by ${input.subjectDisplayName}.`
      : `We have no records of outside spending about ${sideWords} yet.`;

  return {
    question: "INDEPENDENT_EXPENDITURES",
    recordKind: "INDEPENDENT_EXPENDITURE",
    subjectId: input.subjectId,
    subjectDisplayName: input.subjectDisplayName,
    records,
    supporting,
    opposing,
    isMoneyReceivedByTheSubject: false,
    universe: input.universe,
    gaps,
    readerSentence,
  };
}

/* ── The whole-subject answer set ─────────────────────────────────────────── */

export interface FinanceAnswerSet {
  readonly subjectId: string;
  readonly answers: readonly FinanceAnswer[];
  /** True when every question got either records or an attributed gap. */
  readonly everyQuestionAddressed: boolean;
  /** True when no two differently-attributed gaps share a reader sentence. */
  readonly attributionsDistinct: boolean;
}

/**
 * All three questions for one subject, checked as a SET.
 *
 * Asked one at a time, each answer looks fine. The set is where the two
 * cross-question failures live: a question that silently produced nothing at
 * all, and two gaps with different owners wearing the same sentence.
 */
export function answerSetFor(answers: readonly FinanceAnswer[]): FinanceAnswerSet {
  const asked = new Set(answers.map((a) => a.question));
  const allGaps = answers.flatMap((a) => a.gaps);
  return {
    subjectId: answers[0]?.subjectId ?? "",
    answers,
    everyQuestionAddressed: FINANCE_QUESTIONS.every(
      (q) =>
        asked.has(q) &&
        answers.some((a) => a.question === q && (a.records.length > 0 || a.gaps.length > 0)),
    ),
    attributionsDistinct: attributionsDiffer(allGaps),
  };
}
