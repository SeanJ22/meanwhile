import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { parseCivicRecords } from "../lib/control-plane/workers/parser.ts";
import { validateExtraction } from "../lib/control-plane/workers/validator.ts";
import { auditExtraction } from "../lib/control-plane/workers/auditor.ts";
import { bundleProcedure, runIsolatedSource } from "../lib/control-plane/workers/isolation.ts";
import { assertFleetResult, type AuditorWorkerInput, type GeneralizedCivicExtractionContract, type ParserWorkerInput, type RecordExtractionShape, type ValidatorWorkerInput, type WorkerEvidence } from "../lib/control-plane/workers/types.ts";

const timestamp = "2026-09-03T18:00:00.000Z"; // Fixed fixture time, not a session stamp.
const shape: RecordExtractionShape = { format: "JSON_RECORDS", rowsPointer: "/records", fields: { id: { source: "/id", type: "STRING" }, name: { source: "/name", type: "STRING" } } };
function evidence(text: string, id = "capture", sourceId = "fixture-county", url = "https://county.example.gov/roster"): WorkerEvidence {
  return { artifactId: id, contentHash: `sha256-${createHash("sha256").update(text).digest("hex")}`, text, acquiredByAttemptId: `acquire-${id}`, canonicalUrl: url, retrievedAt: timestamp, sourceId, methodRouteId: "OFFICIAL_ROSTER" };
}
function request(text = '{"records":[{"id":"1","name":"Member A"},{"id":"2","name":"Member B"}]}', extraction = shape, recordClass = "OFFICIAL_ROSTER"): ParserWorkerInput & { contract: GeneralizedCivicExtractionContract } {
  const held = evidence(text);
  return { attemptId: "parser-attempt", worker: { role: "PARSER", instance: "parser-instance", provider: "deterministic", version: "2.0.0" }, evidence: held,
    contract: { schemaVersion: 2, recordClass, subjectId: "fixture:nh:county", jurisdiction: { country: "us", state: "nh", canonicalId: "fixture:nh:county" },
      identity: { namespace: "fixture:nh:county:office", keyFields: ["id"] }, sourceScope: { publisher: "Fixture county", sourceId: held.sourceId, routeIds: [held.methodRouteId], canonicalUrls: [held.canonicalUrl], observationArtifactIds: [held.artifactId] }, methodVersion: 56,
      requiredFields: ["id", "name"], completenessScope: "Every mapped record in the held official roster fixture; no source-universe claim.", expectedSourceDate: null, extraction, verification: { required: false, authorities: [] } } };
}
function validator(input = request()): ValidatorWorkerInput {
  return { ...input, attemptId: "validator-attempt", worker: { role: "VALIDATOR", instance: "validator-instance", provider: "deterministic", version: "2.0.0" }, producer: input.worker, producerAttemptId: input.attemptId, candidate: parseCivicRecords(input), verifiedAt: timestamp };
}
function auditor(input = request()): AuditorWorkerInput {
  return { attemptId: "auditor-attempt", worker: { role: "ADVERSARIAL_AUDITOR", instance: "auditor-instance", provider: "deterministic", version: "2.0.0" }, context: { subjectId: input.contract.subjectId, contract: input.contract, publisherSurfaces: [input.evidence.canonicalUrl], methodVersion: input.contract.methodVersion,
      routes: [{ routeId: input.evidence.methodRouteId, canonicalUrl: input.evidence.canonicalUrl, applicable: true, status: "HELD", artifactIds: [input.evidence.artifactId], reason: "Fixture source observation" }], evidence: [input.evidence], scope: "CAPTURED_ARTIFACT", startedFrom: ["CANONICAL_SUBJECT_IDENTITY", "PUBLISHER_SOURCE_UNIVERSE", "METHOD_REGISTRY", "EVIDENCE_VAULT"] },
    candidate: { producer: input.worker, validator: validator(input).worker, producerAttemptId: input.attemptId, validatorAttemptId: "validator-attempt", extraction: parseCivicRecords(input), coveredRouteIds: [input.evidence.methodRouteId], claimsAbsence: false, claimsUniverseComplete: false, renderedRecordCount: null } };
}
function withAuthority(input = request()): { parser: ReturnType<typeof request>; held: WorkerEvidence } {
  const held = evidence("<table><tr><th>ID</th><th>Name</th></tr><tr><td>1</td><td>Member A</td></tr><tr><td>2</td><td>Member B</td></tr></table>", "register", "fixture-state-register", "https://state.example.gov/register");
  return { held, parser: { ...input, contract: { ...input.contract, verification: { required: true, authorities: [{ id: "fixture-state-register", type: "GOVERNMENT_REGISTER", publisher: "Fixture state register", sourceId: held.sourceId, canonicalUrls: [held.canonicalUrl], artifactIds: [held.artifactId], authorityEvidenceArtifactIds: [held.artifactId], independenceBasis: "DISTINCT_AUTHORITY", independenceExplanation: "Separately published official register, acquired independently of the county roster fixture.", extraction: { format: "HTML_TABLE", tableIndex: 0, headerRows: 1, fields: { id: { source: 0, type: "STRING" }, name: { source: 1, type: "STRING" } } }, comparison: { kind: "RECORD_VALUES", keyFields: ["id"], fields: ["name"] } }] } } } };
}

