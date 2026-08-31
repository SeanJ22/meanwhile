/**
 * `pnpm owner:corpus` — load the owner's answer key and question corpus.
 *
 * Reads `docs/Meanwhile-Owner-Checklist.xlsx` through the repository's own
 * workbook reader (`scripts/xlsx.mjs` — there is no spreadsheet library here
 * and two ZIP codecs would be two places for a byte-level bug) and writes:
 *
 * ```
 *   data/health/control-facts.json      the TRUTH contract's answer key
 *   data/health/reader-questions.json   the READER contract's corpus
 * ```
 *
 * The criteria live in `lib/health/owner-corpus.ts` and are applied there, so
 * this script is transport and reporting only. What it adds is the REPORT: the
 * rows seen, the rows that met the criteria BY ID, the rows excluded and why,
 * and the count actually written. Stated N equals rendered rows — a reader of
 * this output can check every number against a list of ids printed beside it.
 *
 * **A row that does not meet the criteria is not loaded and is not mentioned
 * as loaded.** It is not mentioned as anything: the tabs hold drafted rows the
 * owner has not looked at yet, and listing them here would read as a backlog
 * this session was supposed to have processed.
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import { assertValidControlFact, validateControlFact } from "../lib/health/control-fact.ts";
import { floorLine, floored } from "../lib/ops/denominator-floor.ts";
import {
  loadControlFacts,
  loadKeptQuestions,
  type SheetRow,
} from "../lib/health/owner-corpus.ts";
import type { ReaderQuestionTemplate } from "../lib/health/reader-question.ts";

import { readWorkbook } from "./xlsx.mjs";

const ROOT = process.cwd();
const WORKBOOK = join(ROOT, "docs", "Meanwhile-Owner-Checklist.xlsx");
const HEALTH = join(ROOT, "data", "health");

const CONTROL_SHEET = "Control facts";
const QUESTION_SHEET = "Adversarial questions";

/** A sheet's rows keyed by its own header row. Never by column index. */
function rowsOf(sheets: { name: string; rows: string[][] }[], name: string): SheetRow[] {
  const sheet = sheets.find((s) => s.name === name);
  if (!sheet) {
    throw new Error(
      `${WORKBOOK} has no sheet named ${JSON.stringify(name)}. The tabs present are ` +
        `${sheets.map((s) => JSON.stringify(s.name)).join(", ")}. Refusing to guess which one ` +
        "was meant: reading the wrong tab would seed the answer key from the wrong column set.",
    );
  }
  const header = (sheet.rows[0] ?? []).map((h) => String(h ?? "").trim());
  return sheet.rows.slice(1).map((row) => {
    const out: Record<string, string> = {};
    header.forEach((key, i) => {
      out[key] = String(row[i] ?? "");
    });
    return out;
  });
}

const sheets = readWorkbook(readFileSync(WORKBOOK)) as { name: string; rows: string[][] }[];

console.log(`owner:corpus · reading ${WORKBOOK}`);
console.log(`  tabs: ${sheets.map((s) => s.name).join(" · ")}`);

/* ------------------------------------------------------- control facts --- */

const controls = loadControlFacts(rowsOf(sheets, CONTROL_SHEET));

console.log(`\n  ${CONTROL_SHEET}: ${controls.seen} row(s) with an ID`);
/*
 * RULING 159: the count is stated against the population it was taken over, so
 * "2 confirmed" can never be read as "2 rows exist". A tab with no ID'd rows
 * COULD NOT ASSERT rather than reporting a measured zero — the workbook being
 * unreachable and the owner having confirmed nothing are different facts.
 */
console.log(
  `    ${floorLine(
    floored(
      "Status CONFIRMED",
      `the ${CONTROL_SHEET} tab`,
      controls.seen,
      controls.matched.length,
      controls.seen === 0 ? "the tab holds no rows with an ID" : undefined,
    ),
  )} — ${controls.matched.join(", ") || "none"}`,
);
for (const ex of controls.excluded) {
  console.log(`    excluded ${ex.id}: ${ex.why}`);
}
console.log(`    loaded: ${controls.loaded.length}`);

/*
 * A confirmed row that is not a WELL-FORMED fact is reported, by id, and still
 * written. The owner looked and said yes; discarding their confirmation
 * because a required column is blank would lose the one thing the workbook
 * exists to capture. `truthContract` reads the store and the validator reads
 * it too, so an incomplete absence is visible as incomplete rather than gone.
 */
