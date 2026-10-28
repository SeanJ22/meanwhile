import type { Query } from "../facts/publish.ts";
import { registrationTarget } from "../registration/publication.ts";
import type { RegistrationReadModel } from "../registration/candidate.ts";
import type { RegistryRuntimeReadModel } from "../registry/runtime-data-plane.ts";
import type { DerivedInputRef } from "./derived-authority.ts";
import type { DerivedWiringProjection } from "./derived-meeting-wiring.ts";
import { requireRegistryState, stateRegistryRuntimeScope } from "./state-scopes.ts";

export interface GovernmentRowLookup {
  readonly registration: { readonly input: Extract<DerivedInputRef,{kind:"PROMOTED_VERSION"}>;
    readonly value: Pick<RegistrationReadModel,"vintage"|"bodies"|"divisions"|"governments"> } | null;
  readonly reviewed: { readonly input: Extract<DerivedInputRef,{kind:"PROMOTED_VERSION"}>;
    readonly bodies: RegistryRuntimeReadModel["registry"]["bodies"] } | null;
}

/** A provenance reference describes the complete immutable version; the returned values are explicitly selected rows. */
export function keyedSourceInput(row: Record<string,unknown>,recordClass:string): Extract<DerivedInputRef,{kind:"PROMOTED_VERSION"}> {
  if(row.valid!==true || typeof row.version_id!=="string" || typeof row.scope!=="string" ||
    typeof row.normalized_hash!=="string" || !/^[a-f0-9]{64}$/.test(row.normalized_hash))throw new Error(`KEYED_SOURCE_POINTER_INVALID:${recordClass}:${row.scope}`);
  return {kind:"PROMOTED_VERSION",recordClass,scope:row.scope,versionId:row.version_id,readModelSha256:row.normalized_hash,
    promotedAt:new Date(row.promoted_at as string).toISOString()};
}

const pointer=`SELECT p.key,p.scope,p.current_version_id AS version_id,p.promoted_at,c.normalized_hash,
  reader_payload_node(p.payload) AS header,
  (p.current_version_id=p.last_known_good_version_id AND c.state='PROMOTED' AND c.acquisition_succeeded
   AND c.promoted_version_id=c.id AND c.last_known_good_version_id=c.id AND c.source_id=p.source_id
   AND c.record_class=p.record_class AND c.scope=p.scope AND (p.current_version_id=c.id AND p.payload_fingerprint IS NOT DISTINCT FROM c.read_model_fingerprint)
   AND c.validation_receipt=p.validation_receipt AND p.validation_receipt->>'decision'='GOOD'
   AND c.candidate#>>'{normalization,normalizedHash}'=c.normalized_hash) AS valid
 FROM civic_data_promotions p LEFT JOIN civic_data_candidates c ON c.id=p.current_version_id WHERE p.key=$1`;

