import {unpackPlaceContextRow} from "./place-ready.ts";
import {PERSON_ID_NAMESPACES} from "../officials/people-identity.ts";
import {promotedPayloadSha256} from "../civic-data/attested-promotion.ts";
import {parseUnchangedConfirmation} from "../civic-data/unchanged-confirmation.ts";
import {registerIntegrityCheckedEdgeEntries,type PromotedEdgeEntry} from "../civic-data/read-model.ts";

export {savedSelectedPointerSql as selectedPointerSql} from "./page-authorities.ts";
export const selectedMetadataSql=`pointer.key,pointer.source_id,pointer.current_version_id,pointer.last_known_good_version_id,pointer.promoted_at,
  pointer.validation_receipt,pointer.retrieved_at,pointer.confirmation,pointer.published`;

export function selectedStateEntry(recordClass: import("../civic-data/types.ts").RoutineRecordClass, scope: string,
  row: Record<string, unknown> | null | undefined): PromotedEdgeEntry {
  if (!row) return {kind:"NOT_RECORDED",recordClass,scope};
  row={...row,payload:unpackPlaceContextRow(row.payload)};
  if (row.published !== true) throw new Error("READER_PUBLISHED_POINTER_INVALID");
  const temporal=row.temporal as {version?:string|null;sourceThrough?:string|null}|undefined;
  const entry: Extract<PromotedEdgeEntry,{kind:"PROMOTED"}> = {kind:"PROMOTED",projection:{key:String(row.key),sourceId:String(row.source_id),recordClass,scope,
    versionId:String(row.current_version_id),lastKnownGoodVersionId:String(row.last_known_good_version_id),
    promotedAt:new Date(row.promoted_at as string).toISOString(),payload:row.payload,
    receipt:row.validation_receipt as Extract<PromotedEdgeEntry,{kind:"PROMOTED"}>["projection"]["receipt"]},
    attested:{recordClass,scope,versionId:String(row.current_version_id),payloadSha256:promotedPayloadSha256(row.payload),
      retrievedAt:new Date(row.retrieved_at as string).toISOString(),staleAtRetrieval:false,version:temporal?.version??null,sourceThrough:temporal?.sourceThrough??null}};
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
