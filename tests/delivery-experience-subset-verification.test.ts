import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { recordIdentity } from "../lib/control-plane/workers/record-evidence.ts";
import { parseGeneralizedRecords } from "../lib/control-plane/workers/generalized-parser.ts";
import { validateGeneralizedExtraction } from "../lib/control-plane/workers/generalized-validator.ts";
import { auditGeneralizedExtraction } from "../lib/control-plane/workers/generalized-auditor.ts";
import { verifyExternalAuthorities } from "../lib/control-plane/workers/record-verification.ts";
import type { GeneralizedCivicExtractionContract, ParserResult, WorkerEvidence } from "../lib/control-plane/workers/types.ts";

const sourceText = JSON.stringify([{ name: "Ada One", office: "Mayor" }, { name: "Bea Two", office: "Council Member" }]);
const proofText = JSON.stringify([{ name: "Ada One", office: "Mayor" }]);
const hash = (text: string) => `sha256-${createHash("sha256").update(text).digest("hex")}`;
const evidence = (artifactId: string, text: string, canonicalUrl: string, attempt: string): WorkerEvidence => ({
  artifactId, text, contentHash: hash(text), canonicalUrl, acquiredByAttemptId: attempt,
  retrievedAt: "2026-09-28T08:00:00.000Z", sourceId: new URL(canonicalUrl).host, methodRouteId: "official-page",
});
const primary = evidence("source", sourceText, "https://city.example.gov/council", "acquirer-source");
const independent = evidence("profile", proofText, "https://city.example.gov/mayor", "acquirer-profile");
const identity = { namespace: "council", keyFields: ["name"] };
const extraction = { format: "JSON_RECORDS" as const, rowsPointer: "", fields: {
  name: { source: "/name", type: "STRING" as const }, office: { source: "/office", type: "STRING" as const },
} };
const contract: GeneralizedCivicExtractionContract = {
  schemaVersion: 2, recordClass: "OFFICIAL_ROSTER", subjectId: "council", requiredFields: ["name", "office"],
  completenessScope: "captured council page rows", expectedSourceDate: null, jurisdiction: { country: "US", state: "AZ", canonicalId: "council" },
  identity, sourceScope: { sourceId: primary.sourceId, routeIds: [primary.methodRouteId], publisher: "Example City", canonicalUrls: [primary.canonicalUrl], observationArtifactIds: [primary.artifactId] },
  methodVersion: 1, extraction,
  verification: { required: true, authorities: [{ id: "official-profile", type: "GOVERNMENT_REGISTER", publisher: "Example City",
    sourceId: independent.sourceId, canonicalUrls: [independent.canonicalUrl], artifactIds: [independent.artifactId], authorityEvidenceArtifactIds: [independent.artifactId],
    independenceBasis: "INDEPENDENT_OFFICIAL_RECORD", independenceExplanation: "A separately captured official person profile states the member's name and office.",
    extraction, comparison: { kind: "RECORD_VALUES_SUBSET", keyFields: ["name"], fields: ["name", "office"] } }] },
};
const candidate: ParserResult = {
  role: "PARSER", attemptId: "parser", implementation: "fixture", version: "1", schemaVersion: 2,
  recordClass: "OFFICIAL_ROSTER", artifactId: primary.artifactId, contentHash: primary.contentHash,
  acquiredByAttemptId: primary.acquiredByAttemptId, subjectId: contract.subjectId, verdict: "EXTRACTED",
  records: [{ name: "Ada One", office: "Mayor" }, { name: "Bea Two", office: "Council Member" }].map(fields => ({
    id: recordIdentity(fields, identity), subjectId: contract.subjectId, fields, evidenceSpanIds: [],
  })), spans: [], warnings: [], declaredRowCount: null, sourceRowCount: 2, actualRowCount: 2,
};
const run = (artifact: WorkerEvidence, selected = contract) => verifyExternalAuthorities({
  attemptId: "validator", producerAttemptId: "parser", candidate, evidence: primary,
  authorityEvidence: [artifact], verifiedAt: "2026-09-28T08:10:00.000Z",
}, selected)[0]!;

test("one independent profile confirms only its own roster row", () => {
  const result = run(independent);
  assert.equal(result.verdict, "PASS");
  assert.equal(result.candidateCount, 2);
  assert.equal(result.authorityCount, 1);
  assert.deepEqual(result.verifiedRecordIds, [candidate.records[0]!.id]);
});