/** Known government aliases and Census identities select all exact matches, retaining ambiguity for the resolver. */
export async function readKeyedGovernmentLookup(query:Query,state:string,governmentIds:readonly string[],censusIds:readonly string[],bodyIds:readonly string[]=[],divisionIds:readonly string[]=[]):Promise<GovernmentRowLookup>{
  const postal=requireRegistryState(state),registrationScope=registrationTarget(postal).scope,registryScope=stateRegistryRuntimeScope(postal);
  const [registered,reviewed]=await Promise.all([
    query(`WITH pointer AS MATERIALIZED (${pointer}), selected_bodies AS MATERIALIZED (
      SELECT r.ordinal,r.value FROM pointer p JOIN civic_data_rows r ON r.promotion_key=p.key AND r.version_id=p.version_id
      WHERE p.valid AND r.collection='registration.bodies' AND (r.aliases && $2::text[] OR r.row_id=ANY($3::text[]))
    ), selected_governments AS MATERIALIZED (
      SELECT r.ordinal,r.value FROM pointer p JOIN civic_data_rows r ON r.promotion_key=p.key AND r.version_id=p.version_id
      WHERE p.valid AND r.collection='governments' AND (r.aliases && $2::text[] OR r.aliases && $3::text[])
    ) SELECT p.key,p.scope,p.version_id,p.promoted_at,p.normalized_hash,p.valid,reader_payload_value(p.header->'vintage') AS vintage,
      coalesce((SELECT jsonb_agg(reader_payload_value(value) ORDER BY ordinal) FROM selected_bodies),'[]'::jsonb) AS bodies,
      coalesce((SELECT jsonb_agg(reader_payload_value(value) ORDER BY ordinal) FROM selected_governments),'[]'::jsonb) AS governments,
      coalesce((SELECT jsonb_agg(reader_payload_value(r.value) ORDER BY r.ordinal) FROM civic_data_rows r
        WHERE r.promotion_key=p.key AND r.version_id=p.version_id AND r.collection='registration.divisions'
          AND r.row_id=ANY($4::text[]||ARRAY(SELECT value->>'ocdId' FROM selected_bodies WHERE value->>'ocdId' IS NOT NULL)
            ||ARRAY(SELECT reader_payload_node(a.item)->>'divisionId' FROM selected_governments g,LATERAL reader_payload_members(g.value->'associations') a))),'[]'::jsonb) AS divisions
      FROM pointer p`,[`REGISTRATION:${registrationScope}`,[...new Set(governmentIds)],[...new Set(bodyIds)],[...new Set(divisionIds)]]),
    query(`WITH pointer AS MATERIALIZED (${pointer}) SELECT p.key,p.scope,p.version_id,p.promoted_at,p.normalized_hash,p.valid,
      coalesce((SELECT jsonb_agg(reader_payload_value(r.value) ORDER BY r.ordinal) FROM civic_data_rows r
        WHERE p.valid AND r.promotion_key=p.key AND r.version_id=p.version_id AND r.collection='registry.bodies'
          AND (r.row_id=ANY($2::text[]) OR r.value->>'censusId'=ANY($3::text[]))),'[]'::jsonb) AS bodies
      FROM pointer p`,[`REGISTRY_RUNTIME_BINDING:${registryScope}`,[...new Set(bodyIds)],[...new Set(censusIds)]])
  ]);
  const registration=registered[0],registry=reviewed[0];
  return {registration:registration?{input:keyedSourceInput(registration,"REGISTRATION"),value:{vintage:registration.vintage as RegistrationReadModel["vintage"],
    bodies:registration.bodies as RegistrationReadModel["bodies"],divisions:registration.divisions as RegistrationReadModel["divisions"],governments:registration.governments as RegistrationReadModel["governments"]}}:null,
    reviewed:registry?{input:keyedSourceInput(registry,"REGISTRY_RUNTIME_BINDING"),bodies:registry.bodies as RegistryRuntimeReadModel["registry"]["bodies"]}:null};
}

export interface RegistrationOwnershipRows {
  readonly bodies:readonly {readonly id:string;readonly jurisdictionId:string|null}[];
  readonly vintage:{readonly referenceSha256:string};
}

/** Ownership enumerates body identities, never a government's contact/source inventories or the reviewed rosters. */
export async function readOwnershipLookup(query:Query,state:string):Promise<{registration:RegistrationOwnershipRows|null;reviewedIds:readonly string[]|null}>{
  const postal=requireRegistryState(state);
  const [registered,reviewed]=await Promise.all([
    query(`WITH pointer AS MATERIALIZED (${pointer}) SELECT p.scope,p.version_id,p.promoted_at,p.normalized_hash,p.valid,
      reader_payload_node(p.header->'vintage')->>'referenceSha256' AS reference_sha,
      coalesce((SELECT jsonb_agg(jsonb_build_object('id',r.row_id,'jurisdictionId',r.value->'jurisdictionId') ORDER BY r.ordinal)
        FROM civic_data_rows r WHERE p.valid AND r.promotion_key=p.key AND r.version_id=p.version_id AND r.collection='registration.bodies'),'[]'::jsonb) AS bodies
      FROM pointer p`,[`REGISTRATION:${registrationTarget(postal).scope}`]),
    query(`WITH pointer AS MATERIALIZED (${pointer}) SELECT p.scope,p.version_id,p.promoted_at,p.normalized_hash,p.valid,
      coalesce((SELECT jsonb_agg(r.row_id ORDER BY r.ordinal) FROM civic_data_rows r
        WHERE p.valid AND r.promotion_key=p.key AND r.version_id=p.version_id AND r.collection='registry.bodies'),'[]'::jsonb) AS ids
      FROM pointer p`,[`REGISTRY_RUNTIME_BINDING:${stateRegistryRuntimeScope(postal)}`])
  ]);
  if(registered[0])keyedSourceInput(registered[0],"REGISTRATION");
  if(reviewed[0])keyedSourceInput(reviewed[0],"REGISTRY_RUNTIME_BINDING");
  return {registration:registered[0]?{bodies:registered[0].bodies as RegistrationOwnershipRows["bodies"],vintage:{referenceSha256:String(registered[0].reference_sha)}}:null,
    reviewedIds:reviewed[0]?reviewed[0].ids as string[]:null};
}

