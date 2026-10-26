import type { ReadOnlyQuery } from "../../control-plane/admin-view/promoted-slices.ts";
import type { SourceProbeDependencies } from "../../civic-data/source-probe.ts";
import { registrationTarget } from "../../registration/publication.ts";
import { stateBallotScope,stateRegistryRuntimeScope } from "../../civic-data/state-scopes.ts";

export interface CountyCivicContactInputs {
  registration:{
    divisions:readonly {ocdId:string;divisionType:string;geoid:string}[];
    bodies:readonly {ocdId?:string|null;name?:string|null;officeAddress?:string|null}[];
    governments?:readonly {name:string;contactTitle?:string|null;officeAddress?:string|null;associations:readonly {divisionId:string}[]}[];
  }|null;
  votingSites:{jurisdictions:readonly {ocdId:string;office?:{address?:string|null}|null}[]}|null;
  reviewedBodies:readonly {ocdId?:string|null;name?:string|null;officeAddress?:string|null}[];
  dependencies:SourceProbeDependencies;
}
const electionOffice="(^|[^[:alnum:]_])(elections?|voter registration|registrar of voters|supervisor of elections)([^[:alnum:]_]|$)";

/** Actual county-office lookup rows, in one pointer snapshot. No government inventories or voting-site records leave Postgres. */
export async function readCountyCivicContactInputs(query:ReadOnlyQuery,state:string):Promise<CountyCivicContactInputs> {
  const scopes=[registrationTarget(state).scope,stateBallotScope("voting-sites",state),stateRegistryRuntimeScope(state)];
  const [[row]]=await query([{text:`WITH pointers AS MATERIALIZED (
    SELECT p.key,p.record_class,p.scope,p.current_version_id,p.payload,c.raw_hash,c.normalized_hash,c.parser_version,
      (p.current_version_id=p.last_known_good_version_id AND c.id=p.current_version_id AND c.source_id=p.source_id
       AND c.record_class=p.record_class AND c.scope=p.scope AND c.state='PROMOTED' AND c.acquisition_succeeded
       AND c.promoted_version_id=c.id AND c.last_known_good_version_id=c.id
       AND c.candidate#>'{normalization,succeeded}'='true'::jsonb AND p.payload=c.candidate->'readModel'
       AND p.validation_receipt=c.validation_receipt AND p.validation_receipt->>'decision'='GOOD'
       AND p.validation_receipt->>'candidateId'=c.id AND p.validation_receipt->>'sourceId'=c.source_id
       AND p.validation_receipt->>'recordClass'=p.record_class AND p.validation_receipt->>'scope'=p.scope) AS valid
    FROM civic_data_promotions p LEFT JOIN civic_data_candidates c ON c.id=p.current_version_id
    WHERE (p.record_class='REGISTRATION' AND p.scope=$1) OR (p.record_class='VOTING_SITE' AND p.scope=$2)
      OR (p.record_class='REGISTRY_RUNTIME_BINDING' AND p.scope=$3)
  ), registration AS MATERIALIZED (
    SELECT *,reader_payload_node(payload) AS root FROM pointers WHERE valid AND record_class='REGISTRATION'
  ), counties AS (
    SELECT n.value FROM registration p,LATERAL reader_payload_members(p.root->'divisions') d,
      LATERAL(SELECT reader_payload_node(d.item) AS value)n
    WHERE n.value->>'divisionType'='county' AND n.value->>'geoid' ~ '^[0-9]{5}$'
  ), registration_bodies AS (
    SELECT n.value FROM registration p,LATERAL reader_payload_members(p.root->'bodies') b,
      LATERAL(SELECT reader_payload_node(b.item) AS value)n
    WHERE reader_payload_value(n.value->'name')#>>'{}' ~* $4
  ), governments AS (
    SELECT r.value FROM registration p JOIN civic_data_rows r ON r.promotion_key=p.key AND r.version_id=p.current_version_id
    WHERE r.collection='governments' AND concat_ws(' ',reader_payload_value(r.value->'name')#>>'{}',
      reader_payload_value(r.value->'contactTitle')#>>'{}') ~* $4
  ), reviewed AS (
    SELECT r.value FROM pointers p JOIN civic_data_rows r ON r.promotion_key=p.key AND r.version_id=p.current_version_id
    WHERE p.valid AND p.record_class='REGISTRY_RUNTIME_BINDING' AND r.collection='registry.bodies'
      AND reader_payload_value(r.value->'name')#>>'{}' ~* $4
  ), jurisdictions AS (
    SELECT n.value FROM pointers p,LATERAL reader_payload_members(reader_payload_node(p.payload)->'jurisdictions') j,
      LATERAL(SELECT reader_payload_node(j.item) AS value)n
    WHERE p.valid AND p.record_class='VOTING_SITE' AND reader_payload_node(n.value->'office')->>'address' IS NOT NULL
  ) SELECT NOT EXISTS(SELECT 1 FROM pointers WHERE NOT coalesce(valid,false)) AS valid,
    EXISTS(SELECT 1 FROM registration) AS registered,
    coalesce((SELECT jsonb_object_agg(record_class||':'||scope,jsonb_build_array(current_version_id,raw_hash,normalized_hash,parser_version)) FROM pointers WHERE valid),'{}'::jsonb) AS dependencies,
    coalesce((SELECT jsonb_agg(jsonb_build_object('ocdId',value->'ocdId','divisionType',value->'divisionType','geoid',value->'geoid')) FROM counties),'[]'::jsonb) AS divisions,
    coalesce((SELECT jsonb_agg(jsonb_build_object('ocdId',value->'ocdId','name',reader_payload_value(value->'name'),
      'officeAddress',reader_payload_value(value->'officeAddress'))) FROM registration_bodies),'[]'::jsonb) AS bodies,
    coalesce((SELECT jsonb_agg(jsonb_build_object('name',reader_payload_value(value->'name'),'contactTitle',reader_payload_value(value->'contactTitle'),
      'officeAddress',reader_payload_value(value->'officeAddress'),'associations',coalesce((SELECT jsonb_agg(jsonb_build_object('divisionId',reader_payload_node(a.item)->'divisionId'))
        FROM reader_payload_members(value->'associations') a),'[]'::jsonb))) FROM governments),'[]'::jsonb) AS governments,
    coalesce((SELECT jsonb_agg(jsonb_build_object('ocdId',value->'ocdId','name',reader_payload_value(value->'name'),
      'officeAddress',reader_payload_value(value->'officeAddress'))) FROM reviewed),'[]'::jsonb) AS reviewed,
    coalesce((SELECT jsonb_agg(jsonb_build_object('ocdId',value->'ocdId','office',jsonb_build_object('address',
      reader_payload_value(reader_payload_node(value->'office')->'address')))) FROM jurisdictions),'[]'::jsonb) AS jurisdictions`,params:[...scopes,electionOffice]}]);
  if(!row||row.valid!==true)throw Error("Google Civic office inputs have no usable published pointer.");
  return {registration:row.registered===true?{divisions:row.divisions as NonNullable<CountyCivicContactInputs["registration"]>["divisions"],
    bodies:row.bodies as NonNullable<CountyCivicContactInputs["registration"]>["bodies"],
    governments:row.governments as NonNullable<CountyCivicContactInputs["registration"]>["governments"]}:null,
    votingSites:{jurisdictions:row.jurisdictions as NonNullable<CountyCivicContactInputs["votingSites"]>["jurisdictions"]},
    reviewedBodies:row.reviewed as CountyCivicContactInputs["reviewedBodies"],dependencies:row.dependencies as SourceProbeDependencies};
}
