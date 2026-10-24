import type { WorkerRef } from "../attempt.ts";
import type { Artifact } from "../evidence/artifact.ts";
import type { PermissionState, TransportState } from "../../workstate/types.ts";
import type { WorkerFinding, FieldValue } from "./types.ts";

/** Additive role contracts stored in the existing WorkerResult family. */
export interface ResearchSpan {
  readonly artifactId: string;
  readonly contentHash: string;
  readonly start: number;
  readonly end: number;
  readonly quote: string;
  readonly offsetUnit: "UTF16_CODE_UNITS";
}
export interface ObservedResearchRoute {
  readonly id: string;
  readonly subjectId: string;
  readonly jurisdiction: string;
  readonly recordClass: string;
  readonly sourceId: string;
  readonly publisher: string;
  readonly url: string;
  /** An exact locator in the observation; relative links resolve against its canonical URL. */
  readonly observedLocator: string;
  readonly observedAt: string;
  readonly firstObservedAt: string;
  readonly sourcePublishedAt?: string | null;
  readonly effectiveAt?: string | null;
  readonly methodVersion: number;
  readonly permission: PermissionState;
  readonly observation: ResearchSpan;
  readonly publisherSubjectEvidence: readonly ResearchSpan[];
  readonly applicableBecause: string;
  readonly nextRouteIds: readonly string[];
  readonly retrieval: "fetch_public" | "browse";
  /** Machine-selected from a retained transcription, never a model's permission to substitute bytes. */
  readonly representation?: NonNullable<Artifact["extraction"]>["kind"];
}
export interface HeldResearchArtifact {
  readonly artifactId: string;
  /** Declared ancestor owner; execution must independently authorize the lineage. */
  readonly inheritedFromWorkItemId?: string;
  readonly sourceObservationArtifactId: string;
  readonly sourceRouteId: string;
  readonly immutable: boolean;
  readonly currentUntil: string;
  readonly partial: boolean;
}
export interface AcquirerTaskSpec {
  readonly route: ObservedResearchRoute;
  readonly held: readonly HeldResearchArtifact[];
}
export interface AcquiredResearchArtifact {
  readonly artifactId: string;
  readonly sourceRouteId: string;
  readonly sourceObservationArtifactId: string;
  readonly canonicalUrl: string;
  readonly sourceId: string;
  readonly acquisitionAttemptId: string;
  readonly retrievedAt: string;
  readonly contentHash: string;
  readonly byteCount: number;
  readonly contentType: string;
  readonly tier: Artifact["tier"];
  readonly completeness: "COMPLETE" | "PARTIAL" | "EMPTY";
  readonly vaultKey: string;
  readonly transport: TransportState;
  readonly httpStatus: number;
  readonly reused: boolean;
}
export interface ResearchBlocker {
  readonly code: "PERMISSION_DENIED" | "PERMISSION_UNKNOWN" | "CAPABILITY_DENIED" | "PUBLISHER_AUTHENTICATION" |
    "RATE_LIMITED" | "TRANSPORT_FAILED" | "DOCUMENT_INACCESSIBLE" | "EVIDENCE_IDENTITY_MISMATCH" |
    "UNGROUNDED_ROUTE" | "AMBIGUOUS_IDENTITY" | "CONFLICTING_AUTHORITIES" | "MISSING_EXTERNAL_DENOMINATOR" |
    "COST_CEILING" | "MODEL_TRANSPORT_UNAVAILABLE" | "OPERATOR_DECISION_REQUIRED";
  readonly description: string;
  readonly worker: WorkerRef;
  readonly attemptId: string;
  readonly observedAt: string;
  readonly artifactIds: readonly string[];
  readonly retryable: boolean;
  readonly anotherRouteRemains: boolean;
  readonly operatorDecisionRequired: boolean;
}
export interface EvidenceWalkStep {
  readonly sequence: number;
  readonly at: string;
  readonly worker: WorkerRef;
  readonly attemptId: string;
  readonly routeId: string;
  readonly rung: string;
  readonly target: string;
  readonly applicableBecause: string;
  readonly permission: PermissionState;
  readonly transport: TransportState | "NOT_ATTEMPTED";
  readonly observed: string;
  readonly returnedCount: number | null;
  readonly artifactIds: readonly string[];
  readonly nextRouteIds: readonly string[];
  readonly outcome: "WALKED_AND_FOUND" | "WALKED_AND_EMPTY" | "DOES_NOT_EXIST" | "BLOCKED" | "NOT_WALKED";
  readonly nextHopUrls?: readonly string[];
  readonly pass: "INITIAL" | "TERMINAL_REPASS";
}
export type ResearchWalkState = { readonly state: "OPEN"; readonly nextRouteIds: readonly string[] } | {
  readonly state: "CLOSED";
  readonly applicableRouteIds: readonly string[];
  readonly terminalRepassAt: string;
  readonly terminalRepassOutcome: "NO_FURTHER_APPLICABLE_ROUTE";
  readonly noFurtherRouteReason: string;
  readonly absenceArgument: string;
  readonly falsificationConditions: readonly string[];
  readonly supportingArtifactIds: readonly string[];
  readonly stuckProtocolStepSequences: readonly [number, number, number, number, number];
  readonly twoClickStepSequence: number;
  readonly expiresAt: string;
};
export interface AcquirerResult {
  readonly role: "ACQUIRER";
  readonly attemptId: string;
  readonly verdict: "ACQUIRED" | "PARTIAL" | "EMPTY" | "BLOCKED";
  readonly source: ObservedResearchRoute;
  /** Absent on earlier results means the machine verdict was not recorded. */
  readonly sourceGrounding?: { readonly verdict: "OBSERVED" | "UNPROVEN"; readonly checkedArtifactIds: readonly string[] };
  readonly artifacts: readonly AcquiredResearchArtifact[];
  /** Includes permission/diagnostic evidence, separately from possessed source records. */
  readonly artifactIds: readonly string[];
  readonly findings: readonly WorkerFinding[];
  readonly blockers: readonly ResearchBlocker[];
  readonly walk: readonly EvidenceWalkStep[];
  readonly walkState: ResearchWalkState;
  readonly requestCount: number;
  readonly bytesFetched: number;
}
export interface ResearchAuthority {
  readonly artifactId: string;
  readonly organization: string;
  readonly type: "OFFICIAL_RECORD" | "CERTIFIED_ROSTER" | "CENSUS" | "NCES" | "PUBLISHER_DIRECTORY";
  readonly observedAt: string;
}
export interface DetectiveTest {
  readonly artifactId: string;
  readonly predicate: { readonly kind: "JSON_VALUE_EQUALS"; readonly pointer: string; readonly expected: FieldValue } |
    { readonly kind: "EXACT_TEXT"; readonly quote: string };
}
export interface DetectiveAlternative {
  readonly id: string;
  readonly statement: string;
  readonly canonicalIdentity: string | null;
  readonly tests: readonly DetectiveTest[];
}
export interface DenominatorQuestion {
  readonly authority: ResearchAuthority;
  readonly countPointer: string;
  readonly populationDefinition: string;
  readonly coveredCount: number;
  readonly unresolvedCount: number;
}
export interface DetectiveQuestion {
  readonly id: string;
  readonly text: string;
  readonly subjectId: string;
  readonly jurisdiction: string;
  readonly recordClass: string;
  readonly kind: "IDENTITY" | "DENOMINATOR" | "CONTRADICTION" | "RECORD_AUTHORITY";
  readonly alternatives: readonly DetectiveAlternative[];
  readonly authorities: readonly ResearchAuthority[];
  readonly falsificationCondition: string;
  readonly nextAction: string;
  readonly populationDefinition: string | null;
  readonly denominator: DenominatorQuestion | null;
}
export interface DetectiveResult {
  readonly role: "DETECTIVE";
  readonly attemptId: string;
  readonly verdict: "SUPPORTED" | "UNRESOLVED" | "CONTRADICTED";
  readonly question: DetectiveQuestion;
  readonly artifactIds: readonly string[];
  readonly spans: readonly ResearchSpan[];
  readonly alternativesTested: readonly { readonly id: string; readonly outcome: "SUPPORTED" | "CONTRADICTED" | "INSUFFICIENT_EVIDENCE"; readonly spanIndexes: readonly number[] }[];
  readonly conclusion: string;
  readonly burden: "EVIDENCE_SUPPORTED_PENDING_INDEPENDENT_VALIDATION" | "UNRESOLVED";
  readonly identity: { readonly state: "CANDIDATE"; readonly canonicalId: string } | { readonly state: "UNRESOLVED"; readonly candidates: readonly string[] };
  readonly contradictions: readonly string[];
  readonly nextAction: string;
  readonly falsificationCondition: string;
  readonly denominator: { readonly state: "KNOWN"; readonly authority: ResearchAuthority; readonly authorityArtifactId: string; readonly count: number; readonly coveredCount: number; readonly unresolvedCount: number; readonly populationDefinition: string; readonly observedAt: string; readonly span: ResearchSpan } | { readonly state: "UNKNOWN"; readonly populationDefinition: string | null };
  readonly learnedProcedure: { readonly implementation: "bounded-authoritative-evidence-comparison/1"; readonly deterministic: true; readonly testableQuestion: DetectiveQuestion; readonly promotion: "CANDIDATE_ONLY" };
  readonly hypotheses: readonly { readonly claim: string; readonly status: "UNVERIFIED_MODEL_HYPOTHESIS" }[];
  readonly findings: readonly WorkerFinding[];
  readonly blockers: readonly ResearchBlocker[];
  readonly walk: readonly EvidenceWalkStep[];
  readonly walkState: ResearchWalkState;
}