test("v2 roster JSON retains source occurrence, jurisdiction and identity through independent validation and audit", () => {
  const input = request(); const parsed = parseCivicRecords(input);
  assert.equal(parsed.verdict, "EXTRACTED"); assert.equal(parsed.schemaVersion, 2); assert.equal(parsed.actualRowCount, 2);
  assert.equal(parsed.contractMetadata?.jurisdiction.state, "nh");
  for (const span of parsed.spans) assert.equal(input.evidence.text.slice(span.start, span.end), span.quote);
  const validated = validateExtraction(validator(input)); assert.equal(validated.verdict, "PASS"); assert.equal(validated.extractionVerdict, "PASS"); assert.deepEqual(validated.externalVerifications, []);
  const audited = auditExtraction(auditor(input)); assert.equal(audited.verdict, "SURVIVED", JSON.stringify(audited.findings));
  assertFleetResult(parsed, "PARSER", input.attemptId); assertFleetResult(validated, "VALIDATOR", "validator-attempt"); assertFleetResult(audited, "ADVERSARIAL_AUDITOR", "auditor-attempt");
});

test("v2 office rows in HTML and tabular election records preserve exact markup and quoted CSV source spans", () => {
  for (const input of [
    request('<table><tr><th>ID</th><th>Name</th></tr><tr><td>1</td><td><strong>Member</strong> A &amp; B</td></tr></table>', { format: "HTML_TABLE", tableIndex: 0, headerRows: 1, fields: { id: { source: 0, type: "STRING" }, name: { source: 1, type: "STRING" } } }),
    request('ID,Name\r\n1,"District, East"\r\n2,"District ""West"""\r\n', { format: "DELIMITED_TEXT", delimiter: ",", headerRows: 1, fields: { id: { source: 0, type: "STRING" }, name: { source: 1, type: "STRING" } } }, "ELECTION_DISTRICT")
  ]) {
    const parsed = parseCivicRecords(input); assert.equal(parsed.verdict, "EXTRACTED", JSON.stringify(parsed.warnings));
    assert.equal(validateExtraction(validator(input)).verdict, "PASS");
    const audited = auditExtraction(auditor(input)); assert.equal(audited.verdict, "SURVIVED", JSON.stringify(audited.findings));
    for (const span of parsed.spans) assert.equal(input.evidence.text.slice(span.start, span.end), span.quote);
  }
});

test("external official comparison is a distinct durable receipt with exact authority and no source text", () => {
  const { parser, held } = withAuthority(); const input = { ...validator(parser), authorityEvidence: [held] }; const result = validateExtraction(input);
  assert.equal(result.verdict, "PASS", JSON.stringify(result.findings)); const receipt = result.externalVerifications![0];
  assert.equal(receipt.verdict, "PASS"); assert.equal(receipt.authorityCount, 2); assert.equal(receipt.candidateCount, 2); assert.equal(receipt.authority.id, "fixture-state-register"); assert.equal(receipt.verifiedAt, timestamp); assert.equal(receipt.evidence[0].artifactId, held.artifactId); assert.ok(!("text" in receipt.evidence[0]));
  assertFleetResult(result, "VALIDATOR", input.attemptId);
  const audit = auditor(parser); assert.equal(auditExtraction({ ...audit, context: { ...audit.context, authorityEvidence: [held] } }).verdict, "SURVIVED");
});

test("acquired but unverified remains distinct from external disagreement and self-verification", () => {
  const { parser, held } = withAuthority();
  const missing = validateExtraction(validator(parser)); assert.equal(missing.extractionVerdict, "PASS"); assert.equal(missing.verdict, "INCONCLUSIVE"); assert.equal(missing.externalVerifications![0].verdict, "INCONCLUSIVE");
  const changed = evidence(held.text.replace("Member B", "Another name"), held.artifactId, held.sourceId, held.canonicalUrl);
  const disagreement = validateExtraction({ ...validator(parser), authorityEvidence: [changed] }); assert.equal(disagreement.extractionVerdict, "PASS"); assert.equal(disagreement.verdict, "FAIL"); assert.ok(disagreement.findings.some(f => f.code === "EXTERNAL_FIELD_MISMATCH"));
  const ownBytes = { ...held, text: parser.evidence.text, contentHash: parser.evidence.contentHash };
  const self = validateExtraction({ ...validator(parser), authorityEvidence: [ownBytes] }); assert.equal(self.extractionVerdict, "PASS"); assert.equal(self.verdict, "INCONCLUSIVE"); assert.ok(self.findings.some(f => f.code === "SELF_VERIFICATION_REFUSED"));
  const audit = auditor(parser); const broken = auditExtraction({ ...audit, context: { ...audit.context, authorityEvidence: [changed] } }); assert.equal(broken.verdict, "BROKE"); assert.ok(broken.findings.some(f => f.code === "EXTERNAL_FIELD_MISMATCH"));
});

