import { authorityFor } from "./source-authority.ts";
import type {
  CandidateDecision,
  CandidateState,
  CandidateVersionRecord,
  RoutineCandidate,
  ValidationCheck,
  ValidationCheckName,
  ValidationReceipt,
} from "./types.ts";

const SHA256 = /^[a-f0-9]{64}$/;

function result(check: ValidationCheckName, verdict: ValidationCheck["verdict"], code: string, detail: string): ValidationCheck {
  return { check, verdict, code, detail };
}

function jurisdictionAllowed(candidate: RoutineCandidate, allowed: readonly string[]): boolean {
  return candidate.identities.every((identity) => allowed.includes(identity.jurisdiction));
}

function temporalOrder(value: string): number | null {
  if (/^\d{4}$/.test(value)) return Number(value);
  const date = Date.parse(value);
  return Number.isFinite(date) ? date : null;
}

function firstBlocking(checks: readonly ValidationCheck[]): ValidationCheck | null {
  return checks.find((check) => check.verdict !== "PASS") ?? null;
}

export function failureStateFor(check: ValidationCheck): CandidateState {
  switch (check.check) {
    case "SOURCE_AUTHENTICITY": return "SOURCE_BLOCKED";
    case "SCHEMA_PARSE_VALIDITY": return "PARSE_INVALID";
    case "IDENTITY_JURISDICTION_VALIDITY": return "IDENTITY_UNRESOLVED";
    case "TEMPORAL_VALIDITY": return "TEMPORAL_INVALID";
    case "SEMANTIC_VALIDITY": return "SEMANTIC_INVALID";
    case "COMPLETENESS_HORIZON_VALIDITY": return "HORIZON_UNRESOLVED";
    case "ABSENCE_VALIDITY": return check.verdict === "CANNOT_TELL" ? "CANNOT_TELL" : "SEMANTIC_INVALID";
    case "DEPENDENT_READ_MODEL_VALIDITY": return "DEPENDENT_CONSUMER_INVALID";
  }
}

