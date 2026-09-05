import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { bodyRenderProof } from "./lib/reader-body-render-proof.ts";
import { floored } from "../lib/ops/denominator-floor.ts";
import {
  readReaderEvidence, readerSourceFingerprint, inspectReaderMarkup, sourceRenewalCaseProblems,
  packReaderEvidence, sha256, type ReaderCensus, type ReaderClosureReceipt, type ReaderComponentCase,
} from "../lib/holdings/reader-census.ts";
import type { EvidenceRecord } from "../lib/ask/evidence.ts";

// This renews presentation only. Retrieval comes from the still-hash-bound
// canonical receipt, never from a model or a new acquisition.
const root = process.cwd();
const exactHead = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const output = process.env.READER_RENEWAL_EXECUTION!;
if (process.env.READER_RENEWAL_SESSION === "V94") {
  const { executeV94ReaderSourceProof } = await import("./lib/reader-v94-source-proof.ts");
  assert.ok(output && process.env.READER_FINAL_PREPARED_CENSUS && process.env.READER_RENEWAL_VISUAL);
  if (process.env.READER_RENEWAL_EXPECTED_HEAD) assert.equal(exactHead, process.env.READER_RENEWAL_EXPECTED_HEAD);
  console.log(JSON.stringify(await executeV94ReaderSourceProof({ root, exactHead, output,
    preparedCensusPath: process.env.READER_FINAL_PREPARED_CENSUS, visualPath: process.env.READER_RENEWAL_VISUAL })));
  process.exit(0);
}
assert.ok(output && process.env.READER_FINAL_PREPARED_CENSUS && process.env.READER_RENEWAL_BALLOT);
const census = JSON.parse(readFileSync(process.env.READER_FINAL_PREPARED_CENSUS, "utf8")) as ReaderCensus;
const receipt = JSON.parse(readReaderEvidence(root, "docs/evidence/reader-last-mile-final-closure-receipt.json").toString("utf8")) as ReaderClosureReceipt;
assert.equal(receipt.holdingsDigest, census.holdingsDigest);
const inputs: { path: string; sha256: string }[] = [];
const input = (path: string) => { const bytes = readReaderEvidence(root, path); inputs.push({ path, sha256: sha256(bytes) }); return JSON.parse(bytes.toString("utf8")); };

// One canonical case per district rendering class/state, while the prepared
// census independently conserves the complete eligible identity population.
const registry = JSON.parse(readFileSync("lib/registry/registry.json", "utf8"));
const divisions = new Map<string, { divisionType: string; state: string }>(registry.divisions.map((row: { ocdId: string; divisionType: string; state: string }) => [row.ocdId, row]));
const seenDistrictClasses = new Set<string>();
const holdingValues = new Map<string, unknown>();
const selected = census.records.filter(record => {
  if (record.family !== "registry" || record.unit !== "divisions" || record.eligibility.state !== "READER_ELIGIBLE") return false;
  if (!holdingValues.has(record.holdingPath)) holdingValues.set(record.holdingPath, JSON.parse(readFileSync(record.holdingPath, "utf8")));
  let raw = holdingValues.get(record.holdingPath);
  for (const key of record.pointer.split("/").slice(1)) raw = (raw as Record<string, unknown> | undefined)?.[key.replaceAll("~1", "/").replaceAll("~0", "~")];
  // Officeholder/division bridges feed the official card, not DistrictPopup.
  if ((raw as { officeholderId?: string } | undefined)?.officeholderId) return false;
  const division = record.canonicalIdentity.map(id => divisions.get(id)).find(Boolean);
  if (!division || !["cd", "sldu", "sldl", "county", "place", "school_district"].includes(division.divisionType)) return false;
  const key = `${division.state}:${division.divisionType}`;
  if (seenDistrictClasses.has(key)) return false;
  seenDistrictClasses.add(key); return true;
});
floored("affected district rendering classes", "canonical eligible registry divisions by state/type", selected.length, selected.length);
const bodies = await bodyRenderProof(root, { ...census, records: selected });
assert.deepEqual(bodies.failures, []);
assert.deepEqual(bodies.unsupported, []);
assert.equal(bodies.cases.length, selected.length);
const cases: ReaderComponentCase[] = [...bodies.cases];
const { AskAnswerRecords } = await import("../components/ask/answer-records.tsx");
const { PopupCard } = await import("../components/map/popup/popup-card.tsx");
const add = (id: string, component: string, markup: string, records: readonly EvidenceRecord[], expected: string[], rowCounts: ReaderComponentCase["rowCounts"]) => {
  cases.push({ auditId: id, component, componentSha256: sha256(readFileSync(component)), selector: "unchanged canonical route evidence → actual current presentation", actualCanonicalIdentities: records.map(record => record.id), payloadSha256: sha256(JSON.stringify(records)), markup, markupSha256: sha256(markup), expectedFragments: expected, forbiddenFragments: [], rowCounts, failures: inspectReaderMarkup(markup, expected, [], rowCounts) });
};

