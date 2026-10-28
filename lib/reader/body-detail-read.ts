import { readBodyFacts } from "../facts/registry-overlay.ts";
import type { Query } from "../facts/publish.ts";
import { compositionFor } from "../registry/body-membership.ts";
import { personIdentityKeys } from "../officials/people-identity.ts";
import type { RegistryRuntimeReadModel } from "../registry/runtime-data-plane.ts";
import type { BodyRoster, RosterReaderDisposition } from "../registry/body-rosters.ts";
import type { Body } from "../registry/types.ts";
import { projectBodyDetail, type ReaderBodyDetail } from "./body-detail.ts";

/** Only the selected bodies and rosters cross the database connection. */
const VALID_REGISTRY_POINTER = `(p.current_version_id=p.last_known_good_version_id AND c.state='PROMOTED' AND c.acquisition_succeeded
  AND c.promoted_version_id=c.id AND c.last_known_good_version_id=c.id AND c.source_id=p.source_id
  AND c.record_class=p.record_class AND c.scope=p.scope AND p.payload_fingerprint IS NOT DISTINCT FROM c.read_model_fingerprint
  AND c.validation_receipt=p.validation_receipt AND p.validation_receipt->>'decision'='GOOD'
  AND c.candidate#>>'{normalization,normalizedHash}'=c.normalized_hash)`;

export const BODY_ROWS_SQL = `WITH pointer AS MATERIALIZED (SELECT p.key,p.current_version_id,${VALID_REGISTRY_POINTER} AS valid
  FROM civic_data_promotions p LEFT JOIN civic_data_candidates c ON c.id=p.current_version_id
  WHERE p.key='REGISTRY_RUNTIME_BINDING:US-'||$1||':reader-registry-runtime'),
  requested AS (SELECT unnest($2::text[]) AS id),
  aliases AS (SELECT requested.id,coalesce((SELECT entity_id FROM entity_external_id
    WHERE scheme='body-alias' AND value=requested.id LIMIT 1),requested.id) AS canonical FROM requested),
  matching AS (SELECT a.canonical,a.id AS source FROM aliases a UNION
    SELECT a.canonical,x.value FROM aliases a JOIN entity_external_id x ON x.entity_id=a.canonical AND x.scheme='body-alias')
  SELECT r.collection,m.canonical,reader_payload_value(r.value) AS value
    FROM matching m JOIN civic_data_rows r ON r.body_id=m.source
    JOIN pointer p ON p.key=r.promotion_key AND p.current_version_id=r.version_id
    WHERE p.valid AND r.collection IN ('registry.bodies','bodyRosters')
  UNION ALL SELECT 'entity',e.id,jsonb_build_object('id',e.id,'name',e.name,'parentId',e.parent_id,
    'parentKind',parent.kind,'parentName',parent.name,
    'hasDivision',EXISTS(SELECT 1 FROM entity_place ep WHERE ep.entity_id=e.id AND ep.place_id LIKE 'ocd-division/%'),
    'hostCounty',EXISTS(SELECT 1 FROM entity_place ep WHERE ep.entity_id=e.id AND ep.placement_basis='HOST_COUNTY'))
    FROM entity e LEFT JOIN entity parent ON parent.id=e.parent_id
    WHERE e.kind='body' AND e.state=$1::char(2) AND e.id IN (SELECT canonical FROM aliases)
  UNION ALL SELECT 'registry_status',NULL,to_jsonb(coalesce(valid,false)) FROM pointer`;

