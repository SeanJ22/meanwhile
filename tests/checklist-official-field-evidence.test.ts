import assert from "node:assert/strict";
import test from "node:test";
import type { AssignmentSources } from "../lib/control-plane/assignment-view.ts";
import type { ExpansionScopeDecision } from "../lib/control-plane/expansion/scopes.ts";
import { checklistOfficialFieldEvidence } from "../lib/control-plane/readiness/checklist-official-field-evidence.ts";
import { buildChecklistCensus } from "../lib/control-plane/readiness/checklist-census.ts";
import { evaluateChecklistSnapshot } from "../lib/control-plane/readiness/checklist-score.ts";

const joined = "2026-09-28T06:00:00.000Z";
const observed = "2026-09-28T09:00:00.000Z";
const scope = { key: "zcta:2020/85635", receiptId: "test-exact-receipt", budgetStartedAt: joined } as ExpansionScopeDecision;
const subject = "az:city:example";
const hash = `sha256-${"a".repeat(64)}`;
const span = (field: string) => ({ id: `span-${field}`, recordId: "record-1", field,
  artifactId: "ar-primary", contentHash: hash, start: 0, end: 4, quote: "test", offsetUnit: "UTF16_CODE_UNITS" });
const parser = { id: "result-parser", workItemId: "wi-source", attemptId: "at-parser",
  startedAt: "2026-09-28T07:00:00.000Z", endedAt: "2026-09-28T07:01:00.000Z", inputResultIds: [],
  result: { role: "PARSER", verdict: "EXTRACTED", recordClass: "OFFICIAL_ROSTER", subjectId: subject,
    artifactId: "ar-primary", contentHash: hash, acquiredByAttemptId: "at-source",
    contractMetadata: { sourceScope: { canonicalUrls: ["https://city.example.gov/council"] } },
    records: [{ id: "record-1", subjectId: subject,
      fields: { name: "Alex Example", office: "Council member", phone: "555-0100", contactKind: "PUBLIC_OFFICE" },
      evidenceSpanIds: ["span-name", "span-office", "span-phone"] }],
    spans: [span("name"), span("office"), span("phone")] } };
const validator = { id: "result-validator", workItemId: "wi-source", attemptId: "at-validator",
  endedAt: "2026-09-28T07:02:00.000Z", inputResultIds: ["result-parser"],
  result: { role: "VALIDATOR", verdict: "PASS", producerAttemptId: "at-parser",
    validatedRecordIds: ["record-1"], externalVerifications: [{ verdict: "PASS",
      verifiedRecordIds: ["record-1"], comparison: { kind: "RECORD_VALUES_SUBSET", fields: ["name", "office"] } }] } };
const auditor = { id: "result-auditor", workItemId: "wi-source", attemptId: "at-auditor",
  endedAt: "2026-09-28T07:03:00.000Z", inputResultIds: ["result-parser", "result-validator"],
  result: { role: "ADVERSARIAL_AUDITOR", verdict: "SURVIVED", survivingRecordIds: ["record-1"] } };
const source = (): AssignmentSources => ({
  obligations: [{ id: "obligation", subjectId: subject,
    assignments: [{ assignmentKey: scope.key, ref: scope.receiptId, at: joined }] }],
  workItems: [{ id: "wi-source", project: "freshness", subject,
    autonomousPlan: { ownerInstructions: [scope.receiptId] },
    publicationOutcome: { status: "PUBLISHED", workerResultId: "result-auditor",
      at: "2026-09-28T07:05:00.000Z", candidateId: "candidate-1", versionId: "version-1",
      acceptedMembers: [{ recordId: "record-1", memberId: "member-1" }] } }],
  attempts: [{ id: "at-source", workItemId: "wi-source", outcome: "COMPLETED", artifactIds: ["ar-primary"] }],
  artifacts: [{ artifactId: "ar-primary", workItemId: "wi-source", attemptId: "at-source",
    tier: "RAW", partial: false, contentHash: hash, recordedAt: "2026-09-28T06:30:00.000Z",
    canonicalUrl: "https://city.example.gov/council" }],
  workerResults: [parser, validator, auditor], pipeline: [], occurrences: [],
} as unknown as AssignmentSources);
const read = (sources: AssignmentSources) => checklistOfficialFieldEvidence({
  scope, sources, observedAt: observed,
  knownRecordKeys: new Set([JSON.stringify([subject, "OFFICIAL_ROSTER", "record-1"])]),
});

