import { federalGovernmentNameSql } from "../federal-money/recipient.ts";
import { CivicPayloadParts } from "../civic-data/payload-parts.ts";
import { RETIRED_MEETING_ROUTES } from "../registry/source-wiring.ts";
import { MEETING_HELD_LOOKBACK_DAYS } from "../meetings/constants.ts";
import { EVERYDAY_ROUTING_POINTER } from "../routing/everyday-data-plane.ts";
import { stateOcdIdFrom } from "../ocd/state-division.ts";
import type { Query } from "../facts/publish.ts";
import { ROSTER_PERSON_FIELDS } from "../facts/roster-read.ts";
import type { PlaceInput } from "./place-types.ts";
import type { FactDb } from "../facts/publish.ts";
import { readerFactDb } from "../facts/db.ts";
import { randomUUID } from "node:crypto";
import { purgeReaderCacheTags, readerCacheTags, type ReaderCachePurger } from "./cache.ts";
import { composePlaceRow } from "./place-decode.ts";
import { packPlaceContext, packReadyPlace } from "./place-ready.ts";
import type { PlacePackage } from "./place-types.ts";
import { lookupZcta } from "../geo/zcta.ts";
import { readerLocation, readerTerritory, territoryBodies } from "./location.ts";
import { selectBodyTerritory, type BodyTerritorySelection } from "../registry/body-territory.ts";

const everydayRoutingKey = `${EVERYDAY_ROUTING_POINTER.recordClass}:${EVERYDAY_ROUTING_POINTER.scope}`.replaceAll("'","''");
const rosterPersonFieldsSql = ROSTER_PERSON_FIELDS.map(field => `'${field}'`).join(",");
const retiredMeetingScopesSql = RETIRED_MEETING_ROUTES.map(route =>
  `'source:${encodeURIComponent(route.meetingSource)}:body:${encodeURIComponent(route.bodyId)}'`).join(",") || "NULL";

const normalizedGovernmentSql = (value: string) => {
  const flat = `btrim(regexp_replace(regexp_replace(replace(upper(${value}),'&',' AND '),'[^A-Z0-9, ]',' ','g'),'\\s+',' ','g'))`;
  return `btrim(regexp_replace(replace(regexp_replace(${flat},'^(.+?),\\s*(CITY|TOWN|TOWNSHIP|VILLAGE|BOROUGH|COUNTY)\\s+OF$','\\2 OF \\1'),',',''),'\\s+',' ','g'))`;
};

const agendaDocumentSql = (row: string) => `CASE WHEN $8::text[] IS NULL OR reader_payload_node(${row}.item)->'text' ? '$civicPayloadPart' THEN ${row}.item
    WHEN jsonb_typeof(reader_payload_value(reader_payload_node(${row}.item)->'text'))='string' THEN
      (reader_payload_node(${row}.item)-'text') || jsonb_build_object('text',jsonb_build_object('$readerAgendaText',(
        SELECT text_id FROM agenda_texts WHERE value=reader_payload_value(reader_payload_node(${row}.item)->'text') LIMIT 1)))
    ELSE ${row}.item END`;
const fullAgendaDocumentSql = (row: string) => `($8::text[] IS NULL OR EXISTS (SELECT 1 FROM agenda_calendar_fallback)
    OR reader_payload_node(${row}.item)->>'meetingId' IN (SELECT id FROM agenda_full_ids))`;
const ownedAgendaDocumentSql = (row: string) => `EXISTS (SELECT 1 FROM agenda_current_headers m WHERE m.scope=p.scope
    AND reader_payload_value(m.value->'id') IS NOT DISTINCT FROM reader_payload_value(reader_payload_node(${row}.item)->'meetingId'))`;
// For unopened sittings, only URL ownership participates in the agenda reading.
const agendaDocumentLinkSql = (row: string) => `jsonb_build_object(
  'meetingId',reader_payload_value(reader_payload_node(${row}.item)->'meetingId'),
  'documentUrl',reader_payload_value(reader_payload_node(${row}.item)->'documentUrl'))`;
const agendaDocumentLinksSql = (owned = "true") => `coalesce((
  SELECT jsonb_agg(link ORDER BY ordinal_index) FROM (
    SELECT ${agendaDocumentLinkSql("d")} AS link,min(d.ordinal_index) AS ordinal_index
      FROM reader_payload_members(p.header->'agendaDocuments') d
      WHERE $7::boolean AND NOT ${fullAgendaDocumentSql("d")} AND (${owned})
        AND reader_payload_value(reader_payload_node(d.item)->'documentUrl') IN (SELECT value FROM agenda_full_urls)
      GROUP BY ${agendaDocumentLinkSql("d")}
  ) links),'[]'::jsonb)`;

