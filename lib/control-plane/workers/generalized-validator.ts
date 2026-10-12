import type { GeneralizedCivicExtractionContract, ValidatorResult, ValidatorWorkerInput, WorkerFinding } from "./types.ts";
import { assertGeneralizedScope, inventoryRecordEvidence, RecordEvidenceRefusal } from "./record-evidence.ts";
import { isQuotedExtraction, quotedSourceFindings } from "./quoted-proof.ts";
import { compareCandidateWithSource, findingsVerdict, issue, verifyExternalAuthorities } from "./record-verification.ts";
import { linkingPageFrom, needsSecondSource, SECTION3_MINIMUMS, section3Page, section3Record } from "../promotion/section3.ts";

/** Source-wide shortfalls that leave blanks open but make no captured record wrong. */
const COVERAGE_CODES = new Set(["COMPLETENESS_SOURCE_ROW_OMITTED", "DECLARED_COUNT_MISMATCH"]);

/** The Validator confirms each record's values on a saved official page from the right place, inside its freshness window. A record whose minimum facts pass is validated on its own; a second source is required only for judgment calls (`needsSecondSource`). */
export function validateGeneralizedExtraction(input: ValidatorWorkerInput, contract: GeneralizedCivicExtractionContract): ValidatorResult {
  const findings: WorkerFinding[] = [];
  // The Validator confirms what the extraction claims; each reader door then requires its class's minimums.
  const mapped = new Set([...Object.keys("fields" in contract.extraction ? contract.extraction.fields : {}), ...contract.requiredFields]);
  const classMinimums = (SECTION3_MINIMUMS[contract.recordClass] ?? []).filter(requirement => requirement.split("|").some(field => mapped.has(field)));
  const minimums = classMinimums.length ? classMinimums : contract.requiredFields;
  if (input.worker.role !== "VALIDATOR" || input.producer.role !== "PARSER" || !input.worker.instance || !input.producer.instance || input.worker.instance === input.producer.instance || input.attemptId === input.producerAttemptId) findings.push(issue("SELF_VALIDATION_REFUSED", "Validator and parser must have distinct machine actors and Attempts."));
  if (input.candidate.attemptId !== input.producerAttemptId || !input.worker.provider || !input.worker.version || !input.producer.provider || !input.producer.version) findings.push(issue("MACHINE_PROVENANCE_MISMATCH", "Candidate and worker identities must match machine-issued producer provenance."));
  if (input.candidate.verdict !== "EXTRACTED") findings.push(issue("PARSER_RESULT_UNRESOLVED", "Failed or ambiguous parser results cannot supply validated records.", input.candidate.verdict === "FAILED" ? "BLOCKING" : "WARNING"));
  findings.push(...input.candidate.warnings);
  try {
    assertGeneralizedScope(contract, input.evidence);
    // A record type with no parsing rule is checked from the quotes the Parser took; every other from its source rows.
    const replay = isQuotedExtraction(contract, input.candidate) ? quotedSourceFindings(input.candidate, contract, input.evidence)
      : compareCandidateWithSource(input.candidate, contract, input.evidence, inventoryRecordEvidence(input.evidence, contract.extraction));
    for (const finding of replay) {
      // A field beyond the minimums that fails stays open as work; it never holds its record.
      const open = COVERAGE_CODES.has(finding.code) || (finding.recordId && finding.field && !minimums.includes(finding.field));
      findings.push(open ? { ...finding, severity: "INFO" } : finding);
    }
  } catch (error) { if (!(error instanceof RecordEvidenceRefusal)) throw error; findings.push(issue(error.code, error.message)); }
  const now = input.verifiedAt && Number.isFinite(Date.parse(input.verifiedAt)) ? input.verifiedAt : input.evidence.retrievedAt;
  const page = { url: input.evidence.canonicalUrl, text: input.evidence.text, retrievedAt: input.evidence.retrievedAt,
    linkingPage: linkingPageFrom(input.evidence.canonicalUrl, input.authorityEvidence ?? []) };
  const pageVerdict = section3Page(page, contract.recordClass, now);
  if (!pageVerdict.ok) findings.push(issue(pageVerdict.reason!.split(":")[0], pageVerdict.reason!));
  // Findings about one record hold that record only; anything else holds the capture.
  const recordScoped = (f: WorkerFinding) => Boolean(f.recordId) && f.severity !== "INFO";
  const extractionVerdict = findingsVerdict(findings.filter(f => !recordScoped(f)));
  // A second source is required only for judgment calls. A declared source that contradicts one record still holds that record; anything else it says is coverage.
  const secondSource = needsSecondSource(contract);
  const externalVerifications = contract.verification.authorities.length ? verifyExternalAuthorities(input, contract) : [];
  if (secondSource && !externalVerifications.length) findings.push(issue("SECOND_SOURCE_MISSING", "This judgment call needs a second, independent source.", "WARNING"));
  for (const verification of externalVerifications) for (const finding of verification.discrepancies) {
    findings.push(secondSource || (finding.recordId && finding.severity === "BLOCKING") ? finding : { ...finding, severity: "INFO" });
  }
  const overall = findingsVerdict(findings.filter(f => !recordScoped(f)));
  const held = new Set(findings.filter(recordScoped).map(f => f.recordId!));
  const validatedRecordIds = overall !== "PASS" ? [] : input.candidate.records.flatMap(record => {
    if (held.has(record.id)) return [];
    let verdict = section3Record({ recordClass: contract.recordClass, fields: record.fields, page, now, pageVerdict, minimums });
    if (!verdict.live && contract.recordClass === "CAMPAIGN_FINANCE_FILING") verdict = section3Record({ recordClass: "CAMPAIGN_FINANCE_DOCUMENT", fields: record.fields, page, now, pageVerdict });
    if (verdict.live) return [record.id];
    findings.push(issue("MINIMUM_FACTS_UNVERIFIED", verdict.reason ?? "The record's minimum facts are not on the page.", "INFO", record.id));
    return [];
  });
  const verdict = overall !== "PASS" ? overall : validatedRecordIds.length ? "PASS" : "FAIL";
  return { role: "VALIDATOR", attemptId: input.attemptId, producerAttemptId: input.producerAttemptId, extractionVerdict, externalVerifications, verdict,
    checked: ["PRODUCER_INDEPENDENCE", "CONTRACT_SCOPE", "EXACT_SOURCE_OCCURRENCES", "OFFICIAL_SOURCE", "FRESHNESS_WINDOW", "VALUES_ON_PAGE"], findings,
    artifactIds: [...new Set([input.evidence.artifactId, ...externalVerifications.flatMap(v => v.evidence.map(e => e.artifactId))])], validatedRecordIds, validatedRecordCount: validatedRecordIds.length };
}