// Record presentation is kind-generic. Reuse one previously retrieved exact
// record per kind, plus every held summary (the only reordered record kind).
const recordsByClass = new Map<string, EvidenceRecord>();
function collect(value: unknown) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) { value.forEach(collect); return; }
  const row = value as Record<string, unknown>;
  if (Array.isArray(row.returnedRecords)) for (const record of row.returnedRecords as EvidenceRecord[]) {
    if (record.kind === "CONTACT" || typeof record.text !== "string" || !record.id) continue;
    const key = record.kind === "MEASURE_SUMMARY" ? `${record.kind}:${record.id}` : record.kind;
    if (!recordsByClass.has(key)) recordsByClass.set(key, record);
  }
  Object.values(row).forEach(collect);
}
for (const entry of receipt.evidenceHashes.filter(entry => /ask.*\.json$/.test(entry.path))) {
  assert.equal(sha256(readReaderEvidence(root, entry.path)), entry.sha256, `Inherited retrieval changed: ${entry.path}`);
  collect(input(entry.path));
}
floored("Ask presentation record classes", "hash-bound prior canonical route executions", recordsByClass.size, recordsByClass.size);
assert.ok([...recordsByClass.values()].some(record => record.kind === "MEASURE_SUMMARY"));
let askCases = 0;
for (const [key, record] of recordsByClass) for (const initiallyOpen of [true, false]) {
  const records = [record];
  const markup = renderToStaticMarkup(createElement(AskAnswerRecords, { records, initiallyOpen }));
  add(`ask:${key}:${initiallyOpen}`, "components/ask/answer-records.tsx", markup, records, [record.id, record.text, ...(record.sourceUrl ? [record.sourceUrl] : []), ...(record.sourceOrg ? [record.sourceOrg] : [])], { records: { expected: 1, actual: [...markup.matchAll(/data-ask-record-id=/g)].length } });
  askCases++;
}
const mixed = [...recordsByClass.values()];
for (const initiallyOpen of [true, false]) {
  const markup = renderToStaticMarkup(createElement(AskAnswerRecords, { records: mixed, initiallyOpen }));
  const summaries = mixed.filter(record => record.kind === "MEASURE_SUMMARY");
  if (initiallyOpen) {
    assert.ok(markup.indexOf("data-ask-measure-summary") < markup.indexOf("<details"));
    assert.ok(!markup.includes('open=""'));
    assert.ok(markup.includes(`data-ask-detail-count="${mixed.length - summaries.length}"`));
  }
  add(`ask:all-classes:${initiallyOpen}`, "components/ask/answer-records.tsx", markup, mixed, mixed.flatMap(record => [record.id, record.text, ...(record.sourceUrl ? [record.sourceUrl] : [])]), { records: { expected: mixed.length, actual: [...markup.matchAll(/data-ask-record-id=/g)].length } });
  askCases++;
}
// The opt-in minimise control must conserve every other popup's content.
for (const tier of ["local", "state", "national"] as const) for (const minimize of [false, true]) {
  const record = [...recordsByClass.values()][0];
  const popupProps = { tier, type: "Government", title: record.id, onClose: () => {}, ...(minimize ? { onMinimize: () => {} } : {}), children: createElement("p", null, record.text) };
  const markup = renderToStaticMarkup(createElement(PopupCard, popupProps));
  assert.equal(markup.includes("popup-minimize-btn"), minimize);
  add(`popup:${tier}:${minimize}`, "components/map/popup/popup-card.tsx", markup, [record], [record.id, record.text], { children: { expected: 1, actual: [...markup.matchAll(/<p>/g)].length } });
}
const ballot = input(process.env.READER_RENEWAL_BALLOT);
assert.equal(ballot.exactHead, exactHead);
assert.ok(ballot.cases.length);
cases.push(...ballot.cases);
packReaderEvidence(root, process.env.READER_RENEWAL_BALLOT);

// The already-reviewed ten images are inherited by exact source identity.
// CSS's only subsequent change was a computed-value-preserving token edit.
const visualHead = "1082e85040859dd04e6020b003f810f6da7e2d3f";
const visualPaths = ["app/ballot/page.tsx", "components/ask/answer-records.tsx", "components/map/map-entry.tsx", "components/map/popup/district-popup.tsx", "components/map/popup/popup-card.tsx", "hooks/use-compact-map.ts"];
for (const path of visualPaths) assert.equal(readFileSync(path, "utf8").replaceAll("\r\n", "\n"), execFileSync("git", ["show", `${visualHead}:${path}`], { encoding: "utf8" }).replaceAll("\r\n", "\n"), `Reviewed visual implementation changed: ${path}`);
const visualPath = "docs/evidence/reader-last-mile-visual-renewal-rendering.json";
const tokenEquivalence = JSON.parse(readFileSync(".scratch/token-equivalence.json", "utf8"));
assert.equal(tokenEquivalence.result, "PASS");
assert.deepEqual(tokenEquivalence.before, tokenEquivalence.after);
const visual = JSON.parse(readFileSync(".scratch/visual-feedback-final/results.json", "utf8"));
assert.equal(visual.results.length, 11);
writeFileSync(visualPath, `${JSON.stringify({ visualHead, visualPaths, execution: visual, tokenEquivalence, currentCssSha256: sha256(readFileSync("app/globals.css")) }, null, 2)}\n`);
input(visualPath);
const failures = sourceRenewalCaseProblems(cases);
assert.deepEqual(failures, []);
const denominator = floored("renewed reader presentation cases", "affected ballot DOM, district classes, Ask record classes and shared popup", cases.length, cases.length);
writeFileSync(output, `${JSON.stringify({ exactHead, sourceHashes: readerSourceFingerprint(root), inputs, cases, failures, denominator, counts: { district: bodies.cases.length, ask: askCases, popup: 6, ballot: ballot.cases.length, inheritedVisual: visual.results.length } }, null, 2)}\n`);
packReaderEvidence(root, output);
console.log(JSON.stringify({ output, cases: cases.length, district: bodies.cases.length, ask: askCases, popup: 6, ballot: ballot.cases.length, inheritedVisual: visual.results.length }));
