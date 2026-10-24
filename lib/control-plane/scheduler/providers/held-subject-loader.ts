import type { Query } from "../../../facts/publish.ts";
import type { RegistryRuntimeReadModel } from "../../../registry/runtime-data-plane.ts";
import type { Officeholder } from "../../../officials/types.ts";
import { heldSubjectDetails, type HeldSubjectDetails, type HeldGovernmentDetails } from "./held-subject-enrichment.ts";
import { committeeNameKey, type HeldCommitteeIdentity } from "./held-official-details.ts";
import { HELD_MEMBER_FACTS_SQL } from "./held-subject-rosters.ts";

/** Only the committee names actually written on this official's saved page leave the server. */
export const HELD_COMMITTEES_SQL = `WITH roots AS MATERIALIZED (
  SELECT record_class,reader_payload_node(payload) value FROM civic_data_promotions
    WHERE key IN ('REGISTRY_RUNTIME_BINDING:US-'||$1||':reader-registry-runtime',
      'FEDERAL_DIRECTORY:US-'||$1||':current-congress-directory')
  ), committees AS (
    SELECT reader_payload_node(b.item)->>'id' committee_id,reader_payload_node(b.item)->>'name' name,
      coalesce(reader_payload_node(b.item)->>'homepageUrl',reader_payload_node(reader_payload_node(b.item)->'provenance')->>'sourceUrl') url
      FROM roots r,LATERAL reader_payload_members(reader_payload_node(r.value->'registry')->'bodies') b
      WHERE r.record_class='REGISTRY_RUNTIME_BINDING' AND (reader_payload_node(b.item)->>'bodyClass' ILIKE '%committee%'
        OR reader_payload_node(b.item)->>'name' ILIKE '%committee%')
        AND (reader_payload_node(b.item)->>'ocdId'=ANY($3::text[]) OR EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(coalesce(reader_payload_value(reader_payload_node(b.item)->'alsoServesOcdIds'),'[]'::jsonb)) division
            WHERE division.value=ANY($3::text[])))
    UNION ALL SELECT c.key,reader_payload_node(c.value)->>'name',reader_payload_node(c.value)->>'url'
      FROM roots r,LATERAL jsonb_each(coalesce(reader_payload_value(reader_payload_node(r.value->'directory')->'committees'),'{}'::jsonb)) c
      WHERE r.record_class='FEDERAL_DIRECTORY' AND $4 ~* '(senator|representative|delegate|commissioner)' AND (reader_payload_node(c.value)->>'type'='joint'
        OR reader_payload_node(c.value)->>'type'='senate' AND $4 ILIKE '%senator%'
        OR reader_payload_node(c.value)->>'type'='house' AND $4 ~* '(representative|delegate|commissioner)')
  ) SELECT committee_id,name,url FROM committees
    WHERE trim(regexp_replace(lower(name),'[^[:alnum:]]+',' ','g'))=ANY($2::text[])`;

export async function readHeldCommitteeIdentities(query: Query, state: string, names: readonly string[], divisionIds: readonly string[], officeTitle: string | null): Promise<HeldCommitteeIdentity[]> {
  if (!/^[A-Z]{2}$/.test(state) || !names.length) return [];
  const rows = await query(HELD_COMMITTEES_SQL, [state, [...new Set(names.map(committeeNameKey))], divisionIds, officeTitle]);
  return rows.flatMap(row => typeof row.committee_id === "string" && typeof row.name === "string"
    ? [{ committeeId: row.committee_id, name: row.name, url: typeof row.url === "string" ? row.url : null }] : []);
}

