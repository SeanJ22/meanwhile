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
import {
  compileExpectation,
  inferApplicability,
  unresolvedTokens,
} from "../lib/health/owner-corpus-compile.ts";

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
 * **A KEPT QUESTION IS COMPILED, NOT MERELY COPIED.** (Session B resume, W4.)
 *
 * This block used to write every template with `applicability: PER_ZIP`,
 * `placeholders: []` and no expectation, under a comment arguing that
 * compiling the owner's right-answer column "would be this loader writing its
 * own answer key". The result was nine templates, thirty-six instances, and
 * thirty-six NOT_EVALUABLE — a reader contract that measured nothing.
 *
 * The argument confused INVENTING a standard with TRANSCRIBING one. The owner
 * wrote the standard; `lib/health/owner-corpus-compile.ts` turns it into a
 * typed expectation and cites the row it came from, and where the prose does
 * not determine a checkable proposition it says so FOR THAT ROW and compiles
 * nothing. The owner's text stays the authority in every case.
 */
/* Keyed by the workbook's own row id, which `loadControlFacts` now carries.
   The previous version zipped `loaded` against a filtered `matched` by index,
   which is a correspondence nothing enforced. */
const factById = new Map(controls.rows.map((r) => [r.id, r]));

interface Compilation {
  readonly id: string;
  readonly template: ReaderQuestionTemplate | null;
  readonly applicability: string;
  readonly expectation: string;
  readonly needs: readonly string[];
}

const compilations: Compilation[] = questions.loaded.map((q) => {
  const needs: string[] = [];

  /* A template whose text still carries an unresolved token may not be built
     at all: it would reach the Ask box with a literal bracket in it. */
  const tokens = unresolvedTokens(q.questionText);
  if (tokens.length > 0) {
    needs.push(
      `${q.id}'s question text still contains ${tokens.join(", ")}, which is not in the closed ` +
        `template vocabulary ([BODY], [ZIP]). Nothing renders it, so the question would be ` +
        `submitted with the bracket in it. Resolve it in the workbook.`,
    );
  }

  const applicability = inferApplicability(q);
  if (applicability.kind === "AMBIGUOUS") needs.push(applicability.needs);

  const expectation = compileExpectation(q, (id) => factById.get(id) ?? null, applicability);
  if (expectation.kind === "NEEDS_OWNER") needs.push(expectation.needs);

  const buildable = tokens.length === 0 && applicability.kind === "RESOLVED";
  return {
    id: q.id,
    template: buildable
      ? {
          id: q.id,
          questionClass: "HAND_AUTHORED_ADVERSARIAL",
          templateText: q.questionText,
          placeholders: [],
          applicability: applicability.rule,
          ...(expectation.kind === "COMPILED"
            ? { expectation: expectation.compiled.expectation }
            : {}),
        }
      : null,
    applicability:
      applicability.kind === "RESOLVED"
        ? `${applicability.rule.kind} — ${applicability.basis}`
        : "AMBIGUOUS",
    expectation:
      expectation.kind === "COMPILED"
        ? `${expectation.compiled.expectation.kind} — ${expectation.compiled.basis} (cites ${expectation.compiled.sourceRows.join(", ")})`
        : "NONE",
    needs,
  };
});

const templates: ReaderQuestionTemplate[] = compilations
  .map((c) => c.template)
  .filter((t): t is ReaderQuestionTemplate => t !== null);

writeFileSync(
  join(HEALTH, "reader-questions.json"),
  `${JSON.stringify(templates, null, 2)}\n`,
  "utf8",
);

console.log(`\n  COMPILATION — ${templates.length} of ${questions.loaded.length} kept question(s) built into a template`);
for (const c of compilations) {
  console.log(`    ${c.id}  applicability: ${c.applicability}`);
  console.log(`        expectation: ${c.expectation}`);
  for (const n of c.needs) console.log(`        NEEDS OWNER: ${n}`);
}

/*
 * **A CORPUS THAT LOADS N AND EVALUATES ZERO IS A SILENT ZERO.**
 * (Session B WI1.4, kept.)
 *
 * `0 questions loaded` is a defect the report makes obvious. `9 questions
 * loaded, every one NOT_EVALUABLE` reads as a working corpus and is the same
 * hole wearing a number. The difference now is that every gap has a NAMED
 * cause on the line above it, addressed to the person who can close it.
 */
const evaluable = templates.filter((t) => t.expectation !== undefined);
console.log(
  `\n  ${evaluable.length} of ${questions.loaded.length} kept question(s) carry a typed ` +
    `expectation and can be GREEN or RED. ${questions.loaded.length - evaluable.length} cannot, ` +
    "and each names what the owner must supply.",
);

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