test("same-publisher authority requires an explicit independent-record basis and never accepts a duplicate capture", () => {
  const { parser, held } = withAuthority(); const authority = parser.contract.verification.authorities[0]; const sameSource = { ...held, sourceId: parser.evidence.sourceId };
  const contract = { ...parser.contract, verification: { required: true, authorities: [{ ...authority, sourceId: sameSource.sourceId }] } };
  assert.equal(validateExtraction({ ...validator({ ...parser, contract }), authorityEvidence: [sameSource] }).verdict, "INCONCLUSIVE");
  const independent = { ...contract, verification: { required: true, authorities: [{ ...contract.verification.authorities[0], independenceBasis: "INDEPENDENT_OFFICIAL_RECORD" as const }] } };
  assert.equal(validateExtraction({ ...validator({ ...parser, contract: independent }), authorityEvidence: [sameSource] }).verdict, "PASS");
});

test("cross-row repeated quotations, missing mapped fields, source-scope forgery and duplicate identity fail independently", () => {
  const input = request('{"records":[{"id":"1","name":"Repeated"},{"id":"2","name":"Repeated"}]}');
  const original = validator(input); const first = original.candidate.spans.find(s => s.recordId === original.candidate.records[0].id && s.field === "name")!;
  const spans = original.candidate.spans.map(span => span.recordId === original.candidate.records[1].id && span.field === "name" ? { ...span, start: first.start, end: first.end, jsonPointer: first.jsonPointer } : span);
  const candidate = { ...original.candidate, spans }; assert.equal(validateExtraction({ ...original, candidate }).verdict, "FAIL");
  const audit = auditor(input); assert.equal(auditExtraction({ ...audit, candidate: { ...audit.candidate, extraction: candidate } }).verdict, "BROKE");
  assert.equal(parseCivicRecords({ ...input, evidence: { ...input.evidence, methodRouteId: "UNOBSERVED_ROUTE" } }).verdict, "FAILED");
  assert.equal(parseCivicRecords(request('{"records":[{"id":"1"}]}')).verdict, "FAILED");
  const duplicate = request('{"records":[{"id":"1","name":"A"},{"id":"1","name":"B"}]}'); assert.equal(parseCivicRecords(duplicate).verdict, "AMBIGUOUS"); assert.equal(validateExtraction(validator(duplicate)).verdict, "FAIL");
});

test("XML sitemap is record inventory with exact loc spans, never a derived meeting date or universe claim", () => {
  const input = request('<urlset><url><loc>https://district.example.gov/2026-01-02-meeting</loc></url></urlset>', { format: "XML_RECORDS", rowTag: "url", fields: { id: { source: "loc", type: "STRING" }, name: { source: "loc", type: "STRING" } } }, "PUBLISHED_RECORD_ROUTE");
  const parsed = parseCivicRecords(input); assert.equal(parsed.verdict, "EXTRACTED"); assert.deepEqual(Object.keys(parsed.records[0].fields).sort(), ["id", "name"]); assert.equal(validateExtraction(validator(input)).verdict, "PASS"); assert.equal(auditExtraction(auditor(input)).verdict, "SURVIVED");
  const incomplete = { ...input, evidence: evidence(input.evidence.text.replace('</urlset>', '<url><loc>unfinished</loc></urlset>')) }; assert.equal(parseCivicRecords(incomplete).verdict, "FAILED");
  assert.equal(parseCivicRecords(request('{"records":[]}')).verdict, "FAILED");
  assert.equal(parseCivicRecords({ ...input, evidence: evidence(input.evidence.text.replace("</urlset>", "")) }).verdict, "FAILED");
});

test("unsupported acquired media retains its media type and adapter reason without manufacturing parsed records", () => {
  const input=request("%PDF-fixture-binary-header",{format:"UNSUPPORTED",fields:{},mediaType:"application/pdf",reason:"PDF text extraction adapter required for this publication."},"MEETING_NOTICE");
  const parsed=parseCivicRecords(input); assert.equal(parsed.verdict,"FAILED"); assert.deepEqual(parsed.records,[]); assert.equal(parsed.warnings[0].code,"SOURCE_SHAPE_UNSUPPORTED");
  assert.match(parsed.warnings[0].detail,/application\/pdf: PDF text extraction adapter required/); assertFleetResult(parsed,"PARSER",input.attemptId);
});

test("generalized parser, validator, and auditor execute through the scrubbed disposable realm", async () => {
  const input = request();
  for (const [role, value] of [["PARSER", input], ["VALIDATOR", validator(input)], ["ADVERSARIAL_AUDITOR", auditor(input)]] as const) {
    const result = await runIsolatedSource(await bundleProcedure(role), value, 2000); assertFleetResult(result, role, value.attemptId);
    assert.equal(result.verdict, role === "PARSER" ? "EXTRACTED" : role === "VALIDATOR" ? "PASS" : "SURVIVED");
  }
});