const invalid = controls.loaded
  .map((fact, i) => ({ fact, problems: validateControlFact(fact), index: i }))
  .filter((row) => row.problems.length > 0);
for (const row of invalid) {
  console.log(
    `    INCOMPLETE (written, and reported): ${JSON.stringify(row.fact.statement.slice(0, 60))} ` +
      `— ${row.problems.join("; ")}`,
  );
}
for (const { fact } of controls.loaded.map((fact) => ({ fact })).filter((_, i) => !invalid.some((v) => v.index === i))) {
  assertValidControlFact(fact);
}

const present = controls.loaded.filter((f) => f.fact_class === "known_present").length;
const absence = controls.loaded.length - present;
console.log(`    ${present} known_present · ${absence} known_absence`);

mkdirSync(HEALTH, { recursive: true });
writeFileSync(
  join(HEALTH, "control-facts.json"),
  `${JSON.stringify(controls.loaded, null, 2)}\n`,
  "utf8",
);

/* ---------------------------------------------------------- questions --- */

const questions = loadKeptQuestions(rowsOf(sheets, QUESTION_SHEET));

console.log(`\n  ${QUESTION_SHEET}: ${questions.seen} row(s) with an ID`);
console.log(
  `    ${floorLine(
    floored(
      "marked KEEP or EDIT",
      `the ${QUESTION_SHEET} tab`,
      questions.seen,
      questions.matched.length,
      questions.seen === 0 ? "the tab holds no rows with an ID" : undefined,
    ),
  )} — ${questions.matched.join(", ") || "none"}`,
);

/*
 * A kept question becomes a HAND_AUTHORED_ADVERSARIAL template, which is the
 * class that exists precisely because it is NOT generated from the registry.
 * It carries no `expectation` unless the owner stated a typed one — the
 * "What the RIGHT answer looks like" column is prose for a human auditor and
 * turning it into a machine expectation would be this session inventing the
 * answer key it is supposed to be measured against.
 */
const templates: ReaderQuestionTemplate[] = questions.loaded.map((q) => ({
  id: q.id,
  questionClass: "HAND_AUTHORED_ADVERSARIAL",
  templateText: q.questionText,
  placeholders: [],
  applicability: { kind: "PER_ZIP" },
}));

writeFileSync(
  join(HEALTH, "reader-questions.json"),
  `${JSON.stringify(templates, null, 2)}\n`,
  "utf8",
);
console.log(`    loaded: ${templates.length}`);

/*
 * **A CORPUS THAT LOADS N AND EVALUATES ZERO IS A SILENT ZERO.**
 * (Session B WI1.4.)
 *
 * `0 questions loaded` is a defect the report makes obvious. `9 questions
 * loaded, every one NOT_EVALUABLE` reads as a working corpus and is the same
 * hole wearing a number: nothing about the product is measured either way.
 * The count and the ids are stated here, at the loader, so the gap is a fact
 * about the run rather than something a reader has to reconstruct from the
 * suite's NOT_EVALUABLE tally.
 *
 * The expectations are NOT derived from the prose. That column is written for
 * a human auditor, and turning it into a machine expectation would be this
 * session authoring the answer key it is then graded against.
 */
const withoutExpectation = templates.filter((t) => t.expectation === undefined);
if (withoutExpectation.length > 0) {
  console.log(
    `    NOT_EVALUABLE by construction: ${withoutExpectation.length} of ${templates.length} ` +
      `template(s) carry no typed expectation — ${withoutExpectation.map((t) => t.id).join(", ")}. ` +
      "These are LOADED and can never be GREEN. The owner's right-answer column is prose; " +
      "deriving a machine expectation from it would be this loader writing its own answer key.",
  );
}

/* The owner's edits that AMEND rather than replace. Product requirements, and
   they are not questions — reported here because a loader that drops them
   makes the owner state them twice. */
const amendments = questions.loaded.filter((q) => q.ownerAmendment !== null);
if (amendments.length > 0) {
  console.log(
    `    owner amendments kept beside the drafted question (not submitted as questions): ` +
      amendments.map((q) => q.id).join(", "),
  );
  for (const q of amendments) console.log(`      ${q.id}: ${q.ownerAmendment}`);
}

console.log(
  `\n  wrote data/health/control-facts.json (${controls.loaded.length}) and ` +
    `data/health/reader-questions.json (${templates.length}).`,
);