/** Every decision below is deterministic and tied to one named GOOD check. */
export function validateRoutineCandidate(
  candidate: RoutineCandidate,
  lastKnownGood: CandidateVersionRecord | null,
  validatedAt: string = new Date().toISOString(),
): { readonly receipt: ValidationReceipt; readonly state: "VALIDATED" | CandidateState } {
  const checks: ValidationCheck[] = [];
  const authority = candidate.retrieval.finalUrl
    ? authorityFor(candidate.sourceId, candidate.recordClass, candidate.retrieval.finalUrl)
    : { ok: false as const, code: "FINAL_URL_MISSING", detail: "Successful retrieval has no final URL." };

  if (!candidate.retrieval.succeeded) {
    checks.push(result("SOURCE_AUTHENTICITY", "FAIL", "SOURCE_RETRIEVAL_FAILED", candidate.retrieval.failureDetail ?? `HTTP ${candidate.retrieval.httpStatus ?? "unknown"}; no authoritative bytes acquired.`));
  } else if (!authority.ok) {
    checks.push(result("SOURCE_AUTHENTICITY", "FAIL", authority.code, authority.detail));
  } else if (!candidate.retrieval.rawHash || !SHA256.test(candidate.retrieval.rawHash)) {
    checks.push(result("SOURCE_AUTHENTICITY", "FAIL", "RAW_HASH_INVALID", "Acquired bytes do not carry a lowercase SHA-256 hash."));
  } else {
    checks.push(result("SOURCE_AUTHENTICITY", "PASS", "AUTHORITY_AND_RAW_PROVENANCE_VALID", `${authority.contract.publisher}; ${candidate.retrieval.finalUrl}; raw ${candidate.retrieval.rawHash}.`));
  }

  if (!candidate.normalization.succeeded) {
    checks.push(result("SCHEMA_PARSE_VALIDITY", "FAIL", "PARSER_FAILED", candidate.normalization.failureDetail ?? "Normalizer did not produce a candidate."));
  } else if (!candidate.normalization.normalizedHash || !SHA256.test(candidate.normalization.normalizedHash)) {
    checks.push(result("SCHEMA_PARSE_VALIDITY", "FAIL", "NORMALIZED_HASH_INVALID", "Normalized payload does not carry a lowercase SHA-256 hash."));
  } else if (authority.ok && candidate.normalization.parserVersion !== authority.contract.parserVersion) {
    checks.push(result("SCHEMA_PARSE_VALIDITY", "FAIL", "PARSER_VERSION_UNREGISTERED", `${candidate.normalization.parserVersion} does not equal ${authority.contract.parserVersion}.`));
  } else if (candidate.normalization.missingRequiredFields.length > 0) {
    checks.push(result("SCHEMA_PARSE_VALIDITY", "FAIL", "REQUIRED_FIELDS_MISSING", candidate.normalization.missingRequiredFields.join(", ")));
  } else if (candidate.normalization.inputRecords < 0 || candidate.normalization.outputRecords < 0 || candidate.normalization.droppedRecords < 0 || candidate.normalization.outputRecords + candidate.normalization.droppedRecords !== candidate.normalization.inputRecords) {
    checks.push(result("SCHEMA_PARSE_VALIDITY", "FAIL", "RECORD_DISPOSITION_MISMATCH", `${candidate.normalization.outputRecords} output + ${candidate.normalization.droppedRecords} dropped != ${candidate.normalization.inputRecords} input.`));
  } else {
    checks.push(result("SCHEMA_PARSE_VALIDITY", "PASS", "SCHEMA_AND_DISPOSITION_VALID", `${candidate.normalization.outputRecords}/${candidate.normalization.inputRecords} records normalized; ${candidate.normalization.droppedRecords} explicitly dropped.`));
  }

  const registered = authority.ok ? authority.contract : null;
  const identityFailure = candidate.identities.find((identity) =>
    identity.ambiguous || identity.matchBasis === "NAME_ONLY" || Object.keys(identity.identifiers).length === 0,
  );
  const identifierContractFailure = registered ? candidate.identities.find((identity) =>
    !registered.expectedIdentifierKeys.some((key) => Object.hasOwn(identity.identifiers, key)),
  ) : undefined;
  if (candidate.normalization.outputRecords > 0 && candidate.identities.length === 0) {
    checks.push(result("IDENTITY_JURISDICTION_VALIDITY", "FAIL", "IDENTITY_EVIDENCE_MISSING", "Normalized records have no identity receipt."));
  } else if (identityFailure) {
    checks.push(result("IDENTITY_JURISDICTION_VALIDITY", "FAIL", identityFailure.ambiguous ? "IDENTITY_AMBIGUOUS" : identityFailure.matchBasis === "NAME_ONLY" ? "NAME_ONLY_IDENTITY_REFUSED" : "IDENTIFIER_MISSING", `${identityFailure.subjectId} cannot be mapped by an exact registered identifier.`));
  } else if (registered && !jurisdictionAllowed(candidate, registered.jurisdictions)) {
    checks.push(result("IDENTITY_JURISDICTION_VALIDITY", "FAIL", "JURISDICTION_OUTSIDE_AUTHORITY", `One or more identities fall outside ${registered.jurisdictions.join(", ")}.`));
  } else if (identifierContractFailure) {
    checks.push(result("IDENTITY_JURISDICTION_VALIDITY", "FAIL", "REGISTERED_IDENTIFIER_MISSING", `${identifierContractFailure.subjectId} carries none of the registered keys: ${registered!.expectedIdentifierKeys.join(", ")}.`));
  } else if (candidate.recordClass === "STATE_LEGISLATOR" && candidate.identities.some((identity) => !identity.chamber || !identity.term || !identity.office)) {
    checks.push(result("IDENTITY_JURISDICTION_VALIDITY", "FAIL", "STATE_MEMBER_SEAT_IDENTITY_INCOMPLETE", "Every state member requires exact office, chamber, and term."));
  } else if (candidate.recordClass === "STATE_LEGISLATOR" && candidate.identities.some((identity) =>
    identity.term !== candidate.temporal.version ||
    (candidate.sourceId === "nh-general-court" && identity.identifiers.chamber !== identity.chamber)
  )) {
    checks.push(result("IDENTITY_JURISDICTION_VALIDITY", "FAIL", "STATE_MEMBER_CHAMBER_TERM_MISMATCH", "Every state member's chamber identifier and term must agree with the normalized seat and candidate period."));
  } else if (candidate.recordClass === "STATE_ROLL_CALL" && candidate.identities.some((identity) => !identity.chamber || !identity.term || !identity.session || !identity.identifiers.rollCallId || !identity.identifiers.eventId)) {
    checks.push(result("IDENTITY_JURISDICTION_VALIDITY", "FAIL", "STATE_ROLL_IDENTITY_INCOMPLETE", "Every state roll call requires exact roll, event, chamber, term, and session identifiers."));
  } else {
    checks.push(result("IDENTITY_JURISDICTION_VALIDITY", "PASS", "IDENTITY_AND_JURISDICTION_EXACT", `${candidate.identities.length} exact identity binding(s); no name-only inheritance.`));
  }

  const current = lastKnownGood?.candidate.temporal;
  const candidateOrder = temporalOrder(candidate.temporal.sourceThrough);
  const currentOrder = current ? temporalOrder(current.sourceThrough) : null;
  if (!candidate.temporal.version || !candidate.temporal.sourceThrough) {
    checks.push(result("TEMPORAL_VALIDITY", "CANNOT_TELL", "SOURCE_THROUGH_UNKNOWN", "Candidate has no product/session/report source-through value."));
  } else if (candidate.temporal.version !== candidate.temporal.expectedVersion) {
    checks.push(result("TEMPORAL_VALIDITY", "FAIL", "WRONG_PERIOD_OR_VINTAGE", `${candidate.temporal.version} does not equal expected ${candidate.temporal.expectedVersion}.`));
  } else if (candidate.temporal.staleAtRetrieval) {
    checks.push(result("TEMPORAL_VALIDITY", "FAIL", "FRESH_FETCH_STALE_FACTS", "The route was freshly read but the source facts belong to an expired term/session/period."));
  } else if (current && candidate.temporal.version < current.version) {
    checks.push(result("TEMPORAL_VALIDITY", "FAIL", "VERSION_REGRESSION", `${candidate.temporal.version} precedes promoted ${current.version}.`));
  } else if (candidateOrder !== null && currentOrder !== null && candidateOrder < currentOrder) {
    checks.push(result("TEMPORAL_VALIDITY", "FAIL", "SOURCE_THROUGH_REGRESSION", `${candidate.temporal.sourceThrough} precedes promoted ${current!.sourceThrough}.`));
  } else {
    checks.push(result("TEMPORAL_VALIDITY", "PASS", "TEMPORAL_VERSION_VALID", `${candidate.temporal.version}; source through ${candidate.temporal.sourceThrough}.`));
  }

  if (candidate.semantics.violations.length > 0) {
    checks.push(result("SEMANTIC_VALIDITY", "FAIL", "SEMANTIC_CONTRACT_VIOLATION", candidate.semantics.violations.join("; ")));
  } else if (candidate.semantics.expectedActionStage && candidate.semantics.actionStage !== candidate.semantics.expectedActionStage) {
    checks.push(result("SEMANTIC_VALIDITY", "FAIL", "WRONG_ACTION_STAGE", `${candidate.semantics.actionStage ?? "unstated"} is not ${candidate.semantics.expectedActionStage}.`));
  } else {
    checks.push(result("SEMANTIC_VALIDITY", "PASS", "FACT_INTERPRETATION_VALID", `${candidate.semantics.factKind}${candidate.semantics.actionStage ? ` at ${candidate.semantics.actionStage}` : ""}.`));
  }

  if (candidate.horizon.returnedRecords !== candidate.normalization.outputRecords) {
    checks.push(result("COMPLETENESS_HORIZON_VALIDITY", "FAIL", "HORIZON_RECORD_COUNT_MISMATCH", `${candidate.horizon.returnedRecords} horizon rows != ${candidate.normalization.outputRecords} normalized rows.`));
  } else if (candidate.horizon.claimsComplete && candidate.horizon.kind !== "BOUNDED") {
    checks.push(result("COMPLETENESS_HORIZON_VALIDITY", "CANNOT_TELL", "COMPLETE_UNIVERSE_UNBOUNDED", "An open fact set cannot claim a complete universe."));
  } else if (candidate.horizon.claimsComplete && !candidate.horizon.paginationComplete) {
    checks.push(result("COMPLETENESS_HORIZON_VALIDITY", "CANNOT_TELL", "PAGINATION_INCOMPLETE", "The candidate claims completeness before the bounded query's last page."));
  } else if (candidate.horizon.claimsComplete && candidate.horizon.declaredTotal !== candidate.horizon.returnedRecords) {
    checks.push(result("COMPLETENESS_HORIZON_VALIDITY", "CANNOT_TELL", "DECLARED_TOTAL_NOT_RECONCILED", `${candidate.horizon.returnedRecords} returned != ${candidate.horizon.declaredTotal ?? "unstated"} declared.`));
  } else {
    checks.push(result("COMPLETENESS_HORIZON_VALIDITY", "PASS", candidate.horizon.claimsComplete ? "BOUNDED_UNIVERSE_RECONCILED" : "INDIVIDUAL_FACTS_NO_UNIVERSE_CLAIM", candidate.horizon.claimsComplete ? `${candidate.horizon.returnedRecords}/${candidate.horizon.declaredTotal} rows and pagination ended.` : "Valid individual facts may promote; broader completeness remains open."));
  }

  const absencePolicy = registered?.absencePolicy;
  if (!candidate.absence.claimsAbsence && candidate.normalization.outputRecords === 0) {
    checks.push(result("ABSENCE_VALIDITY", "CANNOT_TELL", "ZERO_IS_NOT_ABSENCE", "The query returned zero records but carries no competent bounded absence evidence."));
  } else if (!candidate.absence.claimsAbsence) {
    checks.push(result("ABSENCE_VALIDITY", "PASS", "NO_ABSENCE_CLAIM", "The projection makes no absence claim."));
  } else if (!absencePolicy || absencePolicy.kind === "NEVER_FROM_ZERO") {
    checks.push(result("ABSENCE_VALIDITY", "FAIL", "SOURCE_CANNOT_ESTABLISH_ABSENCE", `${candidate.sourceId} is not registered to establish absence for this record class/query.`));
  } else if (candidate.absence.basis === "ZERO_ONLY") {
    checks.push(result("ABSENCE_VALIDITY", "CANNOT_TELL", "ZERO_IS_NOT_ABSENCE", "A zero result without bounded horizon or an explicit official statement proves no absence."));
  } else if (!candidate.absence.exactSubject || !candidate.absence.exactHorizon) {
    checks.push(result("ABSENCE_VALIDITY", "CANNOT_TELL", "ABSENCE_SCOPE_INCOMPLETE", "Absence evidence lacks the exact subject or horizon."));
  } else if (candidate.absence.basis === "BOUNDED_AUTHORITATIVE_QUERY" && (!candidate.horizon.paginationComplete || candidate.horizon.kind !== "BOUNDED")) {
    checks.push(result("ABSENCE_VALIDITY", "CANNOT_TELL", "ABSENCE_QUERY_NOT_BOUNDED", "The authoritative query did not prove its last page/end of universe."));
  } else {
    checks.push(result("ABSENCE_VALIDITY", "PASS", "AUTHORITATIVE_ABSENCE_BOUNDED", `${candidate.absence.basis}: ${candidate.absence.exactSubject} within ${candidate.absence.exactHorizon}.`));
  }

  const failedConsumer = candidate.dependentChecks.find((check) => !check.passed);
  if (candidate.dependentChecks.length === 0) {
    checks.push(result("DEPENDENT_READ_MODEL_VALIDITY", "FAIL", "DEPENDENT_CHECK_MISSING", "No named Reader/Ask consumer exercised the promoted projection shape."));
  } else if (failedConsumer) {
    checks.push(result("DEPENDENT_READ_MODEL_VALIDITY", "FAIL", "DEPENDENT_CONSUMER_REJECTED", `${failedConsumer.consumer}: ${failedConsumer.detail}`));
  } else {
    checks.push(result("DEPENDENT_READ_MODEL_VALIDITY", "PASS", "DEPENDENT_CONSUMERS_ACCEPT", candidate.dependentChecks.map((check) => check.consumer).join(", ")));
  }

  const blocking = firstBlocking(checks);
  const decision: CandidateDecision = blocking === null ? "GOOD" : blocking.verdict === "CANNOT_TELL" ? "CANNOT_TELL" : "FAIL";
  const receipt: ValidationReceipt = {
    contractVersion: 2,
    decision,
    candidateId: candidate.id,
    sourceId: candidate.sourceId,
    recordClass: candidate.recordClass,
    scope: candidate.scope,
    validatedAt,
    checks,
    excludedFacts: candidate.excludedFacts ?? [],
  };
  return { receipt, state: blocking ? failureStateFor(blocking) : "VALIDATED" };
}
