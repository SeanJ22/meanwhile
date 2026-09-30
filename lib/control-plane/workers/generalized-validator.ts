import type { GeneralizedCivicExtractionContract, ValidatorResult, ValidatorWorkerInput, WorkerFinding } from "./types.ts";
import { assertGeneralizedScope, inventoryRecordEvidence, RecordEvidenceRefusal } from "./record-evidence.ts";
import { isQuotedExtraction, quotedSourceFindings } from "./quoted-proof.ts";
import { compareCandidateWithSource, findingsVerdict, issue, verifyExternalAuthorities } from "./record-verification.ts";
export function validateGeneralizedExtraction(input: ValidatorWorkerInput, contract: GeneralizedCivicExtractionContract): ValidatorResult {
  const findings: WorkerFinding[] = [];
  if (input.worker.role !== "VALIDATOR" || input.producer.role !== "PARSER" || !input.worker.instance || !input.producer.instance || input.worker.instance === input.producer.instance || input.attemptId === input.producerAttemptId) findings.push(issue("SELF_VALIDATION_REFUSED", "Validator and parser must have distinct machine actors and Attempts."));
  if (input.candidate.attemptId !== input.producerAttemptId || !input.worker.provider || !input.worker.version || !input.producer.provider || !input.producer.version) findings.push(issue("MACHINE_PROVENANCE_MISMATCH", "Candidate and worker identities must match machine-issued producer provenance."));
  if (input.candidate.verdict !== "EXTRACTED") findings.push(issue("PARSER_RESULT_UNRESOLVED", "Failed or ambiguous parser results cannot supply fully validated records.", input.candidate.verdict === "FAILED" ? "BLOCKING" : "WARNING"));
  findings.push(...input.candidate.warnings);
  try { assertGeneralizedScope(contract, input.evidence); findings.push(...(isQuotedExtraction(contract, input.candidate) ? quotedSourceFindings(input.candidate, contract, input.evidence)
    : compareCandidateWithSource(input.candidate, contract, input.evidence, inventoryRecordEvidence(input.evidence, contract.extraction)))); }
  catch (error) { if (!(error instanceof RecordEvidenceRefusal)) throw error; findings.push(issue(error.code, error.message)); }
  const extractionVerdict = findingsVerdict(findings);
  const externalVerifications = verifyExternalAuthorities(input, contract);
  if (contract.verification.required && !externalVerifications.length) findings.push(issue("EXTERNAL_VERIFICATION_MISSING", "This domain requires an external authority; extraction validation alone is insufficient.", "WARNING"));
  for (const verification of externalVerifications) findings.push(...verification.discrepancies);
  const verdict = findingsVerdict(findings);
  // A disagreement in one independently captured person may isolate that
  // person, but a source replay, authority identity, or chain failure taints
  // the whole capture. Keep the overall FAIL receipt even when other rows are
  // independently safe to carry forward.
  const localExternal = new Set(externalVerifications.flatMap(result => result.discrepancies.filter(f => f.recordId && f.severity !== "INFO")));
  const globallyUnsafe = extractionVerdict !== "PASS" || findings.some(f => f.severity !== "INFO" && !localExternal.has(f));
  const unsafeIds = new Set([...localExternal].map(f => f.recordId));
  const validatedRecordIds = globallyUnsafe ? [] : input.candidate.records.map(record => record.id).filter(id => !unsafeIds.has(id));
  return { role: "VALIDATOR", attemptId: input.attemptId, producerAttemptId: input.producerAttemptId, extractionVerdict, externalVerifications, verdict,
    checked: ["PRODUCER_INDEPENDENCE", "CONTRACT_SCOPE", "EXACT_SOURCE_OCCURRENCES", "SOURCE_RECORD_IDENTITIES", "EXTERNAL_AUTHORITY_COMPARISON"], findings,
    artifactIds: [...new Set([input.evidence.artifactId, ...externalVerifications.flatMap(v => v.evidence.map(e => e.artifactId))])], validatedRecordIds, validatedRecordCount: validatedRecordIds.length };
}
