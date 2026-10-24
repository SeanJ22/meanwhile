import type {
  EvidenceSpan,
  ValidatorResult,
  ValidatorWorkerInput,
  WorkerFinding,
} from "./types.ts";
import { isFieldValue as scalar } from "./types.ts";
import { validateGeneralizedExtraction } from "./generalized-validator.ts";

const CORE_FIELDS = ["EventId", "EventBodyId", "EventBodyName", "EventDate"] as const;
const CIVICCLERK_CORE_FIELDS = ["id", "eventName", "startDateTime", "eventDate", "categoryId", "eventCategoryName", "isPublished"] as const;
const CHECKS = [
  "PRODUCER_INDEPENDENCE",
  "MACHINE_OWNED_PROVENANCE",
  "ARTIFACT_IDENTITY_AND_HASH",
  "SOURCE_DATE_CONSISTENCY",
  "DECLARED_AND_CAPTURED_COUNTS",
  "CONTRADICTIONS",
  "COMPLETENESS",
  "PARSER_WARNINGS",
  "CLAIM_RESOLVES_TO_SOURCE_SPAN",
  "CANONICAL_IDENTITY_UNIQUE",
  "ASSERTION_CLASS_BURDENS",
  "NEUTRALITY_AND_RENDERING_SYMMETRY",
  "FALSE_ZERO",
] as const;

interface SourceToken {
  readonly start: number;
  readonly end: number;
  readonly quote: string;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function pointerPart(value: string): string {
  return value.replace(/~/g, "~0").replace(/\//g, "~1");
}

/**
 * Locate source tokens independently of the extraction. JSON.parse has already
 * checked grammar; this walk proves that an offset belongs to its claimed JSON
 * pointer, not merely to an identical value somewhere else in the document.
 */
function sourceTokens(text: string): { tokens: Map<string, SourceToken>; duplicateKeys: string[] } {
  const tokens = new Map<string, SourceToken>();
  const duplicateKeys: string[] = [];
  let cursor = 0;
  const whitespace = () => { while (/\s/.test(text[cursor] ?? "") && cursor < text.length) cursor += 1; };
  const stringEnd = () => {
    cursor += 1;
    while (cursor < text.length) {
      if (text[cursor] === "\\") cursor += 2;
      else if (text[cursor++] === '"') return;
    }
  };
  const walk = (pointer: string): void => {
    whitespace();
    const start = cursor;
    if (text[cursor] === "{") {
      cursor += 1;
      whitespace();
      const keys = new Set<string>();
      while (text[cursor] !== "}") {
        const keyStart = cursor;
        stringEnd();
        const key = JSON.parse(text.slice(keyStart, cursor)) as string;
        const child = `${pointer}/${pointerPart(key)}`;
        if (keys.has(key)) duplicateKeys.push(child);
        keys.add(key);
        whitespace();
        cursor += 1;
        walk(child);
        whitespace();
        if (text[cursor] !== ",") break;
        cursor += 1;
        whitespace();
      }
      cursor += 1;
    } else if (text[cursor] === "[") {
      cursor += 1;
      whitespace();
      let index = 0;
      while (text[cursor] !== "]") {
        walk(`${pointer}/${index++}`);
        whitespace();
        if (text[cursor] !== ",") break;
        cursor += 1;
        whitespace();
      }
      cursor += 1;
    } else if (text[cursor] === '"') {
      stringEnd();
    } else {
      while (cursor < text.length && !/[\s,}\]]/.test(text[cursor])) cursor += 1;
    }
    tokens.set(pointer, { start, end: cursor, quote: text.slice(start, cursor) });
  };
  walk("");
  return { tokens, duplicateKeys };
}

function sourceCount(value: unknown): number | null {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return value;
  if (typeof value === "string" && /^(0|[1-9]\d*)$/.test(value)) {
    const count = Number(value);
    if (Number.isSafeInteger(count)) return count;
  }
  return null;
}

