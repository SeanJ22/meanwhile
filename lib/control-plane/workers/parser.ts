import type {
  EvidenceSpan,
  ExtractedRecord,
  FieldValue,
  ParserResult,
  ParserWorkerInput,
  WorkerFinding,
} from "./types.ts";
import { isFieldValue as isScalar } from "./types.ts";
import { parseGeneralizedRecords } from "./generalized-parser.ts";

export const PARSER_IMPLEMENTATION = "legistar-events";
export const CIVICCLERK_PARSER_IMPLEMENTATION = "civicclerk-events";
export const PARSER_VERSION = "1.0.0";

const LEGISTAR_PROFILE = {
  prefix: "legistar",
  implementation: PARSER_IMPLEMENTATION,
  idField: "EventId",
  required: ["EventId", "EventBodyId", "EventBodyName", "EventDate"],
  positiveIds: ["EventId", "EventBodyId"],
  stringFields: ["EventBodyName", "EventDate"],
  subresources: ["EventItems"],
};
const CIVICCLERK_PROFILE = {
  prefix: "civicclerk",
  implementation: CIVICCLERK_PARSER_IMPLEMENTATION,
  idField: "id",
  required: ["id", "eventName", "startDateTime", "eventDate", "categoryId", "eventCategoryName"],
  positiveIds: ["id"],
  stringFields: ["eventName", "startDateTime", "eventDate", "eventCategoryName"],
  subresources: ["eventLocation", "agendaFile", "minutesFile", "eventSocialMediaModel", "publishedFiles"],
};

export interface SourceToken {
  readonly start: number;
  readonly end: number;
}

class ParseRefusal extends Error {
  readonly code: string;
  readonly field?: string;

  constructor(code: string, detail: string, field?: string) {
    super(detail);
    this.name = "ParseRefusal";
    this.code = code;
    this.field = field;
  }
}

function pointerPart(key: string): string {
  return key.replace(/~/g, "~0").replace(/\//g, "~1");
}

/**
 * Index lexical JSON values after JSON.parse has checked the grammar. Searching
 * for a value's text is unsafe: repeated dates, names and numbers would cite
 * another row. A pointer identifies its occurrence, including escaped keys.
 */
export function indexJson(text: string): ReadonlyMap<string, SourceToken> {
  const tokens = new Map<string, SourceToken>();
  let cursor = 0;
  const whitespace = () => {
    while (/\s/.test(text[cursor] ?? "") && cursor < text.length) cursor += 1;
  };
  const stringEnd = () => {
    cursor += 1;
    while (cursor < text.length) {
      const c = text[cursor++];
      if (c === "\\") cursor += 1;
      else if (c === '"') return;
    }
    throw new ParseRefusal("JSON_MALFORMED", "A JSON string was not terminated.");
  };
  const scan = (pointer: string, depth: number): void => {
    if (depth > 64) {
      throw new ParseRefusal("JSON_NESTING_LIMIT", "The evidence exceeds the bounded JSON nesting depth.");
    }
    whitespace();
    const start = cursor;
    if (text[cursor] === "[") {
      cursor += 1;
      whitespace();
      let index = 0;
      while (text[cursor] !== "]") {
        scan(`${pointer}/${index++}`, depth + 1);
        whitespace();
        if (text[cursor] === ",") cursor += 1;
        else break;
      }
      cursor += 1;
    } else if (text[cursor] === "{") {
      cursor += 1;
      whitespace();
      const keys = new Set<string>();
      while (text[cursor] !== "}") {
        whitespace();
        const keyStart = cursor;
        stringEnd();
        const key = JSON.parse(text.slice(keyStart, cursor)) as string;
        if (keys.has(key)) {
          throw new ParseRefusal("DUPLICATE_JSON_KEY", "An object repeats a field; neither value may silently win.");
        }
        keys.add(key);
        whitespace();
        cursor += 1; // The colon was already checked by JSON.parse.
        scan(`${pointer}/${pointerPart(key)}`, depth + 1);
        whitespace();
        if (text[cursor] === ",") cursor += 1;
        else break;
      }
      cursor += 1;
    } else if (text[cursor] === '"') {
      stringEnd();
    } else {
      while (cursor < text.length && !/[\s,\]}]/.test(text[cursor])) cursor += 1;
    }
    tokens.set(pointer, { start, end: cursor });
  };
  scan("", 0);
  return tokens;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function declaredCount(value: unknown): number {
  const number = typeof value === "string" && /^(?:0|[1-9]\d*)$/.test(value)
    ? Number(value)
    : value;
  if (typeof number !== "number" || !Number.isSafeInteger(number) || number < 0) {
    throw new ParseRefusal("DECLARED_COUNT_INVALID", "The publisher's declared count is not a nonnegative safe integer.");
  }
  return number;
}

