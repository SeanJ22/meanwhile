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

/** What a load pass found, with every count derived from the rows themselves. */
export interface CorpusLoad<T> {
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
  }

  return { matched, excluded, loaded, seen: rows.filter((r) => (r["ID"] ?? "").trim()).length };
}

/** A question the owner kept, before it becomes a template. */
export interface KeptQuestion {
  readonly id: string;
  readonly questionText: string;
  readonly rightAnswer: string;
  readonly ownerEdit: string;
}

/**
 * Load the adversarial questions the owner marked KEEP or EDIT.
 *
 * An EDIT row's own text wins where the owner wrote one: the edit column is
 * the owner correcting the drafted question, and preferring the draft over
 * the correction would ask the question they told us not to ask.
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
    loaded.push({
      id,
      questionText: edit || (row["Question (fully written — keep, edit, or kill)"] ?? "").trim(),
      rightAnswer: (row["What the RIGHT answer looks like"] ?? "").trim(),
      ownerEdit: edit,
    });
  }

  return { matched, excluded: [], loaded, seen: rows.filter((r) => (r["ID"] ?? "").trim()).length };
}
