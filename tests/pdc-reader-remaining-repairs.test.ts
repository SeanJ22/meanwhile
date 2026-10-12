import assert from "node:assert/strict";

import { readFileSync } from "node:fs";

import test from "node:test";

import ts from "typescript";

import * as React from "react";

import { renderToStaticMarkup } from "react-dom/server";

import { fundingFreshnessNote } from "../lib/funding/freshness.ts";

import { directFundingTargetPlan } from "../lib/funding/target-authorities.ts";

import { telHref } from "../lib/officials/phone-numbers.ts";

import { withReaderAuthorityEdge } from "../lib/registry/runtime-edge.ts";

const compile = (source: string) => ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;

function nodes(path: string) {
  const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const all: ts.Node[] = [];
  const visit = (node: ts.Node) => { all.push(node); ts.forEachChild(node, visit); };
  visit(source);
  return all;
}

test("contactless grounded bodies retain the routed topic and correctly attributed reachable contact", () => {
  const all = nodes("components/ask/ask-box.tsx");
  const cited = all.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "citedContactUrl")!;
  const cards = all.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "RoutedContactCards")!;
  const predicate = all.find((node) => ts.isVariableDeclaration(node) && node.name.getText() === "preservedRoutedContact")!;
  const block = all.find((node) => ts.isJsxElement(node) && node.openingElement.attributes.properties.some((prop) => ts.isJsxAttribute(prop) && prop.name.getText() === "data-ask-preserved-contact"))!;
  assert.ok(cited && cards && predicate && block, "exercise the production card, URL guard and actual placement predicate");
  const render = new Function("telHref", "React", "asked", "grounded", compile(`${cited.getText()} ${cards.getText()} const ${predicate.getText()}; return preservedRoutedContact ? (${block.getText()}) : null;`)).bind(null, telHref);
  const contact = { body: "Borough of Rockaway — Tax Collector", service: "Property tax payments", phone: "973-627-2000 ext 228", email: "taxcollector@rockawayborough.org", sourceOrg: "Borough of Rockaway", sourceUrl: "https://www.rockawayborough.org/departments/tax-collector/" };
  const asked = { answer: { kind: "ROUTED", topic: { label: "Property taxes" } }, contacts: [contact] };
  const grounded = { subject: { name: "Board of Assessment Commissioners" }, contacts: [] };
  const markup = renderToStaticMarkup(render(React, asked, grounded));
  for (const fragment of ["Property taxes", contact.body, contact.service, contact.phone, `mailto:${contact.email}`, 'href="tel:9736272000;ext=228"', "This was sourced from ", `href="${contact.sourceUrl}"`, `>${contact.sourceOrg}</a>.`]) assert.ok(markup.includes(fragment), fragment);
  assert.ok(!markup.includes('href="tel:9736272000228"'), "extension must not become part of the subscriber number");
  assert.ok(!markup.includes(grounded.subject.name), "the collector must not be attributed to the grounded assessment board");
  assert.equal((markup.match(/mailto:/g) ?? []).length, 1);
  assert.equal(render(React, asked, { ...grounded, contacts: [{ id: "existing-grounded-contact" }] }), null, "do not duplicate a grounded contact answer");
  assert.equal(render(React, { ...asked, contacts: [] }, grounded), null);
  assert.equal(render(React, asked, { ...grounded, subject: null }), null);
  const other = { ...asked, answer: { kind: "ROUTED", topic: { label: "Street maintenance" } }, contacts: [{ ...contact, body: "Test City Streets", phone: "311", email: null }] };
  const otherMarkup = renderToStaticMarkup(render(React, other, grounded));
  assert.match(otherMarkup, /Street maintenance/);
  assert.match(otherMarkup, /href="tel:311"/);
  assert.ok(!otherMarkup.includes(contact.body));
});

