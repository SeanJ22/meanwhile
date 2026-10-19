import { CivicPayloadParts } from "../civic-data/payload-parts.ts";
import { factReader } from "../facts/db.ts";
import { factCommentAccessFromRows } from "../facts/comment-read.ts";
import { sittingFactsFromRows, withSittingFacts } from "../facts/meeting-read.ts";
import type { Query } from "../facts/publish.ts";
import { bodyFieldsFromRows, type BodyFacts } from "../facts/registry-overlay.ts";
import { factRostersFromRows } from "../facts/roster-read.ts";
import { RETIRED_MEETING_ROUTES } from "../registry/source-wiring.ts";
import { collapseDuplicateSittings } from "../sources/composite/index.ts";
import { mergeDuplicateSittingFields, mergeReaderSittings } from "../meetings/sitting-merge.ts";
import { applyPartitionFreshCheck, confirmationCheckedAt, meetingVersionReadsASource } from "../meetings/fresh-checks.ts";
import { parseUnchangedConfirmation } from "../civic-data/unchanged-confirmation.ts";
import { stampMeetingDoor } from "../civic-data/fact-door.ts";
import { accountCarriedCollapses, snapshotCounts, type MeetingsSnapshot, type SnapshotSourceReport } from "../meetings/snapshot.ts";
import type { Meeting } from "../sources/types.ts";
import type { RegistrationGovernmentListing } from "../registration/listings.ts";
import type { Division } from "../registry/types.ts";
import { MEETING_HELD_LOOKBACK_DAYS } from "../meetings/constants.ts";
import { carriedFromAnswer } from "../meetings/carry-forward.ts";
import type { RegistryRuntimeReadModel } from "../registry/runtime-data-plane.ts";
import { EVERYDAY_ROUTING_POINTER } from "../routing/everyday-data-plane.ts";
import type { EverydayRoutingProjection } from "../routing/everyday.ts";
import type { PublicBodyAttempt } from "../registry/body-attempt-read.ts";
import { attemptFamilyOf } from "../registry/attempt-families.ts";

const everydayRoutingKey = `${EVERYDAY_ROUTING_POINTER.recordClass}:${EVERYDAY_ROUTING_POINTER.scope}`.replaceAll("'","''");

const normalizedGovernmentSql = (value: string) => {
  const flat = `btrim(regexp_replace(regexp_replace(replace(upper(${value}),'&',' AND '),'[^A-Z0-9, ]',' ','g'),'\\s+',' ','g'))`;
  return `btrim(regexp_replace(replace(regexp_replace(${flat},'^(.+?),\\s*(CITY|TOWN|TOWNSHIP|VILLAGE|BOROUGH|COUNTY)\\s+OF$','\\2 OF \\1'),',',''),'\\s+',' ','g'))`;
};

