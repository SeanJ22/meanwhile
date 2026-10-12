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
    const validated = validateExtraction(validator(input));
    assert.equal(validated.extractionVerdict, "PASS", JSON.stringify(validated.findings));
    if (input.contract.extraction.format !== "XML_RECORDS") assert.equal(validated.verdict, "PASS", `${input.contract.extraction.format}: ${JSON.stringify(validated.findings)}`);
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

test("retained document text uses literal record boundaries; a contradicting official record holds only the disputed row (§3, §6)", () => {
  const extraction: RecordExtractionShape = { format: "TEXT_BLOCKS", recordStart: "ID:", recordEnd: "End of record", fields: { id: { source: "ID:", type: "STRING" }, name: { source: "Name:", type: "STRING" } } };
  const source = request("[Page 1]\nID: 1 Name: Member A End of record\nID: 2 Name: Member B End of record", extraction);
  const { held, parser: authority } = withAuthority();
  const parser = { ...source, contract: { ...source.contract, verification: authority.contract.verification } };
  const parsed = parseCivicRecords(parser);
  assert.equal(parsed.verdict, "EXTRACTED", JSON.stringify(parsed.warnings));
  assert.equal(parsed.actualRowCount, 2);
  assert.equal(validateExtraction(validator(parser)).verdict, "PASS", "no second source is needed for facts that are not judgment calls");
  assert.equal(validateExtraction({ ...validator(parser), authorityEvidence: [held] }).verdict, "PASS");
  const audit = auditor(parser);
  assert.equal(auditExtraction({ ...audit, context: { ...audit.context, authorityEvidence: [held] } }).verdict, "SURVIVED");
  for (const span of parsed.spans) assert.equal(parser.evidence.text.slice(span.start, span.end), span.quote);
  for (const bad of [parser.evidence.text.replace("Name: Member A", "Name: Member A Name: Duplicate"), parser.evidence.text.replace("End of record", "No ending")]) {
    const broken = request(bad, extraction);
    assert.notEqual(parseCivicRecords(broken).verdict, "EXTRACTED");
  }
  const conflict = evidence(held.text.replace("Member B", "Wrong person"), held.artifactId, held.sourceId, held.canonicalUrl);
  const disputed = validateExtraction({ ...validator(parser), authorityEvidence: [conflict] });
  assert.equal(disputed.verdict, "PASS");
  assert.deepEqual(disputed.validatedRecordIds, [parsed.records[0].id], "only Member B is in dispute");
});

test("an unchecked outside source never holds a verified fact; a contradicting one holds only its row", () => {
  const { parser, held } = withAuthority();
  const missing = validateExtraction(validator(parser)); assert.equal(missing.extractionVerdict, "PASS"); assert.equal(missing.verdict, "PASS"); assert.equal(missing.externalVerifications![0].verdict, "INCONCLUSIVE", "the receipt still says what was not checked");
  const changed = evidence(held.text.replace("Member B", "Another name"), held.artifactId, held.sourceId, held.canonicalUrl);
  const disagreement = validateExtraction({ ...validator(parser), authorityEvidence: [changed] }); assert.equal(disagreement.extractionVerdict, "PASS"); assert.equal(disagreement.validatedRecordCount, 1); assert.ok(disagreement.findings.some(f => f.code === "EXTERNAL_FIELD_MISMATCH"));
  const ownBytes = { ...held, text: parser.evidence.text, contentHash: parser.evidence.contentHash };
  const self = validateExtraction({ ...validator(parser), authorityEvidence: [ownBytes] }); assert.equal(self.extractionVerdict, "PASS"); assert.equal(self.verdict, "PASS"); assert.ok(self.findings.some(f => f.code === "SELF_VERIFICATION_REFUSED" && f.severity === "INFO"));
  const audit = auditor(parser); const broken = auditExtraction({ ...audit, context: { ...audit.context, authorityEvidence: [changed] } }); assert.equal(broken.verdict, "BROKE"); assert.ok(broken.findings.some(f => f.code === "EXTERNAL_FIELD_MISMATCH"));
});

test("a same-publisher authority without an independent-record basis is not a check, and never holds the facts", () => {
  const { parser, held } = withAuthority(); const authority = parser.contract.verification.authorities[0]; const sameSource = { ...held, sourceId: parser.evidence.sourceId };
  const contract = { ...parser.contract, verification: { required: true, authorities: [{ ...authority, sourceId: sameSource.sourceId }] } };
  const unchecked = validateExtraction({ ...validator({ ...parser, contract }), authorityEvidence: [sameSource] });
  assert.equal(unchecked.verdict, "PASS"); assert.equal(unchecked.externalVerifications![0].verdict, "INCONCLUSIVE");
  const independent = { ...contract, verification: { required: true, authorities: [{ ...contract.verification.authorities[0], independenceBasis: "INDEPENDENT_OFFICIAL_RECORD" as const }] } };
  assert.equal(validateExtraction({ ...validator({ ...parser, contract: independent }), authorityEvidence: [sameSource] }).verdict, "PASS");
});

