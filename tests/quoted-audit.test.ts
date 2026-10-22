import assert from "node:assert/strict";
import test from "node:test";
import { contentHash } from "../lib/control-plane/ids.ts";
import { auditExtraction } from "../lib/control-plane/workers/auditor.ts";
import { confirmQuotedRecords } from "../lib/control-plane/workers/quoted-proof.ts";
import type { WorkerRef } from "../lib/control-plane/attempt.ts";
import type { AuditorWorkerInput, GeneralizedCivicExtractionContract, ParserResult, WorkerEvidence } from "../lib/control-plane/workers/types.ts";

const NOW = "2026-09-29T10:00:00.000Z";
const TEXT = [
  "[Page 1]",
  "Regular Meeting: Tuesday, October 14, 2026 at 6:00 PM",
  "Special Meeting: Thursday, October 23, 2026 at 5:30 PM",
].join("\n");
const evidence = (text: string): WorkerEvidence => ({ artifactId: "art", contentHash: contentHash(text), text, acquiredByAttemptId: "acq", canonicalUrl: "https://www.exampletonaz.gov/agenda.txt",
  retrievedAt: NOW, sourceId: "exampleton", methodRouteId: "route-agenda" });
const contract: GeneralizedCivicExtractionContract = {
  schemaVersion: 2, recordClass: "PLANNING_MEETING", subjectId: "az:city:exampleton", requiredFields: ["title", "when"],
  identity: { namespace: "az:city:exampleton:planning", keyFields: ["when"] }, jurisdiction: { country: "US", state: "AZ", canonicalId: "az:city:exampleton" },
  completenessScope: "Meetings in this agenda.", expectedSourceDate: null, methodVersion: 61,
  sourceScope: { sourceId: "exampleton", publisher: "City of Exampleton", routeIds: ["route-agenda"], canonicalUrls: ["https://www.exampletonaz.gov/agenda.txt"], observationArtifactIds: ["art"] },
  extraction: { format: "UNSUPPORTED", mediaType: "text/plain", fields: {}, reason: "No parsing rule." },
  verification: { required: false, authorities: [] },
};
const producer: WorkerRef = { role: "PARSER", provider: "anthropic", version: "m", instance: "parser" };
const validator: WorkerRef = { role: "VALIDATOR", provider: "we-the-people", version: "v", instance: "validator" };
const auditor: WorkerRef = { role: "ADVERSARIAL_AUDITOR", provider: "we-the-people", version: "a", instance: "auditor" };
const f = (name: string, value: string) => ({ name, value, quote: value });

function input(text = TEXT, source = evidence(TEXT)): AuditorWorkerInput {
  const confirmed = confirmQuotedRecords({ evidence: source, contract }, [
    { fields: [f("title", "Regular Meeting"), f("when", "Tuesday, October 14, 2026 at 6:00 PM")], windowStart: 0 },
    { fields: [f("title", "Special Meeting"), f("when", "Thursday, October 23, 2026 at 5:30 PM")], windowStart: 0 },
  ]);
  const extraction: ParserResult = {
    role: "PARSER", attemptId: "parse", implementation: "model-quoted-extraction", version: "1.0.0", schemaVersion: 2, recordClass: contract.recordClass,
    contractMetadata: { jurisdiction: contract.jurisdiction, identity: contract.identity, sourceScope: contract.sourceScope, methodVersion: 61 },
    artifactId: source.artifactId, contentHash: source.contentHash, acquiredByAttemptId: "acq", subjectId: contract.subjectId, verdict: "EXTRACTED",
    records: confirmed.records, spans: confirmed.spans, warnings: [], declaredRowCount: null, sourceRowCount: 2, actualRowCount: 2,
  };
  const held = evidence(text);
  return { attemptId: "audit", worker: auditor, context: { subjectId: contract.subjectId, contract, publisherSurfaces: ["https://www.exampletonaz.gov/"], methodVersion: 61,
    routes: [{ routeId: "route-agenda", canonicalUrl: held.canonicalUrl, applicable: true, status: "HELD", artifactIds: ["art"], reason: "held" },
      { routeId: "route-minutes", canonicalUrl: "https://www.exampletonaz.gov/minutes", applicable: true, status: "OPEN", artifactIds: [], reason: "not fetched yet" }],
    evidence: [held], startedFrom: ["CANONICAL_SUBJECT_IDENTITY", "PUBLISHER_SOURCE_UNIVERSE", "METHOD_REGISTRY", "EVIDENCE_VAULT"], scope: "CAPTURED_ARTIFACT" },
  candidate: { producer, validator, producerAttemptId: "parse", validatorAttemptId: "validate", extraction, coveredRouteIds: ["route-agenda"], claimsAbsence: false, claimsUniverseComplete: false, renderedRecordCount: null } };
}

test("a quoted extraction with no rule is audited from the immutable document: survives, and the unchecked minutes route is a coverage number", () => {
  const result = auditExtraction(input());
  assert.equal(result.verdict, "SURVIVED", JSON.stringify(result.findings));
  assert.equal(result.survivingRecordCount, 2);
  assert.deepEqual(result.brokenRecordIds, []);
  assert.deepEqual([result.coverage!.routesApplicable, result.coverage!.routesChecked, result.coverage!.sourcesPercent], [2, 1, 50]);
});

test("the sample re-check finds the saved document no longer says it: every quote that is gone is broken and named", () => {
  // The document the auditor reads has a changed time; the extraction still carries the old quote.
  const drifted = TEXT.replace("6:00 PM", "7:00 PM");
  const original = input();
  const result = auditExtraction({ ...original, context: { ...original.context, evidence: [evidence(drifted)] } });
  assert.equal(result.verdict, "BROKE");
  assert.equal(result.reopenRequired, true);
  assert.ok(result.findings.some((finding) => finding.code === "QUOTE_NOT_IN_DOCUMENT" || finding.code === "SPAN_ARTIFACT_MISMATCH" || finding.code === "AUDIT_ARTIFACT_IDENTITY_MISMATCH"));
  assert.ok(result.brokenRecordIds!.length >= 1);
  assert.equal(result.survivingRecordCount, 0);
});

test('a quoted source has no independent row inventory to compare with a claimed universe or rendered count',()=>{
 const given=input();
 const result=auditExtraction({...given,candidate:{...given.candidate,claimsUniverseComplete:true,renderedRecordCount:1}});
 assert.equal(result.findings.some(f=>f.code==='AUDIT_RECORD_NOT_IN_SOURCE'||f.code==='AUDIT_RENDERED_COUNT_MISMATCH'),false);
 assert.ok(result.coverage);
 assert.equal(result.coverage.sourceRecords,null);
});
