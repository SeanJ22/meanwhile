import { normalizedHash, sha256, failedAcquisitionCandidate } from "../../civic-data/candidate-builders.ts";
import { civicRecordsFor } from "../../civic-data/changes.ts";
import { sourceProjectionEvidence, type RoutineCandidate } from "../../civic-data/types.ts";
import { GOOGLE_CIVIC_API, GOOGLE_CIVIC_PARSER_VERSION, GOOGLE_CIVIC_RECORD_CLASS, GOOGLE_CIVIC_SOURCE_ID, GOOGLE_CIVIC_ELECTION_DAY } from "./targets.ts";
import { assertCivicProjection, civicElectionRows, type CivicProjection } from "./model.ts";
import type { EvidenceStore } from "../../control-plane/evidence/store.ts";
import { holdRawCapture } from "../../civic-data/raw-capture-vault.ts";

export async function civicCandidate(vault: EvidenceStore, scope: string, projection: CivicProjection, raw: string, route: "elections" | "voterinfo"): Promise<RoutineCandidate> {
  if (route === "voterinfo" || projection.kind === "LOOKUP") throw new Error("Google voting answers are transient and cannot be published or saved.");
  assertCivicProjection(projection);
  const checkedAt = projection.checkedAt;
  const joined = new Set(projection.rows.flatMap(row => row.joinedDivisionId ?? []));
  const sourceRows = civicElectionRows(raw, checkedAt, joined);
  if (normalizedHash(sourceRows) !== normalizedHash(projection.rows)) throw new Error("Google Civic facts differ from the saved source response.");
  const records = civicRecordsFor(GOOGLE_CIVIC_RECORD_CLASS, projection);
  // Saved public-source evidence only; transient reader lookups never enter publication.
  const rawCapture = await holdRawCapture(vault, GOOGLE_CIVIC_SOURCE_ID, raw, "application/json");
  const normalizedPayload = { projection, rawCapture };
  const rawHash = sha256(rawCapture.rawHash);
  return {
    id: `cv-${sha256(`${scope}:${rawHash}:${checkedAt}:${normalizedHash(projection)}`).slice(0, 32)}`,
    sourceId: GOOGLE_CIVIC_SOURCE_ID, recordClass: GOOGLE_CIVIC_RECORD_CLASS, scope,
    sourceProjectionEvidence: sourceProjectionEvidence(GOOGLE_CIVIC_SOURCE_ID, GOOGLE_CIVIC_RECORD_CLASS, scope),
    retrieval: { succeeded: true, requestedUrl: `${GOOGLE_CIVIC_API}${route}`, finalUrl: `${GOOGLE_CIVIC_API}${route}`,
      httpStatus: 200, retrievedAt: checkedAt, rawHash },
    normalization: { succeeded: true, parserVersion: GOOGLE_CIVIC_PARSER_VERSION, schemaVersion: "google-civic/1",
      normalizedHash: normalizedHash(projection), normalizedPayloadHash: normalizedHash(normalizedPayload),
      inputRecords: records.length, outputRecords: records.length, droppedRecords: 0, missingRequiredFields: [] },
    identities: records.map(record => ({ subjectId: record.key, jurisdiction: "US", identifiers: { observation_id: record.key }, matchBasis: "EXACT_SCOPED_ID", ambiguous: false })),
    temporal: { version: GOOGLE_CIVIC_ELECTION_DAY, expectedVersion: GOOGLE_CIVIC_ELECTION_DAY, sourceThrough: checkedAt, staleAtRetrieval: false },
    semantics: { factKind: "Google Civic voterinfo observations beside certified election lists; native OCD joins only", violations: [] },
    horizon: { kind: "OPEN_FACT_SET", query: "November 3 voter information by queried address; no national completeness or voter assignment claim", returnedRecords: records.length, declaredTotal: null, paginationComplete: true, claimsComplete: false },
    absence: { claimsAbsence: false, basis: "NONE", exactSubject: null, exactHorizon: null },
    dependentChecks: [{ consumer: "elections catalog and Admin", passed: true, detail: "Separate attributed observations; unknown joins and publication dates remain explicit." }],
    normalizedPayload, readModel: projection, civicRecords: records,
  };
}
export function failureCandidate(scope: string, reason: string, at: string): RoutineCandidate {
  return failedAcquisitionCandidate({ sourceId: GOOGLE_CIVIC_SOURCE_ID, recordClass: GOOGLE_CIVIC_RECORD_CLASS, scope,
    requestedUrl: `${GOOGLE_CIVIC_API}voterinfo`, attemptedAt: at, failureDetail: reason, parserVersion: GOOGLE_CIVIC_PARSER_VERSION });
}
