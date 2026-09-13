import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createHash } from "node:crypto";
import { curatedRegistrySeedProblems, CURATED_BODY_SEED, REGISTRY_FIRST_SEED } from "../lib/holdings/registry-seed-proof.ts";
import { candidateProfileCensusHoldingPath, canonicalReaderAuthorityJson, civicContactObserved } from "../lib/holdings/reader-census.ts";
import { fundingFreshnessNote } from "../lib/funding/freshness.ts";
import { telHref } from "../lib/officials/phone-numbers.ts";
import { validateFullReproofComponentEvidence, validateFullReproofWitnesses, validateListingWitnessReadback } from "../scripts/lib/reader-full-reproof.ts";

const compile = (source: string) => ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
test("listing witnesses bind the complete current group set rather than a historical literal", () => {
  const one = { sourceIds: ["listing:a", "listing:b"], reason: "Distinct count unresolved", sourceListingCount: 2, uniqueMeetingCount: null };
  const two = { ...one, sourceIds: ["listing:c", "listing:d"] };
  validateListingWitnessReadback([one], [one]);
  validateListingWitnessReadback([one, two], [one, two]);
  assert.throws(() => validateListingWitnessReadback([], []), /population is empty/);
  assert.throws(() => validateListingWitnessReadback([one], [one, two]), /Every current/);
  assert.throws(() => validateListingWitnessReadback([{ ...one, sourceIds: ["listing:a", "listing:other"] }], [one]), /Every current/);
  assert.throws(() => validateListingWitnessReadback([{ ...one, sourceListingCount: 3 }], [one]), /Every current/);
  assert.throws(() => validateListingWitnessReadback([one], [{ ...one, sourceListingCount: 3 }]), /ambiguity is not proved/);
});
test("full component and body evidence requires current source bindings and actual cases", () => {
  const evidence = { exactHead: "a".repeat(40), holdingsDigest: "holdings", sourceHashes: [{ path: "body.tsx", sha256: "hash" }], cases: [{ auditId: "body:one" }], failures: [] };
  validateFullReproofComponentEvidence(evidence, evidence.exactHead, "holdings");
  for (const invalid of [{ exactHead: undefined }, { exactHead: "b".repeat(40) }, { holdingsDigest: "old" }, { sourceHashes: [] }, { cases: [] }, { failures: ["missing held fact"] }]) assert.throws(() => validateFullReproofComponentEvidence({ ...evidence, ...invalid }, evidence.exactHead, "holdings"));
});
test("full reproof refuses missing, stale, incomplete and wrong-build surface evidence", () => {
  const exactHead = "a".repeat(40);
  const bytes = Buffer.from(JSON.stringify({ exactHead, buildId: "current-build" }));
  const witness = { surface: "map", component: "body.tsx", exactHead, evidencePath: "body.json", evidenceSha256: createHash("sha256").update(bytes).digest("hex") };
  const valid = { exactHead, buildId: "current-build", witnesses: [witness], requirements: [{ surface: "map", component: "body.tsx", importReach: true }], readEvidence: () => bytes };
  validateFullReproofWitnesses(valid);
  assert.throws(() => validateFullReproofWitnesses({ ...valid, witnesses: [] }), /full surface/);
  assert.throws(() => validateFullReproofWitnesses({ ...valid, requirements: [...valid.requirements, { surface: "ballot", component: "candidate.tsx", importReach: true }] }), /lacks current surface/);
  assert.throws(() => validateFullReproofWitnesses({ ...valid, witnesses: [{ ...witness, exactHead: "b".repeat(40) }] }), /stale witness/);
  assert.throws(() => validateFullReproofWitnesses({ ...valid, readEvidence: () => Buffer.from("{}") }), /wrong witness artifact/);
  assert.throws(() => validateFullReproofWitnesses({ ...valid, buildId: "another-build" }), /wrong browser build/);
  assert.throws(() => validateFullReproofWitnesses({ ...valid, witnesses: [witness, witness] }), /Duplicate/);
});
function nodes(path: string) {
  const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const all: ts.Node[] = [];
  const visit = (node: ts.Node) => { all.push(node); ts.forEachChild(node, visit); };
  visit(source);
  return all;
}

test("contactless grounded bodies retain the routed topic and correctly attributed reachable contact", () => {
  const all = nodes("components/ask/ask-box.tsx");
  const cards = all.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "RoutedContactCards")!;
  const predicate = all.find((node) => ts.isVariableDeclaration(node) && node.name.getText() === "preservedRoutedContact")!;
  const block = all.find((node) => ts.isJsxElement(node) && node.openingElement.attributes.properties.some((prop) => ts.isJsxAttribute(prop) && prop.name.getText() === "data-ask-preserved-contact"))!;
  assert.ok(cards && predicate && block, "exercise the production card and its actual placement predicate");
  const render = new Function("telHref", "React", "asked", "grounded", compile(`${cards.getText()} const ${predicate.getText()}; return preservedRoutedContact ? (${block.getText()}) : null;`)).bind(null, telHref);
  const contact = { body: "Borough of Rockaway — Tax Collector", service: "Property tax payments", phone: "973-627-2000 ext 228", email: "taxcollector@rockawayborough.org", sourceOrg: "Borough of Rockaway", sourceUrl: "https://www.rockawayborough.org/departments/tax-collector/" };
  const asked = { answer: { kind: "ROUTED", topic: { label: "Property taxes" } }, contacts: [contact] };
  const grounded = { subject: { name: "Board of Assessment Commissioners" }, contacts: [] };
  const markup = renderToStaticMarkup(render(React, asked, grounded));
  for (const fragment of ["Property taxes", contact.body, contact.service, contact.phone, `mailto:${contact.email}`, 'href="tel:9736272000;ext=228"', `This was sourced from ${contact.sourceOrg}.`]) assert.ok(markup.includes(fragment), fragment);
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
  const make = new Function("React", "fundingAnswerForTarget", "settleFundingHoldingAnswer", "fundingFreshnessNote", "unavailableHolding", "FundingAbsence", "FundingDisplay", compile(`${fn.getText()}; return CandidateFunding;`));
  const unexpected = () => { throw new Error("none must not fabricate funding records"); };
  const component = make(React, () => ({ kind: "none" }), async () => envelope, fundingFreshnessNote, unexpected, unexpected, unexpected);
  const props = { targetKey: "congress:test", context: null, available: true };
  const markup = renderToStaticMarkup(await component(props));
  assert.match(markup, /funding-data-freshness/);
  assert.match(markup, /source through 2026-08-19/);
  envelope.dataMetadata.stale = "CURRENT";
  assert.equal(await component(props), null);
  envelope.dataMetadata.stale = "UNKNOWN";
  assert.match(renderToStaticMarkup(await component(props)), /freshness could not be established/);
});

