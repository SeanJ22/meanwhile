import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { contentHash } from "../lib/control-plane/ids.ts";
import { PARSER_VERSION, parseLegistarEvents } from "../lib/control-plane/workers/parser.ts";
import { validateExtraction } from "../lib/control-plane/workers/validator.ts";
import type {
  LegacyCivicExtractionContract as CivicExtractionContract,
  ParserResult,
  ValidatorWorkerInput,
  WorkerEvidence,
} from "../lib/control-plane/workers/types.ts";
import type { WorkerRef } from "../lib/control-plane/attempt.ts";

const CONTRACT: CivicExtractionContract = {
  recordClass: "LEGISTAR_EVENTS",
  schemaVersion: 1,
  subjectId: "ocd-division/country:us/state:az/county:pima:board-of-supervisors",
  sourceBodyId: 138,
  sourceBodyName: "Board of Supervisors",
  publisherSlug: "pima",
  requiredFields: ["EventTime"],
  completenessScope: "Every event row in this immutable captured representation; other official routes remain separate obligations.",
  expectedSourceDate: null,
};
const PRODUCER: WorkerRef = { role: "PARSER", provider: "deterministic", version: PARSER_VERSION, instance: "parser-instance-1" };
const VALIDATOR: WorkerRef = { role: "VALIDATOR", provider: "deterministic", version: "1.0.0", instance: "validator-instance-1" };

function rows(count = 12): Record<string, unknown>[] {
  return Array.from({ length: count }, (_, index) => ({
    EventId: 100 + index,
    EventBodyId: 138,
    EventBodyName: "Board of Supervisors",
    EventDate: `2026-08-${String(index + 1).padStart(2, "0")}T00:00:00`,
    EventTime: "5:00 PM",
    EventLocation: 'Hearing room "A" — civic evidence',
    EventComment: null,
  }));
}

function inputFrom(source: unknown = rows(), contract = CONTRACT): ValidatorWorkerInput {
  return inputFromText(JSON.stringify(source, null, 2), contract);
}

function inputFromText(text: string, contract = CONTRACT): ValidatorWorkerInput {
  const evidence: WorkerEvidence = {
    artifactId: `ar-${contentHash(text).slice(7, 31)}`,
    contentHash: contentHash(text),
    text,
    acquiredByAttemptId: "at-real-acquirer-contract-fixture",
    canonicalUrl: contract.recordClass === "CIVICCLERK_EVENTS" ? `https://${contract.publisherSlug}.api.civicclerk.com/v1/Events` : "https://webapi.legistar.com/v1/pima/events",
    retrievedAt: "2026-08-30T10:00:00.000Z",
    sourceId: "legistar-pima",
    methodRouteId: "legistar-webapi-events",
  };
  const candidate = parseLegistarEvents({ attemptId: "at-parser-1", worker: PRODUCER, evidence, contract });
  return {
    attemptId: "at-validator-1",
    worker: VALIDATOR,
    producer: PRODUCER,
    producerAttemptId: candidate.attemptId,
    evidence,
    contract,
    candidate,
  };
}

function withCandidate(input: ValidatorWorkerInput, update: Partial<ParserResult>): ValidatorWorkerInput {
  return { ...input, candidate: { ...input.candidate, ...update } };
}

function refuses(input: ValidatorWorkerInput, code: string): void {
  const result = validateExtraction(input);
  assert.equal(result.verdict, "FAIL", JSON.stringify(result.findings));
  assert.equal(result.validatedRecordCount, 0);
  assert.ok(result.findings.some((finding) => finding.code === code), JSON.stringify(result.findings));
}

test("Validator accepts an independently produced complete captured artifact with exact lexical spans", () => {
  const input = inputFrom();
  const result = validateExtraction(input);
  assert.equal(result.verdict, "PASS", JSON.stringify(result.findings));
  assert.equal(result.validatedRecordCount, 12);
  assert.deepEqual(result.artifactIds, [input.evidence.artifactId]);
  assert.equal(result.producerAttemptId, input.candidate.attemptId);
  assert.ok(result.checked.includes("CLAIM_RESOLVES_TO_SOURCE_SPAN"));
  assert.ok(result.checked.includes("CANONICAL_IDENTITY_UNIQUE"));
  assert.ok(result.checked.includes("NEUTRALITY_AND_RENDERING_SYMMETRY"));
});

