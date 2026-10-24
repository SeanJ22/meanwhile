import type { AttemptCost, WorkerRef } from "../attempt.ts";
import type { AttackMode, AuditEvidenceBase } from "../audit.ts";
import { ATTACK_MODES, AUDIT_EVIDENCE_BASES } from "../audit.ts";
import type { CapabilityGrant } from "../capability.ts";
import type { Attempt } from "../attempt.ts";
import type { RouteTask } from "../route-task.ts";
import { assertResearchResult, type AcquirerResult, type DetectiveResult, type AcquirerTaskSpec } from "./research-types.ts";
export const FLEET_ROLES = ["PARSER", "VALIDATOR", "ADVERSARIAL_AUDITOR", "ACQUIRER", "DETECTIVE"] as const;
export type FleetRole = (typeof FLEET_ROLES)[number];
export type ComputationRole = "PARSER" | "VALIDATOR" | "ADVERSARIAL_AUDITOR";
export type FieldValue = string | number | boolean | null;
/** The shared wire scalar contract; this does not interpret source evidence. */
export function isFieldValue(value: unknown): value is FieldValue {
  return value === null || typeof value === "string" || typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value));
}

/** Text is issued by readForParser, never fetched or supplied by a model. */
export interface WorkerEvidence {
  readonly artifactId: string;
  readonly contentHash: string;
  readonly text: string;
  readonly acquiredByAttemptId: string;
  readonly canonicalUrl: string;
  readonly retrievedAt: string;
  readonly sourceId: string;
  readonly methodRouteId: string;
  readonly sourceDocument?: { readonly artifactId: string; readonly contentHash: string; readonly kind: "PDF_TEXT" | "PDF_TABLES" };
}
export interface LegacyCivicExtractionContract {
  readonly recordClass: "LEGISTAR_EVENTS" | "CIVICCLERK_EVENTS";
  readonly schemaVersion: 1;
  readonly subjectId: string;
  readonly sourceBodyId: number | null;
  readonly sourceBodyName: string | null;
  readonly publisherSlug: string;
  readonly requiredFields: readonly string[];
  /** Describes exactly what is counted; a captured feed is not all records ever published. */
  readonly completenessScope: string;
  readonly expectedSourceDate: string | null;
}
/** Versioned procedure contracts evolve without changing the durable store envelope. */
export interface RecordFieldMapping {
  /** JSON pointer relative to a row, or zero-based column index for tabular evidence. */
  readonly source: string | number;
  readonly type: "STRING" | "NUMBER" | "BOOLEAN" | "SCALAR";
  /** For an HTML table cell, read its source link instead of its display text. */
  readonly attribute?: "href";
}
export type RecordExtractionShape = {
  readonly fields: Readonly<Record<string, RecordFieldMapping>>;
} & (
  | { readonly format: "JSON_RECORDS"; readonly rowsPointer: string; readonly countPointer?: string; readonly headerRows?: number }
  | { readonly format: "HTML_TABLE"; readonly tableIndex: number; readonly headerRows: number }
  | { readonly format: "HTML_PROFILE" }
  | { readonly format: "DELIMITED_TEXT"; readonly delimiter: "," | "\t"; readonly headerRows: number }
  | { readonly format: "XML_RECORDS"; readonly rowTag: string }
  | { readonly format: "TEXT_BLOCKS"; readonly recordStart: string; readonly recordEnd?: string }
  | { readonly format: "UNSUPPORTED"; readonly mediaType: string; readonly reason: string }
);
export interface GeneralizedContractMetadata {
  readonly jurisdiction: { readonly country: string; readonly state: string; readonly canonicalId: string };
  readonly identity: { readonly namespace: string; readonly keyFields: readonly string[] };
  readonly sourceScope: {
    readonly sourceId: string;
    readonly routeIds: readonly string[];
    readonly publisher: string;
    readonly canonicalUrls: readonly string[];
    readonly observationArtifactIds: readonly string[];
  };
  readonly methodVersion: number;
}
export interface VerificationAuthority {
  readonly id: string;
  readonly type: "GOVERNMENT_REGISTER" | "STATUTORY_RECORD" | "OFFICIAL_DENOMINATOR";
  readonly publisher: string;
  readonly sourceId: string;
  readonly canonicalUrls: readonly string[];
  readonly artifactIds: readonly string[];
  /** Publisher identity evidence establishing this as an external authority. */
  readonly authorityEvidenceArtifactIds: readonly string[];
  /** Same-publisher records require an explicit distinct-record basis; a copy is not independent. */
  readonly independenceBasis: "DISTINCT_AUTHORITY" | "INDEPENDENT_OFFICIAL_RECORD";
  readonly independenceExplanation: string;
  readonly extraction: RecordExtractionShape;
  readonly comparison: {
    /** SUBSET corroborates only the explicitly matched records; never a complete roster. */
    readonly kind: "RECORD_VALUES" | "RECORD_VALUES_SUBSET" | "IDENTITY_SET" | "COUNT";
    readonly keyFields: readonly string[];
    readonly fields: readonly string[];
  };
}
export interface GeneralizedCivicExtractionContract extends GeneralizedContractMetadata {
  readonly schemaVersion: 2;
  readonly recordClass: string;
  readonly subjectId: string;
  readonly requiredFields: readonly string[];
  readonly completenessScope: string;
  readonly expectedSourceDate: string | null;
  readonly dateFields?: readonly string[];
  readonly extraction: RecordExtractionShape;
  readonly verification: { readonly required: boolean; readonly authorities: readonly VerificationAuthority[] };
}
export type CivicExtractionContract = LegacyCivicExtractionContract | GeneralizedCivicExtractionContract;
export interface EvidenceSpan {
  readonly id: string;
  readonly artifactId: string;
  readonly contentHash: string;
  readonly recordId: string;
  readonly field: string;
  readonly jsonPointer: string;
  readonly start: number;
  readonly end: number;
  readonly offsetUnit: "UTF16_CODE_UNITS";
  readonly quote: string;
  /** Legacy JSON spans omit this; v2 uses an explicit source locator kind. */
  readonly sourceFormat?: RecordExtractionShape["format"];
}
export interface ExtractedRecord {
  readonly id: string;
  readonly subjectId: string;
  readonly fields: Readonly<Record<string, FieldValue>>;
  readonly evidenceSpanIds: readonly string[];
}
export interface WorkerFinding {
  readonly code: string;
  readonly detail: string;
  readonly severity: "INFO" | "WARNING" | "BLOCKING";
  readonly recordId?: string;
  readonly field?: string;
  readonly evidenceSpanIds?: readonly string[];
}
export interface ParserWorkerInput {
  readonly attemptId: string;
  readonly worker: WorkerRef;
  readonly evidence: WorkerEvidence;
  readonly contract: CivicExtractionContract;
}
export interface ParserResult {
  readonly role: "PARSER";
  readonly attemptId: string;
  readonly implementation: string;
  readonly version: string;
  readonly schemaVersion: 1 | 2;
  readonly recordClass: string;
  readonly contractMetadata?: GeneralizedContractMetadata;
  readonly artifactId: string;
  readonly contentHash: string;
  readonly acquiredByAttemptId: string;
  readonly subjectId: string;
  readonly verdict: "EXTRACTED" | "FAILED" | "AMBIGUOUS";
  readonly records: readonly ExtractedRecord[];
  readonly spans: readonly EvidenceSpan[];
  readonly warnings: readonly WorkerFinding[];
  readonly declaredRowCount: number | null;
  readonly sourceRowCount: number | null;
  readonly actualRowCount: number;
}
export interface ValidatorWorkerInput {
  /** Issued by the broker from the vault, separately from the producer capture. */
  readonly authorityEvidence?: readonly WorkerEvidence[];
  readonly verifiedAt?: string;
  readonly attemptId: string;
  readonly worker: WorkerRef;
  readonly producer: WorkerRef;
  readonly producerAttemptId: string;
  readonly evidence: WorkerEvidence;
  readonly contract: CivicExtractionContract;
  readonly candidate: ParserResult;
}
export interface ValidatorResult {
  /** Exact records that passed replay and all record-specific checks; absent on legacy results. */
  readonly validatedRecordIds?: readonly string[];
  readonly extractionVerdict?: "PASS" | "FAIL" | "INCONCLUSIVE";
  readonly externalVerifications?: readonly ExternalVerificationResult[];
  readonly role: "VALIDATOR";
  readonly attemptId: string;
  readonly producerAttemptId: string;
  readonly verdict: "PASS" | "FAIL" | "INCONCLUSIVE";
  readonly checked: readonly string[];
  readonly findings: readonly WorkerFinding[];
  readonly artifactIds: readonly string[];
  readonly validatedRecordCount: number;
}
export interface ExternalVerificationResult {
  /** Exact candidate records independently matched for the declared fields. Omitted on legacy results. */
  readonly verifiedRecordIds?: readonly string[];
  readonly candidateAttemptId: string;
  readonly validatorAttemptId: string;
  readonly authority: VerificationAuthority;
  readonly evidence: readonly Omit<WorkerEvidence, "text">[];
  readonly comparison: VerificationAuthority["comparison"];
  readonly candidateCount: number;
  readonly authorityCount: number | null;
  readonly verdict: "PASS" | "FAIL" | "INCONCLUSIVE";
  readonly discrepancies: readonly WorkerFinding[];
  readonly verifiedAt: string | null;
}
export interface OfficialRouteExpectation {
  readonly routeId: string;
  readonly canonicalUrl: string;
  readonly applicable: boolean;
  readonly status: "HELD" | "OPEN" | "PERMISSION_BLOCKED" | "NOT_APPLICABLE";
  readonly artifactIds: readonly string[];
  readonly reason: string;
}
/** Built before the candidate is read. No producer/validator prose is a legal field. */
export interface IndependentAuditContext {
  readonly authorityEvidence?: readonly WorkerEvidence[];
  /** First-party publisher/link evidence, not represented as Event rows. */
  readonly surfaceEvidence?: readonly WorkerEvidence[];
  readonly subjectId: string;
  readonly contract: CivicExtractionContract;
  readonly publisherSurfaces: readonly string[];
  readonly methodVersion: number;
  readonly routes: readonly OfficialRouteExpectation[];
  readonly evidence: readonly WorkerEvidence[];
  readonly startedFrom: readonly AuditEvidenceBase[];
  readonly scope: "CAPTURED_ARTIFACT" | "SOURCE_UNIVERSE";
}
/** A claim projection is compared AFTER independent evidence is inventoried. */
export interface AuditCandidate {
  readonly producer: WorkerRef;
  readonly validator: WorkerRef;
  readonly producerAttemptId: string;
  readonly validatorAttemptId: string;
  readonly extraction: ParserResult;
  readonly coveredRouteIds: readonly string[];
  readonly claimsAbsence: boolean;
  readonly claimsUniverseComplete: boolean;
  readonly renderedRecordCount: number | null;
}
export interface AuditorWorkerInput {
  readonly attemptId: string;
  readonly worker: WorkerRef;
  readonly context: IndependentAuditContext;
  readonly candidate: AuditCandidate;
}
export interface AuditAttackResult {
  readonly mode: AttackMode;
  readonly applicable: boolean;
  readonly executed: boolean;
  readonly reason: string;
  readonly verdict: "SURVIVED" | "BROKE" | "INCONCLUSIVE" | "NOT_APPLICABLE";
  readonly findings: readonly WorkerFinding[];
}
/** How much of what applies has been checked: a number, never a verdict. */
export interface AuditCoverage {
  readonly routesApplicable: number;
  readonly routesChecked: number;
  readonly sourceRecords: number | null;
  readonly extractedRecords: number;
  /** Whole percent; null when nothing applies (no denominator). */
  readonly sourcesPercent: number | null;
  readonly recordsPercent: number | null;
}
export interface AuditorResult {
  /** Exact records surviving the independent audit. An INCONCLUSIVE audit lists none: unchecked is not broken. */
  readonly survivingRecordIds?: readonly string[];
  /** Records a BLOCKING finding names (or every record, when the whole capture is untrustworthy): the ones to pull. */
  readonly brokenRecordIds?: readonly string[];
  /** Other official sources and records not yet checked, as a number. Never holds back a verified fact. */
  readonly coverage?: AuditCoverage;
  readonly role: "ADVERSARIAL_AUDITOR";
  readonly attemptId: string;
  readonly producerAttemptId: string;
  readonly validatorAttemptId: string;
  readonly verdict: "SURVIVED" | "BROKE" | "INCONCLUSIVE";
  readonly startedFrom: readonly AuditEvidenceBase[];
  readonly attacks: readonly AuditAttackResult[];
  readonly findings: readonly WorkerFinding[];
  readonly artifactIds: readonly string[];
  readonly survivingRecordCount: number;
  readonly reopenRequired: boolean;
}
export type FleetInput = ParserWorkerInput | ValidatorWorkerInput | AuditorWorkerInput;
export type FleetResult = ParserResult | ValidatorResult | AuditorResult | AcquirerResult | DetectiveResult;
export interface WorkerTaskSpec {
  readonly auditEscalation?: { readonly previousResultId: string; readonly from: string; readonly to: "sonnet" | "frontier"; readonly reason: string };
  readonly acquisition?: AcquirerTaskSpec;
  readonly schemaVersion: 1;
  /** Replay proves reproducibility without advancing or resetting the civic obligation. */
  readonly purpose?: "OBLIGATION" | "DIAGNOSTIC_REPLAY";
  readonly role: FleetRole;
  readonly artifactId: string;
  readonly contract: CivicExtractionContract;
  readonly producerResultId: string | null;
  readonly validatorResultId: string | null;
  readonly auditScope: "CAPTURED_ARTIFACT" | "SOURCE_UNIVERSE";
  readonly implementationVersion: string;
}
export interface WorkerUsage {
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly cacheReadInputTokens: number | null;
  readonly cacheCreationInputTokens: number | null;
  readonly uncachedInputTokens: number | null;
}
/** Stored in the same append-only repository family as Scout results. */
export interface WorkerResultRecord {
  /** Machine inventory can reconstruct the independent input from immutable vault identities. */
  readonly auditContext?: Omit<IndependentAuditContext, "evidence" | "surfaceEvidence" | "authorityEvidence"> & {
    readonly evidence: readonly Omit<WorkerEvidence, "text">[];
    readonly surfaceEvidence: readonly Omit<WorkerEvidence, "text">[];
    readonly authorityEvidence?: readonly Omit<WorkerEvidence, "text">[];
  };
  /** The model-quoted extraction that produced this PARSER result, when no parsing rule existed. */
  readonly modelParse?: import("./model-parser.ts").ModelParseRecord;
  readonly modelReview?: {
    readonly escalation?: NonNullable<WorkerTaskSpec["auditEscalation"]> & { readonly at: string };
    readonly step: "adversarial-audit";
    readonly model: string;
    readonly effort: string;
    readonly contextHash: string;
    readonly verdict: "SURVIVED" | "BROKE" | "INCONCLUSIVE";
    readonly challenges: readonly { code: string; detail: string; artifactId: string; quote: string }[];
    readonly elapsedMs: number;
    readonly validationError?: string | null;
    readonly responseText?: string;
  };
  readonly id: string;
  readonly schemaVersion: 1;
  readonly workItemId: string;
  readonly routeTaskId: string;
  readonly attemptId: string;
  readonly worker: WorkerRef;
  readonly grant: CapabilityGrant;
  readonly methodVersion: number;
  readonly policyVersion: string;
  readonly startedAt: string;
  readonly endedAt: string;
  readonly executionMode: "DETERMINISTIC" | "MODEL_ASSISTED";
  readonly cost: AttemptCost;
  readonly usage: WorkerUsage;
  readonly inputArtifactIds: readonly string[];
  readonly inputResultIds: readonly string[];
  readonly semanticHash: string;
  readonly implementationHash?: string;
  readonly result: FleetResult;
  /** The append is the commit point; recovery applies these exact aggregate values. */
  readonly completion: {
    readonly closedAttempt: Attempt;
    readonly completedTask: RouteTask;
    readonly taskRevision: number;
    readonly attemptRevision: number;
  };
}

