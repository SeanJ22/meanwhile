import type { Query } from "../../../facts/publish.ts";
import type { RegistryRuntimeReadModel } from "../../../registry/runtime-data-plane.ts";
import type { Officeholder } from "../../../officials/types.ts";
import { heldSubjectDetails, type HeldSubjectDetails, type HeldGovernmentDetails } from "./held-subject-enrichment.ts";
import { committeeNameKey, type HeldCommitteeIdentity } from "./held-official-details.ts";
import { HELD_MEMBER_FACTS_SQL } from "./held-subject-rosters.ts";

/** Only the committee names actually written on this official's saved page leave the server. */
export const HELD_COMMITTEES_SQL = `WITH committees AS (
    SELECT r.row_id AS committee_id,reader_payload_value(r.value->'name')#>>'{}' AS name,
      coalesce(r.value->>'homepageUrl',reader_payload_node(r.value->'provenance')->>'sourceUrl') AS url
    FROM civic_data_rows r JOIN civic_data_promotions p ON p.key=r.promotion_key AND p.current_version_id=r.version_id
    WHERE r.promotion_key='REGISTRY_RUNTIME_BINDING:US-'||$1||':reader-registry-runtime' AND r.collection='registry.bodies'
      AND r.label_key=ANY($2::text[]) AND (r.value->>'bodyClass' ILIKE '%committee%' OR r.value->>'name' ILIKE '%committee%')
      AND (r.value->>'ocdId'=ANY($3::text[]) OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(coalesce(reader_payload_value(r.value->'alsoServesOcdIds'),'[]'::jsonb)) d WHERE d.value=ANY($3::text[])))
    UNION ALL SELECT r.row_id,reader_payload_value(r.value->'name')#>>'{}',r.value->>'url'
    FROM civic_data_rows r JOIN civic_data_promotions p ON p.key=r.promotion_key AND p.current_version_id=r.version_id
    WHERE r.promotion_key='FEDERAL_DIRECTORY:US-'||$1||':current-congress-directory' AND r.collection='federalCommittees' AND r.label_key=ANY($2::text[])
      AND $4 ~* '(senator|representative|delegate|commissioner)' AND (r.value->>'type'='joint'
        OR r.value->>'type'='senate' AND $4 ILIKE '%senator%'
        OR r.value->>'type'='house' AND $4 ~* '(representative|delegate|commissioner)')
  ) SELECT committee_id,name,url FROM committees`;


export async function readHeldCommitteeIdentities(query: Query, state: string, names: readonly string[], divisionIds: readonly string[], officeTitle: string | null): Promise<HeldCommitteeIdentity[]> {
  if (!/^[A-Z]{2}$/.test(state) || !names.length) return [];
  const rows = await query(HELD_COMMITTEES_SQL, [state, [...new Set(names.map(committeeNameKey))], divisionIds, officeTitle]);
  return rows.flatMap(row => typeof row.committee_id === "string" && typeof row.name === "string"
    ? [{ committeeId: row.committee_id, name: row.name, url: typeof row.url === "string" ? row.url : null }] : []);
}

