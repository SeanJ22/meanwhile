import type { ExternalVerificationResult, FieldValue, GeneralizedCivicExtractionContract, ParserResult, ValidatorWorkerInput, WorkerEvidence, WorkerFinding } from "./types.ts";
import { inventoryRecordEvidence, recordIdentity, RecordEvidenceRefusal, type RecordEvidenceInventory } from "./record-evidence.ts";

export const stableValue = (value: unknown): string => JSON.stringify(value && typeof value === "object" ? Array.isArray(value) ? value.map(v => JSON.parse(stableValue(v))) : Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, JSON.parse(stableValue(v))])) : value);
export const valuesOf = (row: RecordEvidenceInventory["rows"][number]): Record<string, FieldValue> => Object.fromEntries(Object.entries(row).map(([field, cell]) => [field, cell.value]));
export const issue = (code: string, detail: string, severity: WorkerFinding["severity"] = "BLOCKING", recordId?: string, field?: string): WorkerFinding => ({ code, detail, severity, ...(recordId ? { recordId } : {}), ...(field ? { field } : {}) });
export const findingsVerdict = (findings: readonly WorkerFinding[]) => findings.some(f => f.severity === "BLOCKING") ? "FAIL" as const : findings.some(f => f.severity === "WARNING") ? "INCONCLUSIVE" as const : "PASS" as const;

/** Checks source occurrences directly. Does not invoke the parser or trust its count. */
export function compareCandidateWithSource(candidate: ParserResult, contract: GeneralizedCivicExtractionContract, evidence: WorkerEvidence, source: RecordEvidenceInventory): WorkerFinding[] {
  const findings: WorkerFinding[] = [];
  const add = (code: string, detail: string, recordId?: string, field?: string) => findings.push(issue(code, detail, "BLOCKING", recordId, field));
  if (candidate.schemaVersion !== 2 || candidate.recordClass !== contract.recordClass || candidate.subjectId !== contract.subjectId) add("EXTRACTION_CONTRACT_MISMATCH", "Candidate version, record class, and canonical subject must match the governing contract.");
  const metadata = { jurisdiction: contract.jurisdiction, identity: contract.identity, sourceScope: contract.sourceScope, methodVersion: contract.methodVersion };
  if (!candidate.contractMetadata || stableValue(candidate.contractMetadata) !== stableValue(metadata)) add("CONTRACT_PROVENANCE_MISMATCH", "The extraction must retain its exact jurisdiction, identity, publisher scope, and method version.");
  if (candidate.artifactId !== evidence.artifactId || candidate.contentHash !== evidence.contentHash || candidate.acquiredByAttemptId !== evidence.acquiredByAttemptId) add("ARTIFACT_IDENTITY_MISMATCH", "The candidate differs from the independently issued immutable source identity.");
  if (source.rows.length === 0 || candidate.records.length === 0) add("ZERO_ROW_EXTRACTION", "An empty extraction cannot become a verified civic absence.");
  if (candidate.actualRowCount !== candidate.records.length || candidate.records.length !== source.rows.length || candidate.sourceRowCount !== source.rows.length || candidate.declaredRowCount !== source.declaredCount) add("COMPLETENESS_SOURCE_ROW_OMITTED", `Captured source rows=${source.rows.length}; candidate rows=${candidate.records.length}; reported source rows=${candidate.sourceRowCount}.`);
  if (source.declaredCount !== null && source.declaredCount !== source.rows.length) add("DECLARED_COUNT_MISMATCH", `Publisher declaration ${source.declaredCount} does not reconcile with captured ${source.rows.length} records.`);
  const byId = new Map<string, { row: RecordEvidenceInventory["rows"][number]; index: number }>();
  source.rows.forEach((row, index) => {
    const id = recordIdentity(valuesOf(row), contract.identity);
    if (byId.has(id)) add("DUPLICATE_SOURCE_IDENTITY", "Distinct source rows share a stable identity; reconciliation is required.", id);
    byId.set(id, { row, index });
  });
  const ids = new Set<string>(); const spanIds = new Set<string>(); const consumed = new Set<number>();
  const spans = new Map(candidate.spans.map(span => [span.id, span]));
  if (spans.size !== candidate.spans.length) add("DUPLICATE_EVIDENCE_SPAN", "Evidence span identifiers must be unique.");
  for (const record of candidate.records) {
    if (ids.has(record.id)) add("DUPLICATE_ENTITY", "The candidate repeats a stable source identity.", record.id);
    ids.add(record.id);
    if (record.subjectId !== contract.subjectId || record.id !== recordIdentity(record.fields, contract.identity)) add("SUBJECT_IDENTITY_MISMATCH", "Record identity must bind the canonical subject and original source key.", record.id);
    const observed = byId.get(record.id);
    if (!observed) { add("UNSUPPORTED_SOURCE_RECORD", "No independent source row supports this candidate identity.", record.id); continue; }
    consumed.add(observed.index);
    const expectedFields = Object.keys(observed.row).sort();
    if (stableValue(Object.keys(record.fields).sort()) !== stableValue(expectedFields)) add("COMPLETENESS_SOURCE_FIELD_OMITTED", "Candidate fields differ from the explicit source field projection.", record.id);
    for (const field of contract.requiredFields) if (record.fields[field] === null || record.fields[field] === undefined || record.fields[field] === "") add("COMPLETENESS_REQUIRED_FIELD_MISSING", "Required civic field is missing or empty.", record.id, field);
    for (const field of contract.dateFields ?? []) {
      const value = record.fields[field]; const date = typeof value === "string" ? value.slice(0, 10) : "";
      const parsed = new Date(`${date}T00:00:00.000Z`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date || (contract.expectedSourceDate !== null && date !== contract.expectedSourceDate)) add("SOURCE_DATE_MISMATCH", "Source date does not satisfy its explicit calendar date contract.", record.id, field);
    }
    if (new Set(record.evidenceSpanIds).size !== record.evidenceSpanIds.length) add("DUPLICATE_EVIDENCE_SPAN", "A record repeats a support reference.", record.id);
    for (const field of expectedFields) {
      const cell = observed.row[field]; const supporting = record.evidenceSpanIds.map(id => spans.get(id)).filter(span => span?.field === field);
      if (record.fields[field] !== cell.value || supporting.length !== 1) { add("UNSUPPORTED_EVIDENCE_SPAN", "Each mapped field requires its exact source occurrence and value.", record.id, field); continue; }
      const span = supporting[0]!;
      if (span.recordId !== record.id || span.artifactId !== evidence.artifactId || span.contentHash !== evidence.contentHash || span.sourceFormat !== contract.extraction.format || span.jsonPointer !== cell.locator || span.start !== cell.start || span.end !== cell.end || span.offsetUnit !== "UTF16_CODE_UNITS" || span.quote !== evidence.text.slice(cell.start, cell.end)) add("UNSUPPORTED_EVIDENCE_SPAN", "The cited quotation, range, and source locator do not support this field in its own record.", record.id, field);
    }
    for (const id of record.evidenceSpanIds) {
      spanIds.add(id); const span = spans.get(id);
      if (!span || span.recordId !== record.id || !Object.hasOwn(observed.row, span.field)) add("UNSUPPORTED_EVIDENCE_SPAN", "Support references an absent span or a different record/field.", record.id);
    }
  }
  if (consumed.size !== source.rows.length) add("COMPLETENESS_SOURCE_ROW_OMITTED", "Not every independently observed source record is uniquely represented.");
  if (candidate.spans.some(span => !spanIds.has(span.id))) add("UNSUPPORTED_EVIDENCE_SPAN", "Unreferenced source quotations cannot establish candidate provenance.");
  return findings;
}