/** The place indexes lead to bodies; live facts and canonical source calendars are read together. */
const placePackageSql = (bodyFactsOnly: boolean) => `WITH RECURSIVE selected_places AS MATERIALIZED (
  SELECT unnest($2::text[]) AS id
  UNION SELECT split_part(id,'#',1) FROM unnest($3::text[]) body(id) WHERE $9::boolean AND id LIKE 'ocd-division/%'
  UNION SELECT place_id FROM entity_place WHERE $9::boolean AND entity_id=ANY($3::text[])
  UNION SELECT ep.place_id FROM entity_external_id x JOIN entity_place ep ON ep.entity_id=x.entity_id
    WHERE $9::boolean AND x.scheme='body-alias' AND x.value=ANY($3::text[])
), named_places AS MATERIALIZED (
  SELECT unnest($10::text[]) AS id
), registration AS MATERIALIZED (
  SELECT reader_payload_node(payload) AS payload FROM civic_data_promotions WHERE $8::text[] IS NULL AND key='REGISTRATION:US-'||$1||':registration:v1' AND record_class='REGISTRATION'
), government_inventory AS MATERIALIZED (
  SELECT g,${normalizedGovernmentSql("g->>'name'")} AS identity,${federalGovernmentNameSql("g->>'name'")} AS recipient_identity FROM registration,
    LATERAL reader_payload_members(payload->'governments') member,
    LATERAL (SELECT reader_payload_node(member.item) AS original) header,
    LATERAL (SELECT original || jsonb_build_object('name',reader_payload_value(original->'name')) AS g) named
), government_identities AS MATERIALIZED (
  SELECT g,identity,count(*) OVER (PARTITION BY upper(g->>'state'),identity) AS identities,
    count(*) OVER (PARTITION BY upper(g->>'state'),recipient_identity) AS recipient_names FROM government_inventory
), local_governments AS MATERIALIZED (
  SELECT reader_payload_value(g) AS g,identity,identities,recipient_names FROM government_identities WHERE EXISTS (
    SELECT 1 FROM reader_payload_members(g->'associations') member,
      LATERAL (SELECT reader_payload_node(member.item) AS a) association
    WHERE a->>'divisionId'=ANY(ARRAY(SELECT id FROM selected_places)))
), dotgov AS MATERIALIZED (
  SELECT payload->'domains' AS domains,payload->'source' AS source FROM civic_data_promotions
    WHERE $8::text[] IS NULL AND key='DOTGOV_REFERENCE:US:current-full:domains' AND record_class='DOTGOV_REFERENCE'
), domains AS MATERIALIZED (
  SELECT d,${normalizedGovernmentSql("d->>'organization'")} AS identity,source FROM dotgov,
    LATERAL jsonb_array_elements(coalesce(domains,'[]'::jsonb)) d WHERE upper(d->>'state')=$1
), runtime_root AS MATERIALIZED (
  SELECT reader_payload_node(payload) AS value FROM civic_data_promotions
    WHERE key='REGISTRY_RUNTIME_BINDING:US-'||$1||':reader-registry-runtime' AND record_class='REGISTRY_RUNTIME_BINDING'
), runtime_registry AS MATERIALIZED (
  SELECT reader_payload_node(value->'registry') AS value FROM runtime_root
), runtime_bodies AS MATERIALIZED (
  SELECT DISTINCT ON (header.value->>'id') header.value AS item,header.value,b.ordinal_index
    FROM runtime_registry r CROSS JOIN LATERAL reader_payload_members(r.value->'bodies') b
    CROSS JOIN LATERAL (SELECT reader_payload_node(b.item) AS value) original
    LEFT JOIN entity_external_id alias ON alias.scheme='body-alias' AND alias.value=original.value->>'id'
    LEFT JOIN entity canonical ON canonical.id=alias.entity_id
    LEFT JOIN LATERAL (SELECT array_agg(DISTINCT place_id) AS ids,
      bool_or(place_id !~ '^ocd-division/country:us/(state|district|territory):[^/]+$') AS local
      FROM entity_place WHERE entity_id=coalesce(alias.entity_id,original.value->>'id')) served_places ON true
    CROSS JOIN LATERAL (SELECT CASE WHEN alias.entity_id IS NULL THEN original.value ELSE original.value || jsonb_build_object(
      'id',alias.entity_id) END || jsonb_build_object('ocdId',CASE WHEN served_places.local
        AND original.value->>'ocdId' ~ '^ocd-division/country:us/(state|district|territory):[^/]+$'
        THEN NULL ELSE original.value->>'ocdId' END) || CASE WHEN served_places.ids IS NOT NULL
        THEN jsonb_build_object('alsoServesOcdIds',to_jsonb(served_places.ids)
        || coalesce(original.value->'alsoServesOcdIds','[]'::jsonb)) ELSE '{}'::jsonb END AS value) header
    WHERE ((original.value->>'ocdId'=ANY(ARRAY(SELECT id FROM selected_places)) AND (
        original.value->>'ocdId' !~ '^ocd-division/country:us/(state|district|territory):[^/]+$' OR NOT coalesce(served_places.local,false)))
      OR served_places.ids && ARRAY(SELECT id FROM selected_places)
      OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(coalesce(original.value->'alsoServesOcdIds','[]'::jsonb)) served WHERE served=ANY(ARRAY(SELECT id FROM selected_places)))
      OR coalesce(alias.entity_id,original.value->>'id')=ANY($3::text[]) OR $5::boolean
      OR coalesce(alias.entity_id,original.value->>'id') IN (SELECT id FROM owned WHERE kind='body'))
      AND (alias.entity_id IS NULL OR canonical.state=$1::char(2))
    ORDER BY header.value->>'id',alias.entity_id IS NOT NULL
), ancestors AS (
  SELECT id, parent_id FROM entity WHERE id=ANY(ARRAY(SELECT id FROM selected_places)) AND state=$1::char(2) AND id<>$4
  UNION
  SELECT p.id,p.parent_id FROM ancestors a JOIN entity p ON p.id=a.parent_id WHERE p.state=$1::char(2) AND p.id<>$4
), held_body_hosts AS MATERIALIZED (
  SELECT DISTINCT bh.host FROM entity b JOIN entity_host bh ON bh.entity_id=b.id
    WHERE b.kind='body' AND b.parent_id=$4 AND b.state=$1::char(2)
), local_government_hosts AS MATERIALIZED (
  SELECT lg.g,gh.host FROM local_governments lg
    JOIN entity_host gh ON gh.entity_id=lg.g->>'jurisdictionId'
    JOIN held_body_hosts held ON held.host=gh.host
    WHERE NOT EXISTS (SELECT 1 FROM entity_host o JOIN entity og ON og.id=o.entity_id AND og.kind='government' WHERE o.host=gh.host AND o.entity_id<>gh.entity_id)
      AND NOT EXISTS (SELECT 1 FROM domains d WHERE d.d->>'domain'=gh.host AND d.d->>'type' ~ '^(State|Federal|Interstate)')
), linked_bodies AS MATERIALIZED (
  -- Check shared-site ownership once per government host, then attach its held boards.
  SELECT DISTINCT b.id,a->>'divisionId' AS division FROM local_government_hosts lg
    CROSS JOIN LATERAL jsonb_array_elements(lg.g->'associations') a
    JOIN entity_host bh ON bh.host=lg.host
    JOIN entity b ON b.id=bh.entity_id AND b.kind='body' AND b.parent_id=$4 AND b.state=$1::char(2)
    WHERE a->>'divisionId'=ANY(ARRAY(SELECT id FROM selected_places))
    ORDER BY b.id,a->>'divisionId'
), covered AS (
  SELECT id FROM ancestors
  UNION SELECT ep.entity_id FROM entity_place ep JOIN ancestors a ON a.id=ep.place_id
  UNION SELECT g->>'id' FROM local_governments
  UNION SELECT g->>'jurisdictionId' FROM local_governments WHERE g->>'jurisdictionId' IS NOT NULL
  UNION SELECT id FROM linked_bodies
), owned AS (
  SELECT e.id,e.kind,e.name,e.parent_id,e.state FROM entity e JOIN covered c ON c.id=e.id
  UNION
  SELECT e.id,e.kind,e.name,e.parent_id,e.state FROM entity e JOIN owned p ON e.parent_id=p.id
    WHERE e.state=$1::char(2) AND e.kind IN ('government','body')
), bodies AS MATERIALIZED (
  SELECT id,kind,name,parent_id,state FROM owned WHERE kind='body'
  UNION SELECT id,kind,name,parent_id,state FROM entity
    WHERE (id=ANY($3::text[]) OR id IN (SELECT x.entity_id FROM entity_external_id x WHERE x.scheme='body-alias' AND x.value=ANY($3::text[]))
      OR id IN (SELECT value->>'id' FROM runtime_bodies) OR $5::boolean) AND state=$1::char(2) AND kind='body'
  UNION SELECT requested.id,'body',coalesce(r.value->>'name',requested.id),coalesce(r.value->>'ocdId',split_part(requested.id,'#',1)),$1
    FROM (SELECT unnest($3::text[]) AS id UNION SELECT value->>'id' FROM runtime_bodies) requested
    LEFT JOIN runtime_bodies r ON r.value->>'id'=requested.id
    WHERE NOT EXISTS (SELECT 1 FROM entity e WHERE e.id=requested.id)
      AND NOT EXISTS (SELECT 1 FROM entity_external_id x WHERE x.scheme='body-alias' AND x.value=requested.id)
), body_facts AS MATERIALIZED (
  SELECT f.*,s.url,b.name AS body_name,b.parent_id FROM bodies b
    CROSS JOIN LATERAL (SELECT * FROM fact WHERE entity_id=b.id AND status='live'
      AND ($8::text[] IS NULL OR field NOT LIKE 'member:%') OFFSET 0) f
    LEFT JOIN source_copy s ON s.id=f.source_copy_id
), members AS (
  SELECT f.entity_id AS body_id,f.body_name,substr(f.field,8) AS person_id,f.value,f.quote,f.checked_at,f.provenance_kind,f.url,
    coalesce((SELECT x.value FROM entity_external_id x WHERE x.entity_id=substr(f.field,8) AND x.scheme='roster-member' LIMIT 1),'') AS shown_id,
    coalesce((SELECT jsonb_object_agg(p.field,jsonb_build_object('value',p.value,'quote',p.quote,'url',s.url,'checked',p.checked_at))
      FROM fact p LEFT JOIN source_copy s ON s.id=p.source_copy_id WHERE p.entity_id=substr(f.field,8) AND p.status='live'
        AND (p.field=ANY(ARRAY[${rosterPersonFieldsSql}]) OR p.field=ANY(ARRAY(SELECT field||':'||f.entity_id FROM unnest(ARRAY[${rosterPersonFieldsSql}]) field)))),'{}'::jsonb) AS person
  FROM body_facts f WHERE $8::text[] IS NULL AND f.field LIKE 'member:%'
), runtime_rosters AS MATERIALIZED (
  SELECT CASE WHEN $8::text[] IS NULL THEN header.value ELSE (header.value-'members') || jsonb_build_object('members','[]'::jsonb) END AS item,
    CASE WHEN $8::text[] IS NULL THEN header.value ELSE (header.value-'members') || jsonb_build_object('members','[]'::jsonb) END AS value
    FROM runtime_root root,LATERAL reader_payload_members(root.value->'bodyRosters') r,
    LATERAL (SELECT reader_payload_node(r.item) AS original) source,
    LATERAL (SELECT CASE WHEN x.entity_id IS NULL THEN source.original ELSE jsonb_set(source.original,'{bodyId}',to_jsonb(x.entity_id)) END AS value
      FROM (SELECT (SELECT entity_id FROM entity_external_id WHERE scheme='body-alias' AND value=source.original->>'bodyId') AS entity_id) x) header
    WHERE header.value->>'bodyId' IN (SELECT id FROM bodies)
), runtime_members AS MATERIALIZED (
  SELECT reader_payload_node(m.item) AS value FROM runtime_rosters r,LATERAL reader_payload_members(r.value->'members') m WHERE $8::text[] IS NULL
), runtime_people AS MATERIALIZED (
  SELECT value->>'id' AS id FROM runtime_members
  UNION SELECT value->>'personId' FROM runtime_members
  UNION SELECT value->>'sourceRecordId' FROM runtime_members
  UNION SELECT alias#>>'{}' FROM runtime_members,
    LATERAL jsonb_path_query(reader_payload_value(value->'nativeIds'),'$.*[*]') alias
  UNION SELECT person_id FROM members
  UNION SELECT shown_id FROM members
  UNION SELECT reader_payload_node(reader_payload_node(e.item)->'holder')->>'id'
    FROM runtime_root root,LATERAL reader_payload_members(root.value->'statewideExecutives') e
    WHERE $8::text[] IS NULL AND reader_payload_node(e.item)->>'stateOcdId'=ANY(ARRAY(SELECT id FROM selected_places))
), runtime_divisions AS MATERIALIZED (
  SELECT d.item,header.value FROM runtime_registry r,LATERAL reader_payload_members(r.value->'divisions') d,
    LATERAL (SELECT reader_payload_node(d.item) AS value) header
), runtime_division_ids(id) AS (
  SELECT unnest(ARRAY(SELECT id FROM selected_places))
  UNION SELECT value->>'ocdId' FROM runtime_bodies
  UNION SELECT d.value->>'parentOcdId' FROM runtime_division_ids selected JOIN runtime_divisions d ON d.value->>'ocdId'=selected.id
    WHERE d.value->>'parentOcdId' IS NOT NULL
), runtime_candidacies AS MATERIALIZED (
  SELECT c.item,reader_payload_node(header.value->'holder') AS holder
    FROM runtime_root root,LATERAL reader_payload_members(reader_payload_node(root.value->'officialCandidacies')->'rows') c,
      LATERAL (SELECT reader_payload_node(c.item) AS value) header
    WHERE $8::text[] IS NULL AND (reader_payload_node(header.value->'holder')->>'id' IN (SELECT id FROM runtime_people)
      OR EXISTS (SELECT 1 FROM reader_payload_members(reader_payload_node(header.value->'holder')->'divisions') d
        WHERE d.item#>>'{}' IN (SELECT id FROM runtime_division_ids)))
), runtime_photos AS MATERIALIZED (
  SELECT p.item,header.value FROM runtime_root root,LATERAL reader_payload_members(reader_payload_node(root.value->'officialPhotos')->'photos') p,
    LATERAL (SELECT reader_payload_node(p.item) AS value) header
    WHERE $8::text[] IS NULL AND (header.value->>'officeholderId' IN (SELECT id FROM runtime_people UNION SELECT holder->>'id' FROM runtime_candidacies)
      OR header.value->>'personId' IN (SELECT id FROM runtime_people))
), sittings AS MATERIALIZED (
  SELECT b.id AS body_id,b.name AS body_name,m.id AS entity_id,f.field,f.value,f.quote,f.checked_at,s.url
    FROM bodies b CROSS JOIN LATERAL (SELECT id FROM entity WHERE parent_id=b.id AND kind='meeting' OFFSET 0) m
    CROSS JOIN LATERAL (SELECT * FROM fact WHERE entity_id=m.id AND status='live' OFFSET 0) f
    LEFT JOIN source_copy s ON s.id=f.source_copy_id
    WHERE $8::text[] IS NULL OR EXISTS (SELECT 1 FROM agenda_calendar_fallback) OR substr(m.id,9) IN (SELECT id FROM agenda_fact_ids)
), encoded_bodies AS MATERIALIZED (
  SELECT b.id,encoded.id AS encoded_id FROM bodies b
  CROSS JOIN LATERAL (SELECT string_agg(CASE WHEN ch ~ '^[A-Za-z0-9_.!~*''()-]$' THEN ch
    ELSE regexp_replace(upper(encode(convert_to(ch,'UTF8'),'hex')),'(..)','%\\1','g') END,'' ORDER BY n) AS id
    FROM regexp_split_to_table(b.id,'') WITH ORDINALITY AS chars(ch,n)) encoded
), meeting_partitions AS MATERIALIZED (
  SELECT p.scope,reader_payload_node(p.payload) AS header,p.current_version_id,
    (SELECT detail FROM (SELECT detail,sequence FROM civic_data_candidate_events WHERE candidate_id=p.current_version_id OFFSET 0) e
      WHERE left(e.detail,26)='UNCHANGED_CONFIRMATION_V1 ' ORDER BY sequence DESC LIMIT 1) AS confirmation
  FROM encoded_bodies b
  JOIN civic_data_promotions p ON p.record_class='MEETING' AND left(p.scope,7)='source:'
    AND split_part(p.scope,':',3)='body' AND split_part(p.scope,':',4)=b.encoded_id
    AND ($6::boolean OR right(p.scope,8)<>':history')
  UNION
  SELECT p.scope,reader_payload_node(p.payload) AS header,p.current_version_id,
    (SELECT detail FROM (SELECT detail,sequence FROM civic_data_candidate_events WHERE candidate_id=p.current_version_id OFFSET 0) e
      WHERE left(e.detail,26)='UNCHANGED_CONFIRMATION_V1 ' ORDER BY sequence DESC LIMIT 1) AS confirmation
  FROM (SELECT '' AS suffix UNION ALL SELECT ':history' WHERE $6::boolean) suffixes
  JOIN civic_data_promotions p ON p.key='MEETING:source:derived:family:US-'||$1||suffix AND p.record_class='MEETING'
), family_meetings AS MATERIALIZED (
  SELECT p.scope,m.ordinal_index,m.item,header.value->>'id' AS id
  FROM meeting_partitions p,LATERAL reader_payload_members(p.header->'meetings') m,
    LATERAL (SELECT reader_payload_node(m.item) AS value) header
  WHERE p.scope LIKE 'source:derived:family:%' AND (
    header.value->>'bodyId' IN (SELECT id FROM bodies)
    OR coalesce(header.value->>'bodyId','')='' AND header.value->>'ocdId'=ANY(ARRAY(SELECT id FROM selected_places)))
), meeting_rows AS MATERIALIZED (
  SELECT p.scope,CASE WHEN p.scope LIKE 'source:derived:family:%' THEN
    (p.header-'meetings'-'agendaDocuments'-'derivedMembers') || jsonb_build_object(
      'meetings',coalesce((SELECT jsonb_agg(m.item ORDER BY m.ordinal_index) FROM family_meetings m WHERE m.scope=p.scope
        AND ($8::text[] IS NULL OR EXISTS (SELECT 1 FROM agenda_calendar_fallback) OR m.id IN (SELECT id FROM agenda_relevant_ids))),'[]'::jsonb),
      'agendaDocuments',coalesce((SELECT jsonb_agg(${agendaDocumentSql("d")} ORDER BY d.ordinal_index)
        FROM reader_payload_members(p.header->'agendaDocuments') d
        WHERE $7::boolean AND ${fullAgendaDocumentSql("d")} AND reader_payload_node(d.item)->>'meetingId' IN (SELECT id FROM family_meetings m WHERE m.scope=p.scope)),'[]'::jsonb))
      || CASE WHEN $8::text[] IS NOT NULL THEN jsonb_build_object('agendaDocumentLinks',${agendaDocumentLinksSql("reader_payload_node(d.item)->>'meetingId' IN (SELECT id FROM family_meetings m WHERE m.scope=p.scope)")}) ELSE '{}'::jsonb END
      || CASE WHEN p.header ? 'derivedMembers' THEN jsonb_build_object('derivedMembers',coalesce((
        SELECT jsonb_agg(d.item ORDER BY d.ordinal_index) FROM reader_payload_members(p.header->'derivedMembers') d
        WHERE reader_payload_node(d.item)->>'bodyId' IN (SELECT id FROM bodies)),'[]'::jsonb)) ELSE '{}'::jsonb END
    ELSE (p.header-'agendaDocuments') || CASE WHEN $8::text[] IS NULL THEN '{}'::jsonb ELSE jsonb_build_object(
      'meetings',coalesce((SELECT jsonb_agg(m.item ORDER BY m.ordinal_index) FROM reader_payload_members(p.header->'meetings') m
        WHERE EXISTS (SELECT 1 FROM agenda_calendar_fallback) OR reader_payload_node(m.item)->>'id' IN (SELECT id FROM agenda_relevant_ids)),'[]'::jsonb)) END
      || jsonb_build_object('agendaDocuments',CASE WHEN $7::boolean THEN
      coalesce((SELECT jsonb_agg(${agendaDocumentSql("d")} ORDER BY d.ordinal_index)
        FROM reader_payload_members(p.header->'agendaDocuments') d WHERE ${fullAgendaDocumentSql("d")}
          AND ($8::text[] IS NULL OR ${ownedAgendaDocumentSql("d")})), '[]'::jsonb) ELSE '[]'::jsonb END)
      || CASE WHEN $8::text[] IS NOT NULL THEN jsonb_build_object('agendaDocumentLinks',${agendaDocumentLinksSql()}) ELSE '{}'::jsonb END
    END AS payload,p.current_version_id,p.confirmation FROM meeting_partitions p
), archived_versions AS MATERIALIZED (
  SELECT c.id,c.scope,c.retrieved_at
    FROM meeting_partitions p JOIN civic_data_candidates current ON current.id=p.current_version_id
    JOIN civic_data_candidates c ON c.record_class='MEETING' AND c.scope=p.scope AND c.source_id=current.source_id
    WHERE $6::boolean AND right(p.scope,8)<>':history' AND c.id<>p.current_version_id
      AND c.state='PROMOTED' AND c.acquisition_succeeded AND c.promoted_version_id=c.id AND c.last_known_good_version_id=c.id
      AND c.normalized_hash ~ '^[a-f0-9]{64}$' AND c.validation_receipt->>'decision'='GOOD'
      AND c.validation_receipt->>'candidateId'=c.id AND c.validation_receipt->>'recordClass'=c.record_class
      AND c.validation_receipt->>'scope'=c.scope AND c.validation_receipt->>'sourceId'=c.source_id
), archived_records AS MATERIALIZED (
  SELECT v.scope,v.retrieved_at,m.item,header.value AS header FROM archived_versions v
    CROSS JOIN LATERAL (SELECT candidate->'readModel' AS payload FROM civic_data_candidates WHERE id=v.id LIMIT 1) candidate
    CROSS JOIN LATERAL reader_payload_members(reader_payload_node(candidate.payload)->'meetings') m
    CROSS JOIN LATERAL (SELECT reader_payload_node(m.item) AS value) header
    WHERE header.value->>'bodyId' IN (SELECT id FROM bodies) AND header.value->>'id' IS NOT NULL
      AND CASE WHEN header.value->>'startsAt' ~ '^\\d{4}-\\d{2}-\\d{2}T'
        THEN (header.value->>'startsAt')::timestamptz < now()-make_interval(days=>${MEETING_HELD_LOOKBACK_DAYS}) ELSE false END
), archived_calendar AS MATERIALIZED (
  SELECT DISTINCT ON (header->>'id') scope,retrieved_at,item FROM archived_records
    ORDER BY header->>'id',retrieved_at DESC
), archived_meetings AS MATERIALIZED (
  SELECT * FROM archived_calendar WHERE $8::text[] IS NULL OR EXISTS (SELECT 1 FROM agenda_calendar_fallback)
    OR reader_payload_node(item)->>'id' IN (SELECT id FROM agenda_relevant_ids)
), archived_document_records AS MATERIALIZED (
  SELECT DISTINCT ON (reader_payload_node(d.item)->>'id') d.item FROM archived_versions v
    CROSS JOIN LATERAL (SELECT candidate->'readModel' AS payload FROM civic_data_candidates WHERE id=v.id LIMIT 1) candidate
    CROSS JOIN LATERAL reader_payload_members(reader_payload_node(candidate.payload)->'agendaDocuments') d
    WHERE $7::boolean AND reader_payload_node(d.item)->>'meetingId' IN (SELECT reader_payload_node(item)->>'id' FROM archived_calendar)
    ORDER BY reader_payload_node(d.item)->>'id',v.retrieved_at DESC
), archived_documents AS MATERIALIZED (
  SELECT ${agendaDocumentSql("d")} AS item FROM archived_document_records d WHERE ${fullAgendaDocumentSql("d")}
), archived_document_links AS MATERIALIZED (
  SELECT DISTINCT ${agendaDocumentLinkSql("d")} AS item FROM archived_document_records d WHERE NOT ${fullAgendaDocumentSql("d")}
    AND reader_payload_value(reader_payload_node(d.item)->'documentUrl') IN (SELECT value FROM agenda_full_urls)
), agenda_current_headers AS MATERIALIZED (
  SELECT p.scope,header.value FROM meeting_partitions p,LATERAL reader_payload_members(p.header->'meetings') m,
    LATERAL (SELECT reader_payload_node(m.item) AS value) header
    WHERE $8::text[] IS NOT NULL AND (header.value->>'bodyId' IN (SELECT id FROM bodies)
      OR coalesce(header.value->>'bodyId','')='' AND header.value->>'ocdId'=ANY(ARRAY(SELECT id FROM selected_places)))
), agenda_raw_headers AS MATERIALIZED (
  SELECT * FROM agenda_current_headers
  UNION ALL SELECT scope,reader_payload_node(item) FROM archived_calendar WHERE $8::text[] IS NOT NULL
), agenda_meeting_headers AS MATERIALIZED (
  SELECT scope,value,coalesce(nullif(value->>'bodyId',''),(value->>'ocdId')||':'||(value->>'bodyName')) AS body_key,
    CASE WHEN value->>'startsAt' ~ '^\\d{4}-\\d{2}-\\d{2}T' AND pg_input_is_valid(value->>'startsAt','timestamptz')
      THEN (value->>'startsAt')::timestamptz END AS raw_at
  FROM agenda_raw_headers
), agenda_header_ids AS MATERIALIZED (
  SELECT h.scope,h.value,h.body_key,h.raw_at,identity.id FROM agenda_meeting_headers h CROSS JOIN LATERAL (
    SELECT h.value->>'id' AS id UNION SELECT jsonb_array_elements_text(reader_payload_value(h.value->'mergedMeetingIds'))
  ) identity
), agenda_start_facts AS MATERIALIZED (
  SELECT substr(m.id,9) AS id,f.value->>'startsAt' AS value,
    CASE WHEN f.value->>'startsAt' ~ '^\\d{4}-\\d{2}-\\d{2}T' AND pg_input_is_valid(f.value->>'startsAt','timestamptz')
      THEN (f.value->>'startsAt')::timestamptz END AS starts_at
  FROM bodies b CROSS JOIN LATERAL (SELECT id FROM entity WHERE parent_id=b.id AND kind='meeting' OFFSET 0) m
    CROSS JOIN LATERAL (SELECT value FROM fact WHERE $8::text[] IS NOT NULL AND entity_id=m.id AND status='live' AND field='starts_at' OFFSET 0) f
), agenda_calendar_fallback AS MATERIALIZED (
  -- Ambiguous identities can change global duplicate-ID/merge decisions. Keep their original corpus intact.
  SELECT true AS needed WHERE EXISTS (SELECT 1 FROM agenda_meeting_headers h WHERE nullif(h.value->>'id','') IS NULL
    OR h.value->>'bodyId'='' OR h.body_key IS NULL OR h.raw_at IS NULL
    OR NOT EXISTS (SELECT 1 FROM pg_timezone_names z WHERE z.name=h.value->>'timeZone'))
    OR EXISTS (SELECT 1 FROM agenda_header_ids GROUP BY id HAVING count(DISTINCT jsonb_build_array(body_key,value->>'startsAt',value->>'timeZone'))>1)
    OR EXISTS (SELECT 1 FROM agenda_start_facts WHERE starts_at IS NULL)
    OR EXISTS (SELECT 1 FROM agenda_start_facts f WHERE f.id=ANY($8::text[]) AND NOT EXISTS (SELECT 1 FROM agenda_header_ids h WHERE h.id=f.id))
), agenda_targets AS MATERIALIZED (
  SELECT * FROM agenda_meeting_headers WHERE value->>'id'=ANY($8::text[])
    OR reader_payload_value(value->'mergedMeetingIds') ?| $8::text[]
), agenda_full_ids AS MATERIALIZED (
  SELECT unnest($8::text[]) AS id
  UNION SELECT m.value->>'id' FROM agenda_meeting_headers m WHERE EXISTS (SELECT 1 FROM agenda_calendar_fallback) OR EXISTS (
    SELECT 1 FROM agenda_targets target WHERE m.value->>'id'=target.value->>'id'
      OR m.body_key=target.body_key AND abs(extract(epoch FROM m.raw_at-target.raw_at))<=72*60*60)
), agenda_full_documents AS MATERIALIZED (
  SELECT header.value FROM (
    SELECT d.item FROM meeting_partitions p,LATERAL reader_payload_members(p.header->'agendaDocuments') d
      WHERE $7::boolean AND $8::text[] IS NOT NULL AND CASE WHEN p.scope LIKE 'source:derived:family:%'
        THEN reader_payload_node(d.item)->>'meetingId' IN (SELECT id FROM family_meetings m WHERE m.scope=p.scope)
        ELSE ${ownedAgendaDocumentSql("d")} END
    UNION ALL SELECT item FROM archived_document_records WHERE $8::text[] IS NOT NULL
  ) d,LATERAL (SELECT reader_payload_node(d.item) AS value) header
    WHERE EXISTS (SELECT 1 FROM agenda_calendar_fallback) OR header.value->>'meetingId' IN (SELECT id FROM agenda_full_ids)
), agenda_full_urls AS MATERIALIZED (
  SELECT DISTINCT reader_payload_value(value->'documentUrl') AS value FROM agenda_full_documents
), agenda_possible_times AS MATERIALIZED (
  SELECT value,body_key,raw_at AS starts_at FROM agenda_meeting_headers
  UNION SELECT h.value,h.body_key,f.starts_at FROM agenda_header_ids h JOIN agenda_start_facts f USING(id)
), agenda_context_seeds AS MATERIALIZED (
  SELECT id FROM agenda_full_ids
  UNION SELECT m.value->>'id' FROM agenda_possible_times m WHERE EXISTS (
    SELECT 1 FROM agenda_possible_times target WHERE target.value->>'id' IN (SELECT id FROM agenda_full_ids)
      AND m.body_key=target.body_key AND abs(extract(epoch FROM m.starts_at-target.starts_at))<=72*60*60)
  UNION SELECT reader_payload_node(d.item)->>'meetingId' FROM (
    SELECT d.item FROM meeting_partitions p,LATERAL reader_payload_members(p.header->'agendaDocuments') d
      WHERE $7::boolean AND $8::text[] IS NOT NULL
    UNION ALL SELECT item FROM archived_document_records WHERE $8::text[] IS NOT NULL
  ) d WHERE reader_payload_value(reader_payload_node(d.item)->'documentUrl') IN (SELECT value FROM agenda_full_urls)
), agenda_relevant_ids AS MATERIALIZED (
  SELECT id FROM agenda_context_seeds
  UNION SELECT m.value->>'id' FROM agenda_meeting_headers m WHERE EXISTS (
    SELECT 1 FROM agenda_meeting_headers seed WHERE seed.value->>'id' IN (SELECT id FROM agenda_context_seeds)
      AND m.body_key=seed.body_key AND abs(extract(epoch FROM m.raw_at-seed.raw_at))<=72*60*60)
), agenda_fact_ids AS MATERIALIZED (
  SELECT h.id FROM agenda_header_ids h WHERE h.value->>'id' IN (SELECT id FROM agenda_relevant_ids)
  UNION SELECT id FROM agenda_header_ids WHERE scope IN (${retiredMeetingScopesSql})
  UNION SELECT substr(m.id,9) FROM bodies b JOIN entity m ON m.parent_id=b.id AND m.kind='meeting'
    WHERE $8::text[] IS NOT NULL AND NOT EXISTS (SELECT 1 FROM agenda_header_ids h WHERE h.id=substr(m.id,9))
), agenda_text_candidates AS MATERIALIZED (
  SELECT reader_payload_value(value->'text') AS value FROM agenda_full_documents
    WHERE NOT coalesce(value->'text' ? '$civicPayloadPart',false)
), agenda_texts AS MATERIALIZED (
  SELECT (row_number() OVER (ORDER BY value)-1)::integer AS text_id,value
    FROM (SELECT DISTINCT value FROM agenda_text_candidates WHERE jsonb_typeof(value)='string') unique_texts
), hashes(hash) AS (
  SELECT ref#>>'{}' FROM (
    SELECT payload FROM meeting_rows UNION ALL SELECT item FROM archived_meetings UNION ALL SELECT item FROM archived_documents
  ) roots,LATERAL jsonb_path_query(payload,'strict $.**."$civicPayloadPart"','{}',true) ref
  UNION
  SELECT ref#>>'{}' FROM hashes
    CROSS JOIN LATERAL (SELECT payload FROM civic_data_payload_parts WHERE hash=hashes.hash LIMIT 1) part,
    LATERAL jsonb_path_query(part.payload,'strict $.**."$civicPayloadPart"','{}',true) ref
)
SELECT ${bodyFactsOnly ? 'false' : 'EXISTS(SELECT 1 FROM registration)'} AS registration_held,ARRAY(SELECT id FROM selected_places) AS division_ids,
  coalesce((SELECT jsonb_agg(value ORDER BY text_id) FROM agenda_texts),'[]'::jsonb) AS agenda_texts,
  CASE WHEN ${!bodyFactsOnly} THEN (SELECT reader_payload_value(payload) FROM civic_data_promotions WHERE $8::text[] IS NULL AND key='${everydayRoutingKey}' AND record_class='CURATED_READER_RECORD') END AS everyday_routing,
  '[]'::jsonb AS publication_attempts,
  CASE WHEN ${!bodyFactsOnly} THEN (SELECT reader_payload_value(root.value-'registry'-'bodyRosters'-'rosterReaderDispositions'-'statewideExecutives'-'officialCandidacies'-'officialPhotos'-'rosterPhotos')
    || jsonb_build_object('registry',reader_payload_value(r.value-'bodies'-'divisions') || jsonb_build_object(
      'bodies',coalesce((SELECT jsonb_agg(reader_payload_value(b.item) ORDER BY b.ordinal_index) FROM runtime_bodies b),'[]'::jsonb),
      'divisions',coalesce((SELECT jsonb_agg(reader_payload_value(d.item)) FROM runtime_divisions d WHERE d.value->>'ocdId' IN (SELECT id FROM runtime_division_ids)),'[]'::jsonb)),
      'bodyRosters',coalesce((SELECT jsonb_agg(reader_payload_value(item)) FROM runtime_rosters),'[]'::jsonb),
      'rosterReaderDispositions',CASE WHEN $8::text[] IS NULL THEN coalesce((SELECT jsonb_agg(reader_payload_value(d.item))
        FROM reader_payload_members(root.value->'rosterReaderDispositions') d,LATERAL (SELECT reader_payload_node(d.item) AS value) header
        WHERE header.value->>'sourceId' IN (SELECT id FROM runtime_people) OR header.value->>'canonicalId' IN (SELECT id FROM runtime_people)
          OR EXISTS (SELECT 1 FROM bodies b WHERE starts_with(header.value->>'sourceId','roster:'||b.id||'#'))),'[]'::jsonb) ELSE '[]'::jsonb END,
      'statewideExecutives',CASE WHEN $8::text[] IS NULL THEN coalesce((SELECT jsonb_agg(reader_payload_value(e.item)) FROM reader_payload_members(root.value->'statewideExecutives') e
        WHERE reader_payload_node(e.item)->>'stateOcdId'=ANY(ARRAY(SELECT id FROM selected_places))),'[]'::jsonb) ELSE '[]'::jsonb END,
      'officialCandidacies',reader_payload_value(reader_payload_node(root.value->'officialCandidacies')-'rows') || jsonb_build_object(
        'rows',coalesce((SELECT jsonb_agg(reader_payload_value(item)) FROM runtime_candidacies),'[]'::jsonb)),
      'officialPhotos',reader_payload_value(reader_payload_node(root.value->'officialPhotos')-'photos') || jsonb_build_object(
        'photos',coalesce((SELECT jsonb_agg(reader_payload_value(item)) FROM runtime_photos),'[]'::jsonb)),
      'rosterPhotos',CASE WHEN $8::text[] IS NULL THEN coalesce((SELECT jsonb_object_agg(photo.key,reader_payload_value(photo.value))
        FROM jsonb_each(reader_payload_node(root.value->'rosterPhotos')) photo
        WHERE photo.key IN (SELECT id FROM runtime_people UNION SELECT value->>'officeholderId' FROM runtime_photos)),'{}'::jsonb) ELSE '{}'::jsonb END)
    FROM runtime_root root CROSS JOIN runtime_registry r) END AS registry,
  CASE WHEN ${!bodyFactsOnly} THEN coalesce((SELECT jsonb_agg(g || jsonb_build_object('recipientNameUnique',g.recipient_names=1,'govDomains',coalesce((SELECT jsonb_agg(jsonb_build_object(
    'domain',d->>'domain','website','https://'||(d->>'domain'),'sourceUrl',source->>'url','checkedAt',source->>'readAt'))
    FROM domains d WHERE d.identity=g.identity AND g.identities=1 AND g.identity<>''),'[]'::jsonb))) FROM local_governments g),'[]'::jsonb) ELSE '[]'::jsonb END AS governments,
  CASE WHEN ${!bodyFactsOnly} THEN coalesce((SELECT jsonb_agg(reader_payload_value(member.item)) FROM registration,LATERAL reader_payload_members(payload->'divisions') member,
    LATERAL (SELECT reader_payload_node(member.item) AS d) division
    WHERE d->>'ocdId'=ANY(ARRAY(SELECT id FROM selected_places)) OR d->>'ocdId' IN (SELECT id FROM named_places)),'[]'::jsonb) ELSE '[]'::jsonb END AS divisions,
  coalesce((SELECT jsonb_agg(to_jsonb(b) || jsonb_build_object('placed',b.id IN (SELECT id FROM linked_bodies)
    OR EXISTS (SELECT 1 FROM entity_place ep WHERE ep.entity_id=b.id)
    OR EXISTS (SELECT 1 FROM entity g WHERE g.id=b.parent_id AND g.kind='government'),
    'linked',b.id IN (SELECT id FROM linked_bodies),
    'divisions',ARRAY(SELECT ep.place_id FROM entity_place ep WHERE ep.entity_id=b.id
      UNION SELECT l.division FROM linked_bodies l WHERE l.id=b.id),'division',coalesce(
    (SELECT CASE WHEN p.kind='place' THEN p.id WHEN gp.kind='place' THEN gp.id END FROM entity p LEFT JOIN entity gp ON gp.id=p.parent_id WHERE p.id=b.parent_id),
    split_part(b.id,'#',1)),'placement_basis',CASE WHEN EXISTS (
      SELECT 1 FROM entity_place ep WHERE ep.entity_id=b.id AND ep.placement_basis='HOST_COUNTY') THEN 'HOST_COUNTY' ELSE 'SERVICE_AREA' END,
    'government',(SELECT g.name FROM entity g WHERE g.id=b.parent_id AND g.kind='government' AND g.id ~ '^[a-z]{2}:special:'))) FROM bodies b),'[]'::jsonb) AS entities,
  coalesce((SELECT jsonb_agg(to_jsonb(f)) FROM body_facts f WHERE field IN ('name','homepage','meeting_cadence','agenda_url','office_address','office_phone')),'[]'::jsonb) AS fields,
  coalesce((SELECT jsonb_agg(to_jsonb(m) ORDER BY body_id,person_id) FROM members m),'[]'::jsonb) AS rosters,
  coalesce((SELECT jsonb_agg(to_jsonb(f) ORDER BY entity_id,field) FROM body_facts f WHERE field LIKE 'comment:%'),'[]'::jsonb) AS comments,
  coalesce((SELECT jsonb_agg(to_jsonb(s)) FROM sittings s),'[]'::jsonb) AS sittings,
  coalesce((SELECT jsonb_agg(to_jsonb(m)) FROM meeting_rows m),'[]'::jsonb) AS meeting_rows,
  coalesce((SELECT jsonb_agg(item) FROM archived_meetings),'[]'::jsonb) AS archived_meetings,
  coalesce((SELECT jsonb_agg(item) FROM archived_documents),'[]'::jsonb) AS archived_documents,
  coalesce((SELECT jsonb_agg(item) FROM archived_document_links),'[]'::jsonb) AS archived_document_links,
  coalesce((SELECT jsonb_object_agg(part.hash,part.payload) FROM hashes JOIN civic_data_payload_parts part USING(hash)),'{}'::jsonb) AS parts`;

