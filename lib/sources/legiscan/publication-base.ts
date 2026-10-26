import type { Query } from "../../facts/publish.ts";
import type { RoutinePublicationBase } from "../../civic-data/store.ts";
import type { CandidateState, RoutineCandidate, ValidationReceipt } from "../../civic-data/types.ts";
import { parseUnchangedConfirmation, UNCHANGED_CONFIRMATION_PREFIX } from "../../civic-data/unchanged-confirmation.ts";

/** Read one exact changed session/base, without its obsolete identity and before/after lists. */
export async function readLegiscanPublicationBase(query:Query,scope:string,decode:(value:unknown)=>Promise<unknown>):Promise<RoutinePublicationBase>{
  const [row]=await query(`SELECT p.key,p.source_id,p.scope,p.current_version_id,p.last_known_good_version_id,p.promoted_at,
    p.validation_receipt AS receipt,c.state,c.acquisition_succeeded,c.promoted_version_id,c.last_known_good_version_id AS candidate_lkg,
    c.failure_code,c.failure_detail,c.candidate-ARRAY['identities','changeSet','civicRecords'] AS candidate,
    (p.payload=c.candidate->'readModel' AND p.validation_receipt=c.validation_receipt
      AND c.normalized_hash=c.candidate#>>'{normalization,normalizedHash}') AS coupled,
    (SELECT e.detail FROM civic_data_candidate_events e WHERE e.candidate_id=p.current_version_id AND left(e.detail,$2)=$3
      ORDER BY e.sequence DESC LIMIT 1) AS confirmation
    FROM civic_data_promotions p LEFT JOIN civic_data_candidates c ON c.id=p.current_version_id
    WHERE p.record_class='STATE_BILL' AND p.scope=$1`,[scope,UNCHANGED_CONFIRMATION_PREFIX.length,UNCHANGED_CONFIRMATION_PREFIX]);
  if(!row)return{current:null,lkg:null};
  if(!row.coupled)throw Error(`LEGISCAN_PUBLICATION_POINTER_PROOF_INVALID:${scope}`);
  const candidate=await decode(row.candidate) as RoutineCandidate,receipt=await decode(row.receipt) as ValidationReceipt;
  const confirmation=typeof row.confirmation==="string"?parseUnchangedConfirmation(row.confirmation):null;
  return{current:{key:String(row.key),sourceId:String(row.source_id),recordClass:"STATE_BILL",scope,
    versionId:String(row.current_version_id),lastKnownGoodVersionId:String(row.last_known_good_version_id),
    promotedAt:new Date(row.promoted_at as string|Date).toISOString(),payload:candidate.readModel,receipt,
    ...(confirmation?.versionId===row.current_version_id?{latestConfirmation:confirmation}:{})},
    lkg:{candidate,state:row.state as CandidateState,acquisitionSucceeded:row.acquisition_succeeded===true,receipt,
      promotedVersion:row.promoted_version_id as string|null,lastKnownGoodVersion:row.candidate_lkg as string|null,
      failureCode:row.failure_code as string|null,failureDetail:row.failure_detail as string|null}};
}
