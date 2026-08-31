/**
 * **THE OWNER'S WORKBOOK, READ UNDER ITS OWN STATED CRITERIA.**
 * (A.1, 2026-08-30.)
 *
 * `docs/Meanwhile-Owner-Checklist.xlsx` is the answer key and the question
 * corpus, filled in by the owner against primary sources. This module turns it
 * into `data/health/control-facts.json` and `data/health/reader-questions.json`
 * — and the whole discipline is in what it REFUSES to load.
 *
 * ## The criteria, and they are not negotiable per run
 *
 * ```
 *   Control facts tab          Status is CONFIRMED           and nothing else
 *   Adversarial questions tab  Keep? is KEEP or EDIT         and nothing else
 * ```
 *
 * A row the owner marked `COULD NOT TELL`, `WRONG`, `SKIPPED`, or left blank
 * is NOT an answer key entry. The workbook's own READ ME says so — *"Nothing
 * is a control fact until YOU looked"* — and a loader that took a drafted row
 * because it looked complete would seed the truth contract with the machine's
 * own claims and then grade the machine against them. That is the coverage
 * attack mode pointed at the answer key.
 *
 * ## The EXAMPLE row is excluded BY ID, and that is stated in the report
 *
 * Row `EX` carries `Status: CONFIRMED` and satisfies the criterion literally.
 * It is also the workbook's own documented demonstration row — the READ ME
 * says *"see the EXAMPLE row at the top of Control facts"* — and its statement
 * begins with the word EXAMPLE. Loading it would put a formatting
 * demonstration into the answer key.
 *
 * So it is excluded, by id, and the count of rows meeting the criteria is
 * reported SEPARATELY from the count loaded. Stated N equals rendered rows
 * applies to a refusal as much as to an acceptance: the reader of the report
 * can see exactly one row was set aside and why.
 *
 * ## Excel serial dates
 *
 * The owner types dates into a date-formatted cell, so `2026-08-30` arrives as
 * `46264`. Converted here rather than stored raw: a `verified_date` of `46264`
 * would pass every validator and be meaningless in every report.
 */

import type { ControlFact, FactClass } from "./control-fact.ts";

/** The workbook's own demonstration row. Excluded by id, never by heuristic. */
export const EXAMPLE_ROW_ID = "EX";

/** The one Status value that makes a row an answer-key entry. */
export const CONFIRMED = "CONFIRMED";

/**
 * **OWNER UNCERTAINTY IS NOT EVIDENCE, IN EITHER DIRECTION.**
 * (Session B closure, 2026-08-31, the author's correction.)
 *
 * `COULD NOT TELL`, `SKIPPED` and a blank Status carry ZERO evidentiary
 * weight. They are never corroboration of an absence and never corroboration
 * of a presence. They record one thing: that the owner has not yet looked, or
 * looked and could not answer.
 *
 * This is written down because it was got wrong. A Session B report said a
 * reader-suite RED was *"corroborated by the owner's own F2 being COULD NOT
 * TELL"* — reasoning from the owner's uncertainty to a conclusion about what a
 * government publishes. That is the same substitution the whole product exists
 * to refuse, arriving through the answer key rather than through a render: the
 * absence of a reading became a reading.
 *
 * It was also, as it happens, false. Walking the routes afterwards found 417
 * roll calls and 2,083 per-person vote rows held from that very tenant, 285 of
 * them for the exact sitting the claim was about. An unverified row is not
 * evidence, and reasoning from one had produced a statement that measurement
 * contradicted outright.
 *
 * A `known_absence` row is evidence ONLY with authority, period and
 * verified_through filled — `validateControlFact` enforces that half.
 */
export const NON_EVIDENTIARY_STATUSES: readonly string[] = [
  "COULD NOT TELL",
  "COULD_NOT_TELL",
  "SKIPPED",
  "WRONG",
  "",
];

/** Is this row's status one that may be cited as evidence at all? */
export function isCitableAsEvidence(status: string): boolean {
  return String(status ?? "").trim().toUpperCase() === CONFIRMED;
}

/**
 * Refuse to let a non-CONFIRMED row be used as evidence.
 *
 * Throws rather than returning false, because every caller of this is about to
 * treat the row as an answer-key entry, and a boolean that a caller can ignore
 * is the shape that let the original mistake through.
 */
export function assertCitableAsEvidence(id: string, status: string): void {
  if (isCitableAsEvidence(status)) return;
  throw new Error(
    `Control facts row ${id} has Status ${JSON.stringify(String(status ?? "").trim() || "(blank)")} ` +
      "and may not be cited as evidence. COULD NOT TELL, SKIPPED, WRONG and blank carry zero " +
      "evidentiary weight in EITHER direction: they are never corroboration of an absence and " +
      "never corroboration of a presence. Only CONFIRMED is evidence, and a known_absence row " +
      "is evidence only with authority, period and verified_through filled.",
  );
}

