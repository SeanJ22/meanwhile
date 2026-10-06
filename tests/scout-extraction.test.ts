import assert from "node:assert/strict";
import test from "node:test";
import { contentHash } from "../lib/control-plane/ids.ts";
import { scoutExtraction } from "../lib/control-plane/workers/scout-extraction.ts";
import { quotedSourceFindings } from "../lib/control-plane/workers/quoted-proof.ts";
import type { GeneralizedCivicExtractionContract, WorkerEvidence } from "../lib/control-plane/workers/types.ts";
import type { ScoutFinding } from "../lib/control-plane/scheduler/scout-result.ts";
const text = '<table><tr><td>Ada Adams</td><td>Chair</td><td>ada@example.gov</td></tr><tr><td>Bea Baker</td><td>Clerk</td><td>bea@example.gov</td></tr></table>';
const evidence: WorkerEvidence = { artifactId: "saved", contentHash: contentHash(text), text, acquiredByAttemptId: "hunter", canonicalUrl: "https://example.gov/board", retrievedAt: "2026-10-05T12:00:00Z", sourceId: "example.gov", methodRouteId: "official" };
const contract: GeneralizedCivicExtractionContract = { schemaVersion: 2, subjectId: "body:example", recordClass: "OFFICIAL_ROSTER", jurisdiction: { country: "US", state: "AZ", canonicalId: "body:example" }, identity: { namespace: "body:example", keyFields: ["name", "office"] }, sourceScope: { sourceId: "example.gov", publisher: "Example Board", routeIds: ["official"], canonicalUrls: [evidence.canonicalUrl], observationArtifactIds: ["saved"] }, methodVersion: 1, requiredFields: ["name", "office"], completenessScope: "Named members on this page", expectedSourceDate: null, extraction: { format: "UNSUPPORTED", fields: {}, mediaType: "text/html", reason: "No coded reader" }, verification: { required: false, authorities: [] } };
const finding = (field: string, value: string, quote = value): ScoutFinding => ({ kind: "RECORD", summary: field, field, value, exactQuote: quote, sourceUrl: evidence.canonicalUrl, artifactIds: [evidence.artifactId], subjectId: "person:ada" });
const extract = (findings: ScoutFinding[]) => scoutExtraction({ contract, evidence, findings, attemptId: "builder" });
const minimum = [finding("name", "Ada Adams"), finding("office", "Chair")];
test("Box field proof keeps the correct email and replays through quotedSourceFindings", () => {
  const result = extract([...minimum, finding("email", "ada@example.gov")]);
  assert.equal(result.verdict, "EXTRACTED");
  assert.equal(result.records[0].fields.email, "ada@example.gov");
  assert.deepEqual(quotedSourceFindings(result, contract, evidence), []);
  assert.equal(result.sourceRowCount, null, "a finding is not a full roster census");
});
test("another person's contact and invented quotes stay owed while good minimum facts survive", () => {
  const result = extract([...minimum, finding("email", "bea@example.gov"), finding("phone", "555-1234")]);
  assert.equal(result.verdict, "EXTRACTED");
  assert.equal(result.records[0].fields.email, undefined);
  assert.equal(result.records[0].fields.phone, undefined);
  assert.ok(result.warnings.some(row => row.code === "FIELD_OUTSIDE_RECORD_BLOCK"));
  assert.deepEqual(quotedSourceFindings(result, contract, evidence), []);
});
test("a URL or quote alone cannot manufacture a record; wrong saved copies do not ground findings", () => {
  assert.equal(extract([finding("email", "ada@example.gov")]).verdict, "FAILED");
  assert.equal(extract(minimum.map(row => ({ ...row, artifactIds: ["different-copy"] }))).verdict, "FAILED");
  assert.equal(extract(minimum.map(row => ({ ...row, sourceUrl: "https://other.gov" }))).verdict, "FAILED");
  assert.equal(extract([...minimum, finding("email", "invented@example.gov", "ada@example.gov")]).records[0].fields.email, undefined);
});

test("quoted replay refuses moving a Box extraction to another subject or acquisition", () => {
  const result = extract(minimum);
  assert.ok(quotedSourceFindings({ ...result, subjectId: "another-body" }, contract, evidence).some(f => f.code === "QUOTED_SCOPE_MISMATCH"));
  assert.ok(quotedSourceFindings({ ...result, acquiredByAttemptId: "another-hunter" }, contract, evidence).some(f => f.code === "QUOTED_SCOPE_MISMATCH"));
});
