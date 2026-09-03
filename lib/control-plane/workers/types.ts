import type { AttemptCost, WorkerRef } from "../attempt.ts";
import type { AttackMode, AuditEvidenceBase } from "../audit.ts";
import { ATTACK_MODES, AUDIT_EVIDENCE_BASES } from "../audit.ts";
import type { CapabilityGrant } from "../capability.ts";
import type { Attempt } from "../attempt.ts";
import type { RouteTask } from "../route-task.ts";

/** One wire contract: the broker validates both sides of the disposable worker boundary. */
export const WORKER_SCHEMA_VERSION = 1 as const;
export const FLEET_ROLES = ["PARSER", "VALIDATOR", "ADVERSARIAL_AUDITOR"] as const;
export type FleetRole = (typeof FLEET_ROLES)[number];
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
}
export interface CivicExtractionContract {
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
  readonly schemaVersion: 1;
  readonly recordClass: "LEGISTAR_EVENTS" | "CIVICCLERK_EVENTS";
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
  readonly attemptId: string;
  readonly worker: WorkerRef;
  readonly producer: WorkerRef;
  readonly producerAttemptId: string;
  readonly evidence: WorkerEvidence;
  readonly contract: CivicExtractionContract;
  readonly candidate: ParserResult;
}
export interface ValidatorResult {
  readonly role: "VALIDATOR";
  readonly attemptId: string;
  readonly producerAttemptId: string;
  readonly verdict: "PASS" | "FAIL" | "INCONCLUSIVE";
  readonly checked: readonly string[];
  readonly findings: readonly WorkerFinding[];
  readonly artifactIds: readonly string[];
  readonly validatedRecordCount: number;
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
export interface AuditorResult {
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
export type FleetResult = ParserResult | ValidatorResult | AuditorResult;
export interface WorkerTaskSpec {
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
  readonly auditContext?: Omit<IndependentAuditContext, "evidence" | "surfaceEvidence"> & {
    readonly evidence: readonly Omit<WorkerEvidence, "text">[];
    readonly surfaceEvidence: readonly Omit<WorkerEvidence, "text">[];
  };
  readonly modelReview?: {
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
    if (r.schemaVersion !== 1 || !["LEGISTAR_EVENTS", "CIVICCLERK_EVENTS"].includes(String(r.recordClass)) ||
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
  } else {
    array("findings"); array("artifactIds");
    valid((r.findings as unknown[]).every(finding) && strings(r.artifactIds), "FINDINGS_AND_ARTIFACTS");
    if (typeof r.producerAttemptId !== "string") throw new Error("WORKER_RESULT_SCHEMA_INVALID:PRODUCER");
    if (role === "VALIDATOR" && !["PASS", "FAIL", "INCONCLUSIVE"].includes(String(r.verdict))) throw new Error("WORKER_RESULT_SCHEMA_INVALID:VALIDATOR");
    if (role === "VALIDATOR") valid(strings(r.checked) && count(r.validatedRecordCount), "VALIDATOR_CHECKS");
    if (role === "ADVERSARIAL_AUDITOR") {
      array("attacks"); array("startedFrom");
      if (!["SURVIVED", "BROKE", "INCONCLUSIVE"].includes(String(r.verdict)) || typeof r.validatorAttemptId !== "string" ||
          typeof r.reopenRequired !== "boolean" || (r.verdict === "BROKE" && r.reopenRequired !== true)) throw new Error("WORKER_RESULT_SCHEMA_INVALID:AUDITOR");
      valid(count(r.survivingRecordCount) && (r.startedFrom as unknown[]).every(v => AUDIT_EVIDENCE_BASES.includes(v as AuditEvidenceBase)), "AUDITOR_CONTEXT");
      valid((r.attacks as unknown[]).every(attack => object(attack) && ATTACK_MODES.includes(attack.mode as AttackMode) && typeof attack.applicable === "boolean" &&
        typeof attack.executed === "boolean" && string(attack.reason) && ["SURVIVED", "BROKE", "INCONCLUSIVE", "NOT_APPLICABLE"].includes(String(attack.verdict)) &&
        Array.isArray(attack.findings) && attack.findings.every(finding)), "AUDITOR_ATTACKS");
    }
  }
}