test("split ZIP contacts require every covered ZIP and the exact contact facts and source", () => {
  const contact = { topicId: "property-taxes", zips: ["85701", "85641"], body: "County Assessor", phone: "520-724-8630", sourceUrl: "https://clerk.example/contact", sourceOrg: "County", holdingStatus: "CONTACT_HELD" };
  const observed = (rows: unknown[]) => new Set(rows.map((row) => `contact:${canonicalReaderAuthorityJson(row)}`));
  const { holdingStatus: _holdingStatus, ...fields } = contact;
  const parts = contact.zips.map((zip) => ({ ...fields, zips: [zip] }));
  assert.equal(civicContactObserved(contact, observed(parts)), true);
  assert.equal(civicContactObserved(contact, observed([fields])), true);
  assert.equal(civicContactObserved(contact, observed(parts.slice(0, 1))), false);
  for (const drift of [{ body: "Other office" }, { phone: "311" }, { sourceUrl: "https://other.example/contact" }, { sourceOrg: "Other source" }]) assert.equal(civicContactObserved(contact, observed([parts[0], { ...parts[1], ...drift }])), false);
});

test("candidate profile route proof recognizes only the exact field, key and demonstrated authority encoding", () => {
  const holdingKey = "candidate/a~b";
  const prefix = "civic-data:CANDIDATE_PROFILE:US-AZ+US-NH+US-NJ:2026-supported-candidates#";
  for (const field of ["bio", "phone", "email", "filedAddress", "official", "campaign"]) {
    const unit = ["official", "campaign"].includes(field) ? "links" : "cards";
    const pointer = `/${unit}/candidate~1a~0b${field === "bio" ? "" : `/${field}`}`;
    const expected = `data/ballot/candidate-${unit}-2026.json#${pointer}`;
    const profile = { holdingKey, field, holdingPath: prefix + pointer };
    assert.equal(candidateProfileCensusHoldingPath(profile), expected);
    assert.equal(candidateProfileCensusHoldingPath({ ...profile, holdingPath: expected }), expected);
    for (const wrong of [{ holdingKey: "another" }, { field: "unrecognized" }, { holdingPath: profile.holdingPath.replace("2026-supported", "2024-supported") }, { holdingPath: profile.holdingPath + "/extra" }, { holdingPath: profile.holdingPath.replace("candidate~1a~0b", "candidate/a~b") }]) assert.equal(candidateProfileCensusHoldingPath({ ...profile, ...wrong }), null);
  }
});

test("registry seed proof binds exact curated records and rejects identity coincidence or wrong artifacts", () => {
  const body = { id: "body:one", ocdId: "division:one", name: "Verified body", bodyOrigin: "CURATED", provenance: { sourceUrl: "https://clerk.example/body", sourceOrg: "Clerk" } };
  const check = (seed: unknown, overrides: Record<string, unknown> = {}) => {
    const artifactBytes = Buffer.from(typeof seed === "string" ? seed : JSON.stringify(seed));
    return curatedRegistrySeedProblems({ holdingPath: CURATED_BODY_SEED, family: "curated-body-identities", artifactPath: REGISTRY_FIRST_SEED, artifactBytes, artifactSha256: createHash("sha256").update(artifactBytes).digest("hex"), artifactTraced: true, records: [{ auditId: "curated#/0", value: body }], ...overrides });
  };
  assert.deepEqual(check({ bodies: [body] }), []);
  assert.deepEqual(check({ bodies: [body] }, { records: [{ auditId: "curated#/0", value: { ...body, _manifestStateCodes: ["az"] } }] }), [], "manifest-added state classification is not a source body field");
  assert.ok(check({ bodies: [body] }, { records: [{ auditId: "curated#/0", value: { ...body, _otherHeldField: "required" } }] }).length, "other underscored fields remain required");
  for (const seed of [{ bodies: [] }, { bodies: [{ ...body, id: "body:other" }], divisions: [{ id: body.id }] }, { bodies: [{ ...body, name: "Wrong body" }] }, { bodies: [{ ...body, provenance: { sourceOrg: "Other" } }] }, { bodies: [body, body] }, { bodies: [], note: body.id }, "{broken", null]) assert.ok(check(seed).length);
  for (const overrides of [{ holdingPath: "lib/registry/auxiliary.json" }, { family: "body-compositions" }, { artifactPath: "another/registry.json" }, { artifactSha256: "0".repeat(64) }, { artifactTraced: false }, { records: [] }]) assert.ok(check({ bodies: [body] }, overrides).length);
});