test("a wrong office cannot confirm a named member", () => {
  const changed = evidence("profile", JSON.stringify([{ name: "Ada One", office: "City Manager" }]), independent.canonicalUrl, independent.acquiredByAttemptId);
  const result = run(changed);
  assert.equal(result.verdict, "FAIL");
  assert.ok(result.discrepancies.some(row => row.code === "EXTERNAL_FIELD_MISMATCH"));
});

test("a copy of the source, its URL, or its acquisition cannot be an independent profile", () => {
  for (const copied of [
    { ...independent, text: primary.text, contentHash: primary.contentHash },
    { ...independent, canonicalUrl: primary.canonicalUrl },
    { ...independent, acquiredByAttemptId: "parser" },
  ]) {
    const result = run(copied);
    assert.notEqual(result.verdict, "PASS");
    assert.ok(result.discrepancies.some(row => row.code === "SELF_VERIFICATION_REFUSED"));
  }
});

test("one profile contradiction fails the whole chain but preserves only the unrelated row's safe IDs", () => {
  const producer = { role: "PARSER" as const, provider: "fixture", version: "1", instance: "parser-1" };
  const validator = { role: "VALIDATOR" as const, provider: "fixture", version: "1", instance: "validator-1" };
  const auditor = { role: "ADVERSARIAL_AUDITOR" as const, provider: "fixture", version: "1", instance: "auditor-1" };
  const parsed = parseGeneralizedRecords({ attemptId: "parser", worker: producer, evidence: primary, contract }, contract);
  assert.equal(parsed.verdict, "EXTRACTED");
  const conflicting = evidence("profile", JSON.stringify([{ name: "Ada One", office: "Mayor" }, { name: "Bea Two", office: "City Manager" }]), independent.canonicalUrl, independent.acquiredByAttemptId);
  const checked = validateGeneralizedExtraction({ attemptId: "validator", worker: validator, producer, producerAttemptId: "parser", evidence: primary,
    candidate: parsed, contract, authorityEvidence: [conflicting], verifiedAt: "2026-09-28T08:10:00.000Z" }, contract);
  assert.equal(checked.verdict, "FAIL");
  assert.deepEqual(checked.validatedRecordIds, [parsed.records[0]!.id]);
  assert.equal(checked.validatedRecordCount, 1);
  const challenged = auditGeneralizedExtraction({ attemptId: "auditor", worker: auditor,
    context: { subjectId: contract.subjectId, contract, publisherSurfaces: ["city.example.gov"], methodVersion: 1,
      routes: [{ routeId: "official-page", canonicalUrl: primary.canonicalUrl, applicable: true, status: "HELD", artifactIds: [primary.artifactId], reason: "official roster" }],
      evidence: [primary], authorityEvidence: [conflicting], startedFrom: ["CANONICAL_SUBJECT_IDENTITY", "PUBLISHER_SOURCE_UNIVERSE", "METHOD_REGISTRY", "EVIDENCE_VAULT"], scope: "SOURCE_UNIVERSE" },
    candidate: { producer, validator, producerAttemptId: "parser", validatorAttemptId: "validator", extraction: parsed, coveredRouteIds: ["official-page"],
      claimsAbsence: false, claimsUniverseComplete: false, renderedRecordCount: null } }, contract);
  assert.equal(challenged.verdict, "BROKE");
  assert.equal(challenged.reopenRequired, true);
  assert.deepEqual(challenged.survivingRecordIds, [parsed.records[0]!.id]);
  assert.equal(challenged.survivingRecordCount, 1);
});

test("a global authority defect cannot issue any isolated validator IDs", () => {
  const producer = { role: "PARSER" as const, provider: "fixture", version: "1", instance: "parser-1" };
  const validator = { role: "VALIDATOR" as const, provider: "fixture", version: "1", instance: "validator-1" };
  const parsed = parseGeneralizedRecords({ attemptId: "parser", worker: producer, evidence: primary, contract }, contract);
  const copied = { ...independent, contentHash: primary.contentHash };
  const checked = validateGeneralizedExtraction({ attemptId: "validator", worker: validator, producer, producerAttemptId: "parser", evidence: primary,
    candidate: parsed, contract, authorityEvidence: [copied], verifiedAt: "2026-09-28T08:10:00.000Z" }, contract);
  assert.equal(checked.verdict, "INCONCLUSIVE");
  assert.deepEqual(checked.validatedRecordIds, []);
});