test("normal roster lineage exposes exact verified fields and accepted reader binding without checklist credit", () => {
  const rows = read(source());
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].fields.map(field => [field.name, field.recordSurvivedChecks, field.independentlyMatched]), [
    ["name", true, true], ["office", true, true], ["phone", true, false],
  ]);
  assert.equal(rows[0].fields.find(field => field.name === "phone")?.officialContactEligible, true);
  assert.equal(rows[0].fields.every(field => field.readerFieldVisible === "UNMEASURED"), true);
  assert.equal(rows[0].reader.state, "MEMBER_BINDING_ACCEPTED");
  assert.equal(rows[0].reader.objectId, "member-1");
  assert.equal(rows[0].reader.publicSurface, "UNMEASURED");
  assert.equal(rows[0].effectivePeriod, "UNRESOLVED");
  assert.ok(rows[0].relatedPredicates.some(predicate => predicate.id === "OFF-09" && /personal/.test(predicate.residual)));
  const census = buildChecklistCensus({ scope, sources: source(), observedAt: observed });
  assert.equal(census.fieldEvidence?.length, 1);
  assert.equal(evaluateChecklistSnapshot(census).results.filter(result => result.passed).length, 0);
  const repeated = read({ ...source(), workerResults: [...source().workerResults, {
    ...parser, id: "result-parser-retry", endedAt: "2026-09-28T08:00:00.000Z",
  }] } as unknown as AssignmentSources);
  assert.equal(repeated.length, 1, "a parser retry does not inflate known field evidence");
});

test("wrong instruction, earlier shared-subject result, and missing source span never earn field evidence", () => {
  const base = source();
  assert.equal(read({ ...base, workItems: [{ ...base.workItems[0],
    autonomousPlan: { ...base.workItems[0].autonomousPlan, ownerInstructions: ["another-receipt"] } }] } as AssignmentSources).length, 0);
  assert.equal(read({ ...base, workerResults: [{ ...parser, startedAt: "2026-09-28T05:00:00.000Z" }, validator, auditor] } as unknown as AssignmentSources).length, 0);
  const noSpans = { ...parser, result: { ...parser.result, spans: [] } };
  assert.equal(read({ ...base, workerResults: [noSpans, validator, auditor] } as unknown as AssignmentSources).length, 0);
});

test("no independent per-row survival or accepted member binding leaves status unproved", () => {
  const base = source();
  const noValidation = read({ ...base, workerResults: [parser, { ...validator,
    result: { ...validator.result, validatedRecordIds: [] } }, auditor] } as unknown as AssignmentSources);
  assert.equal(noValidation[0].fields.every(field => !field.recordSurvivedChecks), true);
  assert.equal(noValidation[0].reader.state, "UNBOUND");
  const noBinding = read({ ...base, workItems: [{ ...base.workItems[0],
    publicationOutcome: { ...base.workItems[0].publicationOutcome, acceptedMembers: [] } }] } as AssignmentSources);
  assert.equal(noBinding[0].reader.state, "UNBOUND");
  const personal = { ...parser, result: { ...parser.result, records: [{ ...parser.result.records[0],
    fields: { ...parser.result.records[0].fields, contactKind: "PERSONAL" } }] } };
  const personalRows = read({ ...base, workerResults: [personal, validator, auditor] } as unknown as AssignmentSources);
  assert.equal(personalRows[0].fields.find(field => field.name === "phone")?.officialContactEligible, false);
});

test("directory fields retain GOV residuals without inventing source-row to body identity", () => {
  const base = source();
  const directory = { ...parser, result: { ...parser.result, recordClass: "OFFICIAL_BOARD_DIRECTORY",
    records: [{ ...parser.result.records[0], fields: { bodyName: "Planning Board", bodyClass: "advisory",
      homepageUrl: "https://city.example.gov/boards/planning" },
      evidenceSpanIds: ["span-bodyName", "span-bodyClass", "span-homepageUrl"] }],
    spans: [span("bodyName"), span("bodyClass"), span("homepageUrl")] } };
  const sources = { ...base, workerResults: [directory, validator, auditor],
    workItems: [{ ...base.workItems[0], publicationOutcome: { ...base.workItems[0].publicationOutcome,
      acceptedMembers: undefined, bodyIds: ["body-1"] } }] } as unknown as AssignmentSources;
  const rows = checklistOfficialFieldEvidence({ scope, sources, observedAt: observed,
    knownRecordKeys: new Set([JSON.stringify([subject, "OFFICIAL_BOARD_DIRECTORY", "record-1"])]) });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].reader.state, "UNBOUND");
  assert.ok(rows[0].relatedPredicates.some(predicate => predicate.id === "GOV-11" && /denominator/.test(predicate.residual)));
});
