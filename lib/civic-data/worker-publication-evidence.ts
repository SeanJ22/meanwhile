import { createHash } from "node:crypto";
import { canonicalJson } from "../control-plane/repository/types.ts";
import type { AutonomousWorkPlan } from "../control-plane/workers/autonomous-plan.ts";
import type { WorkerResultRecord } from "../control-plane/workers/types.ts";
import { inventoryRecordEvidence } from "../control-plane/workers/record-evidence.ts";
import { compareCandidateWithSource, verifyExternalAuthorities } from "../control-plane/workers/record-verification.ts";
import { isScheduled, scheduleObligation } from "../control-plane/scheduler/obligation.ts";
import type { WorkerPublicationCapture } from "./worker-roster-publication.ts";
import type { ManualSourceSetReceipt } from "./types.ts";

export function requirePublication(value: unknown, reason: string): asserts value {
  if (!value) throw new Error(`WORKER_PUBLICATION_${reason}`);
}

/** Replays completed independent workers, not model-written review claims.
 * The caller still owes its class-specific identity and Reader conversion. */
export function verifiedWorkerRecords(input: {
  plan: AutonomousWorkPlan; parser: WorkerResultRecord; validator: WorkerResultRecord;
  auditor: WorkerResultRecord; captures: readonly WorkerPublicationCapture[]; now: string;
}) {
  const { plan, parser, validator, auditor, now } = input;
  const contract = plan.contract;
  const extraction = parser.result, verification = validator.result, audit = auditor.result;
  requirePublication(contract.schemaVersion === 2 && plan.auditScope === "SOURCE_UNIVERSE", "CONTRACT_UNRESOLVED");
  requirePublication(extraction.role === "PARSER" && verification.role === "VALIDATOR" && audit.role === "ADVERSARIAL_AUDITOR", "WORKER_ROLES_INVALID");
  requirePublication(extraction.verdict === "EXTRACTED" && verification.verdict === "PASS" && audit.verdict === "SURVIVED" && !audit.reopenRequired &&
    [...extraction.warnings, ...verification.findings, ...audit.findings].every(f => f.severity === "INFO"), "VERIFICATION_UNFINISHED");
  requirePublication(new Set([parser.worker.instance, validator.worker.instance, auditor.worker.instance]).size === 3 &&
    new Set([parser.attemptId, validator.attemptId, auditor.attemptId]).size === 3 && parser.workItemId === validator.workItemId && parser.workItemId === auditor.workItemId &&
    verification.producerAttemptId === parser.attemptId && audit.producerAttemptId === parser.attemptId && audit.validatorAttemptId === validator.attemptId &&
    validator.inputResultIds.includes(parser.id) && auditor.inputResultIds.includes(parser.id) && auditor.inputResultIds.includes(validator.id), "INDEPENDENT_CHAIN_INVALID");
  requirePublication([parser, validator, auditor].every(record => canonicalJson(record.completion.completedTask.workerTask?.contract) === canonicalJson(contract)) &&
    auditor.completion.completedTask.workerTask?.auditScope === "SOURCE_UNIVERSE", "CONTRACT_MISMATCH");
  // Every published scalar must be compared, including optional extracted facts.
  const fields = Object.keys(contract.extraction.fields);
  requirePublication(fields.length > 0 && contract.verification.required && contract.verification.authorities.length > 0 &&
    [...fields, ...contract.requiredFields, ...contract.identity.keyFields].every(field => contract.verification.authorities.some(a =>
      a.comparison.kind === "RECORD_VALUES" && a.comparison.fields.includes(field))), "FIELD_VERIFICATION_MISSING");
  const primary = input.captures.find(c => c.evidence.artifactId === extraction.artifactId);
  requirePublication(primary, "PRIMARY_CAPTURE_MISSING");
  const required = new Set([extraction.artifactId, ...contract.verification.authorities.flatMap(a => [...a.artifactIds, ...a.authorityEvidenceArtifactIds])]);
  const captures = input.captures.filter(c => required.has(c.evidence.artifactId));
  requirePublication(new Set(captures.map(c => c.evidence.artifactId)).size === required.size, "AUTHORITY_CAPTURE_MISSING");
  for (const capture of captures) {
    const age = Date.parse(now) - Date.parse(capture.observedAt);
    const freshness = scheduleObligation({ id: parser.workItemId, subjectId: contract.subjectId, recordClass: contract.recordClass,
      routeId: capture.evidence.methodRouteId, active: true, readerImpactAt: plan.freshness?.readerImpactAt ?? null,
      observedChangeRateHours: plan.freshness?.observedChangeRateHours ?? null, declaredCycleHours: plan.freshness?.declaredCycleHours ?? null,
      lastWorkedAt: capture.observedAt }, Date.parse(now));
    requirePublication(Number.isFinite(age) && age >= 0 && isScheduled(freshness) && Date.parse(freshness.nextDueAt) > Date.parse(now) &&
      capture.transport === "REACHABLE" && !capture.partial && capture.httpStatus !== null && capture.httpStatus >= 200 && capture.httpStatus < 300 &&
      capture.evidence.contentHash === `sha256-${createHash("sha256").update(capture.evidence.text).digest("hex")}`, "CAPTURE_STALE_OR_UNPROVEN");
  }
  const source = inventoryRecordEvidence(primary.evidence, contract.extraction);
  requirePublication(compareCandidateWithSource(extraction, contract, primary.evidence, source).length === 0, "SOURCE_REPLAY_FAILED");
  const external = verifyExternalAuthorities({ attemptId: validator.attemptId, producerAttemptId: parser.attemptId, candidate: extraction,
    evidence: primary.evidence, authorityEvidence: captures.map(c => c.evidence), verifiedAt: now }, contract);
  requirePublication(external.length > 0 && external.every(check => check.verdict === "PASS"), "AUTHORITY_REPLAY_FAILED");
  requirePublication(extraction.actualRowCount > 0 && verification.validatedRecordCount === extraction.actualRowCount &&
    audit.survivingRecordCount === extraction.actualRowCount, "FALSE_ZERO_OR_COUNT_MISMATCH");
  const changed = { ...extraction, records: extraction.records.map((record, index) => index ? record : {
    ...record, fields: { ...record.fields, [fields[0]]: "UNSUPPORTED_CONTROL_72e9" } }) };
  requirePublication(compareCandidateWithSource(changed, contract, primary.evidence, source).length > 0 &&
    compareCandidateWithSource({ ...extraction, records: [] }, contract, primary.evidence, source).length > 0, "CONTROLS_FAILED");
  const sourceReceipt: ManualSourceSetReceipt = { contractVersion: 1, reviewedAt: now, reviewedBy: `independent-workers:${auditor.worker.instance}`,
    sources: captures.map(c => ({ requestedUrl: c.evidence.canonicalUrl, finalUrl: c.evidence.canonicalUrl, publisher: c.evidence.sourceId,
      sourceClass: "OFFICIAL_PUBLISHER", retrievedAt: c.observedAt, httpStatus: c.httpStatus!,
      rawHash: (c.evidence.sourceDocument?.contentHash ?? c.evidence.contentHash).slice(7), reviewOutcome: "SUPPORTED",
      reviewedEvidence: `Independent chain ${parser.id}, ${validator.id}, ${auditor.id}; exact source and external authority replay, full record counts and mutation/false-zero controls passed.` })) };
  return { contract, extraction, primary, captures, sourceReceipt };
}