test("ballot keeps freshness for a federal none answer and leaves a current none answer empty", async () => {
  const fn = nodes("app/ballot/page.tsx").find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "CandidateFunding")!;
  const envelope = { kind: "ANSWER", holdingStatus: "HELD", dataState: "PROMOTED", dataMetadata: { stale: "STALE", sourceThrough: "2026-08-19" } };
  const make = new Function("React", "fundingAnswerForTarget", "settleFundingHoldingAnswer", "fundingFreshnessNote", "unavailableHolding", "FundingAbsence", "FundingDisplay", "withReaderAuthorityEdge", compile(`${fn.getText()}; return CandidateFunding;`));
  const unexpected = () => { throw new Error("none must not fabricate funding records"); };
  // The settlement runs inside the page's reader edge (R30); with no edge it runs as it always did.
  const component = make(React, () => ({ kind: "none" }), async () => envelope, fundingFreshnessNote, unexpected, unexpected, unexpected, withReaderAuthorityEdge);
  const props = { targetKey: "congress:test", context: null, available: true, readerEdge: null };
  const markup = renderToStaticMarkup(await component(props));
  assert.match(markup, /funding-data-freshness/);
  assert.match(markup, /source through 2026-08-19/);
  envelope.dataMetadata.stale = "CURRENT";
  assert.equal(await component(props), null);
  envelope.dataMetadata.stale = "UNKNOWN";
  assert.match(renderToStaticMarkup(await component(props)), /freshness could not be established/);
});

test("state ballot funding discloses the exact held state's freshness and preserves its records", () => {
  const fn = nodes("app/ballot/page.tsx").find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "stateCandidateFunding");
  assert.ok(fn);
  const make = new Function("React", "directFundingTargetPlan", "stateMoneyReadState", "fundingFreshnessNote", "StateMoneySection", compile(`${fn.getText()}; return stateCandidateFunding;`));
  const reads: string[] = [];
  const states = new Map([
    ["AZ", { kind: "PROMOTED", metadata: { stale: "STALE", sourceThrough: "2026-09-08" } }],
    ["NJ", { kind: "PROMOTED", metadata: { stale: "STALE", sourceThrough: "2026-09-07" } }],
    ["NH", { kind: "PROMOTED", metadata: { stale: "UNKNOWN", sourceThrough: null } }],
  ]);
  const records = [{ held: "exact candidate filing" }];
  const render = make(React, directFundingTargetPlan, (state: string) => { reads.push(state); return states.get(state); }, fundingFreshnessNote, (props: { records: typeof records }) => {
    assert.equal(props.records, records, "disclosure must not replace or rematch held records");
    return React.createElement("span", null, props.records[0].held);
  });
  for (const [target, state, expected] of [
    ["ballot-az-pima:governor|Katie Hobbs", "AZ", "source through 2026-09-08"],
    ["ballot-nj-morris:commissioner:person", "NJ", "source through 2026-09-07"],
    ["ballot-nh-merrimack:representative:person", "NH", "freshness could not be established"],
  ]) {
    const markup = renderToStaticMarkup(render(target, records));
    assert.equal(reads.at(-1), state);
    assert.ok(markup.includes(expected));
    assert.equal((markup.match(/funding-data-freshness/g) ?? []).length, 1);
    assert.ok(markup.includes(records[0].held));
  }
  assert.ok(nodes("app/ballot/page.tsx").some((node) => ts.isCallExpression(node) && node.expression.getText() === "stateCandidateFunding" && node.arguments[0]?.getText() === "targetKey" && node.arguments[1]?.getText() === "stateMoney"), "the actual battlecard money slot must use the disclosure");
});

test("an empty state funding selection retains stale disclosure but leaves current empty slots empty", () => {
  const fn = nodes("app/ballot/page.tsx").find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "stateCandidateFunding")!;
  const read = { kind: "PROMOTED", metadata: { stale: "STALE", sourceThrough: "2026-09-08" } };
  const make = new Function("React", "directFundingTargetPlan", "stateMoneyReadState", "fundingFreshnessNote", "StateMoneySection", compile(`${fn.getText()}; return stateCandidateFunding;`));
  const render = make(React, directFundingTargetPlan, () => read, fundingFreshnessNote, (props: { records: unknown[] }) => { assert.equal(props.records.length, 0); return null; });
  assert.match(renderToStaticMarkup(render("ballot-az-pima:governor:person", [])), /source through 2026-09-08/);
  read.metadata.stale = "CURRENT";
  assert.equal(render("ballot-az-pima:governor:person", []), null);
});
