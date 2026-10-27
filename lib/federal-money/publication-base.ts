import type {Query} from "../facts/publish.ts";
import type {CivicReadCache} from "../db/civic-read-cache.ts";
import type {RoutinePublicationBase} from "../civic-data/store.ts";
import type {CandidateState,RoutineCandidate,ValidationReceipt} from "../civic-data/types.ts";
import {parseUnchangedConfirmation,UNCHANGED_CONFIRMATION_PREFIX} from "../civic-data/unchanged-confirmation.ts";

interface Header {
  readonly key:string;readonly source_id:string;readonly scope:string;readonly current_version_id:string;readonly last_known_good_version_id:string;
  readonly promoted_at:string|Date;readonly receipt:unknown;readonly candidate:unknown;readonly model:unknown;readonly has_records:boolean;
  readonly state:CandidateState;readonly acquired:boolean;readonly promoted_version:string|null;readonly candidate_lkg:string|null;
  readonly failure_code:string|null;readonly failure_detail:string|null;readonly coupled:boolean;readonly confirmation:string|null;
}
interface NativeRow {readonly key:string;readonly etag:string;readonly value:unknown}

/** One exact base: pointer/GOOD metadata, required evidence, and the government's native rows.
 * The immutable candidate's old identities and before/after delta never cross the connection. */
export async function readFederalMoneyPublicationBase(query:Query,cache:CivicReadCache,scope:string,
  decode:(value:unknown)=>Promise<unknown>):Promise<RoutinePublicationBase> {
  const [value]=await query(`SELECT p.key,p.source_id,p.scope,p.current_version_id,p.last_known_good_version_id,p.promoted_at,
    p.validation_receipt AS receipt,c.state,c.acquisition_succeeded AS acquired,c.promoted_version_id AS promoted_version,
    c.last_known_good_version_id AS candidate_lkg,c.failure_code,c.failure_detail,
    CASE WHEN c.candidate?'bootstrapImport' THEN c.candidate-'readModel'
      ELSE c.candidate-ARRAY['readModel','identities','changeSet','civicRecords'] END AS candidate,
    reader_payload_node(p.payload)-'records' AS model,reader_payload_node(p.payload)?'records' AS has_records,
    (p.payload=c.candidate->'readModel' AND p.validation_receipt=c.validation_receipt
      AND c.normalized_hash=c.candidate#>>'{normalization,normalizedHash}') AS coupled,
    (SELECT e.detail FROM civic_data_candidate_events e WHERE e.candidate_id=p.current_version_id AND left(e.detail,$2)=$3
      ORDER BY e.sequence DESC LIMIT 1) AS confirmation
    FROM civic_data_promotions p LEFT JOIN civic_data_candidates c ON c.id=p.current_version_id
    WHERE p.record_class='FEDERAL_MONEY' AND p.scope=$1`,[scope,UNCHANGED_CONFIRMATION_PREFIX.length,UNCHANGED_CONFIRMATION_PREFIX]);
  if(!value)return {current:null,lkg:null};
  const header=value as unknown as Header;
  if(!header.coupled)throw new Error(`FEDERAL_PUBLICATION_POINTER_PROOF_INVALID:${scope}`);
  const versions=async(keys?:readonly string[])=>{
    const rows=await query(`SELECT row_id AS key,content_hash AS etag FROM civic_data_rows
      WHERE record_class='FEDERAL_MONEY' AND scope=$1 AND version_id=$2 AND collection='federalMoney'
        ${keys?"AND row_id=ANY($3::text[])":""} ORDER BY ordinal`,[scope,header.current_version_id,...(keys?[keys]:[])]);
    return rows as unknown as readonly {key:string;etag:string}[];
  };
  const ordered=header.has_records?await versions():[];
  const records=await cache.rows<NativeRow,{key:string;etag:string}>({namespace:`federal-money-native:${scope}`,keys:ordered.map(row=>row.key),
    versions:keys=>versions(keys),
    values:async keys=>(await query(`SELECT row_id AS key,content_hash AS etag,reader_payload_value(value) AS value FROM civic_data_rows
      WHERE record_class='FEDERAL_MONEY' AND scope=$1 AND version_id=$2 AND collection='federalMoney' AND row_id=ANY($3::text[]) ORDER BY ordinal`,
      [scope,header.current_version_id,keys])) as unknown as readonly NativeRow[],keyOf:row=>row.key,etagOf:row=>row.etag});
  const model=await decode(header.model) as Readonly<Record<string,unknown>>;
  const readModel=header.has_records?{...model,records:records.map(row=>row.value)}:model;
  const candidate={...await decode(header.candidate) as RoutineCandidate,readModel};
  const receipt=await decode(header.receipt) as ValidationReceipt;
  const confirmation=header.confirmation?parseUnchangedConfirmation(header.confirmation):null;
  return {current:{key:header.key,sourceId:header.source_id,recordClass:"FEDERAL_MONEY",scope:header.scope,
    versionId:header.current_version_id,lastKnownGoodVersionId:header.last_known_good_version_id,promotedAt:new Date(header.promoted_at).toISOString(),payload:readModel,receipt,
    ...(confirmation?.versionId===header.current_version_id?{latestConfirmation:confirmation}:{})},
    lkg:{candidate,state:header.state,acquisitionSucceeded:header.acquired,receipt,promotedVersion:header.promoted_version,
      lastKnownGoodVersion:header.candidate_lkg,failureCode:header.failure_code,failureDetail:header.failure_detail}};
}