/** External comparison starts from separately held official records, never a derived registry. */
export function verifyExternalAuthorities(input: Pick<ValidatorWorkerInput, "attemptId" | "producerAttemptId" | "candidate" | "evidence" | "authorityEvidence" | "verifiedAt">, contract: GeneralizedCivicExtractionContract): ExternalVerificationResult[] {
  return contract.verification.authorities.map(authority => {
    const discrepancies: WorkerFinding[] = []; const held = input.authorityEvidence ?? [];
    const requiredIds = [...new Set([...authority.artifactIds, ...authority.authorityEvidenceArtifactIds])];
    const evidence = held.filter(item => requiredIds.includes(item.artifactId));
    const artifacts = held.filter(item => authority.artifactIds.includes(item.artifactId));
    const rows: Record<string, FieldValue>[] = []; let observedAuthority = false;
    const inconclusive = (code: string, detail: string) => discrepancies.push(issue(code, detail, "WARNING"));
    if (!authority.id || !authority.publisher || !authority.sourceId || !authority.independenceExplanation.trim() || !authority.artifactIds.length || !authority.authorityEvidenceArtifactIds.length || !["GOVERNMENT_REGISTER", "STATUTORY_RECORD", "OFFICIAL_DENOMINATOR"].includes(authority.type)) inconclusive("VERIFICATION_AUTHORITY_UNESTABLISHED", "An identified external official authority and its publisher evidence are required.");
    if (requiredIds.some(id => !evidence.some(item => item.artifactId === id))) inconclusive("VERIFICATION_EVIDENCE_MISSING", "One or more authority records or authority identity artifacts have not been issued from the vault.");
    for (const artifact of artifacts) {
      if (artifact.artifactId === input.evidence.artifactId || artifact.contentHash === input.evidence.contentHash || artifact.canonicalUrl === input.evidence.canonicalUrl || artifact.acquiredByAttemptId === input.producerAttemptId || !artifact.acquiredByAttemptId || !/^sha256-[0-9a-f]{64}$/.test(artifact.contentHash)) {
        inconclusive("SELF_VERIFICATION_REFUSED", "The authority evidence repeats the extraction's artifact, bytes, URL, or producer-owned output."); continue;
      }
      if (artifact.sourceId !== authority.sourceId || !authority.canonicalUrls.includes(artifact.canonicalUrl) || !["DISTINCT_AUTHORITY", "INDEPENDENT_OFFICIAL_RECORD"].includes(authority.independenceBasis) || (artifact.sourceId === input.evidence.sourceId && authority.independenceBasis !== "INDEPENDENT_OFFICIAL_RECORD")) {
        inconclusive("VERIFICATION_AUTHORITY_SCOPE_MISMATCH", "The external evidence does not match the exact authority or documented distinct-record basis."); continue;
      }
      try {
        const inventory = inventoryRecordEvidence(artifact, authority.extraction);
        observedAuthority = true;
        if (!inventory.rows.length || (inventory.declaredCount !== null && inventory.declaredCount !== inventory.rows.length)) inconclusive("AUTHORITY_CAPTURE_INCOMPLETE", "An empty or count-inconsistent authority capture cannot verify coverage.");
        rows.push(...inventory.rows.map(valuesOf));
      } catch (error) { if (!(error instanceof RecordEvidenceRefusal)) throw error; inconclusive(error.code, error.message); }
    }
    const comparison = authority.comparison;
    if (!["RECORD_VALUES", "IDENTITY_SET", "COUNT"].includes(comparison.kind) || (comparison.kind !== "COUNT" && !comparison.keyFields.length) || (comparison.kind === "RECORD_VALUES" && !comparison.fields.length)) inconclusive("VERIFICATION_COMPARISON_UNSPECIFIED", "The authority comparison needs an explicit count, identity-set, or field-value burden.");
    if (!discrepancies.length) {
      if (rows.length !== input.candidate.records.length) discrepancies.push(issue("EXTERNAL_COUNT_MISMATCH", `Authority records=${rows.length}; candidate records=${input.candidate.records.length}.`));
      if (comparison.kind !== "COUNT") {
        const identity = { namespace: authority.id, keyFields: comparison.keyFields };
        try {
          const expected = new Map<string, Record<string, FieldValue>>();
          for (const row of rows) { const key = recordIdentity(row, identity); if (expected.has(key)) discrepancies.push(issue("EXTERNAL_IDENTITY_AMBIGUOUS", "The authority contains duplicate comparison identities.")); expected.set(key, row); }
          const observed = new Set<string>();
          for (const record of input.candidate.records) {
            const key = recordIdentity(record.fields, identity); observed.add(key); const other = expected.get(key);
            if (!other) discrepancies.push(issue("EXTERNAL_IDENTITY_MISMATCH", "Candidate identity is absent from the independent authority.", "BLOCKING", record.id));
            else if (comparison.kind === "RECORD_VALUES") for (const field of comparison.fields) if (!Object.hasOwn(other, field) || other[field] !== record.fields[field]) discrepancies.push(issue("EXTERNAL_FIELD_MISMATCH", "The candidate field differs from the independent official record.", "BLOCKING", record.id, field));
          }
          if (observed.size !== input.candidate.records.length || [...expected.keys()].some(key => !observed.has(key))) discrepancies.push(issue("EXTERNAL_IDENTITY_SET_MISMATCH", "The independently observed authority identity set is not reproduced by candidate records."));
        } catch (error) { if (!(error instanceof RecordEvidenceRefusal)) throw error; inconclusive(error.code, error.message); }
      }
    }
    const verifiedAt = input.verifiedAt && Number.isFinite(Date.parse(input.verifiedAt)) ? input.verifiedAt : null;
    if (!verifiedAt) inconclusive("VERIFICATION_TIMESTAMP_MISSING", "The broker has not issued a verification timestamp.");
    return { candidateAttemptId: input.producerAttemptId, validatorAttemptId: input.attemptId, authority,
      evidence: evidence.map(({ text: _text, ...metadata }) => metadata), comparison,
      candidateCount: input.candidate.records.length, authorityCount: observedAuthority ? rows.length : null,
      verdict: verifiedAt ? findingsVerdict(discrepancies) : "INCONCLUSIVE", discrepancies, verifiedAt };
  });
}