/** Per-body/member rows preserve native aliases and source fields without scanning a held state record. */
export const HELD_SUBJECT_SQL = `WITH runtime AS MATERIALIZED (
  SELECT key,current_version_id,jsonb_build_object('registry',jsonb_build_object('generatedAt',reader_payload_node(reader_payload_node(payload)->'registry')->'generatedAt')) AS value
    FROM civic_data_promotions WHERE key='REGISTRY_RUNTIME_BINDING:US-'||$1||':reader-registry-runtime'
  ), roster_member AS MATERIALIZED (
    SELECT reader_payload_node(r.value->'roster') AS roster,reader_payload_node(r.value->'member') AS member FROM runtime p JOIN civic_data_rows r
      ON r.promotion_key=p.key AND r.version_id=p.current_version_id WHERE r.collection='registry.rosterMembers' AND r.row_id=$2
  ), fact_member_inputs AS MATERIALIZED (
    SELECT m.body_id,m.person_id,m.name,m.office_title,m.source_url,m.checked_at FROM (${HELD_MEMBER_FACTS_SQL}) m WHERE $2='roster:'||m.body_id||'#'||m.person_id
      AND m.checked_at<=$3::timestamptz AND m.source_url ~ '^https?://'
  ), bodies AS MATERIALIZED (
    SELECT r.value FROM runtime p JOIN civic_data_rows r ON r.promotion_key=p.key AND r.version_id=p.current_version_id
    WHERE r.collection='registry.bodies' AND r.row_id=ANY(ARRAY[$2::text]||ARRAY(SELECT roster->>'bodyId' FROM roster_member)||ARRAY(SELECT body_id FROM fact_member_inputs))
  ), fact_member_candidates AS MATERIALIZED (
    SELECT b.value body,m.body_id,m.person_id,m.name,m.office_title,m.source_url,m.checked_at FROM fact_member_inputs m JOIN bodies b ON b.value->>'id'=m.body_id
    WHERE NOT EXISTS(SELECT 1 FROM runtime p JOIN civic_data_rows r ON r.promotion_key=p.key AND r.version_id=p.current_version_id
      WHERE r.collection='registry.rosterMembers' AND r.body_id=m.body_id AND
        (coalesce(reader_payload_node(r.value->'member')->>'personId',reader_payload_node(r.value->'member')->>'id')=m.person_id
          OR lower(reader_payload_node(r.value->'member')->>'name')=lower(m.name)))
  ), fact_member AS (
    SELECT body,jsonb_build_object('bodyId',body_id,'bodyName',body->>'name','sourceUrl',source_url,'sourceOrg',source_url,'collectedAt',checked_at) roster,
      jsonb_build_object('id',$2,'personId',person_id,'name',name,'officeTitle',office_title) member FROM fact_member_candidates WHERE (SELECT count(*) FROM fact_member_candidates)=1
  ), requested_body AS (
    SELECT value FROM bodies WHERE value->>'id'=$2
    UNION SELECT b.value FROM bodies b JOIN roster_member r ON b.value->>'id'=r.roster->>'bodyId'
    UNION SELECT body FROM fact_member
  ), requested_roster AS (
    SELECT roster,member FROM roster_member
    UNION ALL SELECT r.value-'members',NULL::jsonb FROM runtime p JOIN civic_data_rows r ON r.promotion_key=p.key AND r.version_id=p.current_version_id
      WHERE r.collection='bodyRosters' AND r.row_id=$2
    UNION ALL SELECT roster,member FROM fact_member
  ), executive AS (
    SELECT r.value FROM runtime p JOIN civic_data_rows r ON r.promotion_key=p.key AND r.version_id=p.current_version_id WHERE r.collection='registry.executives' AND r.row_id=$2
  ), bridge AS (
    SELECT reader_payload_node(r.value->'holder') value FROM runtime p JOIN civic_data_rows r ON r.promotion_key=p.key AND r.version_id=p.current_version_id
      WHERE r.collection='registry.candidacies' AND r.row_id=$2
  ), federal AS (
    SELECT r.value FROM civic_data_rows r JOIN civic_data_promotions p ON p.key=r.promotion_key AND p.current_version_id=r.version_id
      WHERE p.key='FEDERAL_DIRECTORY:US-'||$1||':current-congress-directory' AND r.collection='federalPeople' AND r.row_id=$2
  ), governments AS (
    SELECT reader_payload_node(r.value->'row') value,r.value->>'checkedAt' checked FROM civic_data_rows r JOIN civic_data_promotions p
      ON p.key=r.promotion_key AND p.current_version_id=r.version_id WHERE r.collection='operationalGovernments' AND r.state=$1 AND r.row_id=$2
    UNION ALL SELECT jsonb_build_object('id',coalesce(g->>'jurisdictionId',g->>'id'),'name',g->>'name','stateCode',g->>'state',
      'ownWebAddress',g->>'website','govClass',g->>'governmentClass','censusId',reader_payload_node(g->'nativeIds')->>'census_pid6',
      'ocdId',CASE WHEN jsonb_array_length(coalesce(reader_payload_value(g->'associations'),'[]'::jsonb))=1 THEN reader_payload_value(g->'associations')#>>'{0,divisionId}' END,
      'bodyId',CASE WHEN jsonb_array_length(coalesce(reader_payload_value(g->'bodyIds'),'[]'::jsonb))=1 THEN reader_payload_value(g->'bodyIds')->>0 END),reader_payload_node(g->'provenance')->>'collectedAt'
      FROM civic_data_rows r JOIN civic_data_promotions p ON p.key=r.promotion_key AND p.current_version_id=r.version_id,LATERAL(SELECT r.value AS g) document
      WHERE p.key='REGISTRATION:US-'||$1||':registration:v1' AND r.collection='governments' AND r.aliases @> ARRAY[$2::text]
  ), government AS (
    SELECT value,checked FROM governments LIMIT 1
  ) SELECT
    (SELECT jsonb_build_object('id',value->>'id','name',value->>'name','ocdId',value->>'ocdId',
      'alsoServesOcdIds',reader_payload_value(value->'alsoServesOcdIds'),'bodyClass',value->>'bodyClass',
      'homepageUrl',value->>'homepageUrl','officePhone',value->>'officePhone','officeAddress',value->>'officeAddress',
      'meetingCadence',value->>'meetingCadence','agendaSourceRef',value->>'agendaSourceRef',
      'provenance',jsonb_build_object('sourceUrl',reader_payload_node(value->'provenance')->>'sourceUrl',
        'collectedAt',reader_payload_node(value->'provenance')->>'collectedAt')) FROM requested_body LIMIT 1) body,
    (SELECT jsonb_build_object('bodyId',roster->>'bodyId','bodyName',roster->>'bodyName','sourceUrl',roster->>'sourceUrl',
      'sourceOrg',roster->>'sourceOrg','collectedAt',roster->>'collectedAt','members',CASE WHEN member IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(jsonb_build_object(
        'id',member->>'id','personId',member->>'personId','name',member->>'name','officeTitle',member->>'officeTitle',
        'websiteUrl',member->>'websiteUrl','email',member->>'email','phone',member->>'phone','termStart',member->>'termStart',
        'termEnd',member->>'termEnd','termNote',member->>'termNote')) END) FROM requested_roster LIMIT 1) roster,
    (SELECT jsonb_build_object('stateOcdId',value->>'stateOcdId','sourceUrl',value->>'sourceUrl','sourceOrg',value->>'sourceOrg',
      'collectedAt',value->>'collectedAt','holder',jsonb_build_object('id',h->>'id','personId',h->>'personId','name',h->>'name',
        'officeTitle',h->>'officeTitle','websiteUrl',h->>'websiteUrl','email',h->>'email','phone',h->>'phone','termEnd',h->>'termEnd'))
      FROM executive,LATERAL (SELECT reader_payload_node(value->'holder') h) holder LIMIT 1) executive,
    (SELECT jsonb_build_object('holder',jsonb_build_object('id',value->>'id','name',value->>'name','officeTitle',value->>'officeTitle',
      'sourceUrl',value->>'sourceUrl','divisions',reader_payload_value(value->'divisions'),'authority',value->>'authority')) FROM bridge LIMIT 1) bridge,
    (SELECT jsonb_build_object('id',value->>'id','personId',value->>'personId','name',value->>'name','state',value->>'state','officeTitle',value->>'officeTitle',
      'websiteUrl',value->>'websiteUrl','profileUrls',reader_payload_value(value->'profileUrls'),'phone',value->>'phone','email',value->>'email',
      'termStart',value->>'termStart','termEnd',value->>'termEnd','provenance',jsonb_build_object(
        'sourceUrl',reader_payload_node(value->'provenance')->>'sourceUrl','collectedAt',reader_payload_node(value->'provenance')->>'collectedAt')) FROM federal LIMIT 1) person,
    (SELECT jsonb_build_object('id',value->>'id','name',value->>'name','stateCode',value->>'stateCode','ownWebAddress',value->>'ownWebAddress',
      'ocdId',value->>'ocdId','bodyId',value->>'bodyId','censusId',value->>'censusId','govClass',value->>'govClass','checkedAt',checked) FROM government) government,
    (SELECT r.row_id FROM runtime p JOIN civic_data_rows r ON r.promotion_key=p.key AND r.version_id=p.current_version_id
      WHERE r.collection='registry.divisions' AND r.row_id ~ '/(state|territory|district):[a-z]{2}$' ORDER BY r.ordinal LIMIT 1) state_division,
    (SELECT reader_payload_node(value->'registry')->>'generatedAt' FROM runtime LIMIT 1) checked`;