/** The place indexes lead to bodies; live facts and canonical source calendars are read together. */
export const PLACE_PACKAGE_SQL = `WITH RECURSIVE registration AS MATERIALIZED (
  SELECT payload FROM civic_data_promotions WHERE key='REGISTRATION:US-'||$1||':registration:v1' AND record_class='REGISTRATION'
), government_inventory AS MATERIALIZED (
  SELECT g,${normalizedGovernmentSql("g->>'name'")} AS identity FROM registration,
    LATERAL jsonb_array_elements(coalesce(payload->'governments','[]'::jsonb)) g
), government_identities AS MATERIALIZED (
  SELECT g,identity,count(*) OVER (PARTITION BY upper(g->>'state'),identity) AS identities FROM government_inventory
), local_governments AS MATERIALIZED (
  SELECT * FROM government_identities WHERE EXISTS (
    SELECT 1 FROM jsonb_array_elements(coalesce(g->'associations','[]'::jsonb)) a WHERE a->>'divisionId'=ANY($2::text[]))
), dotgov AS MATERIALIZED (
  SELECT payload->'domains' AS domains,payload->'source' AS source FROM civic_data_promotions
    WHERE key='DOTGOV_REFERENCE:US:current-full:domains' AND record_class='DOTGOV_REFERENCE'
), domains AS MATERIALIZED (
  SELECT d,${normalizedGovernmentSql("d->>'organization'")} AS identity,source FROM dotgov,
    LATERAL jsonb_array_elements(coalesce(domains,'[]'::jsonb)) d WHERE upper(d->>'state')=$1
), runtime_root AS MATERIALIZED (
  SELECT reader_payload_node(payload) AS value FROM civic_data_promotions
    WHERE key='REGISTRY_RUNTIME_BINDING:US-'||$1||':reader-registry-runtime' AND record_class='REGISTRY_RUNTIME_BINDING'
), runtime_registry AS MATERIALIZED (
  SELECT reader_payload_node(value->'registry') AS value FROM runtime_root
), runtime_bodies AS MATERIALIZED (
  SELECT b.item,header.value FROM runtime_registry r,LATERAL reader_payload_members(r.value->'bodies') b,
    LATERAL (SELECT reader_payload_node(b.item) AS value) header
    WHERE header.value->>'ocdId'=ANY($2::text[]) OR header.value->>'id'=ANY($3::text[]) OR $5::boolean
      OR header.value->>'id' IN (SELECT id FROM owned WHERE kind='body')
), ancestors AS (
  SELECT id, parent_id FROM entity WHERE id=ANY($2::text[]) AND state=$1 AND id<>$4
  UNION
  SELECT p.id,p.parent_id FROM ancestors a JOIN entity p ON p.id=a.parent_id WHERE p.state=$1 AND p.id<>$4
), covered AS (
  SELECT id FROM ancestors
  UNION SELECT ep.entity_id FROM entity_place ep JOIN ancestors a ON a.id=ep.place_id
), owned AS (
  SELECT e.id,e.kind,e.name,e.parent_id,e.state FROM entity e JOIN covered c ON c.id=e.id
  UNION
  SELECT e.id,e.kind,e.name,e.parent_id,e.state FROM entity e JOIN owned p ON e.parent_id=p.id
    WHERE e.state=$1 AND e.kind IN ('government','body')
), bodies AS MATERIALIZED (
  SELECT id,kind,name,parent_id,state FROM owned WHERE kind='body'
  UNION SELECT id,kind,name,parent_id,state FROM entity
    WHERE (id=ANY($3::text[]) OR id IN (SELECT value->>'id' FROM runtime_bodies) OR $5::boolean) AND state=$1 AND kind='body'
  UNION SELECT requested.id,'body',coalesce(r.value->>'name',requested.id),coalesce(r.value->>'ocdId',split_part(requested.id,'#',1)),$1
    FROM (SELECT unnest($3::text[]) AS id UNION SELECT value->>'id' FROM runtime_bodies) requested
    LEFT JOIN runtime_bodies r ON r.value->>'id'=requested.id
    WHERE NOT EXISTS (SELECT 1 FROM entity e WHERE e.id=requested.id)
), body_facts AS MATERIALIZED (
  SELECT f.*,s.url,b.name AS body_name,b.parent_id FROM bodies b
    CROSS JOIN LATERAL (SELECT * FROM fact WHERE entity_id=b.id AND status='live' OFFSET 0) f
    LEFT JOIN source_copy s ON s.id=f.source_copy_id
), members AS (
  SELECT f.entity_id AS body_id,f.body_name,substr(f.field,8) AS person_id,f.value,f.quote,f.checked_at,f.provenance_kind,f.url,
    coalesce((SELECT x.value FROM entity_external_id x WHERE x.entity_id=substr(f.field,8) AND x.scheme='roster-member' LIMIT 1),'') AS shown_id,
    coalesce((SELECT jsonb_object_agg(p.field,jsonb_build_object('value',p.value,'quote',p.quote,'url',s.url,'checked',p.checked_at))
      FROM fact p LEFT JOIN source_copy s ON s.id=p.source_copy_id WHERE p.entity_id=substr(f.field,8) AND p.status='live'),'{}'::jsonb) AS person
  FROM body_facts f WHERE f.field LIKE 'member:%'
), runtime_rosters AS MATERIALIZED (
  SELECT r.item,header.value FROM runtime_root root,LATERAL reader_payload_members(root.value->'bodyRosters') r,
    LATERAL (SELECT reader_payload_node(r.item) AS value) header
    WHERE header.value->>'bodyId' IN (SELECT id FROM bodies)
), runtime_members AS MATERIALIZED (
  SELECT reader_payload_node(m.item) AS value FROM runtime_rosters r,LATERAL reader_payload_members(r.value->'members') m
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
    WHERE reader_payload_node(e.item)->>'stateOcdId'=ANY($2::text[])
), runtime_divisions AS MATERIALIZED (
  SELECT d.item,header.value FROM runtime_registry r,LATERAL reader_payload_members(r.value->'divisions') d,
    LATERAL (SELECT reader_payload_node(d.item) AS value) header
), runtime_division_ids(id) AS (
  SELECT unnest($2::text[])
  UNION SELECT value->>'ocdId' FROM runtime_bodies
  UNION SELECT d.value->>'parentOcdId' FROM runtime_division_ids selected JOIN runtime_divisions d ON d.value->>'ocdId'=selected.id
    WHERE d.value->>'parentOcdId' IS NOT NULL
), runtime_candidacies AS MATERIALIZED (
  SELECT c.item,reader_payload_node(header.value->'holder') AS holder
    FROM runtime_root root,LATERAL reader_payload_members(reader_payload_node(root.value->'officialCandidacies')->'rows') c,
      LATERAL (SELECT reader_payload_node(c.item) AS value) header
    WHERE reader_payload_node(header.value->'holder')->>'id' IN (SELECT id FROM runtime_people)
      OR EXISTS (SELECT 1 FROM reader_payload_members(reader_payload_node(header.value->'holder')->'divisions') d
        WHERE d.item#>>'{}' IN (SELECT id FROM runtime_division_ids))
), runtime_photos AS MATERIALIZED (
  SELECT p.item,header.value FROM runtime_root root,LATERAL reader_payload_members(reader_payload_node(root.value->'officialPhotos')->'photos') p,
    LATERAL (SELECT reader_payload_node(p.item) AS value) header
    WHERE header.value->>'officeholderId' IN (SELECT id FROM runtime_people UNION SELECT holder->>'id' FROM runtime_candidacies)
      OR header.value->>'personId' IN (SELECT id FROM runtime_people)
), sittings AS MATERIALIZED (
  SELECT b.id AS body_id,b.name AS body_name,m.id AS entity_id,f.field,f.value,f.quote,f.checked_at,s.url
    FROM bodies b CROSS JOIN LATERAL (SELECT id FROM entity WHERE parent_id=b.id AND kind='meeting' OFFSET 0) m
    CROSS JOIN LATERAL (SELECT * FROM fact WHERE entity_id=m.id AND status='live' OFFSET 0) f
    LEFT JOIN source_copy s ON s.id=f.source_copy_id
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
    OR coalesce(header.value->>'bodyId','')='' AND header.value->>'ocdId'=ANY($2::text[]))
), meeting_rows AS MATERIALIZED (
  SELECT p.scope,CASE WHEN p.scope LIKE 'source:derived:family:%' THEN
    (p.header-'meetings'-'agendaDocuments'-'derivedMembers') || jsonb_build_object(
      'meetings',coalesce((SELECT jsonb_agg(m.item ORDER BY m.ordinal_index) FROM family_meetings m WHERE m.scope=p.scope),'[]'::jsonb),
      'agendaDocuments',coalesce((SELECT jsonb_agg(d.item ORDER BY d.ordinal_index)
        FROM reader_payload_members(p.header->'agendaDocuments') d
        WHERE $7::boolean AND reader_payload_node(d.item)->>'meetingId' IN (SELECT id FROM family_meetings m WHERE m.scope=p.scope)),'[]'::jsonb))
      || CASE WHEN p.header ? 'derivedMembers' THEN jsonb_build_object('derivedMembers',coalesce((
        SELECT jsonb_agg(d.item ORDER BY d.ordinal_index) FROM reader_payload_members(p.header->'derivedMembers') d
        WHERE reader_payload_node(d.item)->>'bodyId' IN (SELECT id FROM bodies)),'[]'::jsonb)) ELSE '{}'::jsonb END
    ELSE CASE WHEN $7::boolean THEN p.header ELSE (p.header-'agendaDocuments') || jsonb_build_object('agendaDocuments','[]'::jsonb) END
    END AS payload,p.current_version_id,p.confirmation FROM meeting_partitions p
), archived_versions AS MATERIALIZED (
  SELECT c.scope,c.retrieved_at,c.candidate->'readModel' AS payload
    FROM meeting_rows p JOIN civic_data_candidates current ON current.id=p.current_version_id
    JOIN civic_data_candidates c ON c.record_class='MEETING' AND c.scope=p.scope AND c.source_id=current.source_id
    WHERE $6::boolean AND right(p.scope,8)<>':history' AND c.id<>p.current_version_id
      AND c.state='PROMOTED' AND c.acquisition_succeeded AND c.promoted_version_id=c.id AND c.last_known_good_version_id=c.id
      AND c.normalized_hash ~ '^[a-f0-9]{64}$' AND c.validation_receipt->>'decision'='GOOD'
      AND c.validation_receipt->>'candidateId'=c.id AND c.validation_receipt->>'recordClass'=c.record_class
      AND c.validation_receipt->>'scope'=c.scope AND c.validation_receipt->>'sourceId'=c.source_id
), archived_records AS MATERIALIZED (
  SELECT v.scope,v.retrieved_at,m.item,reader_payload_node(m.item) AS header FROM archived_versions v,
    LATERAL reader_payload_members(reader_payload_node(v.payload)->'meetings') m
), archived_meetings AS MATERIALIZED (
  SELECT DISTINCT ON (header->>'id') scope,retrieved_at,item FROM archived_records
    WHERE header->>'bodyId' IN (SELECT id FROM bodies) AND header->>'id' IS NOT NULL
      AND CASE WHEN header->>'startsAt' ~ '^\\d{4}-\\d{2}-\\d{2}T'
        THEN (header->>'startsAt')::timestamptz < now()-make_interval(days=>${MEETING_HELD_LOOKBACK_DAYS}) ELSE false END
    ORDER BY header->>'id',retrieved_at DESC
), archived_documents AS MATERIALIZED (
  SELECT DISTINCT ON (reader_payload_node(d.item)->>'id') d.item FROM archived_versions v,
    LATERAL reader_payload_members(reader_payload_node(v.payload)->'agendaDocuments') d
    WHERE $7::boolean AND reader_payload_node(d.item)->>'meetingId' IN (SELECT reader_payload_node(item)->>'id' FROM archived_meetings)
    ORDER BY reader_payload_node(d.item)->>'id',v.retrieved_at DESC
), hashes(hash) AS (
  SELECT ref#>>'{}' FROM (
    SELECT payload FROM meeting_rows UNION ALL SELECT item FROM archived_meetings UNION ALL SELECT item FROM archived_documents
  ) roots,LATERAL jsonb_path_query(payload,'strict $.**."$civicPayloadPart"','{}',true) ref
  UNION
  SELECT ref#>>'{}' FROM hashes
    CROSS JOIN LATERAL (SELECT payload FROM civic_data_payload_parts WHERE hash=hashes.hash LIMIT 1) part,
    LATERAL jsonb_path_query(part.payload,'strict $.**."$civicPayloadPart"','{}',true) ref
)
SELECT EXISTS(SELECT 1 FROM registration) AS registration_held,
  (SELECT reader_payload_value(payload) FROM civic_data_promotions WHERE key='${everydayRoutingKey}' AND record_class='CURATED_READER_RECORD') AS everyday_routing,
  coalesce((SELECT jsonb_agg(jsonb_build_object(
      'bodyId',w.value#>'{autonomousPlan,publication,bodyId}','contractId',w.value#>'{autonomousPlan,publication,contractId}',
      'at',w.value#>'{publicationOutcome,at}','status',w.value#>'{publicationOutcome,status}','code',w.value#>'{publicationOutcome,code}',
      'sourceUrl',CASE WHEN w.value#>>'{autonomousPlan,contract,schemaVersion}'='2' THEN w.value#>'{autonomousPlan,contract,sourceScope,canonicalUrls,0}' ELSE NULL END,
      'acceptedCount',coalesce(jsonb_array_length(w.value#>'{publicationOutcome,acceptedMembers}'),
        jsonb_array_length(w.value#>'{publicationOutcome,acceptedRecordIds}'),jsonb_array_length(w.value#>'{publicationOutcome,bodyIds}')),
      'versionId',w.value#>'{publicationOutcome,versionId}') ORDER BY w.value#>>'{publicationOutcome,at}' DESC,w.id)
    FROM cp_work_items w WHERE (w.value#>>'{autonomousPlan,publication,bodyId}')=ANY(ARRAY(SELECT id FROM bodies))
      AND w.value ? 'publicationOutcome'),'[]'::jsonb) AS publication_attempts,
  (SELECT reader_payload_value(root.value-'registry'-'bodyRosters'-'rosterReaderDispositions'-'statewideExecutives'-'officialCandidacies'-'officialPhotos'-'rosterPhotos')
    || jsonb_build_object('registry',reader_payload_value(r.value-'bodies'-'divisions') || jsonb_build_object(
      'bodies',coalesce((SELECT jsonb_agg(reader_payload_value(b.item)) FROM runtime_bodies b),'[]'::jsonb),
      'divisions',coalesce((SELECT jsonb_agg(reader_payload_value(d.item)) FROM runtime_divisions d WHERE d.value->>'ocdId' IN (SELECT id FROM runtime_division_ids)),'[]'::jsonb)),
      'bodyRosters',coalesce((SELECT jsonb_agg(reader_payload_value(item)) FROM runtime_rosters),'[]'::jsonb),
      'rosterReaderDispositions',coalesce((SELECT jsonb_agg(reader_payload_value(d.item))
        FROM reader_payload_members(root.value->'rosterReaderDispositions') d,LATERAL (SELECT reader_payload_node(d.item) AS value) header
        WHERE header.value->>'sourceId' IN (SELECT id FROM runtime_people) OR header.value->>'canonicalId' IN (SELECT id FROM runtime_people)
          OR EXISTS (SELECT 1 FROM bodies b WHERE starts_with(header.value->>'sourceId','roster:'||b.id||'#'))),'[]'::jsonb),
      'statewideExecutives',coalesce((SELECT jsonb_agg(reader_payload_value(e.item)) FROM reader_payload_members(root.value->'statewideExecutives') e
        WHERE reader_payload_node(e.item)->>'stateOcdId'=ANY($2::text[])),'[]'::jsonb),
      'officialCandidacies',reader_payload_value(reader_payload_node(root.value->'officialCandidacies')-'rows') || jsonb_build_object(
        'rows',coalesce((SELECT jsonb_agg(reader_payload_value(item)) FROM runtime_candidacies),'[]'::jsonb)),
      'officialPhotos',reader_payload_value(reader_payload_node(root.value->'officialPhotos')-'photos') || jsonb_build_object(
        'photos',coalesce((SELECT jsonb_agg(reader_payload_value(item)) FROM runtime_photos),'[]'::jsonb)),
      'rosterPhotos',coalesce((SELECT jsonb_object_agg(photo.key,reader_payload_value(photo.value))
        FROM jsonb_each(reader_payload_node(root.value->'rosterPhotos')) photo
        WHERE photo.key IN (SELECT id FROM runtime_people UNION SELECT value->>'officeholderId' FROM runtime_photos)),'{}'::jsonb))
    FROM runtime_root root CROSS JOIN runtime_registry r) AS registry,
  coalesce((SELECT jsonb_agg(g || jsonb_build_object('govDomains',coalesce((SELECT jsonb_agg(jsonb_build_object(
    'domain',d->>'domain','website','https://'||(d->>'domain'),'sourceUrl',source->>'url','checkedAt',source->>'readAt'))
    FROM domains d WHERE d.identity=g.identity AND g.identities=1 AND g.identity<>''),'[]'::jsonb))) FROM local_governments g),'[]'::jsonb) AS governments,
  coalesce((SELECT jsonb_agg(d) FROM registration,LATERAL jsonb_array_elements(coalesce(payload->'divisions','[]'::jsonb)) d
    WHERE d->>'ocdId'=ANY($2::text[])),'[]'::jsonb) AS divisions,
  coalesce((SELECT jsonb_agg(to_jsonb(b) || jsonb_build_object('division',coalesce(
    (SELECT ep.place_id FROM entity_place ep WHERE ep.entity_id=b.id ORDER BY ep.place_id LIMIT 1),
    (SELECT CASE WHEN p.kind='place' THEN p.id WHEN gp.kind='place' THEN gp.id END FROM entity p LEFT JOIN entity gp ON gp.id=p.parent_id WHERE p.id=b.parent_id),
    split_part(b.id,'#',1)))) FROM bodies b),'[]'::jsonb) AS entities,
  coalesce((SELECT jsonb_agg(to_jsonb(f)) FROM body_facts f WHERE field IN ('name','homepage','meeting_cadence','agenda_url','office_address','office_phone')),'[]'::jsonb) AS fields,
  coalesce((SELECT jsonb_agg(to_jsonb(m) ORDER BY body_id,person_id) FROM members m),'[]'::jsonb) AS rosters,
  coalesce((SELECT jsonb_agg(to_jsonb(f) ORDER BY entity_id,field) FROM body_facts f WHERE field LIKE 'comment:%'),'[]'::jsonb) AS comments,
  coalesce((SELECT jsonb_agg(to_jsonb(s)) FROM sittings s),'[]'::jsonb) AS sittings,
  coalesce((SELECT jsonb_agg(to_jsonb(m)) FROM meeting_rows m),'[]'::jsonb) AS meeting_rows,
  coalesce((SELECT jsonb_agg(item) FROM archived_meetings),'[]'::jsonb) AS archived_meetings,
  coalesce((SELECT jsonb_agg(item) FROM archived_documents),'[]'::jsonb) AS archived_documents,
  coalesce((SELECT jsonb_object_agg(part.hash,part.payload) FROM hashes JOIN civic_data_payload_parts part USING(hash)),'{}'::jsonb) AS parts`;

