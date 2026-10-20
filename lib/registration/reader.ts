/**
 * One state's registration, read from its promoted pointer. The promotion engine's verifier and the
 * reader composition both read through it. There is no bootstrap: a state with no promoted registration
 * answers NOT_RECORDED, named as not registered yet, never as a state with no governments.
 */
import { readPromotedCivicData, type CivicDataReadResult, type PromotedCivicDataReadOptions } from "../civic-data/read-model.ts";
import type { RegistrationReadModel } from "./candidate.ts";
import { REGISTRATION_RECORD_CLASS, registrationTarget } from "./publication.ts";
import { readerDatabaseQuery } from "../reader/database.ts";
import { currentRegistrationsEdge, refuseDatabaseInEdgeOnlyContext } from "../registry/runtime-edge.ts";
import type { Division } from "../registry/types.ts";

export type DivisionMetadata = Pick<Division, "ocdId" | "label" | "divisionType" | "tier">;

/** An exact label lookup must not walk governments, linked records or geometry. */
export async function readRegistrationDivision(state: string, ocdId: string): Promise<DivisionMetadata | undefined> {
  const served = await currentRegistrationsEdge()?.load(state.toLowerCase()).catch(() => null);
  if (served) return served.value?.divisions.find(row => row.ocdId === ocdId);
  refuseDatabaseInEdgeOnlyContext(`The ${state} registration`);
  const query = readerDatabaseQuery(1800);
  if (!query) return undefined;
  const [[row]] = await query([{ text: `WITH pointer AS MATERIALIZED (
    SELECT p.payload,
      (p.current_version_id=p.last_known_good_version_id AND c.state='PROMOTED' AND c.acquisition_succeeded
       AND c.promoted_version_id=c.id AND c.last_known_good_version_id=c.id AND c.record_class=p.record_class AND c.scope=p.scope AND c.source_id=p.source_id
       AND p.validation_receipt->>'decision'='GOOD' AND p.validation_receipt->>'candidateId'=c.id AND p.validation_receipt->>'sourceId'=c.source_id
       AND p.validation_receipt->>'recordClass'=p.record_class AND p.validation_receipt->>'scope'=p.scope) AS published
    FROM civic_data_promotions p LEFT JOIN civic_data_candidates c ON c.id=p.current_version_id WHERE p.key=$1
  ) SELECT published, CASE WHEN published THEN (
    SELECT jsonb_build_object('ocdId',header.value->'ocdId','label',reader_payload_value(header.value->'label'),
      'divisionType',header.value->'divisionType','tier',header.value->'tier')
    FROM reader_payload_members(reader_payload_node(payload)->'divisions') d,
      LATERAL (SELECT reader_payload_node(d.item) AS value) header
    WHERE header.value->>'ocdId'=$2 LIMIT 1
  ) END AS division FROM pointer`, params: [`REGISTRATION:${registrationTarget(state).scope}`, ocdId] }]);
  if (!row) return undefined;
  if (row.published !== true) throw new Error("READER_PUBLISHED_POINTER_INVALID");
  return row.division as DivisionMetadata | undefined ?? undefined;
}

/** Registration is reference data on a Census vintage: a promoted state never goes stale on a clock. */
const REGISTRATION_MAX_AGE_MS = 100 * 365 * 24 * 60 * 60 * 1000;

export async function readRegistrationProjection(
  state: string,
  options: PromotedCivicDataReadOptions = {},
): Promise<CivicDataReadResult<RegistrationReadModel>> {
  const target = registrationTarget(state);
  return readPromotedCivicData<RegistrationReadModel>(REGISTRATION_RECORD_CLASS, target.scope, {
    ...options,
    maxAgeMs: options.maxAgeMs ?? REGISTRATION_MAX_AGE_MS,
  });
}
