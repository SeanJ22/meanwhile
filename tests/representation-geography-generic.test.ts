import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import test from "node:test";
import ts from "typescript";
import { FIPS_TO_STATE } from "../lib/ocd/fips.ts";

const names = ["Alabama", "Alaska", "Arizona", "Arkansas", "California", "Colorado", "Connecticut", "Delaware", "Florida", "Georgia", "Hawaii", "Idaho", "Illinois", "Indiana", "Iowa", "Kansas", "Kentucky", "Louisiana", "Maine", "Maryland", "Massachusetts", "Michigan", "Minnesota", "Mississippi", "Missouri", "Montana", "Nebraska", "Nevada", "New Hampshire", "New Jersey", "New Mexico", "New York", "North Carolina", "North Dakota", "Ohio", "Oklahoma", "Oregon", "Pennsylvania", "Rhode Island", "South Carolina", "South Dakota", "Tennessee", "Texas", "Utah", "Vermont", "Virginia", "Washington", "West Virginia", "Wisconsin", "Wyoming"];
const codes = new Set(Object.values(FIPS_TO_STATE).flatMap(state => [state.postal, state.postal.toLowerCase(), `US-${state.postal}`]));
const subject = /overlay|tribal|aiannh/i;

function stateLiteralsInRepresentationLogic(code: string): string[] {
  const ast = ts.createSourceFile("module.ts", code, ts.ScriptTarget.Latest, true);
  const failures = new Set<string>();
  const isState = (text: string) => codes.has(text) || names.some(name => new RegExp(`\\b${name}\\b`, "i").test(text)) || /\/(?:state|territory|district):[a-z]{2}(?:\/|$)/.test(text);
  const inspect = (node: ts.Node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      const statusValue = /^(?:OK|ok)$/.test(node.text) && !/state|jurisdiction|postal/i.test(node.parent.getText(ast));
      if (!statusValue && isState(node.text)) failures.add(node.text);
    }
    ts.forEachChild(node, inspect);
  };
  const visit = (node: ts.Node) => {
    const candidate = ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node) || ts.isIfStatement(node) || ts.isConditionalExpression(node) || ts.isPropertyAssignment(node) ||
      ts.isVariableDeclaration(node) && subject.test(node.name.getText(ast));
    if (candidate && subject.test(node.getText(ast))) inspect(node);
    ts.forEachChild(node, visit);
  };
  visit(ast);
  return [...failures];
}

function filesUnder(path: string): string[] {
  return readdirSync(path, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? filesUnder(join(path, entry.name)) : [join(path, entry.name)]);
}

test("overlay and tribal behavior uses reference rows across every lib file", () => {
  const violations = filesUnder(join(process.cwd(), "lib")).filter(path => /\.tsx?$/.test(path)).flatMap(path => {
    const code = readFileSync(path, "utf8");
    return subject.test(code) ? stateLiteralsInRepresentationLogic(code).map(value => `${relative(process.cwd(), path)}: ${value}`) : [];
  });
  assert.deepEqual(violations, [], "State-specific overlay or tribal logic belongs in a reference-data row");
});

test("the code check rejects state-named conditions, constants and district identifiers", () => {
  assert.ok(stateLiteralsInRepresentationLogic('if (state === "NH") linkOverlay();').length);
  assert.ok(stateLiteralsInRepresentationLogic('const tribalState = "Maine";').length);
  assert.ok(stateLiteralsInRepresentationLogic('function overlayId() { return "ocd-division/country:us/state:nh/sldl:ro31"; }').length);
  assert.deepEqual(stateLiteralsInRepresentationLogic('function linkOverlay(source) { return source.state; }'), []);
});