export function assertResearchWalk(walk: readonly EvidenceWalkStep[], state: ResearchWalkState): void {
  const instant = (s: string) => Number.isFinite(Date.parse(s));
  const seen = new Set<number>();
  for (const [index, step] of walk.entries()) {
    if (!Number.isSafeInteger(step.sequence) || step.sequence < 0 || seen.has(step.sequence) || !instant(step.at) ||
      (index > 0 && (step.sequence <= walk[index - 1].sequence || Date.parse(step.at) < Date.parse(walk[index - 1].at))) ||
      !step.attemptId || !step.worker?.role || !step.routeId || !step.target || !step.applicableBecause || !step.observed ||
      !["INITIAL", "TERMINAL_REPASS"].includes(step.pass) || !["WALKED_AND_FOUND", "WALKED_AND_EMPTY", "DOES_NOT_EXIST", "BLOCKED", "NOT_WALKED"].includes(step.outcome) ||
      !["ALLOWED", "DISALLOWED", "CANNOT_TELL", "NOT_APPLICABLE"].includes(step.permission) ||
      !["REACHABLE", "FAILED_AT_RUNG", "CHALLENGED", "TIMEOUT", "TLS_CLIENT_MISMATCH", "OTHER_NAMED_FAILURE", "NOT_ATTEMPTED"].includes(step.transport) ||
      !Array.isArray(step.artifactIds) || !Array.isArray(step.nextRouteIds) ||
      (step.outcome === "NOT_WALKED" && step.transport !== "NOT_ATTEMPTED") ||
      (step.returnedCount !== null && (!Number.isSafeInteger(step.returnedCount) || step.returnedCount < 0))) throw new Error("RESEARCH_WALK_INVALID");
    seen.add(step.sequence);
  }
  if (state.state === "OPEN") {
    if (!Array.isArray(state.nextRouteIds) || state.nextRouteIds.some(id => !id)) throw new Error("RESEARCH_OPEN_WALK_INVALID");
    return;
  }
  if (state.state !== "CLOSED") throw new Error("RESEARCH_WALK_STATE_INVALID");
  const terminal = walk.filter(s => s.pass === "TERMINAL_REPASS");
  const lastInitialAt = Math.max(...walk.filter(s => s.pass === "INITIAL").map(s => Date.parse(s.at)));
  const allowed = new Set(state.applicableRouteIds);
  if (!allowed.size || allowed.size !== state.applicableRouteIds.length || !instant(state.terminalRepassAt) || !instant(state.expiresAt) ||
    Date.parse(state.expiresAt) <= Date.parse(state.terminalRepassAt) || !state.absenceArgument.trim() || !state.noFurtherRouteReason.trim() ||
    !state.falsificationConditions.length || !state.supportingArtifactIds.length ||
    walk.some(s => !allowed.has(s.routeId) || s.nextRouteIds.some(id => !allowed.has(id))) ||
    [...allowed].some(id => !walk.some(s => s.routeId === id && s.pass === "INITIAL") || !terminal.some(s => s.routeId === id)) ||
    state.terminalRepassOutcome !== "NO_FURTHER_APPLICABLE_ROUTE" ||
    terminal.some(s => !["WALKED_AND_EMPTY", "DOES_NOT_EXIST"].includes(s.outcome) || s.transport !== "REACHABLE" || s.artifactIds.length === 0 ||
      Date.parse(s.at) < lastInitialAt ||
      Date.parse(s.at) > Date.parse(state.terminalRepassAt)) ||
    state.supportingArtifactIds.some(id => !walk.some(s => s.artifactIds.includes(id))) ||
    state.stuckProtocolStepSequences.length !== 5 || new Set(state.stuckProtocolStepSequences).size !== 5 ||
    [...state.stuckProtocolStepSequences, state.twoClickStepSequence].some(n => !walk.some(s => s.sequence === n && s.outcome !== "NOT_WALKED"))) {
    throw new Error("RESEARCH_CLOSED_WALK_UNPROVEN");
  }
}