/** Shared runtime assertion, including nested discriminants and count-bearing shapes. */
export function assertFleetResult(value: unknown, role: FleetRole, attemptId: string): asserts value is FleetResult {
  if (role === "ACQUIRER" || role === "DETECTIVE") { assertResearchResult(value, role, attemptId); return; }
  if (!value || typeof value !== "object") throw new Error("WORKER_RESULT_SCHEMA_INVALID");
  const r = value as Record<string, unknown>;
  if (r.role !== role || r.attemptId !== attemptId) throw new Error("WORKER_RESULT_IDENTITY_MISMATCH");
  const valid = (condition: unknown, key: string) => { if (!condition) throw new Error(`WORKER_RESULT_SCHEMA_INVALID:${key}`); };
  const object = (v: unknown): v is Record<string, unknown> => Boolean(v && typeof v === "object" && !Array.isArray(v));
  const string = (v: unknown): v is string => typeof v === "string" && v.length > 0;
  const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every(string);
  const count = (v: unknown) => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
  const finding = (f: unknown) => object(f) && string(f.code) && string(f.detail) && ["INFO", "WARNING", "BLOCKING"].includes(String(f.severity)) &&
    (f.evidenceSpanIds === undefined || strings(f.evidenceSpanIds));
  const array = (key: string) => { if (!Array.isArray(r[key])) throw new Error(`WORKER_RESULT_SCHEMA_INVALID:${key}`); };
  if (role === "PARSER") {
    for (const key of ["records", "spans", "warnings"]) array(key);
    if (!((r.schemaVersion === 1 && ["LEGISTAR_EVENTS", "CIVICCLERK_EVENTS"].includes(String(r.recordClass))) || (r.schemaVersion === 2 && string(r.recordClass))) ||
        !["EXTRACTED", "FAILED", "AMBIGUOUS"].includes(String(r.verdict)) ||
        typeof r.artifactId !== "string" || typeof r.contentHash !== "string" ||
        !Number.isInteger(r.actualRowCount) || (r.actualRowCount as number) < 0 ||
        (r.records as unknown[]).length !== r.actualRowCount) throw new Error("WORKER_RESULT_SCHEMA_INVALID:PARSER");
    valid([r.implementation, r.version, r.acquiredByAttemptId, r.subjectId].every(string), "PARSER_PROVENANCE");
    valid([r.declaredRowCount, r.sourceRowCount].every(v => v === null || count(v)), "PARSER_COUNTS");
    valid((r.warnings as unknown[]).every(finding), "PARSER_WARNINGS");
    valid((r.records as unknown[]).every(record => object(record) && string(record.id) && string(record.subjectId) && object(record.fields) &&
      strings(record.evidenceSpanIds) && Object.values(record.fields).every(isFieldValue)), "PARSER_RECORDS");
    valid((r.spans as unknown[]).every(span => object(span) && [span.id, span.artifactId, span.contentHash, span.recordId, span.field, span.jsonPointer, span.quote].every(string) &&
      span.offsetUnit === "UTF16_CODE_UNITS" && count(span.start) && count(span.end) && Number(span.end) > Number(span.start) &&
      String(span.quote).length === Number(span.end) - Number(span.start)), "PARSER_SPANS");
    if (r.schemaVersion === 2) {
      const metadata = r.contractMetadata;
      valid(object(metadata) && object(metadata.jurisdiction) && [metadata.jurisdiction.country, metadata.jurisdiction.state, metadata.jurisdiction.canonicalId].every(string) &&
        object(metadata.identity) && string(metadata.identity.namespace) && strings(metadata.identity.keyFields) && metadata.identity.keyFields.length > 0 &&
        object(metadata.sourceScope) && [metadata.sourceScope.sourceId, metadata.sourceScope.publisher].every(string) && [metadata.sourceScope.routeIds, metadata.sourceScope.canonicalUrls, metadata.sourceScope.observationArtifactIds].every(v => strings(v) && v.length > 0) && count(metadata.methodVersion) && Number(metadata.methodVersion) > 0, "PARSER_CONTRACT_METADATA");
      valid((r.spans as unknown[]).every(span => object(span) && ["JSON_RECORDS", "HTML_TABLE", "DELIMITED_TEXT", "XML_RECORDS", "TEXT_BLOCKS", "UNSUPPORTED"].includes(String(span.sourceFormat))), "PARSER_SOURCE_FORMAT");
    }
  } else {
    array("findings"); array("artifactIds");
    valid((r.findings as unknown[]).every(finding) && strings(r.artifactIds), "FINDINGS_AND_ARTIFACTS");
    if (typeof r.producerAttemptId !== "string") throw new Error("WORKER_RESULT_SCHEMA_INVALID:PRODUCER");
    if (role === "VALIDATOR" && !["PASS", "FAIL", "INCONCLUSIVE"].includes(String(r.verdict))) throw new Error("WORKER_RESULT_SCHEMA_INVALID:VALIDATOR");
    if (role === "VALIDATOR") {
      valid(strings(r.checked) && count(r.validatedRecordCount), "VALIDATOR_CHECKS");
      if (r.validatedRecordIds !== undefined) valid(strings(r.validatedRecordIds) && new Set(r.validatedRecordIds).size === r.validatedRecordIds.length && r.validatedRecordIds.length === Number(r.validatedRecordCount), "VALIDATOR_RECORD_IDS");
      if (r.extractionVerdict !== undefined) valid(["PASS", "FAIL", "INCONCLUSIVE"].includes(String(r.extractionVerdict)), "VALIDATOR_EXTRACTION_VERDICT");
      if (r.externalVerifications !== undefined) valid(Array.isArray(r.externalVerifications) && r.externalVerifications.every(v => object(v) &&
        string(v.candidateAttemptId) && v.validatorAttemptId === attemptId && object(v.authority) && string(v.authority.id) && string(v.authority.publisher) &&
        ["GOVERNMENT_REGISTER", "STATUTORY_RECORD", "OFFICIAL_DENOMINATOR"].includes(String(v.authority.type)) &&
        object(v.comparison) && ["COUNT", "IDENTITY_SET", "RECORD_VALUES", "RECORD_VALUES_SUBSET"].includes(String(v.comparison.kind)) && strings(v.comparison.keyFields) && strings(v.comparison.fields) &&
        Array.isArray(v.evidence) && v.evidence.every(e => object(e) && [e.artifactId, e.contentHash, e.acquiredByAttemptId, e.canonicalUrl, e.retrievedAt, e.sourceId, e.methodRouteId].every(string) && e.text === undefined) &&
        count(v.candidateCount) && (v.authorityCount === null || count(v.authorityCount)) && ["PASS", "FAIL", "INCONCLUSIVE"].includes(String(v.verdict)) &&
        (v.verifiedRecordIds === undefined || strings(v.verifiedRecordIds) && new Set(v.verifiedRecordIds).size === v.verifiedRecordIds.length && v.verifiedRecordIds.length <= Number(v.candidateCount)) &&
        Array.isArray(v.discrepancies) && v.discrepancies.every(finding) && (v.verifiedAt === null ? v.verdict === "INCONCLUSIVE" : string(v.verifiedAt) && Number.isFinite(Date.parse(v.verifiedAt)))), "EXTERNAL_VERIFICATIONS");
    }
    if (role === "ADVERSARIAL_AUDITOR") {
      array("attacks"); array("startedFrom");
      if (!["SURVIVED", "BROKE", "INCONCLUSIVE"].includes(String(r.verdict)) || typeof r.validatorAttemptId !== "string" ||
          typeof r.reopenRequired !== "boolean" || (r.verdict === "BROKE" && r.reopenRequired !== true)) throw new Error("WORKER_RESULT_SCHEMA_INVALID:AUDITOR");
      valid(count(r.survivingRecordCount) && (r.startedFrom as unknown[]).every(v => AUDIT_EVIDENCE_BASES.includes(v as AuditEvidenceBase)), "AUDITOR_CONTEXT");
      if (r.brokenRecordIds !== undefined) valid(strings(r.brokenRecordIds) && new Set(r.brokenRecordIds).size === r.brokenRecordIds.length, "AUDITOR_BROKEN_RECORD_IDS");
      if (r.coverage !== undefined) valid(object(r.coverage) && [r.coverage.routesApplicable, r.coverage.routesChecked, r.coverage.extractedRecords].every(count) &&
        (r.coverage.sourceRecords === null || count(r.coverage.sourceRecords)) && [r.coverage.sourcesPercent, r.coverage.recordsPercent].every(v => v === null || count(v)), "AUDITOR_COVERAGE");
      if (r.survivingRecordIds !== undefined) valid(strings(r.survivingRecordIds) && new Set(r.survivingRecordIds).size === r.survivingRecordIds.length && r.survivingRecordIds.length === Number(r.survivingRecordCount), "AUDITOR_RECORD_IDS");
      valid((r.attacks as unknown[]).every(attack => object(attack) && ATTACK_MODES.includes(attack.mode as AttackMode) && typeof attack.applicable === "boolean" &&
        typeof attack.executed === "boolean" && string(attack.reason) && ["SURVIVED", "BROKE", "INCONCLUSIVE", "NOT_APPLICABLE"].includes(String(attack.verdict)) &&
        Array.isArray(attack.findings) && attack.findings.every(finding)), "AUDITOR_ATTACKS");
    }
  }
}