function calendarDate(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?)?$/.test(value)) return null;
  const date = value.slice(0, 10);
  const parsed = new Date(`${date}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && Number.isFinite(Date.parse(value)) && parsed.toISOString().slice(0, 10) === date ? date : null;
}

function publisherMatches(canonicalUrl: string, slug: string, civicClerk: boolean): boolean {
  // No URL/network object is needed inside the isolated procedure.
  const match = /^https:\/\/([^/?#]+)([^?#]*)/.exec(canonicalUrl);
  if (!match || !/^[a-z0-9-]+$/i.test(slug)) return false;
  const host = match[1].toLowerCase();
  if (civicClerk) return host === `${slug.toLowerCase()}.api.civicclerk.com`;
  return host === `${slug.toLowerCase()}.legistar.com` ||
    (host === "webapi.legistar.com" && match[2].toLowerCase().startsWith(`/v1/${slug.toLowerCase()}/`));
}

/**
 * Deterministic contract procedure invoked by the disposable VALIDATOR runtime.
 * The broker supplies hash-verified sanitized evidence and the persisted producer
 * identity. This procedure has no authority to acquire, persist, or promote.
 */
export function validateExtraction(input: ValidatorWorkerInput): ValidatorResult {
  const { candidate, evidence, contract } = input;
  if (contract.schemaVersion === 2) return validateGeneralizedExtraction(input, contract);
  const civicClerk = contract.recordClass === "CIVICCLERK_EVENTS";
  const idField = civicClerk ? "id" : "EventId";
  const bodyIdField = civicClerk ? "categoryId" : "EventBodyId";
  const bodyNameField = civicClerk ? "eventCategoryName" : "EventBodyName";
  const dateField = civicClerk ? "startDateTime" : "EventDate";
  const findings: WorkerFinding[] = [];
  const checked = new Set<string>();
  const add = (code: string, detail: string, location: Pick<WorkerFinding, "recordId" | "field" | "evidenceSpanIds"> = {}, severity: WorkerFinding["severity"] = "BLOCKING") => {
    findings.push({ code, detail, severity, ...location });
  };
  const result = (): ValidatorResult => {
    const verdict = findings.some((f) => f.severity === "BLOCKING") ? "FAIL" :
      findings.some((f) => f.severity === "WARNING") ? "INCONCLUSIVE" : "PASS";
    return {
      role: "VALIDATOR",
      attemptId: input.attemptId,
      producerAttemptId: input.producerAttemptId,
      verdict,
      checked: CHECKS.filter((check) => checked.has(check)),
      findings,
      artifactIds: evidence.artifactId ? [evidence.artifactId] : [],
      validatedRecordCount: verdict === "PASS" ? candidate.records.length : 0,
    };
  };

  checked.add("PRODUCER_INDEPENDENCE");
  if (input.worker.role !== "VALIDATOR" || input.producer.role !== "PARSER" ||
      !input.worker.instance || !input.producer.instance ||
      input.worker.instance === input.producer.instance || input.attemptId === input.producerAttemptId) {
    add("SELF_VALIDATION_REFUSED", "Validation requires a VALIDATOR distinct from the producing PARSER by both actor instance and Attempt.");
  }
  checked.add("MACHINE_OWNED_PROVENANCE");
  if (!input.attemptId || !input.producerAttemptId || candidate.attemptId !== input.producerAttemptId ||
      !input.worker.provider || !input.worker.version || !input.producer.provider || !input.producer.version ||
      !candidate.implementation || !candidate.version || !evidence.acquiredByAttemptId ||
      candidate.acquiredByAttemptId !== evidence.acquiredByAttemptId) {
    add("MACHINE_PROVENANCE_MISMATCH", "Candidate production and acquisition references must match the machine-held Attempts and named worker versions.");
  }
  checked.add("ARTIFACT_IDENTITY_AND_HASH");
  if (!evidence.artifactId || candidate.artifactId !== evidence.artifactId ||
      !/^sha256-[0-9a-f]{64}$/.test(evidence.contentHash) || candidate.contentHash !== evidence.contentHash) {
    add("ARTIFACT_IDENTITY_MISMATCH", "Candidate artifact identity/hash differs from the immutable evidence verified by the broker.");
  }
  checked.add("ASSERTION_CLASS_BURDENS");
  if (candidate.role !== "PARSER" || candidate.schemaVersion !== 1 || contract.schemaVersion !== 1 ||
      candidate.recordClass !== contract.recordClass || !["LEGISTAR_EVENTS", "CIVICCLERK_EVENTS"].includes(contract.recordClass)) {
    add("EXTRACTION_CONTRACT_MISMATCH", "This validator implements only the versioned LEGISTAR_EVENTS and CIVICCLERK_EVENTS contracts.");
  }
  if (!contract.subjectId || candidate.subjectId !== contract.subjectId ||
      (!civicClerk && (contract.sourceBodyId === null || contract.sourceBodyName === null)) ||
      (contract.sourceBodyId !== null && (!Number.isSafeInteger(contract.sourceBodyId) || contract.sourceBodyId < 0)) ||
      (contract.sourceBodyName !== null && !contract.sourceBodyName) ||
      !publisherMatches(evidence.canonicalUrl, contract.publisherSlug, civicClerk)) {
    add("SUBJECT_IDENTITY_MISMATCH", "Candidate subject, canonical publisher, and body binding must match the obligation contract.");
  }
  if (!contract.completenessScope.trim()) add("COMPLETENESS_SCOPE_MISSING", "The contract must name the captured-record denominator it validates.");
  checked.add("PARSER_WARNINGS");
  if (candidate.verdict === "FAILED") add("PARSER_EXTRACTION_FAILED", "A failed parser result cannot supply verified civic records.");
  else if (candidate.verdict !== "EXTRACTED") add("PARSER_AMBIGUITY_UNRESOLVED", "The parser did not return an unambiguous extraction.", {}, "WARNING");
  for (const warning of candidate.warnings) {
    add("PARSER_WARNING_UNRESOLVED", `${warning.code}: ${warning.detail}`, {
      ...(warning.recordId ? { recordId: warning.recordId } : {}),
      ...(warning.field ? { field: warning.field } : {}),
      ...(warning.evidenceSpanIds ? { evidenceSpanIds: warning.evidenceSpanIds } : {}),
    }, warning.severity);
  }

  let parsed: unknown;
  try { parsed = JSON.parse(evidence.text); }
  catch {
    add("MALFORMED_SOURCE_EVIDENCE", "The captured evidence is not parseable JSON; no empty record set or civic conclusion is certified.");
    return result();
  }
  const rows = Array.isArray(parsed) ? parsed : isObject(parsed) && Array.isArray(parsed.value) ? parsed.value : null;
  if (rows === null) {
    add("MALFORMED_SOURCE_EVIDENCE", "The captured evidence is neither an event array nor an OData value array.");
    return result();
  }
  if (civicClerk && (!isObject(parsed) || typeof parsed["@odata.context"] !== "string" ||
      !publisherMatches(parsed["@odata.context"], contract.publisherSlug, true))) {
    add("SUBJECT_IDENTITY_MISMATCH", "CivicClerk's source OData context must independently identify the contracted municipality publisher.");
  }
  const prefix = Array.isArray(parsed) ? "" : "/value";
  for (const check of CHECKS) checked.add(check);
  const { tokens, duplicateKeys } = sourceTokens(evidence.text);
  for (const pointer of duplicateKeys) add("CONTRADICTORY_OFFICIAL_VALUES", `Repeated JSON member at ${pointer} cannot silently select a publisher value.`);
  const declarations: number[] = [];
  if (isObject(parsed)) {
    for (const key of ["@odata.count", "odata.count"]) {
      if (!Object.hasOwn(parsed, key)) continue;
      const count = sourceCount(parsed[key]);
      if (count === null) add("DECLARED_COUNT_MISMATCH", `Publisher ${key} is not a valid nonnegative row count.`);
      else declarations.push(count);
    }
  }
  const declared = declarations[0] ?? null;
  if (declarations.some((count) => count !== declared)) add("CONTRADICTORY_OFFICIAL_VALUES", "Publisher count declarations disagree.");
  if (candidate.declaredRowCount !== declared || (declared !== null && declared !== candidate.records.length)) {
    add("DECLARED_COUNT_MISMATCH", "Publisher-declared count, candidate declaration, and actual extracted records must agree where a count is declared.");
  }
  if (!Number.isSafeInteger(candidate.actualRowCount) || candidate.actualRowCount !== candidate.records.length ||
      candidate.sourceRowCount !== rows.length || candidate.records.length !== rows.length) {
    add("EXTRACTED_COUNT_MISMATCH", "Every row in the captured artifact must be accounted for exactly once, and measured counts must equal their actual arrays.");
  }
  if (rows.length === 0 || candidate.records.length === 0) add("FALSE_ZERO", "Zero rows are an extraction failure, never evidence that no civic records exist.");

  const spansById = new Map<string, EvidenceSpan>();
  for (const span of candidate.spans) {
    if (!span.id || spansById.has(span.id)) add("DUPLICATE_EVIDENCE_SPAN", "Evidence span ids must be present and unique.", { evidenceSpanIds: [span.id] });
    spansById.set(span.id, span);
  }
  const identities = new Set<string>();
  const sourceIdentities = new Map<unknown, Record<string, unknown>>();
  for (const row of rows) {
    if (!isObject(row)) continue;
    const prior = sourceIdentities.get(row[idField]);
    if (prior) {
      add("DUPLICATE_ENTITY", "The official capture contains a repeated event id requiring explicit reconciliation.");
      if ([...new Set([...Object.keys(prior), ...Object.keys(row)])].some((key) => scalar(prior[key]) && scalar(row[key]) && prior[key] !== row[key])) {
        add("CONTRADICTORY_OFFICIAL_VALUES", "Official rows for the same event id carry different scalar values; neither may silently win.");
      }
    }
    sourceIdentities.set(row[idField], row);
  }
  const consumedRows = new Set<number>();
  const referencedSpanIds = new Set<string>();
  const required = [...new Set([...(civicClerk ? CIVICCLERK_CORE_FIELDS : CORE_FIELDS), ...contract.requiredFields])];
  for (const record of candidate.records) {
    const location = { recordId: record.id };
    const eventId = record.fields[idField];
    const identity = `${civicClerk ? "civicclerk" : "legistar"}:${contract.publisherSlug}:${String(eventId)}`;
    if (!Number.isSafeInteger(eventId) || typeof eventId !== "number" || eventId < 0 || record.id !== identity ||
        record.subjectId !== contract.subjectId || !Number.isSafeInteger(record.fields[bodyIdField]) ||
        typeof record.fields[bodyNameField] !== "string" || !record.fields[bodyNameField] ||
        (contract.sourceBodyId !== null && record.fields[bodyIdField] !== contract.sourceBodyId) ||
        (contract.sourceBodyName !== null && record.fields[bodyNameField] !== contract.sourceBodyName)) {
      add("SUBJECT_IDENTITY_MISMATCH", "Record identity and source body must bind the same canonical subject and publisher event.", location);
    }
    if (identities.has(identity)) add("DUPLICATE_ENTITY", "Two extracted records represent the same publisher event id.", location);
    identities.add(identity);
    for (const field of required) {
      if (!Object.hasOwn(record.fields, field) || !scalar(record.fields[field]) || record.fields[field] === null || record.fields[field] === "") {
        add("COMPLETENESS_REQUIRED_FIELD_MISSING", "A required civic field is absent or empty.", { ...location, field });
      }
    }
    const date = calendarDate(record.fields[dateField]);
    if (date === null || (contract.expectedSourceDate !== null && date !== contract.expectedSourceDate)) {
      add("SOURCE_DATE_MISMATCH", "The event date must preserve the publisher calendar date and the obligation's expected date; retrieval time is a different fact.", { ...location, field: dateField });
    }
    if (civicClerk && (calendarDate(record.fields.eventDate) === null || calendarDate(record.fields.eventDate) !== date)) {
      add("SOURCE_DATE_MISMATCH", "CivicClerk eventDate and startDateTime must retain a consistent event date; an inconsistent publisher date requires reconciliation.", { ...location, field: "eventDate" });
    }
    if (civicClerk && ((record.fields.eventCategoryId !== undefined && record.fields.eventCategoryId !== record.fields.categoryId) ||
        (record.fields.categoryName !== undefined && record.fields.categoryName !== record.fields.eventCategoryName))) {
      add("CONTRADICTORY_OFFICIAL_VALUES", "CivicClerk category identity aliases disagree; no government body may be selected silently.", location);
    }
    if (!civicClerk && record.fields.EventTime !== undefined && record.fields.EventTime !== null &&
        (typeof record.fields.EventTime !== "string" || !/^(?:0?[1-9]|1[0-2]):[0-5]\d(?:\:[0-5]\d)?\s*(?:AM|PM)$/i.test(record.fields.EventTime.trim()))) {
      add("SOURCE_DATE_MISMATCH", "EventTime is not a supported publisher wall-clock time; a timezone is never inferred from retrieval time.", { ...location, field: "EventTime" });
    }
    const sourceIndices = new Set<number>();
    for (const id of record.evidenceSpanIds) {
      referencedSpanIds.add(id);
      if (!spansById.has(id)) add("UNSUPPORTED_EVIDENCE_SPAN", "The record references a span that does not exist.", { ...location, evidenceSpanIds: [id] });
    }
    for (const [field, value] of Object.entries(record.fields)) {
      const supporting = record.evidenceSpanIds.map((id) => spansById.get(id)).filter((span): span is EvidenceSpan => span !== undefined && span.field === field);
      if (!scalar(value) || supporting.length !== 1) {
        add("UNSUPPORTED_EVIDENCE_SPAN", "Each extracted scalar field requires exactly one source span from its own row.", { ...location, field });
        continue;
      }
      const span = supporting[0];
      const match = new RegExp(`^${prefix}/(0|[1-9]\\d*)/([^/]+)$`).exec(span.jsonPointer);
      const rowIndex = match ? Number(match[1]) : -1;
      const sourceRow: unknown = rows[rowIndex];
      const token = tokens.get(span.jsonPointer);
      const valid = span.recordId === record.id && span.artifactId === evidence.artifactId && span.contentHash === evidence.contentHash &&
        span.offsetUnit === "UTF16_CODE_UNITS" && Number.isSafeInteger(span.start) && Number.isSafeInteger(span.end) &&
        span.start >= 0 && span.end > span.start && token !== undefined && token.start === span.start && token.end === span.end && token.quote === span.quote &&
        match !== null && match[2] === pointerPart(field) && isObject(sourceRow) && Object.hasOwn(sourceRow, field) &&
        sourceRow[field] === value && sourceRow[idField] === eventId;
      if (!valid) {
        add(field === dateField || field === "EventTime" || (civicClerk && field === "eventDate") ? "SOURCE_DATE_MISMATCH" : "UNSUPPORTED_EVIDENCE_SPAN", "The claimed field is not supported at its exact source-row pointer, lexical range, and immutable artifact.", { ...location, field, evidenceSpanIds: [span.id] });
      } else sourceIndices.add(rowIndex);
    }
    if (sourceIndices.size !== 1) add("UNSUPPORTED_EVIDENCE_SPAN", "A record must be supported by exactly one original publisher row.", location);
    for (const index of sourceIndices) {
      if (consumedRows.has(index)) add("DUPLICATE_ENTITY", "One captured source row was used to support more than one extracted record.", location);
      consumedRows.add(index);
      const sourceRow = rows[index];
      if (isObject(sourceRow)) {
        for (const [field, value] of Object.entries(sourceRow)) {
          if (scalar(value) && (!Object.hasOwn(record.fields, field) || record.fields[field] !== value)) {
            add("COMPLETENESS_SOURCE_FIELD_OMITTED", "A source scalar field was omitted or changed without a supported extraction contract.", { ...location, field });
          }
        }
      }
    }
    const knownFields = new Set(Object.keys(record.fields));
    for (const id of record.evidenceSpanIds) {
      const span = spansById.get(id);
      if (span && (!knownFields.has(span.field) || span.recordId !== record.id)) add("UNSUPPORTED_EVIDENCE_SPAN", "A referenced span does not belong to one of this record's extracted fields.", { ...location, evidenceSpanIds: [id] });
    }
  }
  if (consumedRows.size !== rows.length) add("COMPLETENESS_SOURCE_ROW_OMITTED", "The source-row denominator contains rows without a uniquely supported extracted record.");
  for (const span of candidate.spans) {
    if (!referencedSpanIds.has(span.id)) add("UNSUPPORTED_EVIDENCE_SPAN", "An unreferenced span cannot count as support for the candidate.", { evidenceSpanIds: [span.id] });
  }
  return result();
}
