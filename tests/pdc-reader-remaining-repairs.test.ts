import assert from "node:assert/strict";

import { readFileSync } from "node:fs";

import test from "node:test";

import ts from "typescript";

import * as React from "react";

import { renderToStaticMarkup } from "react-dom/server";

import { CardGapContribution } from "../components/ui/card-gap-context.tsx";

import { telHref } from "../lib/officials/phone-numbers.ts";

import { currentReaderSelection, withReaderSelection } from "../lib/db/reader-route.ts";

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

test("ballot leaves empty funding fields out and contributes partial holdings to the card", async () => {
  const all = nodes("app/ballot/page.tsx");
  const fn = all.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "CandidateFunding")!;
  const context = all.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "withBallotReader")!;
  assert.ok(fn && context, "exercise the production funding section and its place context");
  const envelope = { kind: "ANSWER", holdingStatus: "HELD", dataState: "PROMOTED", dataMetadata: { stale: "STALE", sourceThrough: "2026-08-19" } };
  const make = new Function("React", "fundingAnswerForTarget", "settleFundingHoldingAnswer", "unavailableHolding", "FundingAbsence", "FundingDisplay", "withReaderSelection", "CardGapContribution", compile(`${context.getText()}; ${fn.getText()}; return CandidateFunding;`));
  const unexpected = () => { throw new Error("none must not fabricate funding records"); };
  const divisions = ["ocd-division/country:us/state:az/cd:1"];
  const readerSelection = { states: ["AZ"], keys: new Set(divisions), divisions };
  const props = { targetKey: "congress:test", context: null, available: true, readerSelection, divisions };
  const assertContext = () => {
    assert.equal(currentReaderSelection(), readerSelection);
  };
  const component = make(React, () => { assertContext(); return { kind: "none" }; }, async (...args: unknown[]) => {
    assertContext();
    assert.deepEqual(args, [props.targetKey, undefined, undefined, divisions], "funding settles only the card's divisions");
    return envelope;
  }, unexpected, unexpected, unexpected, withReaderSelection, CardGapContribution);
  assert.equal(await component(props), null, "held empty answers do not render a funding field or a freshness placeholder");
  envelope.dataMetadata.stale = "UNKNOWN";
  assert.equal(await component(props), null);
  envelope.holdingStatus = "PARTIAL";
  const gap = await component(props);
  assert.equal(gap.type, CardGapContribution);
  assert.equal(gap.props.label, "campaign money records");
  assert.equal(gap.props.id, "funding-holdings:congress:test");
  assert.equal(renderToStaticMarkup(gap), "", "the card frame displays the gap once");
});

test("state ballot funding preserves held records and leaves empty fields out", () => {
  const fn = nodes("app/ballot/page.tsx").find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "stateCandidateFunding");
  assert.ok(fn);
  const make = new Function("React", "StateMoneySection", compile(`${fn.getText()}; return stateCandidateFunding;`));
  const records = [{ held: "exact candidate filing" }];
  const context = { zip: "85701", lat: 32.22, lng: -110.97 };
  const render = make(React, (props: { records: typeof records; context: typeof context }) => {
    assert.equal(props.records, records, "the display never rematches held records");
    assert.equal(props.context, context);
    return React.createElement("span", null, props.records[0].held);
  });
  assert.equal(renderToStaticMarkup(render(records, context)), "<span>exact candidate filing</span>");
  assert.equal(render([], context), null);
  assert.ok(nodes("app/ballot/page.tsx").some((node) => ts.isCallExpression(node) && node.expression.getText() === "stateCandidateFunding" && node.arguments[0]?.getText() === "stateMoney"), "the actual battlecard money slot uses the held records");
});