test("Validator controls use captured Pima publisher evidence as an additional positive control", () => {
  const text = readFileSync(new URL("./fixtures/legistar-pima-events-latest30.json", import.meta.url), "utf8");
  const input = inputFromText(text);
  const result = validateExtraction(input);
  assert.equal(result.verdict, "PASS", JSON.stringify(result.findings));
  assert.equal(result.validatedRecordCount, (JSON.parse(text) as unknown[]).length);
});

test("seed: wrong subject/body identity has a named machine refusal", () => {
  const valid = inputFrom();
  assert.equal(validateExtraction(valid).verdict, "PASS");
  const records = valid.candidate.records.map((record, index) => index === 0 ?
    { ...record, fields: { ...record.fields, EventBodyId: 999 } } : record);
  refuses(withCandidate(valid, { records }), "SUBJECT_IDENTITY_MISMATCH");
  refuses(withCandidate(valid, { subjectId: "another-government" }), "SUBJECT_IDENTITY_MISMATCH");
  refuses({ ...valid, evidence: { ...valid.evidence, canonicalUrl: "https://mesa.legistar.com/Calendar.aspx" } }, "SUBJECT_IDENTITY_MISMATCH");
});

test("seed: wrong date on otherwise-real evidence refuses independently of acquisition timestamp", () => {
  const valid = inputFrom();
  assert.equal(validateExtraction(valid).verdict, "PASS");
  const records = valid.candidate.records.map((record, index) => index === 0 ?
    { ...record, fields: { ...record.fields, EventDate: "2026-09-01T00:00:00" } } : record);
  refuses(withCandidate(valid, { records }), "SOURCE_DATE_MISMATCH");
  const expected = inputFrom(rows(1), { ...CONTRACT, expectedSourceDate: "2026-08-01" });
  assert.equal(validateExtraction(expected).verdict, "PASS");
  refuses({ ...expected, contract: { ...expected.contract, expectedSourceDate: "2026-08-02" } }, "SOURCE_DATE_MISMATCH");
});

test("seed: a real span with the same value in another row cannot support the claimed row", () => {
  const valid = inputFrom();
  const first = valid.candidate.spans.find((span) => span.jsonPointer === "/0/EventBodyName")!;
  const other = valid.candidate.spans.find((span) => span.jsonPointer === "/1/EventBodyName")!;
  assert.equal(first.quote, other.quote);
  const spans = valid.candidate.spans.map((span) => span.id === first.id ?
    { ...span, jsonPointer: other.jsonPointer, start: other.start, end: other.end, quote: other.quote } : span);
  refuses(withCandidate(valid, { spans }), "UNSUPPORTED_EVIDENCE_SPAN");
  const changedOffsets = valid.candidate.spans.map((span) => span.id === first.id ? { ...span, start: span.start + 1 } : span);
  refuses(withCandidate(valid, { spans: changedOffsets }), "UNSUPPORTED_EVIDENCE_SPAN");
});

test("seed: publisher declares twelve rows but only eleven were extracted", () => {
  const valid = inputFrom({ "@odata.count": 12, value: rows() });
  assert.equal(validateExtraction(valid).verdict, "PASS");
  const omitted = valid.candidate.records.at(-1)!;
  refuses(withCandidate(valid, {
    records: valid.candidate.records.slice(0, -1),
    spans: valid.candidate.spans.filter((span) => span.recordId !== omitted.id),
    actualRowCount: 11,
  }), "DECLARED_COUNT_MISMATCH");
});

test("seed: duplicate entity represented as two is refused even when both point to real evidence", () => {
  const valid = inputFrom();
  refuses(withCandidate(valid, { records: [...valid.candidate.records, valid.candidate.records[0]], actualRowCount: 13 }), "DUPLICATE_ENTITY");
});

