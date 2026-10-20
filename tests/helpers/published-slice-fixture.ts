import type { PGlite } from "@electric-sql/pglite";
import { canonicalCivicDataHash } from "../../lib/civic-data/canonical-hash.ts";
import { projectionKey } from "../../lib/civic-data/projection-key.ts";
import { VALIDATION_CHECKS, type RoutineCandidate, type RoutineRecordClass, type ValidationReceipt } from "../../lib/civic-data/types.ts";

export const PUBLISHED_SLICE_FIXTURE_SCHEMA = `CREATE TABLE civic_data_promotions(key text PRIMARY KEY,record_class text,scope text,source_id text,current_version_id text,
  last_known_good_version_id text,promoted_at timestamptz,validation_receipt jsonb,payload jsonb);
  CREATE TABLE civic_data_candidates(id text PRIMARY KEY,normalized_hash text,retrieved_at timestamptz,state text,acquisition_succeeded boolean,
  promoted_version_id text,last_known_good_version_id text,record_class text,scope text,source_id text,candidate jsonb,validation_receipt jsonb);
  CREATE TABLE civic_data_payload_parts(hash text PRIMARY KEY,payload jsonb)`;

/** The same immutable candidate, GOOD receipt and current/LKG identities as a real publication. */
export async function insertPublishedSliceFixture(pg: PGlite, input: {
  readonly id: string; readonly sourceId: string; readonly recordClass: RoutineRecordClass; readonly scope: string;
  readonly readModel: unknown; readonly storedReadModel?: unknown; readonly at: string;
  readonly normalizedPayload?: unknown; readonly storedNormalizedPayload?: unknown;
  readonly sourceVersion?: string; readonly finalUrl?: string;
}): Promise<void> {
  const hash = canonicalCivicDataHash(input.readModel), stored = input.storedReadModel ?? input.readModel;
  const url = input.finalUrl ?? "https://example.gov/source";
  const candidate: RoutineCandidate = {
    id: input.id, sourceId: input.sourceId, recordClass: input.recordClass, scope: input.scope,
    retrieval: {succeeded: true, requestedUrl: url, finalUrl: url, httpStatus: 200, retrievedAt: input.at, rawHash: hash},
    normalization: {succeeded: true, parserVersion: "fixture/1", schemaVersion: "fixture/1", normalizedHash: hash,
      normalizedPayloadHash: canonicalCivicDataHash(input.normalizedPayload ?? input.readModel), inputRecords: 1, outputRecords: 1, droppedRecords: 0, missingRequiredFields: []},
    identities: [], temporal: {version: input.sourceVersion ?? input.at, sourceThrough: input.at, expectedVersion: input.sourceVersion ?? input.at, staleAtRetrieval: false},
    semantics: {factKind: "fixture", violations: []},
    horizon: {kind: "OPEN_FACT_SET", query: "fixture", returnedRecords: 1, declaredTotal: null, paginationComplete: true, claimsComplete: false},
    absence: {claimsAbsence: false, basis: "NONE", exactSubject: null, exactHorizon: null},
    sourceProjectionEvidence: {kind: "SOURCE_PROJECTION_CONTRACT", sourceId: input.sourceId, recordClass: input.recordClass, scope: input.scope},
    dependentChecks: [], normalizedPayload: input.storedNormalizedPayload ?? input.normalizedPayload ?? stored, readModel: stored,
  };
  const receipt: ValidationReceipt = {contractVersion: 2, decision: "GOOD", candidateId: input.id, sourceId: input.sourceId,
    recordClass: input.recordClass, scope: input.scope, validatedAt: input.at, excludedFacts: [],
    checks: VALIDATION_CHECKS.map(check => ({check, verdict: "PASS", code: "FIXTURE_VALID", detail: "The publication fixture contains the validated source value."}))};
  await pg.query("INSERT INTO civic_data_candidates VALUES($1,$2,$3,'PROMOTED',true,$1,$1,$4,$5,$6,$7,$8)",
    [input.id, hash, input.at, input.recordClass, input.scope, input.sourceId, JSON.stringify(candidate), JSON.stringify(receipt)]);
  await pg.query(`INSERT INTO civic_data_promotions VALUES($1,$2,$3,$4,$5,$5,$6,$7,$8)
    ON CONFLICT(key) DO UPDATE SET current_version_id=$5,last_known_good_version_id=$5,promoted_at=$6,validation_receipt=$7,payload=$8`,
    [projectionKey(input.recordClass, input.scope), input.recordClass, input.scope, input.sourceId, input.id, input.at, JSON.stringify(receipt), JSON.stringify(stored)]);
}