/** The Keep? values that make a question part of the corpus. */
export const KEEP_VALUES: readonly string[] = ["KEEP", "EDIT"];

/**
 * An Excel serial date, or a date string, as an ISO day.
 *
 * Returns the input untouched when it is neither — an unrecognised value is
 * reported as it was written rather than converted into a plausible date. A
 * fabricated date misdates every rule the row was verified under.
 */
export function excelDay(value: string): string {
  const text = String(value ?? "").trim();
  if (/^\d{5}$/.test(text)) {
    const ms = Date.UTC(1899, 11, 30) + Number(text) * 86_400_000;
    return new Date(ms).toISOString().slice(0, 10);
  }
  return text;
}

/** One row of the Control facts tab, by header name. */
export type SheetRow = Readonly<Record<string, string>>;

/**
 * One loaded row, WITH the workbook id and Notes it came from.
 *
 * (Session B resume, W4.) `loaded` alone lost two things the compiler needs.
 * The ID, because a `ControlFact` carries a statement and not a row id, so
 * nothing downstream could ask for "F5". And the NOTES, because the owner types
 * material there that the typed fact has no field for — F5's Notes hold the
 * five supervisors by name, which is the roster a per-member LIST expectation
 * must cite rather than derive. Both were dropped on load, so the roster the
 * owner supplied was invisible to everything that needed it.
 */
export interface LoadedRow<T> {
  readonly id: string;
  readonly notes: string;
  /** The workbook Status this row carried. Only CONFIRMED is evidence. */
  readonly status?: string;
  readonly value: T;
}

/** What a load pass found, with every count derived from the rows themselves. */
export interface CorpusLoad<T> {
  /** The loaded rows with their workbook id and Notes. Parallel to `loaded`. */
  readonly rows: readonly LoadedRow<T>[];
  /** Rows that met the stated criteria, before any exclusion. */
  readonly matched: readonly string[];
  /** Rows excluded after matching, with the reason. */
  readonly excluded: readonly { readonly id: string; readonly why: string }[];
  /** What was actually loaded. */
  readonly loaded: readonly T[];
  /** Every row the loader saw, so a denominator exists. */
  readonly seen: number;
}

/**
 * Load the control facts.
 *
 * `PRESENT`/`ABSENCE` in the Type column maps to the two fact classes. The
 * absence class carries required fields the workbook collects in its own
 * columns (Authority, Verified through) and `validateControlFact` refuses one
 * that is missing them — which is why a confirmed absence with a blank
 * Authority is loaded and then REPORTED as invalid rather than silently
 * dropped: the owner confirmed something, and quietly discarding it would lose
 * the confirmation.
 */
export function loadControlFacts(rows: readonly SheetRow[]): CorpusLoad<ControlFact> {
  const matched: string[] = [];
  const excluded: { id: string; why: string }[] = [];
  const loaded: ControlFact[] = [];
  const rows_: LoadedRow<ControlFact>[] = [];

  for (const row of rows) {
    const id = (row["ID"] ?? "").trim();
    if (!id) continue;
    const status = (row["Status"] ?? "").trim().toUpperCase();
    if (status !== CONFIRMED) continue;
    matched.push(id);
    if (id === EXAMPLE_ROW_ID) {
      excluded.push({
        id,
        why:
          "the workbook's own documented EXAMPLE row (its READ ME points at it as the model " +
          "for a completed row); loading it would seed the answer key with a formatting demo",
      });
      continue;
    }
    const factClass: FactClass =
      (row["Type"] ?? "").trim().toUpperCase() === "ABSENCE" ? "known_absence" : "known_present";
    loaded.push({
      statement: (row["Fact to verify (drafted — confirm or correct)"] ?? "").trim(),
      /* The owner states a fact in prose and verifies it against a source. The
         typed proposition is that prose, as a proposition — never a blessed
         sentence to string-match a surface against, which is what
         `ExpectedTruth.proposition` exists to keep honest. */
      expected_truth: {
        kind: "proposition",
        proposition: (row["Fact to verify (drafted — confirm or correct)"] ?? "").trim(),
      },
      fact_class: factClass,
      verification_source: (row["Source link (paste)"] ?? "").trim(),
      verified_by: "owner",
      verified_date: excelDay(row["Verified through (date)"] ?? ""),
      ...(factClass === "known_absence"
        ? {
            authority: (row["Authority (absences only)"] ?? "").trim(),
            period: excelDay(row["Verified through (date)"] ?? ""),
            verified_through: (row["Source link (paste)"] ?? "").trim(),
          }
        : {}),
    });
    rows_.push({
      id,
      notes: (row["Notes"] ?? "").trim(),
      /* Carried so a consumer can be CHECKED against it rather than trusting
         that the loader filtered. The filter and the check are two guards. */
      status,
      value: loaded[loaded.length - 1],
    });
  }

  return {
    rows: rows_,
    matched,
    excluded,
    loaded,
    seen: rows.filter((r) => (r["ID"] ?? "").trim()).length,
  };
}