export const PLACE_PACKAGE_SQL = placePackageSql(false);
const BODY_FACTS_PACKAGE_SQL = placePackageSql(true);


export async function buildPlaceRow(input: PlaceInput,query: Query): Promise<Record<string,unknown>> {
  const state = input.state.toUpperCase();
  const stateRoot = input.divisionIds.map(stateOcdIdFrom).find(Boolean) ?? `ocd-division/country:us/state:${state.toLowerCase()}`;
  const [row] = await query(input.bodyFactsOnly ? BODY_FACTS_PACKAGE_SQL : PLACE_PACKAGE_SQL,[state,input.divisionIds,input.bodyIds ?? [],stateRoot,
    input.allBodies ?? false,input.includeHistory ?? false,input.includeAgenda ?? true,null,input.neighbors ?? false,input.namedDivisionIds ?? []]);
  if (!row) throw new Error("PLACE_PAGE_BUILD_FAILED");
  const parts = new CivicPayloadParts({existing:async()=>[],write:async()=>{},read:async()=>{throw new Error("PLACE_PAGE_PART_MISSING");}});
  const expanded = await parts.loadOwned({rows:row.meeting_rows,archived:row.archived_meetings ?? [],documents:row.archived_documents ?? []},row.parts as Record<string,unknown>) as Record<string,unknown>;
  return {...row,meeting_rows:expanded.rows,archived_meetings:expanded.archived,archived_documents:expanded.documents,parts:{}};
}

