import type {Query} from "../facts/publish.ts";
import type {RegistryPlanningView} from "./keyed-registry-planning.ts";
import {keyedSourceInput} from "./keyed-government-lookup.ts";
import {requireRegistryState,stateRegistryRuntimeScope} from "./state-scopes.ts";

/** The selected place's held subjects, not a complete registry successor. */
export interface RegistryPlaceSlice {readonly versionId:string;readonly payload:RegistryPlanningView}

export function selectRegistryPlaceView(value:RegistryPlanningView,divisionIds:readonly string[]):RegistryPlanningView{
  const ids=new Set(divisionIds),bodies=value.registry.bodies.filter(body=>[body.ocdId,...body.alsoServesOcdIds??[]].some(id=>id!==null&&ids.has(id)));
  const bodyIds=new Set(bodies.map(body=>body.id)),bodyRosters=(value.bodyRosters??[]).filter(roster=>bodyIds.has(roster.bodyId));
  const members=new Set(bodyRosters.flatMap(roster=>roster.members.map(member=>member.id)));
  return {registry:{...value.registry,bodies,divisions:value.registry.divisions.filter(division=>ids.has(division.ocdId))},bodyRosters,
    rosterReaderDispositions:(value.rosterReaderDispositions??[]).filter(row=>members.has(row.sourceId)||typeof row.canonicalId==="string"&&members.has(row.canonicalId)),
    statewideExecutives:(value.statewideExecutives??[]).filter(row=>ids.has(row.stateOcdId)),
    officialCandidacies:{...value.officialCandidacies,rows:(value.officialCandidacies?.rows??[]).filter(row=>row.holder.divisions.some(id=>ids.has(id)))}};
}

/** One statement binds the named divisions and their held rows to the same source pointer. */
export async function readRegistryPlaceRows(query:Query,state:string,divisionIds:readonly string[]):Promise<RegistryPlaceSlice|null>{
  const scope=stateRegistryRuntimeScope(requireRegistryState(state));
  const result=await query(`WITH pointer AS MATERIALIZED (
    SELECT p.key,p.scope,p.current_version_id AS version_id,p.promoted_at,c.normalized_hash,reader_payload_node(p.payload) AS root,
      (p.current_version_id=p.last_known_good_version_id AND c.state='PROMOTED' AND c.acquisition_succeeded
       AND c.promoted_version_id=c.id AND c.last_known_good_version_id=c.id AND c.source_id=p.source_id
       AND c.record_class=p.record_class AND c.scope=p.scope AND c.candidate->'readModel'=p.payload
       AND c.validation_receipt=p.validation_receipt AND p.validation_receipt->>'decision'='GOOD'
       AND c.candidate#>>'{normalization,normalizedHash}'=c.normalized_hash) AS valid
    FROM civic_data_promotions p LEFT JOIN civic_data_candidates c ON c.id=p.current_version_id WHERE p.key=$1
  ), bodies AS MATERIALIZED (
    SELECT r.ordinal,r.row_id,r.value FROM pointer p JOIN civic_data_rows r ON r.promotion_key=p.key AND r.version_id=p.version_id
    WHERE p.valid AND r.collection='registry.bodies' AND (r.value->>'ocdId'=ANY($2::text[])
      OR coalesce(reader_payload_value(r.value->'alsoServesOcdIds'),'[]'::jsonb) ?| $2::text[])
  ), rosters AS MATERIALIZED (
    SELECT r.ordinal,r.row_id,r.value FROM pointer p JOIN civic_data_rows r ON r.promotion_key=p.key AND r.version_id=p.version_id
    WHERE p.valid AND r.collection='bodyRosters' AND r.row_id IN (SELECT row_id FROM bodies)
  ), members AS MATERIALIZED (
    SELECT reader_payload_node(m.item)->>'id' AS id FROM rosters r,LATERAL reader_payload_members(r.value->'members') m
  ), rows AS (
    SELECT 'registry.bodies'::text AS collection,ordinal,row_id,value FROM bodies
    UNION ALL SELECT 'bodyRosters',ordinal,row_id,value FROM rosters
    UNION ALL SELECT r.collection,r.ordinal,r.row_id,r.value FROM pointer p JOIN civic_data_rows r ON r.promotion_key=p.key AND r.version_id=p.version_id
      WHERE p.valid AND (r.collection='registry.divisions' AND r.row_id=ANY($2::text[])
        OR r.collection='registry.executives' AND r.value->>'stateOcdId'=ANY($2::text[])
        OR r.collection='registry.candidacies' AND coalesce(reader_payload_value(reader_payload_node(r.value->'holder')->'divisions'),'[]'::jsonb) ?| $2::text[]
        OR r.collection='registry.rosterDispositions' AND (r.row_id IN (SELECT id FROM members) OR r.value->>'canonicalId' IN (SELECT id FROM members)))
  ), selected AS (
    SELECT 'metadata'::text AS kind,p.scope,p.version_id,p.promoted_at,p.normalized_hash,p.valid,NULL::text AS row_id,
      jsonb_build_object('generatedAt',reader_payload_node(p.root->'registry')->'generatedAt',
        'bridge',reader_payload_value(reader_payload_node(p.root->'officialCandidacies')-'rows')) AS value,0 AS sort_group,0::bigint AS sort_ordinal FROM pointer p
    UNION ALL SELECT r.collection,NULL,NULL,NULL,NULL,NULL,r.row_id,reader_payload_value(r.value),1,r.ordinal FROM rows r
  ) SELECT kind,scope,version_id,promoted_at,normalized_hash,valid,row_id,value FROM selected ORDER BY sort_group,kind,sort_ordinal`,
  [`REGISTRY_RUNTIME_BINDING:${scope}`,[...new Set(divisionIds)]]);
  const metadata=result.find(row=>row.kind==="metadata");
  if(!metadata)return null;
  const input=keyedSourceInput(metadata,"REGISTRY_RUNTIME_BINDING"),header=metadata.value as {generatedAt:string;bridge:RegistryPlanningView["officialCandidacies"]};
  const values=(kind:string)=>result.filter(row=>row.kind===kind).map(row=>row.value);
  return {versionId:input.versionId,payload:{registry:{generatedAt:header.generatedAt,bodies:values("registry.bodies"),divisions:values("registry.divisions")},
    bodyRosters:values("bodyRosters"),rosterReaderDispositions:values("registry.rosterDispositions"),statewideExecutives:values("registry.executives"),
    officialCandidacies:{...header.bridge,rows:values("registry.candidacies")}} as RegistryPlanningView};
}
