import assert from "node:assert/strict";
import test from "node:test";
import { assertFleetResult, type ParserResult } from "../lib/control-plane/workers/types.ts";

const valid: ParserResult = {
  role: "PARSER", attemptId: "attempt", implementation: "civic-events", version: "1", schemaVersion: 1,
  recordClass: "CIVICCLERK_EVENTS", artifactId: "artifact", contentHash: "hash", acquiredByAttemptId: "acquisition",
  subjectId: "subject", verdict: "EXTRACTED", records: [{ id: "event", subjectId: "subject", fields: { id: 1 }, evidenceSpanIds: ["span"] }],
  spans: [{ id: "span", artifactId: "artifact", contentHash: "hash", recordId: "event", field: "id", jsonPointer: "/value/0/id",
    start: 0, end: 1, offsetUnit: "UTF16_CODE_UNITS", quote: "1" }], warnings: [], declaredRowCount: 1, sourceRowCount: 1, actualRowCount: 1,
};

test("shared worker wire contract accepts a serialized scalar result and rejects corrupted nested records before durable certification", () => {
  assert.doesNotThrow(() => assertFleetResult(JSON.parse(JSON.stringify(valid)), "PARSER", "attempt"));
  const defects = [
    { records: [{ ...valid.records[0], fields: { id: { invented: true } } }] },
    { records: [{ ...valid.records[0], evidenceSpanIds: [3] }] },
    { records: [{ ...valid.records[0], fields: { id: Infinity } }] },
    { spans: [{ ...valid.spans[0], end: 99 }] },
    { spans: [{ ...valid.spans[0], start: -1 }] },
    { warnings: [{ code: "WARNING", detail: "Malformed severity", severity: "PASS" }] },
    { sourceRowCount: -1 }, { version: null }, { actualRowCount: 12 },
  ];
  for (const defect of defects) assert.throws(() => assertFleetResult({ ...valid, ...defect }, "PARSER", "attempt"), /WORKER_RESULT_SCHEMA_INVALID/);
  assert.throws(() => assertFleetResult(valid, "VALIDATOR", "attempt"), /WORKER_RESULT_IDENTITY_MISMATCH/);
  assert.throws(() => assertFleetResult(valid, "PARSER", "other-attempt"), /WORKER_RESULT_IDENTITY_MISMATCH/);
});

test("validator and auditor result envelopes reject missing counts, invented attack modes and a BROKE result that suppresses reopening", () => {
  const validator = { role: "VALIDATOR", attemptId: "v", producerAttemptId: "p", verdict: "PASS", checked: ["IDENTITY"], findings: [], artifactIds: ["artifact"], validatedRecordCount: 1 };
  assert.doesNotThrow(() => assertFleetResult(validator, "VALIDATOR", "v"));
  assert.throws(() => assertFleetResult({ ...validator, validatedRecordCount: null }, "VALIDATOR", "v"), /VALIDATOR_CHECKS/);
  const auditor = { role: "ADVERSARIAL_AUDITOR", attemptId: "a", producerAttemptId: "p", validatorAttemptId: "v", verdict: "BROKE",
    startedFrom: ["EVIDENCE_VAULT"], findings: [], artifactIds: ["artifact"], survivingRecordCount: 0, reopenRequired: true,
    attacks: [{ mode: "COVERAGE", applicable: true, executed: true, reason: "Independent denominator disagrees", verdict: "BROKE", findings: [] }] };
  assert.doesNotThrow(() => assertFleetResult(auditor, "ADVERSARIAL_AUDITOR", "a"));
  assert.throws(() => assertFleetResult({ ...auditor, reopenRequired: false }, "ADVERSARIAL_AUDITOR", "a"), /AUDITOR/);
  assert.throws(() => assertFleetResult({ ...auditor, attacks: [{ ...auditor.attacks[0], mode: "TRUST_PRODUCER" }] }, "ADVERSARIAL_AUDITOR", "a"), /AUDITOR_ATTACKS/);
});