/** Only the exact native IDs needed to prove a move; no destination fact bodies. */
export interface FederalMoneyPartitionKeys {
  readonly versionId:string;readonly sourceId:string;readonly state:string;
  readonly children:readonly string[];readonly records:readonly {readonly id:string;readonly sourceId:string}[];
}
export async function readFederalMoneyPartitionKeys(query:Query,scope:string,ids:readonly string[]):Promise<FederalMoneyPartitionKeys|null> {
  const [row]=await query(`SELECT p.current_version_id AS "versionId",p.source_id AS "sourceId",
    reader_payload_node(p.payload)->>'state' AS state,
    coalesce(reader_payload_value(reader_payload_node(p.payload)->'children'),'[]'::jsonb) AS children,
    coalesce((SELECT jsonb_agg(jsonb_build_object('id',r.row_id,'sourceId',r.value->>'sourceId') ORDER BY r.ordinal)
      FROM civic_data_rows r WHERE r.promotion_key=p.key AND r.version_id=p.current_version_id AND r.collection='federalMoney'
        AND r.row_id=ANY($2::text[])),'[]'::jsonb) AS records
    FROM civic_data_promotions p WHERE p.record_class='FEDERAL_MONEY' AND p.scope=$1`,[scope,ids]);
  return row as unknown as FederalMoneyPartitionKeys??null;
}

/** A retried edge publication only needs the old affected places, never old native facts. */
export async function readFederalMoneyPriorPlaces(query:Query,candidateId:string):Promise<readonly string[]> {
  const rows=await query(`SELECT DISTINCT place FROM civic_data_candidates c
    CROSS JOIN LATERAL reader_payload_members(reader_payload_node(c.candidate->'readModel')->'records') r
    CROSS JOIN LATERAL (
      SELECT 'body:'||jsonb_array_elements_text(coalesce(reader_payload_value(reader_payload_node(r.item)->'bodyIds'),'[]'::jsonb)) AS place
      UNION ALL SELECT 'division:'||jsonb_array_elements_text(coalesce(reader_payload_value(reader_payload_node(r.item)->'divisionIds'),'[]'::jsonb)) AS place
    ) places WHERE c.id=$1 AND c.record_class='FEDERAL_MONEY' ORDER BY place`,[candidateId]);
  return rows.map(row=>String(row.place));
}