test("seed: contradictory official values are surfaced without selecting one", () => {
  const source = rows();
  source.push({ ...source[0], EventDate: "2026-09-11T00:00:00" });
  refuses(inputFrom(source), "CONTRADICTORY_OFFICIAL_VALUES");
  const duplicateKey = JSON.stringify(rows(1)).replace('"EventBodyId":138', '"EventBodyId":139,"EventBodyId":138');
  refuses(inputFromText(duplicateKey), "CONTRADICTORY_OFFICIAL_VALUES");
});

test("seed: producer self-validation is refused across role aliases and shared Attempts", () => {
  const valid = inputFrom();
  refuses({ ...valid, worker: { ...VALIDATOR, instance: PRODUCER.instance } }, "SELF_VALIDATION_REFUSED");
  refuses({ ...valid, worker: PRODUCER }, "SELF_VALIDATION_REFUSED");
  refuses({ ...valid, attemptId: valid.producerAttemptId }, "SELF_VALIDATION_REFUSED");
  refuses({ ...valid, producer: { ...PRODUCER, role: "VALIDATOR" } }, "SELF_VALIDATION_REFUSED");
});

test("machine provenance and artifact identity cannot be supplied by candidate assertions", () => {
  const valid = inputFrom();
  refuses(withCandidate(valid, { acquiredByAttemptId: "model-asserted-acquirer" }), "MACHINE_PROVENANCE_MISMATCH");
  refuses(withCandidate(valid, { attemptId: "different-parser" }), "MACHINE_PROVENANCE_MISMATCH");
  refuses(withCandidate(valid, { artifactId: "different-artifact" }), "ARTIFACT_IDENTITY_MISMATCH");
  refuses(withCandidate(valid, { contentHash: `sha256-${"0".repeat(64)}` }), "ARTIFACT_IDENTITY_MISMATCH");
});

test("parser warnings, failed extraction, and malformed evidence never become certified empty records", () => {
  const valid = inputFrom();
  const warned = validateExtraction(withCandidate(valid, {
    warnings: [{ code: "PUBLISHER_FIELD_UNDERDETERMINED", detail: "A publisher field could not be interpreted.", severity: "WARNING" }],
  }));
  assert.equal(warned.verdict, "INCONCLUSIVE");
  assert.equal(warned.validatedRecordCount, 0);
  assert.equal(warned.findings[0].code, "PARSER_WARNING_UNRESOLVED");
  const info = validateExtraction(withCandidate(valid, {
    warnings: [{ code: "NESTED_AGENDA_NOT_IN_EVENT_CONTRACT", detail: "Agenda items are a separate obligation.", severity: "INFO" }],
  }));
  assert.equal(info.verdict, "PASS");
  refuses(withCandidate(valid, { verdict: "FAILED" }), "PARSER_EXTRACTION_FAILED");
  refuses(inputFrom([]), "FALSE_ZERO");
  const malformed = validateExtraction({ ...valid, evidence: { ...valid.evidence, text: "{invalid" } });
  assert.equal(malformed.verdict, "FAIL");
  assert.ok(malformed.findings.some((finding) => finding.code === "MALFORMED_SOURCE_EVIDENCE"));
  assert.ok(!malformed.checked.includes("CLAIM_RESOLVES_TO_SOURCE_SPAN"));
});

test("required fields and unreported source rows cannot silently disappear", () => {
  const valid = inputFrom();
  const records = valid.candidate.records.map((record, index) => {
    if (index !== 0) return record;
    const fields = { ...record.fields };
    delete fields.EventTime;
    return { ...record, fields };
  });
  refuses(withCandidate(valid, { records }), "COMPLETENESS_REQUIRED_FIELD_MISSING");
  const omitted = valid.candidate.records.at(-1)!;
  refuses(withCandidate(valid, {
    records: valid.candidate.records.slice(0, -1),
    spans: valid.candidate.spans.filter((span) => span.recordId !== omitted.id),
    actualRowCount: 11,
    sourceRowCount: 11,
  }), "EXTRACTED_COUNT_MISMATCH");
});

