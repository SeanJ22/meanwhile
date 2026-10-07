/**
 * Three bounded campaign-finance questions, answered from held records or a
 * named gap that says whose gap it is:
 *
 *   1. Who has contributed to this campaign?
 *   2. How much has this committee reported spending?
 *   3. Are there independent expenditures supporting or opposing this side?
 *
 * `FinanceAnswer` is a discriminated union keyed on the question, so an
 * independent expenditure cannot be rendered as money a candidate received;
 * `assertRecordKind` re-checks every row at runtime and throws on a cast.
 * `HeldFilingUniverse.isCompleteFilingSet` is literal `false`.
 *
 * Nothing here reads a clock; `asOf` is caller-supplied.
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

/** The record kind each question is answered with. One question, one kind. */
export const RECORD_KIND_FOR_QUESTION: Readonly<Record<FinanceQuestion, string>> = {
  WHO_CONTRIBUTED: "CONTRIBUTION",
  WHAT_WAS_SPENT: "EXPENDITURE",
  INDEPENDENT_EXPENDITURES: "INDEPENDENT_EXPENDITURE",
};

/* ── Whose gap is it? ─────────────────────────────────────────────────────── */

/**
 * Who the missing thing is missing from.
 *
 *   - `OURS`: we have not retrieved it (a wall, blocked route, unread calendar).
 *   - `THE_FILER`: what the committee filed says none; only from a held filing.
 *   - `THE_AUTHORITY`: the custodian does not publish it; needs the strongest evidence.
 *   - `THE_LAW`: a legal restriction on us withholds it.
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
  /** The sentence a reader sees: plain language, and different for different attributions. */
  readonly readerSentence: string;
}

/** True when no two gaps with different attributions share a reader sentence. */
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

/** What we hold and what we do not. Every answer carries one. */
export interface HeldFilingUniverse {
  /** The custodians whose records these are. Empty means unresolved, not none. */
  readonly authorityIds: readonly string[];
  /** The custodian's own name, for the reader sentence. */
  readonly authorityNames: readonly string[];
  /** Who serves the records, which may be neither the office nor the authority. */
  readonly publisherRoute: string | null;
  readonly recordClassesHeld: readonly FilingRecordClass[];
  /** Named, never counted. Three labels are three next actions; "3 missing" is not. */
  readonly recordClassesNotHeld: readonly FilingRecordClass[];
  /** The authority's labels for the periods it says are due. Null means the calendar was not read: a gap, never a zero. */
  readonly periodsExpected: readonly string[] | null;
  readonly periodsHeld: readonly string[];
  readonly periodsNotHeld: readonly string[];
  /** The latest date any held record covers THROUGH. Null when nothing is held. */
  readonly coversThrough: string | null;
  /** What the figures actually came off — a filing, or an authority's arithmetic. */
  readonly evidenceBasis: EvidenceBasis | null;
  /** How the held rows are cut ("the ten largest itemized receipts"). Null only when nothing is held. */
  readonly itemizationLimit: string | null;
  /** Never true. */
  readonly isCompleteFilingSet: false;
  /** Repo paths or URLs. An answer with none is refused. */
  readonly sourceCitations: readonly string[];
}

/* ── Refusals ─────────────────────────────────────────────────────────────── */

export class RenderRefused extends Error {
  /** Declared explicitly: strip-types mode does not parse parameter properties. */
  readonly question: FinanceQuestion;
  readonly offendingKind: string;

  constructor(message: string, question: FinanceQuestion, offendingKind: string) {
    super(message);
    this.name = "RenderRefused";
    this.question = question;
    this.offendingKind = offendingKind;
  }
}

/** Re-check `recordKind` on every row at runtime; throws rather than filtering. */
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

/** A total the authority reported, kept separate from the rows we hold. */
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
      /** Never true: an independent expenditure supporting a candidate is not money that candidate received. */
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

  /** The gap between the rows held and the reported total, stated. */
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

  /** A reported total with no itemized rows is still an answer, and says it is not itemized. */
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
 * Supporting and opposing are two separate numbers with no combined figure and
 * no path into a receipts total.
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

/** All three questions for one subject, checked as a set. */
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