/** Resolve one exact held subject for a standing worker, without loading a state registry into that worker. */
export async function readHeldSubjectDetails(query: Query, state: string, subjectId: string, now: string): Promise<HeldSubjectDetails | null> {
  const code = state.toUpperCase();
  if (!/^[A-Z]{2}$/.test(code) || !subjectId) return null;
  const [row] = await query(HELD_SUBJECT_SQL, [code, subjectId, now]);
  if (!row) return null;
  const body = row.body as RegistryRuntimeReadModel["registry"]["bodies"][number] | null;
  let roster = row.roster as RegistryRuntimeReadModel["bodyRosters"][number] | null;
  if (roster?.sourceUrl && roster.sourceOrg === roster.sourceUrl) {
    try { roster = { ...roster, sourceOrg: new URL(roster.sourceUrl).hostname }; } catch { /* Invalid sources cannot form a held subject below. */ }
  }
  const executive = row.executive as RegistryRuntimeReadModel["statewideExecutives"][number] | null;
  const bridge = row.bridge as RegistryRuntimeReadModel["officialCandidacies"]["rows"][number] | null;
  const government = row.government as HeldGovernmentDetails | null;
  const person = row.person as Officeholder | null;
  const ids = [...new Set([row.state_division as string | null, body?.ocdId, ...body?.alsoServesOcdIds ?? [], executive?.stateOcdId, ...bridge?.holder.divisions ?? [], government?.ocdId]
    .filter((id): id is string => Boolean(id && new RegExp(`/(?:state|territory|district):${code.toLowerCase()}(?:/|$)`).test(id))))];
  const registry = { registry: { generatedAt: row.checked as string ?? now, divisions: ids.map(ocdId => ({ ocdId, label: code })), bodies: body ? [body] : [] },
    bodyRosters: roster ? [roster] : [], statewideExecutives: executive ? [executive] : [], officialCandidacies: { rows: bridge ? [bridge] : [] } } as unknown as RegistryRuntimeReadModel;
  const result = heldSubjectDetails(registry, code, now, government ? [government] : [], person ? [person] : [])
    .find(subject => subject.subjectId === subjectId) ?? null;
  return result && government?.bodyId ? { ...result, bodyId: government.bodyId } : result;
}