test("ordinary validation certifies captured scope without asserting a complete official route universe", () => {
  const input = inputFrom({ "@odata.count": 11, value: rows(11) });
  const result = validateExtraction(input);
  assert.equal(result.verdict, "PASS", JSON.stringify(result.findings));
  assert.equal(result.validatedRecordCount, 11);
  assert.ok(!result.checked.includes("SOURCE_UNIVERSE"));
});

test("same immutable candidate yields exactly the same validation output", () => {
  const input = inputFrom();
  assert.deepEqual(validateExtraction(input), validateExtraction(structuredClone(input)));
});

const CIVICCLERK_CONTRACT: CivicExtractionContract = {
  ...CONTRACT,
  recordClass: "CIVICCLERK_EVENTS",
  subjectId: "az:city:city-of-avondale",
  publisherSlug: "avondaleaz",
  sourceBodyId: null,
  sourceBodyName: null,
  requiredFields: ["isPublished"],
};

function civicClerkSource() {
  return {
    "@odata.context": "https://avondaleaz.api.civicclerk.com/v1/$metadata#Events",
    value: [
      { id: 1404, eventName: "City Council Meeting", categoryId: 26, eventCategoryName: "City Council" },
      { id: 1377, eventName: "Planning Commission Meeting", categoryId: 29, eventCategoryName: "Planning Commission" },
      { id: 1346, eventName: "Possible Quorum", categoryId: 47, eventCategoryName: ".Upcoming Event Notices (Possible Quorum)" },
    ].map((row) => ({
      ...row,
      eventDate: "2027-12-13T17:30:00Z",
      startDateTime: "2027-12-13T17:30:00Z",
      isPublished: "Published",
      eventCategoryId: row.categoryId,
      categoryName: row.eventCategoryName,
      publishedFiles: [],
      eventLocation: { address1: "Council Chamber" },
    })),
  };
}

test("CivicClerk municipality capture preserves council, planning, and quorum category identities", () => {
  const input = inputFrom(civicClerkSource(), CIVICCLERK_CONTRACT);
  const result = validateExtraction(input);
  assert.equal(result.verdict, "PASS", JSON.stringify(result.findings));
  assert.equal(result.validatedRecordCount, 3);
  assert.deepEqual(input.candidate.records.map((record) => record.fields.categoryId).sort(), [26, 29, 47]);
  assert.ok(input.candidate.records.every((record) => record.id.startsWith("civicclerk:avondaleaz:")));
  // A municipality feed cannot silently be rebound wholesale to one category.
  refuses({ ...input, contract: { ...CIVICCLERK_CONTRACT, sourceBodyId: 26, sourceBodyName: "City Council" } }, "SUBJECT_IDENTITY_MISMATCH");
});

test("CivicClerk source context independently binds the municipality even with plausible event identities", () => {
  const source = civicClerkSource();
  const forged = { ...source, "@odata.context": "https://another-city.api.civicclerk.com/v1/$metadata#Events" };
  refuses(inputFrom(forged, CIVICCLERK_CONTRACT), "SUBJECT_IDENTITY_MISMATCH");
});

test("CivicClerk date claims, category contradictions, and omitted publication status are refused", () => {
  const valid = inputFrom(civicClerkSource(), CIVICCLERK_CONTRACT);
  const changedDate = valid.candidate.records.map((record, index) => index === 0 ?
    { ...record, fields: { ...record.fields, startDateTime: "2027-12-14T17:30:00Z" } } : record);
  refuses(withCandidate(valid, { records: changedDate }), "SOURCE_DATE_MISMATCH");
  const source = civicClerkSource();
  source.value[0].eventCategoryId = 29;
  refuses(inputFrom(source, CIVICCLERK_CONTRACT), "CONTRADICTORY_OFFICIAL_VALUES");
  const missingPublished = valid.candidate.records.map((record, index) => {
    if (index !== 0) return record;
    const fields = { ...record.fields };
    delete fields.isPublished;
    return { ...record, fields };
  });
  refuses(withCandidate(valid, { records: missingPublished }), "COMPLETENESS_REQUIRED_FIELD_MISSING");
});