/** A question the owner kept, before it becomes a template. */
export interface KeptQuestion {
  readonly id: string;
  readonly questionText: string;
  readonly rightAnswer: string;
  readonly ownerEdit: string;
  /**
   * The owner's edit when it AMENDS rather than replaces. (Session B WI1.4.)
   *
   * Never dropped, because these carry product requirements: "add a small
   * clickable pill", "prioritize to the closest", "not just FEC filings".
   * Those are instructions, and an instruction silently discarded by a loader
   * is an instruction the owner will have to give again.
   */
  readonly ownerAmendment: string | null;
  /** The workbook's Notes column for this row, kept rather than dropped. */
  readonly notes: string;
}

/**
 * Is this edit a replacement QUESTION, or an amendment to one?
 *
 * The distinction matters because the answer decides what gets typed into the
 * Ask box. An edit reading *"As long as they are clickable"* is the owner
 * adding a requirement to the drafted question — submitting it as the question
 * would measure nothing, since it is not a question and has no answer to
 * evaluate.
 *
 * Deliberately narrow: a replacement must END in a question mark, or OPEN
 * with an interrogative. Both clauses are needed and neither is enough alone.
 *
 * Merely CONTAINING a question mark is not the test, and that distinction is
 * not hypothetical — the owner's edits on Q6 and Q7 read *"Add a small
 * clickable pill that says \"Want us to get this info sooner?\" so we can
 * start to prioritize…"*. A contains-test reads the pill's own copy and
 * promotes a product requirement into the Ask box.
 *
 * Everything else is an amendment, which is the safe direction: an amendment
 * wrongly kept beside the draft costs a slightly stale question, while a
 * requirement wrongly submitted as a question costs the whole instance.
 */
export function isQuestionShaped(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length === 0) return false;
  if (trimmed.endsWith("?")) return true;
  return /^(who|what|when|where|which|why|how|is|are|does|do|did|can|will|would|should)\b/i.test(
    trimmed,
  );
}

/**
 * Load the adversarial questions the owner marked KEEP or EDIT.
 *
 * ## The edit column is not always a replacement (Session B WI1.4)
 *
 * This read `questionText: edit || draft` — the edit wins whenever one
 * exists. That was right for the case it was written for and wrong for the
 * case that actually arrived: when the owner filled the tab, five of the nine
 * kept rows carried edits like *"Add a small clickable pill…"* and *"As long
 * as they are clickable"*. Those became the question text, so five of nine
 * loaded templates were instances that would type a requirement into the Ask
 * box and grade the answer.
 *
 * A corpus that loads nine and can evaluate four is the same defect as one
 * that loads zero, wearing a number. So a replacement must be question-shaped;
 * anything else is recorded as `ownerAmendment` beside the drafted question
 * and reported, never dropped and never submitted.
 */
export function loadKeptQuestions(rows: readonly SheetRow[]): CorpusLoad<KeptQuestion> {
  const matched: string[] = [];
  const loaded: KeptQuestion[] = [];

  for (const row of rows) {
    const id = (row["ID"] ?? "").trim();
    if (!id) continue;
    const keep = (row["Keep?"] ?? "").trim().toUpperCase();
    if (!KEEP_VALUES.includes(keep)) continue;
    matched.push(id);
    const edit = (row["Your edit / fill-in"] ?? "").trim();
    const draft = (row["Question (fully written — keep, edit, or kill)"] ?? "").trim();
    const replaces = isQuestionShaped(edit);
    loaded.push({
      id,
      questionText: replaces ? edit : draft,
      rightAnswer: (row["What the RIGHT answer looks like"] ?? "").trim(),
      ownerEdit: edit,
      ownerAmendment: edit && !replaces ? edit : null,
      notes: (row["Notes"] ?? "").trim(),
    });
  }

  return {
    rows: loaded.map((q) => ({ id: q.id, notes: q.notes, value: q })),
    matched,
    excluded: [],
    loaded,
    seen: rows.filter((r) => (r["ID"] ?? "").trim()).length,
  };
}
