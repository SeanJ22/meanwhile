/**
 * **WRITE `docs/candidate-questionnaire.md` FROM THE INSTRUMENT ITSELF.**
 * (The questionnaire-and-corpora brief, item 1, 2026-08-23.)
 *
 * ```
 * corepack pnpm questionnaire:doc            # report only
 * corepack pnpm questionnaire:doc --write
 * ```
 *
 * The brief requires the question set to be a versioned document in `docs/`,
 * because changing it mid-cycle across candidates who answered the old version
 * breaks symmetry. A HAND-WRITTEN document would be a second copy of the
 * questions that can disagree with the one the candidates are actually asked —
 * the exact drift `CLAUDE.md` names when it says a stale constitution is worse
 * than a short one.
 *
 * So the document is GENERATED from `lib/questionnaire/instrument.ts`, which is
 * the single copy, and `tests/questionnaire.test.ts` fails the build if the
 * committed document is not what this script would write today.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  CLASS_QUESTIONS,
  CORE_QUESTIONS,
  INSTRUMENT_VERSION,
  INSTRUMENT_VERSION_ADOPTED,
  OFFICE_CLASSES,
  WORD_LIMIT,
} from "../lib/questionnaire/instrument.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const DOC = join(ROOT, "docs/candidate-questionnaire.md");

const CLASS_TITLES: Record<string, string> = {
  school_board: "School board",
  municipal_governing: "Town, township, borough or city governing body",
  county_governing: "County governing board",
  county_row_office: "County office that runs one service (clerk, sheriff, surrogate and the like)",
  state_legislative: "State legislature",
  state_executive: "Statewide executive office",
  federal_legislative: "United States Senate or House of Representatives",
  special_district: "Special district (water, fire, library and the like)",
  other: "Any other office",
};

export function render(): string {
  const lines: string[] = [];
  lines.push(`# The candidate questionnaire — question set \`${INSTRUMENT_VERSION}\``);
  lines.push("");
  lines.push(
    "**GENERATED FILE.** Written by `corepack pnpm questionnaire:doc --write` from",
  );
  lines.push(
    "`lib/questionnaire/instrument.ts`, which is the single copy of these questions.",
  );
  lines.push(
    "Editing this file by hand makes it disagree with what candidates are actually",
  );
  lines.push("asked; `tests/questionnaire.test.ts` fails the build when it does.");
  lines.push("");
  lines.push(`Version \`${INSTRUMENT_VERSION}\`, fixed ${INSTRUMENT_VERSION_ADOPTED}.`);
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("## Why the version is recorded on every answer");
  lines.push("");
  lines.push(
    "Changing the question set mid-cycle across candidates who already answered the",
  );
  lines.push(
    "old version breaks symmetry: two people in one contest would have answered two",
  );
  lines.push(
    "different instruments, and their answers would render side by side as though",
  );
  lines.push(
    "they had answered the same one. So the version travels with the response and a",
  );
  lines.push("bump is a decision, never a tidy-up.");
  lines.push("");
  lines.push("## The rules every question here is held to");
  lines.push("");
  lines.push("- **Five questions.** Three core, two keyed to the kind of office.");
  lines.push(
    `- **${WORD_LIMIT} words per answer — the same limit for every question, every candidate,`,
  );
  lines.push(
    "  every contest and every office class.** Nothing is ever truncated: an",
  );
  lines.push(
    "  over-limit answer is refused at submit time with its own word count shown, and",
  );
  lines.push("  the candidate decides what to cut.");
  lines.push(
    "- **Non-leading.** No question that can only be answered from one side, and none",
  );
  lines.push("  that assumes a candidate wants to change anything or keep anything.");
  lines.push(
    "- **No question tells a candidate what the office does.** That would be an",
  );
  lines.push(
    "  unsourced claim about a class of body wearing a question mark. Every class",
  );
  lines.push("  question asks.");
  lines.push("- **Plain language.** Every question passes the 15-year-old test.");
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("## The core — asked of every candidate for every office at every level");
  lines.push("");
  for (const [i, q] of CORE_QUESTIONS.entries()) {
    lines.push(`${i + 1}. **${q.text}**`);
    lines.push(`   *${q.wordLimit} words · \`${q.id}\`*`);
  }
  lines.push("");
  lines.push("## The class layer — two questions, by kind of office");
  lines.push("");
  for (const officeClass of OFFICE_CLASSES) {
    lines.push(`### ${CLASS_TITLES[officeClass]} — \`${officeClass}\``);
    lines.push("");
    for (const [i, q] of CLASS_QUESTIONS[officeClass].entries()) {
      lines.push(`${i + 4}. **${q.text}**`);
      lines.push(`   *${q.wordLimit} words · \`${q.id}\`*`);
    }
    lines.push("");
  }
  lines.push("---");
  lines.push("");
  lines.push("## What happens to an answer");
  lines.push("");
  lines.push(
    "It publishes **verbatim**. Nobody edits it, shortens it, summarises it, rewrites",
  );
  lines.push(
    "it, paraphrases it, compresses it with a language model, fact-checks inside it,",
  );
  lines.push(
    "rates it or adds an editorial note to it. The Citizens Clean Elections",
  );
  lines.push("Commission's *in their own words* is the model.");
  lines.push("");
  lines.push(
    "A candidate may update an answer at any time. Every version is kept with its",
  );
  lines.push(
    "date; the latest renders, marked with the date it was updated. A candidate who",
  );
  lines.push(
    "withdraws returns to the neutral invited state — the card does not say they",
  );
  lines.push("answered and then withdrew.");
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function main(): void {
  const wanted = render();
  const write = process.argv.includes("--write");
  let current = "";
  try {
    current = readFileSync(DOC, "utf8");
  } catch {
    current = "";
  }

  const questions = CORE_QUESTIONS.length + OFFICE_CLASSES.length * 2;
  console.log(`questionnaire doc — instrument ${INSTRUMENT_VERSION}`);
  console.log(`  core questions       ${CORE_QUESTIONS.length}`);
  console.log(`  office classes       ${OFFICE_CLASSES.length}`);
  console.log(`  questions in the set ${questions}`);
  console.log(`  asked per candidate  ${CORE_QUESTIONS.length + 2}`);

  if (current === wanted) {
    console.log("  document             CURRENT");
    return;
  }
  if (!write) {
    console.error("  document             STALE — run with --write");
    process.exitCode = 1;
    return;
  }
  writeFileSync(DOC, wanted);
  console.log(`  document             WRITTEN (${wanted.length} bytes)`);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop() ?? "")) {
  main();
}
