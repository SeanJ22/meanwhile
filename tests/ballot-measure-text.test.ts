import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { BallotSet } from "@/lib/ballot/types";

/**
 * **BAL-30 (2026-08-28) — THE MEASURE TEXT WAS IN THE REPOSITORY AND THE PAGE
 * RENDERED IT AS MISSING.**
 *
 * The tracker row for this work said the defect was acquisition — *"NOT a
 * rendering defect… The work is acquisition."* It was not. `measures[]` has
 * carried the official question for four local Pima County measures, and the
 * official interpretive statement for two of them, since 2026-08-27.
 * `app/ballot/page.tsx` contained no reference to `set.measures`, to
 * `questionText` or to `officialStatement`; the array's only consumer was
 * `lib/ask/ballot-inventory.ts`, so a reader could obtain the words by ASKING
 * for them and not by reading the card they belong to.
 *
 * `lib/ballot/analyses.ts` states the rule in its own header: data in hand may
 * never be displayed as missing. These tests hold the render to it from both
 * ends — the data is really there, and the page really reaches for it.
 *
 * **THE UNNAMED CONTROL, and it is the reason this file is not one assertion.**
 * Propositions 428 (Sahuarita) and 429 (Tanque Verde) are the same class of
 * question from the same publisher as 423 (Vail), and their `officialStatement`
 * is null because the only document read for them is the Pima County School
 * Superintendent's list, which titles the question without stating the fiscal
 * terms. A render that showed 423 richly and 428 identically would be
 * manufacturing a claim; a render that showed them as the same sentence would
 * be hiding one. They must differ, and the difference must say whose gap it is.
 */

const ROOT = process.cwd();
const PAGE = readFileSync(join(ROOT, "app", "ballot", "page.tsx"), "utf8");

/**
 * Comments are stripped before every source assertion below. This file quotes
 * the exact strings it asserts on, and a guard that matches its own prose is a
 * guard that passes without the code being there.
 */
function code(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !/^\s*\/\//.test(line))
    .join("\n");
}

const SET = JSON.parse(
  readFileSync(join(ROOT, "data", "states", "az", "ballot", "az-pima-2026.json"), "utf8"),
) as BallotSet;

const measureOf = (contestId: string) =>
  SET.measures.find((m) => m.contestId === contestId) ?? null;

test("BAL-30: the local measure text is committed, and it is not thin", () => {
  const rich = ["ballot-az-pima:prop-425", "ballot-az-pima:prop-423"];
  const thin = ["ballot-az-pima:prop-428", "ballot-az-pima:prop-429"];

  for (const id of [...rich, ...thin]) {
    const measure = measureOf(id);
    assert.ok(measure, `${id} has no measure record — the render has nothing to show`);
    assert.ok(
      measure.questionText.trim().length > 120,
      `${id} carries ${measure.questionText.trim().length} characters of question text`,
    );
    assert.ok(measure.provenance.sourceOrg.length > 0, `${id} cites no publisher`);
  }

  for (const id of rich) {
    assert.ok(
      (measureOf(id)?.officialStatement ?? "").trim().length > 300,
      `${id} is one of the two the render must show RICHLY`,
    );
  }
  for (const id of thin) {
    assert.equal(
      measureOf(id)?.officialStatement,
      null,
      `${id} is the control — its statement must stay null so the gap branch is exercised`,
    );
  }
});

test("BAL-30: the ballot page renders the question and the statement it holds", () => {
  const src = code(PAGE);
  assert.match(
    src,
    /const measureFor = \(contestId: string\): Measure \| null =>/,
    "the page must look a measure up by the contest id its cards are keyed on",
  );
  assert.match(src, /measure\.questionText/, "the official question must reach the card");
  assert.match(
    src,
    /measure\.officialStatement/,
    "the official statement must reach the card",
  );
  assert.match(
    src,
    /data-measure-question=\{measure\.id\}/,
    "the question block must be addressable by a walk",
  );
});

test("BAL-30: a null statement renders as a NAMED gap, never as the rich branch", () => {
  const src = code(PAGE);

  const present = src.indexOf('data-measure-statement="PRESENT"');
  const gap = src.indexOf('"data-measure-statement": "GAP_OURS"');
  assert.ok(present > 0, "the statement-present branch is marked");
  assert.ok(gap > present, "the gap branch is marked, and it is a DIFFERENT branch");

  /*
   * The gap says whose it is. "We have not recorded" is a fact about us;
   * anything reading as "the authority published nothing" would be a claim
   * about a school district made out of a document we did not open.
   */
  assert.match(src, /<WorkingOnIt[^\n]+"data-measure-statement": "GAP_OURS"/,
    "FE-30: the missing statement uses the shared Reader hunt state");
  assert.ok(
    !/nothing was published|the district published no/i.test(src),
    "a gap of ours may never render as a claim about the authority",
  );
});

test("BAL-30: a school-district override no longer files under 'Statewide measures'", () => {
  const src = code(PAGE);

  assert.match(
    src,
    /const isStatewideDivision = \(ocdId: string\): boolean =>/,
    "the split must be read off the division, never asserted from the title",
  );
  assert.match(src, /heading: "Statewide measures"/);
  assert.match(src, /heading: "Local measures"/);

  /*
   * And the split really separates these four. The regex is the page's own —
   * duplicated here on purpose, because a shared helper that was wrong would
   * make both sides agree about the wrong answer.
   */
  const statewide = /^ocd-division\/country:us\/state:[a-z]{2}$/;
  const measures = SET.contests.filter((c) => c.type === "MEASURE");
  const local = measures.filter((c) => !statewide.test(c.ocdId));
  assert.deepEqual(
    local.map((c) => c.id).sort(),
    [
      "ballot-az-pima:prop-423",
      "ballot-az-pima:prop-425",
      "ballot-az-pima:prop-428",
      "ballot-az-pima:prop-429",
    ],
    "the four local measures are the four that must not sit under a statewide heading",
  );
  assert.ok(
    measures.length - local.length >= 11,
    "and the statewide group is still the Legislative Council's propositions",
  );
});