/** The query is run by publication workers, never by a reader request. */
export async function buildPlacePackage(input: PlaceInput, query: Query) {
  return composePlaceRow(input, await buildPlaceRow(input,query));
}

export interface StoredPlacePage {
  readonly formatVersion: 1;
  readonly current: Record<string,unknown>;
  readonly history?: Record<string,unknown>;
  readonly emptyCurrent?: Record<string,unknown>;
  readonly emptyHistory?: Record<string,unknown>;
  readonly readyCurrent: PlacePackage;
  readonly readyHistory?: PlacePackage;
  readonly territory?: BodyTerritorySelection|null;
}

/** ZIP geometry is already held; it is the same selection used by the public endpoint. */
export async function placeBuildInput(id:string,kind:string,state:string):Promise<PlaceInput> {
  return (await placeBuildSelection(id,kind,state)).input;
}

async function placeBuildSelection(id:string,kind:string,state:string):Promise<{input:PlaceInput;territory?:BodyTerritorySelection|null}> {
  if (/^zip:\d{5}$/.test(id)) {
    const zip=id.slice(4),point=lookupZcta(zip);
    if(!point)throw new Error(`Place geometry is missing for ZIP ${zip}`);
    const location=await readerLocation(point.lat,point.lng,zip);
    const territory=selectBodyTerritory([point.lng,point.lat],await readerTerritory(state));
    return {input:{state,placeId:id,divisionIds:location.divisionIds,namedDivisionIds:location.fringe,
      bodyIds:territoryBodies(point.lat,point.lng,territory)},territory};
  }
  return {input:{state,divisionIds:kind==='place'?[id]:[],bodyIds:kind==='body'?[id]:[]}};
}

