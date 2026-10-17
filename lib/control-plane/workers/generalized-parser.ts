import type { EvidenceSpan, ExtractedRecord, FieldValue, GeneralizedCivicExtractionContract, ParserResult, ParserWorkerInput, WorkerFinding } from "./types.ts";
import { assertGeneralizedScope, inventoryRecordEvidence, recordIdentity, RecordEvidenceRefusal } from "./record-evidence.ts";

export function parseGeneralizedRecords(input: ParserWorkerInput, contract: GeneralizedCivicExtractionContract): ParserResult {
  const base = {
    role: "PARSER" as const, attemptId: input.attemptId, implementation: "civic-record-mapping", version: "2.0.0", schemaVersion: 2 as const,
    recordClass: contract.recordClass, artifactId: input.evidence.artifactId, contentHash: input.evidence.contentHash,
    acquiredByAttemptId: input.evidence.acquiredByAttemptId, subjectId: contract.subjectId,
    contractMetadata: { jurisdiction: contract.jurisdiction, identity: contract.identity, sourceScope: contract.sourceScope, methodVersion: contract.methodVersion },
  };
  let sourceRowCount: number | null = null; let declaredRowCount: number | null = null;
  try {
    if (input.worker.role !== "PARSER") throw new RecordEvidenceRefusal("PARSER_ROLE_REQUIRED", "Extraction requires a PARSER actor.");
    assertGeneralizedScope(contract, input.evidence);
    const source = inventoryRecordEvidence(input.evidence, contract.extraction, contract);
    sourceRowCount = source.rows.length; declaredRowCount = source.declaredCount;
    if (sourceRowCount === 0) throw new RecordEvidenceRefusal("ZERO_ROW_EXTRACTION", "A zero-row extraction is a failed extraction, never publisher absence.");
    const warnings: WorkerFinding[] = []; const records: ExtractedRecord[] = []; const spans: EvidenceSpan[] = []; const seen = new Set<string>();
    source.rows.forEach((row, rowIndex) => {
      const fields: Record<string, FieldValue> = Object.create(null);
      for (const [field, cell] of Object.entries(row)) fields[field] = cell.value;
      for (const field of contract.requiredFields) if (fields[field] === null || fields[field] === undefined || fields[field] === "") throw new RecordEvidenceRefusal("REQUIRED_FIELD_MISSING", `Record ${rowIndex} lacks required ${field}.`);
      const id = recordIdentity(fields, contract.identity);
      if (seen.has(id)) warnings.push({ code: "DUPLICATE_SOURCE_RECORD_ID", severity: "WARNING", recordId: id, detail: "Source records share a stable identity; preserve both pending independent reconciliation." });
      seen.add(id); const evidenceSpanIds: string[] = [];
      for (const [field, cell] of Object.entries(row)) {
        const spanId = `span:${input.evidence.artifactId}:${rowIndex}:${field}`; evidenceSpanIds.push(spanId);
        spans.push({ id: spanId, artifactId: input.evidence.artifactId, contentHash: input.evidence.contentHash, recordId: id, field,
          jsonPointer: cell.locator, sourceFormat: contract.extraction.format, start: cell.start, end: cell.end,
          offsetUnit: "UTF16_CODE_UNITS", quote: input.evidence.text.slice(cell.start, cell.end) });
      }
      for (const omitted of source.omittedFields ?? []) if (omitted.rowIndex === rowIndex) warnings.push({ code: omitted.code, severity: "INFO", recordId: id, field: omitted.field, detail: `${omitted.detail} The optional field stays open as work.` });
      records.push({ id, subjectId: contract.subjectId, fields, evidenceSpanIds });
    });
    if (declaredRowCount !== null && declaredRowCount !== sourceRowCount) warnings.push({ code: "DECLARED_COUNT_MISMATCH", severity: "WARNING", detail: `Publisher declares ${declaredRowCount} rows; the captured array contains ${sourceRowCount}.` });
    return { ...base, verdict: warnings.some(warning => warning.severity !== "INFO") ? "AMBIGUOUS" : "EXTRACTED", records, spans, warnings, sourceRowCount, declaredRowCount, actualRowCount: records.length };
  } catch (error) {
    if (!(error instanceof RecordEvidenceRefusal)) throw error;
    return { ...base, verdict: "FAILED", records: [], spans: [], warnings: [{ code: error.code, severity: "BLOCKING", detail: error.message }], sourceRowCount, declaredRowCount, actualRowCount: 0 };
  }
}
