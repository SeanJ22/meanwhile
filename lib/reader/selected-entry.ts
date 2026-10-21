import {PERSON_ID_NAMESPACES} from "../officials/people-identity.ts";
import {promotedPayloadSha256} from "../civic-data/attested-promotion.ts";
import {parseUnchangedConfirmation} from "../civic-data/unchanged-confirmation.ts";
import {registerIntegrityCheckedEdgeEntries,type PromotedEdgeEntry} from "../civic-data/read-model.ts";

export const selectedPointerSql = `SELECT p.*,c.retrieved_at,
  (SELECT e.detail FROM civic_data_candidate_events e WHERE e.candidate_id=p.current_version_id
    AND left(e.detail,26)='UNCHANGED_CONFIRMATION_V1 ' ORDER BY e.sequence DESC LIMIT 1) AS confirmation,
  (p.current_version_id=p.last_known_good_version_id AND c.state='PROMOTED' AND c.acquisition_succeeded
   AND c.promoted_version_id=c.id AND c.last_known_good_version_id=c.id AND c.record_class=p.record_class AND c.scope=p.scope AND c.source_id=p.source_id
   AND p.validation_receipt->>'decision'='GOOD' AND p.validation_receipt->>'candidateId'=c.id AND p.validation_receipt->>'sourceId'=c.source_id
   AND p.validation_receipt->>'recordClass'=p.record_class AND p.validation_receipt->>'scope'=p.scope) AS published
  FROM civic_data_promotions p LEFT JOIN civic_data_candidates c ON c.id=p.current_version_id WHERE p.key=$1`;
export const selectedMetadataSql = `pointer.key,pointer.source_id,pointer.current_version_id,pointer.last_known_good_version_id,pointer.promoted_at,
  reader_payload_value(reader_payload_node(pointer.validation_receipt)-'excludedFacts') || jsonb_build_object('excludedFacts','[]'::jsonb) AS validation_receipt,
  pointer.retrieved_at,pointer.confirmation,pointer.published`;

export function selectedStateEntry(recordClass: import("../civic-data/types.ts").RoutineRecordClass, scope: string,
  row: Record<string, unknown> | null | undefined): PromotedEdgeEntry {
  if (!row) return {kind:"NOT_RECORDED",recordClass,scope};
  if (row.published !== true) throw new Error("READER_PUBLISHED_POINTER_INVALID");
  const entry: Extract<PromotedEdgeEntry,{kind:"PROMOTED"}> = {kind:"PROMOTED",projection:{key:String(row.key),sourceId:String(row.source_id),recordClass,scope,
    versionId:String(row.current_version_id),lastKnownGoodVersionId:String(row.last_known_good_version_id),
    promotedAt:String(row.promoted_at),payload:row.payload,
    receipt:row.validation_receipt as Extract<PromotedEdgeEntry,{kind:"PROMOTED"}>["projection"]["receipt"]},
    attested:{recordClass,scope,versionId:String(row.current_version_id),payloadSha256:promotedPayloadSha256(row.payload),
      retrievedAt:String(row.retrieved_at),staleAtRetrieval:false,version:null,sourceThrough:null}};
  const confirmation = typeof row.confirmation==="string" ? parseUnchangedConfirmation(row.confirmation) : null;
  if (confirmation?.versionId===entry.projection.versionId && confirmation.pointerKey===entry.projection.key) Object.assign(entry.projection,{latestConfirmation:confirmation});
  registerIntegrityCheckedEdgeEntries([entry]);
  return entry;
}

/** The same publisher namespaces as personIdentityKeys; organization membership is never an identity. */
export function peopleIdentityKeysSql(value:string):string {
  const cases=Object.entries(PERSON_ID_NAMESPACES).map(([name,canonical])=>`WHEN '${name}' THEN '${canonical}'`).join(' ');
  const aliases=`SELECT source.key,alias.id,CASE regexp_replace(lower(source.key),'[^a-z0-9]','','g') ${cases} END AS canonical
    FROM jsonb_each(coalesce(reader_payload_value(${value}->'nativeIds'),'{}'::jsonb)) source,LATERAL jsonb_array_elements_text(source.value) alias(id) WHERE alias.id<>''`;
  return `ARRAY[${value}->>'id',coalesce(${value}->>'personId',${value}->>'id')] || ARRAY(
    SELECT CASE WHEN key='reader' THEN id ELSE key||':'||id END FROM (${aliases}) aliases
    UNION SELECT canonical||':'||CASE WHEN canonical='ocd-person' THEN regexp_replace(id,'^ocd-person/','') ELSE id END FROM (${aliases}) aliases WHERE canonical IS NOT NULL
    UNION SELECT id FROM (${aliases}) aliases WHERE key='ocd-person' AND id LIKE 'ocd-person/%')`;
}