export async function buildPageBody(id:string,kind:string,state:string,query:Query):Promise<StoredPlacePage> {
  const {input:selected,territory}=await placeBuildSelection(id,kind,state),zip=/^zip:\d{5}$/.test(id);
  const input:PlaceInput=zip?{...selected,includeAgenda:false}:selected;
  const history=zip?undefined:await buildPlaceRow({...input,includeHistory:true},query);
  const current=history?currentPlaceRow(history):await buildPlaceRow(input,query);
  const stateRoot=kind==='place' && /^ocd-division\/country:us(?:\/(?:state|territory|district):[a-z]{2})?$/.test(id);
  const emptyHistory=stateRoot?await buildPlaceRow({...input,divisionIds:[],includeHistory:true},query):undefined;
  const readyCurrent=await composePlaceRow(input,structuredClone(current));
  return {formatVersion:1,current,readyCurrent,
    ...(zip?{territory}:{}),
    ...(history?{history,readyHistory:await composePlaceRow({...input,includeHistory:true},structuredClone(history))}:{}),
    ...(emptyHistory?{emptyCurrent:currentPlaceRow(emptyHistory),emptyHistory}:{})};
}

/** The history switch adds only history partitions and archived rows to the same place selection. */
function currentPlaceRow(history:Record<string,unknown>):Record<string,unknown> {
  return {...history,meeting_rows:(history.meeting_rows as Record<string,unknown>[])
    .filter(row=>!String(row.scope).endsWith(':history')),
    archived_meetings:[],archived_documents:[],archived_document_links:[]};
}

