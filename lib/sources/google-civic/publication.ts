import { normalizedHash, sha256, failedAcquisitionCandidate } from "../../civic-data/candidate-builders.ts";
import { civicRecordsFor } from "../../civic-data/changes.ts";
import { sourceProjectionEvidence, type RoutineCandidate } from "../../civic-data/types.ts";
import { GOOGLE_CIVIC_API, GOOGLE_CIVIC_PARSER_VERSION, GOOGLE_CIVIC_RECORD_CLASS, GOOGLE_CIVIC_SOURCE_ID, GOOGLE_CIVIC_ELECTION_DAY } from "./targets.ts";
import { assertCivicProjection, civicElectionRows, civicLookupFromRaw, type CivicProjection } from "./model.ts";

export function civicCandidate(scope: string, projection: CivicProjection, rawBodies: readonly string[], route: "elections" | "voterinfo"): RoutineCandidate {
  assertCivicProjection(projection);
  const checkedAt = projection.checkedAt;
  if (rawBodies.length !== 1) throw new Error("A Google Civic projection requires its exact saved source response.");
  const joined = new Set(projection.rows.flatMap(row => row.joinedDivisionId ?? []));
  const sourceRows = projection.kind === "LOOKUP"
    ? civicLookupFromRaw(rawBodies[0], projection.electionId, checkedAt, joined).rows
    : civicElectionRows(rawBodies[0], checkedAt, joined);
  if (normalizedHash(sourceRows) !== normalizedHash(projection.rows)) throw new Error("Google Civic facts differ from the saved source response.");
  const records = civicRecordsFor(GOOGLE_CIVIC_RECORD_CLASS, projection);
  // The raw envelope comes only from public government-address probes, never reader lookups.
  const normalizedPayload = { projection, rawBodies };
  const rawHash = sha256(rawBodies.map(sha256).join("\n"));
  return {
    id: `cv-${sha256(`${scope}:${rawHash}:${checkedAt}:${normalizedHash(projection)}`).slice(0, 32)}`,
    sourceId: GOOGLE_CIVIC_SOURCE_ID, recordClass: GOOGLE_CIVIC_RECORD_CLASS, scope,
    sourceProjectionEvidence: sourceProjectionEvidence(GOOGLE_CIVIC_SOURCE_ID, GOOGLE_CIVIC_RECORD_CLASS, scope),
    retrieval: { succeeded: rawBodies.length > 0, requestedUrl: `${GOOGLE_CIVIC_API}${route}`, finalUrl: `${GOOGLE_CIVIC_API}${route}`,
      httpStatus: 200, retrievedAt: checkedAt, rawHash },
    normalization: { succeeded: true, parserVersion: GOOGLE_CIVIC_PARSER_VERSION, schemaVersion: "google-civic/1",
      normalizedHash: normalizedHash(projection), normalizedPayloadHash: normalizedHash(normalizedPayload),
      inputRecords: records.length, outputRecords: records.length, droppedRecords: 0, missingRequiredFields: [] },
    identities: records.map(record => ({ subjectId: record.key, jurisdiction: "US", identifiers: { observation_id: record.key }, matchBasis: "EXACT_SCOPED_ID", ambiguous: false })),
    temporal: { version: GOOGLE_CIVIC_ELECTION_DAY, expectedVersion: GOOGLE_CIVIC_ELECTION_DAY, sourceThrough: checkedAt, staleAtRetrieval: false },
    semantics: { factKind: "Google Civic voterinfo observations beside certified election lists; native OCD joins only", violations: [] },
    horizon: { kind: "OPEN_FACT_SET", query: "November 3 voter information by queried address; no national completeness or voter assignment claim", returnedRecords: records.length, declaredTotal: null, paginationComplete: true, claimsComplete: false },
    absence: { claimsAbsence: false, basis: "NONE", exactSubject: null, exactHorizon: null },
    dependentChecks: [{ consumer: "ballot, voting-sites and Ask", passed: true, detail: "Separate attributed observations; unknown joins and publication dates remain explicit." }],
    normalizedPayload, readModel: projection, civicRecords: records,
  };
}
export function failureCandidate(scope: string, reason: string, at: string): RoutineCandidate {
  return failedAcquisitionCandidate({ sourceId: GOOGLE_CIVIC_SOURCE_ID, recordClass: GOOGLE_CIVIC_RECORD_CLASS, scope,
    requestedUrl: `${GOOGLE_CIVIC_API}voterinfo`, attemptedAt: at, failureDetail: reason, parserVersion: GOOGLE_CIVIC_PARSER_VERSION });
}

export function parseFailureCandidate(scope: string, raw: string, reason: string, at: string): RoutineCandidate {
  const base = failureCandidate(scope, reason, at);
  return { ...base, id: `cv-${sha256(`${scope}:${sha256(raw)}:${at}:parse-failure`).slice(0, 32)}`,
    retrieval: { ...base.retrieval, succeeded: true, finalUrl: `${GOOGLE_CIVIC_API}voterinfo`, httpStatus: 200, rawHash: sha256(raw) },
    normalization: { ...base.normalization, normalizedPayloadHash: normalizedHash({ raw }), failureDetail: reason },
    normalizedPayload: { raw } };
}