type Row = Record<string, unknown>;
export interface PlacePackage {
  readonly registry: RegistryRuntimeReadModel | null;
  readonly everydayRouting: EverydayRoutingProjection | null;
  readonly publicationAttempts: readonly PublicBodyAttempt[];
  readonly bodies: readonly BodyFacts[];
  readonly governments: readonly RegistrationGovernmentListing[];
  readonly divisions: readonly Division[];
  readonly registrationHeld: boolean;
  readonly meetings: readonly Meeting[];
  readonly snapshot: MeetingsSnapshot;
  readonly bodySnapshots: Readonly<Record<string, MeetingsSnapshot>>;
}

/** A ZIP's local facts are visible directly from the fact store, without a runner-made copy. */
export async function readPlacePackage(input: { readonly state: string; readonly divisionIds: readonly string[]; readonly bodyIds?: readonly string[]; readonly allBodies?: boolean; readonly includeHistory?: boolean; readonly includeAgenda?: boolean },
  query: Query | null = factReader()): Promise<PlacePackage> {
  if (!query) throw new Error("FACT_STORE_DATABASE_URL_MISSING");
  const state = input.state.toUpperCase();
  const [row] = await query(PLACE_PACKAGE_SQL, [state, input.divisionIds, input.bodyIds ?? [], `ocd-division/country:us/state:${state.toLowerCase()}`,
    input.allBodies ?? false,input.includeHistory ?? false,input.includeAgenda ?? false]);
  if (!row) throw new Error("PLACE_PACKAGE_READ_FAILED");
  const entities = row.entities as Row[], rawSittings = row.sittings as Row[];
  const fields = bodyFieldsFromRows(row.fields as Row[]), { rosters, dispositions } = factRostersFromRows(row.rosters as Row[]);
  const roster = new Map(rosters.map(r => [r.bodyId,r])), comments = new Map(factCommentAccessFromRows(row.comments as Row[]).map(c => [c.bodyId,c]));
  const sittings = sittingFactsFromRows(rawSittings), disposition = new Map(dispositions.map(d => [d.sourceId,d]));
  const bodies: BodyFacts[] = entities.map(e => {
    const id = String(e.id), own = roster.get(id) ?? null;
    return { id, division: String(e.division), fields: fields[id] ? {...fields[id],ocdId:String(e.division).startsWith("ocd-division/") ? String(e.division) : null} : {}, roster: own, comment: comments.get(id) ?? null,
      dispositions: own?.members.flatMap(m => disposition.get(m.id) ?? []) ?? [], sittings: sittings.get(id) ?? [] };
  });
  const parts = new CivicPayloadParts({ existing: async () => [], write: async () => {}, read: async () => { throw new Error("PLACE_PACKAGE_PART_MISSING"); } });
  const decoded = await parts.loadOwned({rows:row.meeting_rows,archived:row.archived_meetings ?? [],documents:row.archived_documents ?? []},row.parts as Record<string, unknown>) as {
    rows:{scope: string; payload: MeetingsSnapshot; current_version_id: string; confirmation: string | null}[];
    archived:Meeting[];documents:MeetingsSnapshot["agendaDocuments"];
  };
  const rows = decoded.rows;
  if (!input.includeAgenda) for (const r of rows) r.payload.agendaDocuments = [];
  const selected = new Set(entities.map(e => String(e.id))), scopes = new Set(rows.map(r => r.scope));
  const byBody = new Map<string, MeetingsSnapshot[]>();
  const snapshots = rows.flatMap(r => {
    const retired = RETIRED_MEETING_ROUTES.find(route => r.scope === `source:${encodeURIComponent(route.meetingSource)}:body:${encodeURIComponent(route.bodyId)}`);
    if (retired && (retired.successorAlreadyWired || scopes.has(`source:${encodeURIComponent(retired.replacedBy)}:body:${encodeURIComponent(retired.bodyId)}`))) return [];
    const family = r.scope.startsWith("source:derived:family:");
    const owned = r.payload.meetings.filter(m => (m.bodyId && selected.has(m.bodyId)) || (!m.bodyId && m.ocdId && input.divisionIds.includes(m.ocdId)));
    const ids = new Set(owned.map(m => m.id));
    const confirmation = r.confirmation ? parseUnchangedConfirmation(r.confirmation) : null;
    const checked = confirmationCheckedAt(confirmation,r.current_version_id,meetingVersionReadsASource(r.payload.sources));
    const scope = /^source:([^:]+):body:(.+?)(?::history)?$/.exec(r.scope);
    const sources = family ? familySources(r.payload,owned,selected) : r.payload.sources;
    const own = {...r.payload,sources,meetings:owned,agendaDocuments:r.payload.agendaDocuments.filter(d => ids.has(d.meetingId))};
    const stamped = stampMeetingDoor({id:scope ? `meetings:${decodeURIComponent(scope[1]!)}:${scope[2]}` : r.scope,derivedFamily:family ? state : null},applyPartitionFreshCheck(own,checked));
    const owners = family ? [...new Set([...owned.flatMap(m => m.bodyId ?? []),...r.payload.derivedMembers?.filter(m => selected.has(m.bodyId)).map(m => m.bodyId) ?? []])]
      : scope ? [decodeURIComponent(scope[2]!)] : [];
    for (const bodyId of owners) {
      const meetings = stamped.meetings.filter(m => m.bodyId === bodyId), ids = new Set(meetings.map(m => m.id));
      const source = {...stamped,meetings,sources:family ? familySources(r.payload,meetings,new Set([bodyId])) : stamped.sources,
        agendaDocuments:stamped.agendaDocuments.filter(d => ids.has(d.meetingId))};
      byBody.set(bodyId,[...byBody.get(bodyId) ?? [],source]);
    }
    return [stamped];
  });
  const liveIds = new Set(snapshots.flatMap(s => s.meetings.flatMap(m => [m.id,...m.mergedMeetingIds ?? []])));
  const archived = decoded.archived.filter(m => !liveIds.has(m.id));
  if (archived.length) {
    const ids = new Set(archived.map(m => m.id));
    const snapshot: MeetingsSnapshot = {formatVersion:1,generatedAt:archived.map(m => m.provenance.collectedAt).sort().at(-1)!,
      meetings:archived,agendaDocuments:decoded.documents.filter(d => ids.has(d.meetingId)),sources:[],counts:snapshotCounts(archived,0)};
    snapshots.push(snapshot);
    for (const bodyId of new Set(archived.flatMap(m => m.bodyId ?? []))) {
      const meetings = archived.filter(m => m.bodyId === bodyId), ids = new Set(meetings.map(m => m.id));
      byBody.set(bodyId,[...byBody.get(bodyId) ?? [],{...snapshot,meetings,agendaDocuments:snapshot.agendaDocuments.filter(d => ids.has(d.meetingId))}]);
    }
  }
  const exact = collapseDuplicateSittings(snapshots.flatMap(s => s.meetings),mergeDuplicateSittingFields);
  const merged = mergeReaderSittings(exact.rows), meetings = merged.rows;
  const heldIds = new Set(meetings.flatMap(m => [m.id,...m.mergedMeetingIds ?? []]));
  // An independently published sitting is visible even before its calendar's next refresh.
  const fresh = new Map<string, Row[]>();
  for (const fact of rawSittings) {
    const id = String(fact.entity_id).slice("meeting:".length);
    if (!heldIds.has(id)) fresh.set(id,[...fresh.get(id) ?? [],fact]);
  }
  for (const [id,facts] of fresh) {
    const title = facts.find(f => f.field === "title"), start = facts.find(f => f.field === "starts_at");
    if (!title || !start) continue;
    const date = start.value as { startsAt: string; timeZone: string; precision?: "DAY" | "MINUTE" };
    const sourceUrl = String(title.url), at = new Date(title.checked_at as string).toISOString();
    meetings.push({ id,bodyId: String(title.body_id),bodyName: String(title.body_name),ocdId: String(title.body_id).startsWith("ocd-division/") ? String(title.body_id).split("#")[0]! : null,
      title: String(title.value),startsAt: date.startsAt,timeZone: date.timeZone,...(date.precision ? { startPrecision: date.precision } : {}),location: null,agendaUrl: null,
      jurisdiction: "Local",status: "SCHEDULED",provenance: { sourceUrl,sourceOrg: new URL(sourceUrl).hostname,collectedAt: at,verifiedAt: at } });
  }
  const overlaid = withSittingFacts(meetings,[...sittings.values()].flat()).sort((a,b) => Date.parse(a.startsAt)-Date.parse(b.startsAt) || a.id.localeCompare(b.id));
  const accounting = accountCarriedCollapses(snapshots,snapshots.flatMap(s => s.sources),[...exact.dropped,...merged.dropped]);
  const snapshot: MeetingsSnapshot = { formatVersion: 1,generatedAt: snapshots.map(s => s.generatedAt).sort().at(-1) ?? new Date(0).toISOString(),
    counts: snapshotCounts(overlaid,accounting.freshCollapsed),sources: [...accounting.sources],meetings: overlaid,agendaDocuments: snapshots.flatMap(s => s.agendaDocuments).map(d => ({...d,meetingId:merged.aliases.get(d.meetingId) ?? d.meetingId})) };
  // A published calendar names its body independently of the reviewed registry.
  // Use that source only where an independently published body-name fact is absent.
  for (const body of bodies) {
    if (body.fields.name) continue;
    const named = overlaid.filter(m => m.bodyId === body.id && m.bodyName.trim() && m.provenance?.sourceUrl)
      .sort((a,b) => Date.parse(b.provenance.collectedAt)-Date.parse(a.provenance.collectedAt))[0];
    if (!named) continue;
    Object.assign(body.fields,{name:named.bodyName,bodyOrigin:"SOURCED",sourceDataset:"DERIVED",provenance:named.provenance,
      ocdId:named.ocdId ?? (body.division.startsWith("ocd-division/") ? body.division : null)});
  }
  const bodySnapshots = Object.fromEntries(bodies.map(body => {
    const meetings = overlaid.filter(m => m.bodyId === body.id), ids = new Set(meetings.map(m => m.id)), sources = byBody.get(body.id) ?? [];
    const accounting = accountCarriedCollapses(sources,sources.flatMap(s => s.sources),[...exact.dropped,...merged.dropped].filter(m => m.bodyId === body.id));
    return [body.id,{...snapshot,generatedAt:sources.map(s => s.generatedAt).sort().at(-1) ?? snapshot.generatedAt,meetings,
      counts:snapshotCounts(meetings,accounting.freshCollapsed),sources:[...accounting.sources],agendaDocuments:snapshot.agendaDocuments.filter(d => ids.has(d.meetingId))}];
  }));
  return { registry:row.registry as RegistryRuntimeReadModel | null ?? null,everydayRouting:row.everyday_routing as EverydayRoutingProjection | null ?? null,
    publicationAttempts:((row.publication_attempts ?? []) as (Omit<PublicBodyAttempt,"family"> & {contractId?:string})[])
      .map(({contractId,...attempt}) => ({...attempt,family:attemptFamilyOf(contractId)})),
    bodies,meetings: overlaid,snapshot,bodySnapshots,governments:row.governments as RegistrationGovernmentListing[],
    divisions:row.divisions as Division[],registrationHeld:row.registration_held === true };
}