export interface RebuildOptions {
  readonly db?: FactDb;
  readonly purge?: ReaderCachePurger;
  readonly limit?: number;
  readonly concurrency?: number;
  readonly timeBudgetMs?: number;
  /** Build data during deployment; later versions leave cache purges for the published worker. */
  readonly initialBackfill?: boolean;
}

const CLAIM_PAGE_SQL = `WITH slot AS MATERIALIZED (
  SELECT n FROM generate_series(1,4) AS n WHERE NOT EXISTS (
    SELECT 1 FROM rebuild_queue q WHERE q.lease_slot=n AND q.lease_until>=clock_timestamp()
  ) ORDER BY n LIMIT 1
), next AS (
  SELECT q.place_id,slot.n FROM rebuild_queue q JOIN entity e ON e.id=q.place_id CROSS JOIN slot
  WHERE (q.lease_until IS NULL OR q.lease_until<clock_timestamp() OR $2::boolean AND q.lease_token IS NULL)
    AND (NOT $2::boolean OR q.built_generation IS DISTINCT FROM q.generation
      OR NOT EXISTS (SELECT 1 FROM place_page p WHERE p.place_id=q.place_id))
  ORDER BY q.queued_at,q.place_id FOR UPDATE OF q SKIP LOCKED LIMIT 1
) UPDATE rebuild_queue q SET lease_token=$1,lease_until=clock_timestamp()+interval '5 minutes',lease_slot=next.n,next_queued_at=NULL
  FROM next,entity e WHERE q.place_id=next.place_id AND e.id=q.place_id
  RETURNING q.place_id,q.generation,q.built_generation,e.kind,e.state,
    EXISTS (SELECT 1 FROM place_page p WHERE p.place_id=q.place_id) AS has_page`;