/**
 * Disposable deterministic procedure. The broker owns capabilities, vault
 * issuance, hash verification, the execution lease and durable accounting.
 * This module is bundled into its isolated realm and receives only JSON data.
 * It has no host imports, callbacks, acquisition or promotion authority.
 */
export function parseLegistarEvents(input: ParserWorkerInput): ParserResult {
  if (input.contract.schemaVersion === 2) return parseGeneralizedRecords(input, input.contract);
  const profile = input.contract.recordClass === "CIVICCLERK_EVENTS" ? CIVICCLERK_PROFILE : LEGISTAR_PROFILE;
  const base = {
    role: "PARSER" as const,
    attemptId: input.attemptId,
    implementation: profile.implementation,
    version: PARSER_VERSION,
    schemaVersion: 1 as const,
    recordClass: input.contract.recordClass,
    artifactId: input.evidence.artifactId,
    contentHash: input.evidence.contentHash,
    acquiredByAttemptId: input.evidence.acquiredByAttemptId,
    subjectId: input.contract.subjectId,
  };
  let sourceRowCount: number | null = null;
  let declaredRowCount: number | null = null;
  try {
    if (input.worker.role !== "PARSER") {
      throw new ParseRefusal("PARSER_ROLE_REQUIRED", "The parser procedure requires a PARSER worker identity.");
    }
    if (!["LEGISTAR_EVENTS", "CIVICCLERK_EVENTS"].includes(input.contract.recordClass) || input.contract.schemaVersion !== 1) {
      throw new ParseRefusal("SCHEMA_UNSUPPORTED", "The parser does not implement the requested record schema.");
    }
    if (!input.contract.subjectId || !/^[a-z0-9][a-z0-9-]*$/i.test(input.contract.publisherSlug)) {
      throw new ParseRefusal("CONTRACT_IDENTITY_MISSING", "A canonical subject and publisher slug are required.");
    }
    if (input.contract.recordClass === "CIVICCLERK_EVENTS") {
      // A municipality feed contains multiple source categories. Category ids
      // do not identify one canonical body; keep their original fields intact.
      const authority = /^https:\/\/([a-z0-9.-]+)(?::443)?(?:[/?#]|$)/i.exec(input.evidence.canonicalUrl)?.[1];
      if (authority?.toLowerCase() !== `${input.contract.publisherSlug.toLowerCase()}.api.civicclerk.com` ||
          input.contract.sourceBodyId !== null || input.contract.sourceBodyName !== null) {
        throw new ParseRefusal("SOURCE_PROFILE_MISMATCH", "The CivicClerk profile requires its exact publisher host and a municipality-level contract without a category-to-body mapping.");
      }
    }

    let decoded: unknown;
    try {
      decoded = JSON.parse(input.evidence.text);
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      throw new ParseRefusal("JSON_MALFORMED", "The artifact is not a complete valid JSON document.");
    }
    const tokens = indexJson(input.evidence.text);
    let rows: unknown[];
    let rowPrefix = "";
    const warnings: WorkerFinding[] = [];
    if (Array.isArray(decoded)) {
      rows = decoded;
    } else if (isObject(decoded) && Array.isArray(decoded.value)) {
      rows = decoded.value;
      rowPrefix = "/value";
      const countKeys = ["@odata.count", "odata.count"].filter((key) => Object.hasOwn(decoded, key));
      const counts = countKeys.map((key) => declaredCount(decoded[key]));
      if (new Set(counts).size > 1) {
        throw new ParseRefusal("DECLARED_COUNT_CONFLICT", "The publisher's count fields contradict each other.");
      }
      declaredRowCount = counts[0] ?? null;
      if (decoded["@odata.nextLink"] || decoded["odata.nextLink"]) {
        warnings.push({
          code: "SOURCE_PAGINATION_REMAINS",
          severity: "WARNING",
          detail: "The artifact declares another page. These rows alone do not establish the complete source universe.",
        });
      }
    } else {
      throw new ParseRefusal("SCHEMA_UNSUPPORTED", "Expected an Event array or an OData value array.");
    }
    sourceRowCount = rows.length;
    if (rows.length === 0) {
      throw new ParseRefusal("ZERO_ROW_EXTRACTION", "A zero-row extraction is a failed extraction, never a civic absence.");
    }

    const records: ExtractedRecord[] = [];
    const spans: EvidenceSpan[] = [];
    const seenIds = new Set<string>();
    const required = [...new Set([
      ...profile.required, ...input.contract.requiredFields,
    ])];
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      if (!isObject(row)) {
        throw new ParseRefusal("ROW_SCHEMA_INVALID", `Source row ${index} is not a record object.`);
      }
      for (const field of required) {
        if (!Object.hasOwn(row, field) || row[field] === null || row[field] === "") {
          throw new ParseRefusal("REQUIRED_FIELD_MISSING", `Source row ${index} lacks a required field.`, field);
        }
        if (!isScalar(row[field])) {
          throw new ParseRefusal("REQUIRED_FIELD_INVALID", `Source row ${index} has a non-scalar required field.`, field);
        }
      }
      for (const field of profile.positiveIds) {
        if (!Number.isSafeInteger(row[field]) || (row[field] as number) <= 0) {
          throw new ParseRefusal("IDENTITY_FIELD_INVALID", `Source row ${index} has an invalid numeric identity.`, field);
        }
      }
      if (input.contract.recordClass === "CIVICCLERK_EVENTS" &&
          (!Number.isSafeInteger(row.categoryId) || (row.categoryId as number) < 0)) {
        throw new ParseRefusal("CATEGORY_FIELD_INVALID", `Source row ${index} has an invalid source category.`, "categoryId");
      }
      for (const field of profile.stringFields) {
        if (typeof row[field] !== "string" || !(row[field] as string).trim()) {
          throw new ParseRefusal("REQUIRED_FIELD_INVALID", `Source row ${index} has an invalid required string.`, field);
        }
      }
      const id = `${profile.prefix}:${input.contract.publisherSlug}:${row[profile.idField]}`;
      if (seenIds.has(id)) {
        warnings.push({
          code: "DUPLICATE_SOURCE_RECORD_ID", severity: "WARNING", recordId: id,
          detail: "Two source rows share an event identity. Both are preserved for independent reconciliation.",
        });
      }
      seenIds.add(id);
      const fields: Record<string, FieldValue> = Object.create(null) as Record<string, FieldValue>;
      const evidenceSpanIds: string[] = [];
      for (const field of Object.keys(row).sort()) {
        const value = row[field];
        if (!isScalar(value)) {
          if (typeof value === "number") {
            throw new ParseRefusal("NUMERIC_VALUE_INVALID", `Source row ${index} contains a non-finite number.`, field);
          }
          warnings.push(profile.subresources.includes(field) ? {
            code: "SUBRESOURCE_NOT_INTERPRETED", severity: "INFO", recordId: id, field,
            detail: "This nested field is outside the scalar Event schema. Its contents remain in the artifact; this extraction makes no claim about them or their absence.",
          } : {
            code: "UNEXTRACTED_COMPOSITE_FIELD", severity: "WARNING", recordId: id, field,
            detail: "The field is a nested object or array; this scalar Event schema does not interpret it.",
          });
          continue;
        }
        const jsonPointer = `${rowPrefix}/${index}/${pointerPart(field)}`;
        const token = tokens.get(jsonPointer);
        if (!token) {
          throw new ParseRefusal("EVIDENCE_SPAN_MISSING", `Source row ${index} has no indexed evidence token.`, field);
        }
        const spanId = `span:${input.evidence.artifactId}:${jsonPointer}`;
        fields[field] = value;
        evidenceSpanIds.push(spanId);
        spans.push({
          id: spanId,
          artifactId: input.evidence.artifactId,
          contentHash: input.evidence.contentHash,
          recordId: id,
          field,
          jsonPointer,
          start: token.start,
          end: token.end,
          offsetUnit: "UTF16_CODE_UNITS",
          quote: input.evidence.text.slice(token.start, token.end),
        });
      }
      records.push({ id, subjectId: input.contract.subjectId, fields, evidenceSpanIds });
    }
    if (declaredRowCount !== null && declaredRowCount !== records.length) {
      warnings.push({
        code: "DECLARED_COUNT_MISMATCH", severity: "WARNING",
        detail: `The publisher declares ${declaredRowCount} rows; this artifact yielded ${records.length}.`,
      });
    }
    return {
      ...base,
      verdict: warnings.some((warning) => warning.severity !== "INFO") ? "AMBIGUOUS" : "EXTRACTED",
      records, spans, warnings,
      declaredRowCount, sourceRowCount, actualRowCount: records.length,
    };
  } catch (error) {
    // A coding fault is a crash for the broker to reclaim, never a fabricated
    // typed civic result. Only explicit evidence/schema refusals are converted.
    if (!(error instanceof ParseRefusal)) throw error;
    return {
      ...base,
      verdict: "FAILED",
      records: [], spans: [], actualRowCount: 0,
      sourceRowCount, declaredRowCount,
      warnings: [{
        code: error.code, detail: error.message, severity: "BLOCKING",
        ...(error.field ? { field: error.field } : {}),
      }],
    };
  }
}

/** Record-class dispatch over the two implemented publisher profiles. */

/** Execution identities vary across replay; civic content and evidence may not. */
export function normalizedParserResult(
  result: ParserResult,
): Omit<ParserResult, "attemptId" | "acquiredByAttemptId"> {
  const { attemptId: _attemptId, acquiredByAttemptId: _acquiredByAttemptId, ...semantic } = result;
  return semantic;
}