export function assertResearchResult(value: unknown, role: "ACQUIRER" | "DETECTIVE", attemptId: string): asserts value is AcquirerResult | DetectiveResult {
  if (!value || typeof value !== "object") throw new Error("RESEARCH_RESULT_INVALID");
  const r = value as AcquirerResult | DetectiveResult;
  if (r.role !== role || r.attemptId !== attemptId || !Array.isArray(r.artifactIds) || !Array.isArray(r.findings) ||
    !Array.isArray(r.blockers) || !Array.isArray(r.walk) || !r.walkState) throw new Error("RESEARCH_RESULT_INVALID");
  assertResearchWalk(r.walk, r.walkState);
  if (r.artifactIds.some(id => typeof id !== "string" || !id) || new Set(r.artifactIds).size !== r.artifactIds.length ||
    r.findings.some(f => !f.code || !f.detail || !["INFO", "WARNING", "BLOCKING"].includes(f.severity)) ||
    r.walk.some(s => s.artifactIds.some((id: string) => !r.artifactIds.includes(id)))) throw new Error("RESEARCH_RESULT_REFERENCES_INVALID");
  if (r.blockers.some(b => b.attemptId !== attemptId || b.worker.role !== role || !Number.isFinite(Date.parse(b.observedAt)) ||
    b.artifactIds.some((id: string) => !r.artifactIds.includes(id)) || (b.operatorDecisionRequired && b.code !== "OPERATOR_DECISION_REQUIRED"))) throw new Error("RESEARCH_BLOCKER_INVALID");
  if (r.role === "ACQUIRER") {
    if (!["ACQUIRED", "PARTIAL", "EMPTY", "BLOCKED"].includes(r.verdict) || !Array.isArray(r.artifacts) || !r.source ||
      !Number.isSafeInteger(r.requestCount) || r.requestCount < 0 || !Number.isSafeInteger(r.bytesFetched) || r.bytesFetched < 0 ||
      (r.sourceGrounding && (!["OBSERVED", "UNPROVEN"].includes(r.sourceGrounding.verdict) ||
        r.sourceGrounding.checkedArtifactIds.some(id => !r.artifactIds.includes(id)) ||
        (r.sourceGrounding.verdict === "OBSERVED" && !r.sourceGrounding.checkedArtifactIds.includes(r.source.observation.artifactId)))) ||
      r.artifacts.some(a => !r.artifactIds.includes(a.artifactId) || !a.vaultKey || !a.acquisitionAttemptId || !/^sha256-[a-f0-9]{64}$/.test(a.contentHash) ||
        !Number.isFinite(Date.parse(a.retrievedAt)) || !Number.isSafeInteger(a.byteCount) || a.byteCount < 0 ||
        a.sourceRouteId !== r.source.id || a.sourceObservationArtifactId !== r.source.observation.artifactId ||
        a.canonicalUrl !== r.source.url || a.sourceId !== r.source.sourceId || !["COMPLETE", "PARTIAL", "EMPTY"].includes(a.completeness)) ||
      (r.verdict === "PARTIAL" && !r.artifacts.some(a => a.completeness === "PARTIAL")) ||
      (r.verdict === "ACQUIRED" && !r.artifacts.some(a => a.completeness === "COMPLETE" && a.byteCount > 0 && a.transport === "REACHABLE")) ||
      (r.verdict === "EMPTY" && !r.artifacts.some(a => a.completeness === "EMPTY" && a.transport === "REACHABLE"))) throw new Error("ACQUIRER_RESULT_INVALID");
  } else if (!["SUPPORTED", "UNRESOLVED", "CONTRADICTED"].includes(r.verdict) || !r.question?.text || !r.falsificationCondition || !r.nextAction ||
    !Array.isArray(r.spans) || r.spans.some(s => !r.artifactIds.includes(s.artifactId) || !s.quote || s.end - s.start !== s.quote.length) ||
    !Array.isArray(r.alternativesTested) || r.alternativesTested.some(a => !r.question.alternatives.some(q => q.id === a.id) ||
      !["SUPPORTED", "CONTRADICTED", "INSUFFICIENT_EVIDENCE"].includes(a.outcome) || a.spanIndexes.some((n: number) => !Number.isSafeInteger(n) || !r.spans[n])) ||
    (r.verdict === "SUPPORTED" && r.burden !== "EVIDENCE_SUPPORTED_PENDING_INDEPENDENT_VALIDATION") ||
    (r.denominator.state === "KNOWN" && (!r.artifactIds.includes(r.denominator.authorityArtifactId) || r.denominator.count < r.denominator.coveredCount + r.denominator.unresolvedCount))) throw new Error("DETECTIVE_RESULT_INVALID");
}