/** Selected people get their own portrait and disposition, never the state record. */
export const BODY_PEOPLE_SQL = `WITH root AS (SELECT reader_payload_node(p.payload) AS value FROM civic_data_promotions p
  LEFT JOIN civic_data_candidates c ON c.id=p.current_version_id
  WHERE p.key='REGISTRY_RUNTIME_BINDING:US-'||$1||':reader-registry-runtime' AND ${VALID_REGISTRY_POINTER}),
  photos AS (SELECT reader_payload_node(item) AS value,item FROM root,
    LATERAL reader_payload_members(reader_payload_node(root.value->'officialPhotos')->'photos')
    WHERE reader_payload_node(item)->>'officeholderId'=ANY($2::text[])
       OR reader_payload_node(item)->>'personId'=ANY($2::text[]))
  SELECT coalesce((SELECT jsonb_agg(reader_payload_value(item)) FROM photos),'[]'::jsonb) AS photos,
    coalesce((SELECT jsonb_object_agg(p.key,reader_payload_value(p.value)) FROM root,
      LATERAL jsonb_each(reader_payload_node(root.value->'rosterPhotos')) p WHERE p.key=ANY($2::text[])),'{}'::jsonb) AS roster_photos,
    coalesce((SELECT jsonb_agg(reader_payload_value(r.value)) FROM civic_data_rows r
      JOIN civic_data_promotions p ON p.key=r.promotion_key AND p.current_version_id=r.version_id
      JOIN civic_data_candidates c ON c.id=p.current_version_id
      WHERE r.promotion_key='REGISTRY_RUNTIME_BINDING:US-'||$1||':reader-registry-runtime'
        AND ${VALID_REGISTRY_POINTER} AND r.collection='registry.rosterDispositions' AND (r.row_id=ANY($2::text[]) OR r.aliases && $2::text[]
          OR reader_payload_node(r.value)->>'canonicalId'=ANY($2::text[]))),'[]'::jsonb) AS dispositions`;

export async function readBodyDetail(query: Query, state: string, bodyId: string): Promise<ReaderBodyDetail> {
  const alias = compositionFor(bodyId)?.aliasOfBodyId;
  const ids = [...new Set([bodyId, ...(alias ? [alias] : [])])];
  const [rows, facts] = await Promise.all([query(BODY_ROWS_SQL, [state, ids]), readBodyFacts(query, ids, true)]);
  if (rows.some(row => row.collection === "registry_status" && row.value !== true)) throw new Error("BODY_REGISTRY_UNTRUSTED");
  if (!rows.some(row => row.collection !== "registry_status") && !facts.length) throw new Error("BODY_DETAIL_NOT_FOUND");
  const bodies = rows.filter(row => row.collection === "registry.bodies").map(row => ({ ...row.value as Body, id: String(row.canonical) }));
  const rosters = rows.filter(row => row.collection === "bodyRosters").map(row => ({ ...row.value as BodyRoster, bodyId: String(row.canonical) }));
  const people = [...rosters.flatMap(roster => [...roster.members, ...roster.membershipHistory ?? []]),
    ...facts.flatMap(fact => fact.roster?.members ?? [])];
  const keys = [...new Set(people.flatMap(person => [...personIdentityKeys(person)]))];
  const [selected] = keys.length ? await query(BODY_PEOPLE_SQL, [state, keys]) : [];
  const registry: RegistryRuntimeReadModel = { formatVersion: 1, registry: { generatedAt: "", bodies, divisions: [] },
    bodyRosters: rosters, rosterReaderDispositions: selected?.dispositions as RosterReaderDisposition[] ?? [],
    statewideExecutives: [], officialCandidacies: { formatVersion: 1, rule: "EXACT_SEAT_CONSERVATIVE_NAME_OFFLINE_UNIQUE", rows: [] },
    officialPhotos: { photos: selected?.photos as RegistryRuntimeReadModel["officialPhotos"]["photos"] ?? [] },
    rosterPhotos: selected?.roster_photos as Record<string, string> ?? {} };
  const detail = projectBodyDetail(state, bodyId, registry, facts);
  // The place composer attaches the checked body source to its own derived
  // identity fields. Recreate those citations from the same small entity row.
  const entity = rows.find(row => row.collection === "entity" && row.canonical === bodyId)?.value as Record<string, unknown> | undefined;
  const fact = facts.find(row => row.id === bodyId), source = fact?.fields.provenance;
  if (!entity || !source || bodies.some(body => body.id === bodyId)) return detail;
  const derived = [
    ...(entity.hasDivision || bodyId.startsWith("ocd-division/") ? ["ocdId"] : []),
    ...(entity.parentKind === "government" ? ["governmentId", ...(entity.parentName ? ["governmentName"] : []),
      ...(/^(?:[a-z]{2}:(?:special|school|depschool):|government:US-)/i.test(String(entity.parentId)) ? ["governmentType"] : [])] : []),
    ...(typeof entity.name === "string" && entity.name !== bodyId ? ["registeredName"] : []),
    ...(entity.hostCounty ? ["placementBasis"] : []),
  ];
  return { ...detail, fieldSources: { ...Object.fromEntries(derived.map(field => [field, source])), ...detail.fieldSources } };
}
