import type { Query } from "../facts/publish.ts";
import type { RegistryRuntimeReadModel } from "../registry/runtime-data-plane.ts";
import { requireRegistryState,stateRegistryRuntimeScope } from "./state-scopes.ts";
import { keyedSourceInput } from "./keyed-government-lookup.ts";

/** Every source field used to enumerate held subjects; reader portraits and unrelated publication payloads are absent. */
export type RegistryPlanningView=Pick<RegistryRuntimeReadModel,"registry"|"bodyRosters"|"rosterReaderDispositions"|"statewideExecutives"|"officialCandidacies">;

export async function readRegistryPlanningRows(query:Query,state:string):Promise<RegistryPlanningView|null>{
  const scope=stateRegistryRuntimeScope(requireRegistryState(state));
  const result=await query(`WITH pointer AS MATERIALIZED (
    SELECT p.key,p.scope,p.current_version_id AS version_id,p.promoted_at,c.normalized_hash,reader_payload_node(p.payload) AS root,
      (p.current_version_id=p.last_known_good_version_id AND c.state='PROMOTED' AND c.acquisition_succeeded
       AND c.promoted_version_id=c.id AND c.last_known_good_version_id=c.id AND c.source_id=p.source_id
       AND c.record_class=p.record_class AND c.scope=p.scope AND (p.current_version_id=c.id AND p.payload_fingerprint IS NOT DISTINCT FROM c.read_model_fingerprint)
       AND c.validation_receipt=p.validation_receipt AND p.validation_receipt->>'decision'='GOOD'
       AND (c.read_model_fingerprint IS NULL OR c.read_model_fingerprint=c.normalized_hash)) AS valid
    FROM civic_data_promotions p LEFT JOIN civic_data_candidates c ON c.id=p.current_version_id WHERE p.key=$1
  ), rows AS MATERIALIZED (
    SELECT r.collection,r.ordinal,r.row_id,r.value FROM pointer p JOIN civic_data_rows r ON r.promotion_key=p.key AND r.version_id=p.version_id
    WHERE p.valid AND r.collection=ANY(ARRAY['registry.bodies','registry.divisions','bodyRosters','registry.executives','registry.candidacies','registry.rosterDispositions'])
  ), selected AS (
    SELECT 'metadata'::text AS kind,p.scope,p.version_id,p.promoted_at,p.normalized_hash,p.valid,NULL::text AS row_id,
      jsonb_build_object('generatedAt',reader_payload_node(p.root->'registry')->'generatedAt','bridge',reader_payload_value(reader_payload_node(p.root->'officialCandidacies')-'rows')) AS value,
      0 AS sort_group,0::bigint AS sort_ordinal FROM pointer p
    UNION ALL SELECT r.collection,NULL,NULL,NULL,NULL,NULL,r.row_id,reader_payload_value(r.value),1,r.ordinal FROM rows r
  ) SELECT kind,scope,version_id,promoted_at,normalized_hash,valid,row_id,value FROM selected ORDER BY sort_group,kind,sort_ordinal`,[`REGISTRY_RUNTIME_BINDING:${scope}`]);
  const row=result.find(row=>row.kind==="metadata");
  if(!row)return null;
  keyedSourceInput(row,"REGISTRY_RUNTIME_BINDING");
  const metadata=row.value as {generatedAt:string;bridge:Omit<RegistryPlanningView["officialCandidacies"],"rows">};
  const values=<T>(kind:string)=>result.filter(row=>row.kind===kind).map(row=>row.value as T);
  return {registry:{generatedAt:metadata.generatedAt,bodies:values<RegistryPlanningView["registry"]["bodies"][number]>("registry.bodies"),divisions:values<RegistryPlanningView["registry"]["divisions"][number]>("registry.divisions")},
    bodyRosters:values<RegistryPlanningView["bodyRosters"][number]>("bodyRosters"),rosterReaderDispositions:values<RegistryPlanningView["rosterReaderDispositions"][number]>("registry.rosterDispositions"),statewideExecutives:values<RegistryPlanningView["statewideExecutives"][number]>("registry.executives"),
    officialCandidacies:{...metadata.bridge,rows:values<RegistryPlanningView["officialCandidacies"]["rows"][number]>("registry.candidacies")}};
}