test("a row whose quotation points at another row is held on its own; missing fields, scope forgery and duplicate identity fail", () => {
  const input = request('{"records":[{"id":"1","name":"Repeated"},{"id":"2","name":"Repeated"}]}');
  const original = validator(input); const first = original.candidate.spans.find(s => s.recordId === original.candidate.records[0].id && s.field === "name")!;
  const spans = original.candidate.spans.map(span => span.recordId === original.candidate.records[1].id && span.field === "name" ? { ...span, start: first.start, end: first.end, jsonPointer: first.jsonPointer } : span);
  const candidate = { ...original.candidate, spans }; const repeated = validateExtraction({ ...original, candidate });
  assert.deepEqual(repeated.validatedRecordIds, [original.candidate.records[0].id], "the row with a borrowed quotation is held; its neighbour is not");
  const audit = auditor(input); assert.equal(auditExtraction({ ...audit, candidate: { ...audit.candidate, extraction: candidate } }).verdict, "BROKE");
  assert.equal(parseCivicRecords({ ...input, evidence: { ...input.evidence, methodRouteId: "UNOBSERVED_ROUTE" } }).verdict, "FAILED");
  assert.equal(parseCivicRecords(request('{"records":[{"id":"1"}]}')).verdict, "FAILED");
  const duplicate = request('{"records":[{"id":"1","name":"A"},{"id":"1","name":"B"}]}'); assert.equal(parseCivicRecords(duplicate).verdict, "AMBIGUOUS");
  const ambiguous = validateExtraction(validator(duplicate)); assert.notEqual(ambiguous.verdict, "PASS"); assert.equal(ambiguous.validatedRecordCount, 0);
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

test("optional mapped fields fail independently and replay consistently through parser, validator and auditor", () => {
  const inputs = [
    request('{"records":[{"id":"1","name":"Member A","email":"a@town.gov"},{"id":"2","name":"Member B"}]}',
      { ...shape, fields: { ...shape.fields, email: { source: "/email", type: "STRING" } } }),
    request('<table><tr><td>1</td><td>Member A</td><td>a@town.gov</td></tr><tr><td>2</td><td>Member B</td><td></td></tr><tr><td>3</td><td>Member C</td><td>Email</td></tr></table>',
      { format: "HTML_TABLE", tableIndex: 0, headerRows: 0, fields: { id: { source: 0, type: "STRING" }, name: { source: 1, type: "STRING" }, email: { source: 2, type: "STRING" } } }),
    request('1,Member A,7\n2,Member B,unknown\n', { format: "DELIMITED_TEXT", delimiter: ",", headerRows: 0,
      fields: { id: { source: 0, type: "STRING" }, name: { source: 1, type: "STRING" }, district: { source: 2, type: "NUMBER" } } }),
    request('<members><member><id>1</id><name>Member A</name><email>a@town.gov</email></member><member><id>2</id><name>Member B</name></member></members>',
      { format: "XML_RECORDS", rowTag: "member", fields: { id: { source: "id", type: "STRING" }, name: { source: "name", type: "STRING" }, email: { source: "email", type: "STRING" } } }),
    request('ID: 1 Name: Member A Email: a@town.gov End\nID: 2 Name: Member B End',
      { format: "TEXT_BLOCKS", recordStart: "ID:", recordEnd: "End", fields: { id: { source: "ID:", type: "STRING" }, name: { source: "Name:", type: "STRING" }, email: { source: "Email:", type: "STRING" } } }),
  ];
  for (const input of inputs) {
    const parsed = parseCivicRecords(input);
    assert.equal(parsed.verdict, "EXTRACTED", JSON.stringify(parsed.warnings));
    assert.ok(parsed.records.length >= 2);
    assert.ok(parsed.warnings.length > 0 && parsed.warnings.every(row => row.severity === "INFO"));
    const validated = validateExtraction(validator(input));
    assert.equal(validated.extractionVerdict, "PASS", JSON.stringify(validated.findings));
    if (input.contract.extraction.format !== "XML_RECORDS") assert.equal(validated.verdict, "PASS", `${input.contract.extraction.format}: ${JSON.stringify(validated.findings)}`);
    const audited = auditExtraction(auditor(input));
    assert.equal(audited.verdict, "SURVIVED", JSON.stringify(audited.findings));
    assert.equal(parsed.records[1].fields.email ?? parsed.records[1].fields.district, undefined);
    const required = { ...input, contract: { ...input.contract, requiredFields: Object.keys(input.contract.extraction.fields) } };
    assert.equal(parseCivicRecords(required).verdict, "FAILED", "the actual required fields remain required");
  }
});

test("an absent optional profile detail does not suppress the visible person", () => {
  const input = request('<h2 class="detail-title">Member A</h2><ul class="detail-list"><li><span class="detail-list-label">ID:</span><span class="detail-list-value">1</span></li></ul>',
    { format: "HTML_PROFILE", fields: { id: { source: "detail:ID", type: "STRING" }, name: { source: "heading:detail-title", type: "STRING" }, email: { source: "detail:Email", type: "STRING" } } });
  const parsed = parseCivicRecords(input);
  assert.equal(parsed.verdict, "EXTRACTED");
  assert.deepEqual(parsed.records.map(row => ({ ...row.fields })), [{ id: "1", name: "Member A" }]);
  assert.equal(validateExtraction(validator(input)).extractionVerdict, "PASS");
  assert.equal(auditExtraction(auditor(input)).verdict, "SURVIVED");
});