/** A state family's source outcomes are attributed only to the bodies this place includes. */
function familySources(snapshot: MeetingsSnapshot,meetings: readonly Meeting[],bodyIds: ReadonlySet<string>): SnapshotSourceReport[] {
  const members = snapshot.derivedMembers?.filter(m => bodyIds.has(m.bodyId));
  if (!members) return meetings.length ? snapshot.sources : [];
  return members.flatMap(member => {
    const own = meetings.filter(m => m.bodyId === member.bodyId && (m.carried?.source ?? m.id.split(":")[0]) === member.source);
    const fresh = own.filter(m => !m.carried).length;
    const answered = own.filter(m => m.carried && carriedFromAnswer(m.carried.reason)).length;
    const walled = own.filter(m => m.carried && !carriedFromAnswer(m.carried.reason)).length;
    const drops = {placeless:0,unknownVenue:0,unplaceableInTime:0,notConfigured:0};
    return [
      ...(member.outcome === "FRESH" || fresh || answered ? [{source:member.source,ok:true,error:null,fetched:fresh,normalized:fresh,drops,...(answered ? {carriedForward:answered} : {})}] : []),
      ...(member.outcome !== "FRESH" || walled ? [{source:member.source,ok:false,error:member.detail ?? `${member.bodyId}: the last verified sittings are held`,failure:"WALL" as const,
        fetched:0,normalized:0,drops,...(walled ? {carriedForward:walled} : {}),
        unreachableOcdIds:[...new Set([...own.flatMap(m => m.ocdId ?? []),...(member.bodyId.startsWith("ocd-division/") ? [member.bodyId.split("#")[0]!] : [])])]}] : []),
    ];
  });
}
