import { azBallot } from "./helpers/ballot-district-fixtures.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { CardGapContribution } from "../components/ui/card-gap-context.tsx";
import { cardGapLine } from "../lib/design/card-gaps.ts";

import type { BallotSet } from "@/lib/ballot/types";

/** The measure text the ballot holds is rendered, and a measure whose statement was not read says whose gap that is. */

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

const SET = azBallot as BallotSet;

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

test("BAL-30: a null statement contributes one named card gap and renders no empty row", () => {
  const source = ts.createSourceFile("ballot.tsx", PAGE, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let statement: ts.ConditionalExpression | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isConditionalExpression(node) && node.condition.getText(source) === "measure.officialStatement") statement = node;
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.ok(statement, "exercise the production held/missing statement branch");
  const executable = ts.transpileModule(`return (${statement.getText(source)});`, {
    compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  const render = new Function("React", "CardGapContribution", "measure", "contest", executable).bind(null, React, CardGapContribution);
  for (const id of ["ballot-az-pima:prop-428", "ballot-az-pima:prop-429"]) {
    const measure = measureOf(id)!;
    const gap = render(measure, { id });
    assert.equal(gap.type, CardGapContribution);
    assert.equal(gap.props.id, `measure-statement:${id}`);
    assert.equal(gap.props.label, "the official statement");
    assert.equal(gap.props.kind ?? "not-held", "not-held", "an unread statement does not claim the authority published nothing");
    assert.equal(renderToStaticMarkup(gap), "", "the missing field itself has no visible row");
    assert.equal(cardGapLine([gap.props]), "Still gathering: the official statement.");
  }
  const held = measureOf("ballot-az-pima:prop-425")!;
  const heldMarkup = renderToStaticMarkup(render(held, { id: held.contestId }));
  assert.match(heldMarkup, /data-measure-statement="PRESENT"/);
  assert.ok(heldMarkup.includes(held.officialStatement!.slice(0, 60)), "held official wording reaches the visible branch");
  assert.doesNotMatch(heldMarkup, /Still gathering|working on getting this info/);
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
