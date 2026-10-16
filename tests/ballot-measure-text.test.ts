import { azBallot, azPlaceMeasures } from "./helpers/ballot-district-fixtures.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { CardGapContribution } from "../components/ui/card-gap-context.tsx";
import { cardGapLine } from "../lib/design/card-gaps.ts";
import { installBallots, installPlaceMeasures } from "./helpers/promoted-fixtures.ts";
import { readerBallotSources } from "../lib/ballot/reader-sources.ts";

const ROOT = process.cwd();
const PAGE = readFileSync(join(ROOT, "app", "ballot", "page.tsx"), "utf8");

function code(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !/^\s*\/\//.test(line))
    .join("\n");
}

await installBallots(azBallot);
await installPlaceMeasures(...azPlaceMeasures);
const sources = await readerBallotSources(["ocd-division/country:us/state:az", ...azPlaceMeasures.map(place => place.ocdId)]);
assert.equal(sources.length, 1);
const SET = sources[0].source.normalize(await sources[0].source.fetch());

const measureOf = (contestId: string) =>
  SET.measures.find((m) => m.contestId === contestId) ?? null;

test("local measure records hold complete questions and source-bound official guide entries", () => {
  for (const id of ["ballot-az-pima:prop-425", "ballot-az-pima:prop-423", "ballot-az-pima:prop-428", "ballot-az-pima:prop-429"]) {
    const measure = measureOf(id);
    assert.ok(measure, `${id} has no measure record — the render has nothing to show`);
    assert.ok(
      measure.questionText.trim().length > 120,
      `${id} carries ${measure.questionText.trim().length} characters of question text`,
    );
    assert.ok(measure.provenance.sourceOrg.length > 0, `${id} cites no publisher`);
    assert.ok(measure.voterGuide!.summary!.trim().length > 300, `${id} has no official explanation`);
    assert.ok(measure.voterGuide!.publisher);
    assert.ok(measure.voterGuide!.vault.key);
    assert.ok(measure.officialText!.vault.key);
    assert.equal(azBallot.measures.some(row => row.contestId === id), false, "local measures remain outside the state ballot record");
  }
});

test("the ballot page renders its question, held statement and attributed official guide", () => {
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
  const source = ts.createSourceFile("ballot.tsx", PAGE, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let guide: ts.BinaryExpression | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isBinaryExpression(node) && node.left.getText(source) === "measure?.voterGuide") guide = node;
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.ok(guide, "exercise the production official guide branch");
  const executable = ts.transpileModule(`return (${guide.getText(source)});`, {
    compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  const render = new Function("React", "measure", executable).bind(null, React);
  for (const place of azPlaceMeasures) for (const ballot of Object.values(place.ballots)) for (const measure of ballot.measures) {
    const markup = renderToStaticMarkup(render(measure));
    assert.ok(markup.includes(`Official voter guide — ${measure.voterGuide!.publisher}`));
    for (const text of [measure.voterGuide!.summary!, ...measure.voterGuide!.argumentsFor ?? [], ...measure.voterGuide!.argumentsAgainst ?? []]) {
      const escaped = renderToStaticMarkup(React.createElement("span", null, text)).slice(6, -7);
      assert.ok(markup.includes(escaped), `${measure.contestId} lost official guide wording`);
    }
  }
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
    const heldGuide = measureOf(id)!;
    assert.equal(render(heldGuide, { id }), null, "the held guide does not produce a missing-statement gap");
    const measure = { ...heldGuide, voterGuide: undefined };
    const gap = render(measure, { id });
    assert.equal(gap.type, CardGapContribution);
    assert.equal(gap.props.id, `measure-statement:${id}`);
    assert.equal(gap.props.label, "the official statement");
    assert.equal(gap.props.kind ?? "not-held", "not-held", "an unread statement does not claim the authority published nothing");
    assert.equal(renderToStaticMarkup(gap), "", "the missing field itself has no visible row");
    assert.equal(cardGapLine([gap.props]), "Still gathering: the official statement.");
  }
  const heldMeasure = measureOf("ballot-az-pima:prop-425")!;
  const held = { ...heldMeasure, officialStatement: heldMeasure.voterGuide!.summary! };
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
  assert.deepEqual(measures.filter(contest => statewide.test(contest.ocdId)).map(contest => contest.id).sort(),
    [141, 142, 144, 316, 317, 318, 319, 320].map(number => `ballot-az-pima:prop-${number}`));
  assert.deepEqual(SET.heldContests!.map(contest => contest.id).sort(), [143, 145, 212].map(number => `ballot-az-pima:prop-${number}`),
    "the three proposals lacking verified ballot text remain named gaps");
});