export async function readOwnershipWiring(query:Query):Promise<{kind:string;value:{records:readonly {row:{state:string;bodyId:string;jurisdictionId:string}}[]}|null}>{
  const rows=await query(`WITH pointer AS MATERIALIZED (${pointer}), selected AS (
      SELECT 'metadata'::text AS kind,p.scope,p.version_id,p.promoted_at,p.normalized_hash,p.valid,NULL::jsonb AS value,0::bigint AS ordinal FROM pointer p
      UNION ALL SELECT 'row',NULL,NULL,NULL,NULL,NULL,jsonb_build_object('state',reader_payload_node(r.value->'row')->'state',
        'bodyId',reader_payload_node(r.value->'row')->'bodyId','jurisdictionId',reader_payload_node(r.value->'row')->'jurisdictionId'),r.ordinal
      FROM pointer p JOIN civic_data_rows r ON r.promotion_key=p.key AND r.version_id=p.version_id WHERE p.valid AND r.collection='derivedWiring'
    ) SELECT kind,scope,version_id,promoted_at,normalized_hash,valid,value FROM selected ORDER BY ordinal`,["CURATED_READER_RECORD:US:meeting-source-wiring"]);
  const metadata=rows.find(row=>row.kind==="metadata");
  if(!metadata)return {kind:"NOT_RECORDED",value:null};
  keyedSourceInput(metadata,"CURATED_READER_RECORD");
  return {kind:"PROMOTED",value:{records:rows.filter(row=>row.kind==="row").map(row=>({row:row.value as {state:string;bodyId:string;jurisdictionId:string}}))}};
}

/** A changed meeting family needs its state's exact routes plus the immutable whole-wiring input reference. */
export async function readStateWiringRows(query:Query,state:string,bodyIds:readonly string[]=[]):Promise<{
  readonly input:Extract<DerivedInputRef,{kind:"PROMOTED_VERSION"}>;readonly value:DerivedWiringProjection;
}|null>{
  const postal=requireRegistryState(state.replace(/^US-/i,""));
  const rows=await query(`WITH pointer AS MATERIALIZED (${pointer}), selected AS (
    SELECT 'metadata'::text AS kind,p.scope,p.version_id,p.promoted_at,p.normalized_hash,p.valid,NULL::text AS row_id,
      jsonb_build_object('kind',p.header->'kind','formatVersion',p.header->'formatVersion') AS value,0 AS sort_group,0::bigint AS ordinal FROM pointer p
    UNION ALL SELECT 'row',NULL,NULL,NULL,NULL,NULL,r.row_id,reader_payload_value(r.value),1,r.ordinal
      FROM pointer p JOIN civic_data_rows r ON r.promotion_key=p.key AND r.version_id=p.version_id
      WHERE p.valid AND r.collection='derivedWiring' AND r.state=$2 AND (cardinality($3::text[])=0 OR r.body_id=ANY($3::text[]))
    ) SELECT kind,scope,version_id,promoted_at,normalized_hash,valid,row_id,value FROM selected ORDER BY sort_group,ordinal`,
    ["CURATED_READER_RECORD:US:meeting-source-wiring",postal,[...new Set(bodyIds)]]);
  const metadata=rows.find(row=>row.kind==="metadata");
  if(!metadata)return null;
  const input=keyedSourceInput(metadata,"CURATED_READER_RECORD"),header=metadata.value as Pick<DerivedWiringProjection,"kind"|"formatVersion">;
  if(header.kind!=="meeting-source-wiring"||header.formatVersion!==1)throw new Error("KEYED_WIRING_PROJECTION_INVALID");
  return {input,value:{...header,records:rows.filter(row=>row.kind==="row").map(row=>row.value as DerivedWiringProjection["records"][number])}};
}

/** Routing identities only; source/wiring records wait until a body's new bytes differ. */
export async function readStateWiringBodyIds(query:Query,state:string):Promise<readonly string[]>{
  const postal=requireRegistryState(state.replace(/^US-/i,""));
  const rows=await query(`WITH pointer AS MATERIALIZED (${pointer}) SELECT p.scope,p.version_id,p.promoted_at,p.normalized_hash,p.valid,
    coalesce((SELECT jsonb_agg(DISTINCT r.body_id ORDER BY r.body_id) FROM civic_data_rows r WHERE p.valid AND r.promotion_key=p.key AND r.version_id=p.version_id
      AND r.collection='derivedWiring' AND r.state=$2 AND r.body_id IS NOT NULL),'[]'::jsonb) AS body_ids FROM pointer p`,
    ["CURATED_READER_RECORD:US:meeting-source-wiring",postal]);
  if(!rows[0])return [];
  keyedSourceInput(rows[0],"CURATED_READER_RECORD");
  return rows[0].body_ids as string[];
}