/** Leases separate slow building and CDN work from writers' short fact transactions. */
export async function rebuildPlacePages(options: RebuildOptions = {}): Promise<{rebuilt:number;failed:number;remaining:number}> {
  const db=options.db ?? readerFactDb(),purge=options.purge ?? purgeReaderCacheTags;
  const limit=Math.max(1,options.limit ?? 128),concurrency=Math.max(1,Math.min(options.concurrency ?? 4,limit));
  const deadline=Date.now()+(options.timeBudgetMs ?? 240_000);
  let started=0,rebuilt=0,failed=0;
  const work=async()=>{
    while(started<limit && Date.now()<deadline) {
      started++;
      const token=randomUUID();
      const claim=await db.transaction(async query=>{
        await query("SELECT pg_advisory_xact_lock(hashtextextended('place-page-rebuild-slots',0))");
        await query(`UPDATE rebuild_queue SET lease_token=NULL,lease_slot=NULL,lease_until=NULL
          WHERE lease_slot IS NOT NULL AND lease_until<clock_timestamp()`);
        return (await query(CLAIM_PAGE_SQL,[token,options.initialBackfill ?? false]))[0];
      });
      if(!claim)return;
      const id=String(claim.place_id),state=String(claim.state ?? "US");
      let built=claim.has_page===true && claim.built_generation!=null && String(claim.built_generation)===String(claim.generation);
      try {
        let firstVersion=false;
        if(!built) {
          const body=await db.transaction<StoredPlacePage>(async query=>{
            await query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
            return buildPageBody(id,String(claim.kind),state,query);
          });
          // Writers can queue a newer generation while the snapshot is being read.
          // Lock its lease only after leaving that snapshot, in this short transaction.
          firstVersion=await db.transaction(async query=>{
            // A worker whose lease expired cannot replace a newer worker's page.
            const [lease]=await query("SELECT place_id FROM rebuild_queue WHERE place_id=$1 AND lease_token=$2 FOR UPDATE",[id,token]);
            if(!lease)throw new Error("PLACE_PAGE_LEASE_REPLACED");
            const {readyCurrent,readyHistory,territory,...rawContext}=body;
            const context=/^zip:\d{5}$/.test(id)?{formatVersion:1}:packPlaceContext(rawContext);
            const [stored]=await query(`INSERT INTO place_page(place_id,version,built_at,body,history_body,context)
              VALUES($1,1,clock_timestamp(),$2::jsonb,$3::jsonb,$4::jsonb)
              ON CONFLICT(place_id) DO UPDATE SET version=place_page.version+1,built_at=excluded.built_at,
                body=excluded.body,history_body=excluded.history_body,context=excluded.context RETURNING version`,
            [id,JSON.stringify(packReadyPlace(readyCurrent,territory)),JSON.stringify(readyHistory ? packReadyPlace(readyHistory) : {}),JSON.stringify(context)]);
            const rows=Object.values(rawContext).filter((row):row is Record<string,unknown>=>
              !!row && typeof row==='object' && Array.isArray((row as Record<string,unknown>).entities));
            const dependencies=new Set<string>([id,...rows.flatMap(row=>[
              ...row.division_ids as string[] ?? [],
              ...(row.divisions as Record<string,unknown>[] ?? []).map(division=>String(division.ocdId)),
              ...(row.entities as Record<string,unknown>[] ?? []).flatMap(entity=>
                [entity.id,entity.parent_id,entity.division,...entity.divisions as string[] ?? []]
                  .filter((value):value is string=>typeof value==='string')),
              ...(row.rosters as Record<string,unknown>[] ?? []).map(member=>String(member.person_id)),
            ])]);
            await query("DELETE FROM place_page_dependency WHERE page_id=$1",[id]);
            await query(`INSERT INTO place_page_dependency(page_id,entity_id)
              SELECT $1,id FROM entity WHERE id=ANY($2::text[]) ON CONFLICT DO NOTHING`,[id,[...dependencies]]);
            await query("UPDATE rebuild_queue SET built_generation=$3::bigint WHERE place_id=$1 AND lease_token=$2",[id,token,claim.generation]);
            await query("SELECT count_hour_add($1,'Place pages','rebuilt',0,1,1)",[state]);
            return Number(stored?.version)===1;
          });
          built=true;
          rebuilt++;
        }
        if(!options.initialBackfill) {
          const result=await purge(readerCacheTags({places:[id]}));
          if(!result.purged)throw new Error(result.detail ?? "Place page cache purge failed");
        }
        await db.transaction(async query=>{
          if(!options.initialBackfill || firstVersion)
            await query("DELETE FROM rebuild_queue WHERE place_id=$1 AND generation=$2::bigint AND lease_token=$3",[id,claim.generation,token]);
          // A later generation waits from its own first arrival, so a hot place
          // cannot repeatedly take the oldest slot ahead of untouched places.
          await query(`UPDATE rebuild_queue SET queued_at=coalesce(next_queued_at,queued_at),
            lease_token=NULL,lease_slot=NULL,lease_until=NULL,next_queued_at=NULL
            WHERE place_id=$1 AND lease_token=$2`,[id,token]);
        });
      } catch(error) {
        failed++;
        console.error("Place page rebuild failed",{place:id,detail:error instanceof Error?error.message:String(error)});
        // A failed build retains the ready page; a failed purge leaves its built replacement queued.
        await db.transaction(query=>query(`UPDATE rebuild_queue SET
          queued_at=CASE WHEN $3::boolean THEN coalesce(next_queued_at,queued_at) ELSE queued_at END,
          next_queued_at=CASE WHEN $3::boolean THEN NULL ELSE next_queued_at END,
          lease_token=NULL,lease_slot=NULL,lease_until=clock_timestamp()+interval '1 minute'
          WHERE place_id=$1 AND lease_token=$2`,[id,token,built]));
      }
    }
  };
  await Promise.all(Array.from({length:concurrency},work));
  const [remaining]=await db.transaction(query=>query(`SELECT count(*)::int AS n FROM rebuild_queue q
    WHERE NOT $1::boolean OR q.built_generation IS DISTINCT FROM q.generation
      OR NOT EXISTS (SELECT 1 FROM place_page p WHERE p.place_id=q.place_id)`,[options.initialBackfill ?? false]));
  return {rebuilt,failed,remaining:Number(remaining?.n ?? 0)};
}