/** Immutable payload parts are searched on the server; only this known subject's identity, fields and URLs leave it. */
export const HELD_SUBJECT_SQL = `WITH runtime AS MATERIALIZED (
  SELECT reader_payload_node(payload) value FROM civic_data_promotions
    WHERE key='REGISTRY_RUNTIME_BINDING:US-'||$1||':reader-registry-runtime'
  ), bodies AS MATERIALIZED (
    SELECT reader_payload_node(b.item) value FROM runtime r,LATERAL reader_payload_members(reader_payload_node(r.value->'registry')->'bodies') b
  ), roster_member AS MATERIALIZED (
    SELECT reader_payload_node(r.item) roster,reader_payload_node(m.item) member FROM runtime root,
      LATERAL reader_payload_members(root.value->'bodyRosters') r,
      LATERAL reader_payload_members(reader_payload_node(r.item)->'members') m
      WHERE reader_payload_node(m.item)->>'id'=$2
  ), fact_member_candidates AS MATERIALIZED (
    SELECT b.value body,m.body_id,m.person_id,m.name,m.office_title,m.source_url,m.checked_at
      FROM (${HELD_MEMBER_FACTS_SQL}) m JOIN bodies b ON b.value->>'id'=m.body_id
      WHERE $2='roster:'||m.body_id||'#'||m.person_id AND m.checked_at<=$3::timestamptz
        AND m.source_url ~ '^https?://' AND NOT EXISTS (
          SELECT 1 FROM runtime root,LATERAL reader_payload_members(root.value->'bodyRosters') r,
            LATERAL reader_payload_members(reader_payload_node(r.item)->'members') member
          WHERE reader_payload_node(r.item)->>'bodyId'=m.body_id AND
            (coalesce(reader_payload_node(member.item)->>'personId',reader_payload_node(member.item)->>'id')=m.person_id
              OR lower(reader_payload_node(member.item)->>'name')=lower(m.name)))
  ), fact_member AS (
    SELECT body,jsonb_build_object('bodyId',body_id,'bodyName',body->>'name','sourceUrl',source_url,
      'sourceOrg',source_url,'collectedAt',checked_at) roster,
      jsonb_build_object('id',$2,'personId',person_id,'name',name,'officeTitle',office_title) member
      FROM fact_member_candidates WHERE (SELECT count(*) FROM fact_member_candidates)=1
  ), requested_body AS (
    SELECT value FROM bodies WHERE value->>'id'=$2
    UNION SELECT b.value FROM bodies b JOIN roster_member r ON b.value->>'id'=r.roster->>'bodyId'
    UNION SELECT body FROM fact_member
  ), requested_roster AS (
    SELECT roster,member FROM roster_member
    UNION ALL SELECT reader_payload_node(r.item),NULL::jsonb FROM runtime root,
      LATERAL reader_payload_members(root.value->'bodyRosters') r WHERE reader_payload_node(r.item)->>'bodyId'=$2
    UNION ALL SELECT roster,member FROM fact_member
  ), executive AS (
    SELECT reader_payload_node(e.item) value FROM runtime r,LATERAL reader_payload_members(r.value->'statewideExecutives') e
      WHERE reader_payload_node(reader_payload_node(e.item)->'holder')->>'id'=$2
  ), bridge AS (
    SELECT reader_payload_node(reader_payload_node(c.item)->'holder') value FROM runtime r,
      LATERAL reader_payload_members(reader_payload_node(r.value->'officialCandidacies')->'rows') c
      WHERE reader_payload_node(reader_payload_node(c.item)->'holder')->>'id'=$2
  ), federal AS (
    SELECT reader_payload_node(p.item) value FROM civic_data_promotions root,
      LATERAL reader_payload_members(reader_payload_node(reader_payload_node(root.payload)->'roster')->'officeholders') p
      WHERE root.key='FEDERAL_DIRECTORY:US-'||$1||':current-congress-directory' AND reader_payload_node(p.item)->>'id'=$2
  ), governments AS (
    SELECT reader_payload_node(j.item) value,r.value->>'generatedOn' checked FROM civic_data_promotions p,
      LATERAL jsonb_each(p.payload->'registries') r,LATERAL reader_payload_members(r.value->'jurisdictions') j
      WHERE p.record_class='OPERATIONAL_REFERENCE' AND upper(r.key)=$1 AND reader_payload_node(j.item)->>'id'=$2
    UNION ALL
    SELECT jsonb_build_object('id',coalesce(g->>'jurisdictionId',g->>'id'),'name',g->>'name','stateCode',g->>'state',
      'ownWebAddress',g->>'website','govClass',g->>'governmentClass','censusId',reader_payload_node(g->'nativeIds')->>'census_pid6',
      'ocdId',CASE WHEN jsonb_array_length(coalesce(reader_payload_value(g->'associations'),'[]'::jsonb))=1 THEN
        reader_payload_value(g->'associations')#>>'{0,divisionId}' END,
      'bodyId',CASE WHEN jsonb_array_length(coalesce(reader_payload_value(g->'bodyIds'),'[]'::jsonb))=1 THEN
        reader_payload_value(g->'bodyIds')->>0 END),reader_payload_node(g->'provenance')->>'collectedAt'
      FROM civic_data_promotions p,LATERAL reader_payload_members(reader_payload_node(p.payload)->'governments') j,
        LATERAL (SELECT reader_payload_node(j.item) g) row
      WHERE p.key='REGISTRATION:US-'||$1||':registration:v1' AND (g->>'id'=$2 OR g->>'jurisdictionId'=$2)
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
    (SELECT reader_payload_node(d.item)->>'ocdId' FROM runtime r,
      LATERAL reader_payload_members(reader_payload_node(r.value->'registry')->'divisions') d
      WHERE reader_payload_node(d.item)->>'ocdId' ~ '/(state|territory|district):[a-z]{2}$' LIMIT 1) state_division,
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
