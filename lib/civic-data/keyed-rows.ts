import type { Query } from "../facts/publish.ts";
import type { OfficeholderSet } from "../officials/types.ts";
import type { VotingSitesFile } from "../ballot/voting-sites.ts";
import type { DerivedCampaignSitesProjection } from "./derived-campaign-sites.ts";
import type { Division, Registry } from "../registry/types.ts";
import { requireRegistryState, stateRegistryRuntimeScope } from "./state-scopes.ts";
import { readNhPlaceRosterRows } from "./state-reader-store.ts";

/** A lookup is a selection of a published registry, never a successor's complete base. */
export interface RegistryLookup {
  readonly versionId: string;
  readonly payload: { readonly registry: Pick<Registry, "bodies" | "divisions"> };
}

const registryPointerWhere = (scope: string) => `SELECT p.key,p.current_version_id,
  (p.source_id='registry-reviewed-bindings' AND p.current_version_id=p.last_known_good_version_id
    AND c.state='PROMOTED' AND c.source_id=p.source_id AND c.record_class=p.record_class AND c.scope=p.scope
    AND (p.current_version_id=c.id AND p.payload_fingerprint IS NOT DISTINCT FROM c.read_model_fingerprint) AND p.validation_receipt=c.validation_receipt
    AND p.validation_receipt->>'decision'='GOOD') AS valid
  FROM civic_data_promotions p LEFT JOIN civic_data_candidates c ON c.id=p.current_version_id
  WHERE p.record_class='REGISTRY_RUNTIME_BINDING' AND ${scope}`;
const registryPointer = registryPointerWhere("p.scope=$1");

function requireRegistryPointer(row: Record<string, unknown>, scope: string): void {
  if (row.valid !== true) throw new Error(`REGISTRY_RUNTIME_BASE_UNAVAILABLE:INVALID_PUBLISHED_POINTER:${scope}`);
}

/** A body's identity header: no calendar, roster, contact or source value leaves Postgres. */
export interface RegistryBodyHeader { readonly id: string; readonly name: string; readonly ocdId: string | null }

/**
 * The published registry bodies of these states whose names match, as identity headers only.
 * Null when any state's published pointer is invalid, so the caller keeps its complete path.
 */
export async function readKeyedRegistryBodyHeaders(query: Query, states: readonly string[], namePattern: string | null):
  Promise<readonly RegistryBodyHeader[] | null> {
  const scopes = [...new Set(states.map(state => stateRegistryRuntimeScope(requireRegistryState(state))))];
  if (!scopes.length) return [];
  const rows = await query(`WITH pointer AS MATERIALIZED (${registryPointerWhere("p.scope=ANY($1::text[])")})
    SELECT p.valid,r.row_id AS id,r.value->>'name' AS name,r.value->>'ocdId' AS ocd_id FROM pointer p
    LEFT JOIN civic_data_rows r ON p.valid AND r.promotion_key=p.key AND r.version_id=p.current_version_id
      AND r.collection='registry.bodies' AND ($2::text IS NULL OR r.value->>'name' ~* $2)`, [scopes, namePattern]);
  if (rows.some(row => row.valid !== true)) return null;
  return rows.filter(row => typeof row.id === "string" && typeof row.name === "string")
    .map(row => ({ id: String(row.id), name: String(row.name), ocdId: typeof row.ocd_id === "string" ? row.ocd_id : null }));
}

export function selectRegistryLookup(versionId: string, registry: Registry, bodyIds: readonly string[], divisionIds: readonly string[]): RegistryLookup {
  const wantedBodies = new Set(bodyIds), bodies = registry.bodies.filter(body => wantedBodies.has(body.id));
  const wantedDivisions = new Set([...divisionIds, ...bodies.flatMap(body => [body.ocdId, ...body.alsoServesOcdIds ?? []].filter((id): id is string => id !== null))]);
  return { versionId, payload: { registry: { bodies: structuredClone(bodies),
    divisions: structuredClone(registry.divisions.filter(division => wantedDivisions.has(division.ocdId))) } } };
}

/** The pointer and its selected rows share one statement and one database snapshot. */
export async function readKeyedRegistry(query: Query, state: string, bodyIds: readonly string[], divisionIds: readonly string[]): Promise<RegistryLookup | null> {
  const scope = stateRegistryRuntimeScope(requireRegistryState(state));
  const [row] = await query(`WITH pointer AS MATERIALIZED (${registryPointer}), bodies AS MATERIALIZED (
    SELECT r.ordinal,r.value FROM pointer p JOIN civic_data_rows r ON r.promotion_key=p.key AND r.version_id=p.current_version_id
    WHERE p.valid AND r.collection='registry.bodies' AND r.row_id=ANY($2::text[])
  ), divisions AS (
    SELECT r.ordinal,r.value FROM pointer p JOIN civic_data_rows r ON r.promotion_key=p.key AND r.version_id=p.current_version_id
    WHERE p.valid AND r.collection='registry.divisions' AND r.row_id=ANY(
      $3::text[] || ARRAY(SELECT value->>'ocdId' FROM bodies WHERE value->>'ocdId' IS NOT NULL)
      || ARRAY(SELECT jsonb_array_elements_text(coalesce(value->'alsoServesOcdIds','[]'::jsonb)) FROM bodies))
  ) SELECT p.current_version_id,p.valid,
    coalesce((SELECT jsonb_agg(reader_payload_value(value) ORDER BY ordinal) FROM bodies),'[]'::jsonb) AS bodies,
    coalesce((SELECT jsonb_agg(reader_payload_value(value) ORDER BY ordinal) FROM divisions),'[]'::jsonb) AS divisions FROM pointer p`,
  [scope, [...new Set(bodyIds)], [...new Set(divisionIds)]]);
  if (!row) return null;
  requireRegistryPointer(row, scope);
  return { versionId: String(row.current_version_id), payload: { registry: {
    bodies: row.bodies as Registry["bodies"], divisions: row.divisions as Registry["divisions"],
  } } };
}

export async function readKeyedRegistryDivisions(query: Query, state: string, labels: readonly string[]):
  Promise<readonly Pick<Division, "ocdId" | "label" | "state" | "sourceDataset">[]> {
  if (!labels.length) return [];
  const jurisdiction = requireRegistryState(state), scope = stateRegistryRuntimeScope(jurisdiction);
  const [row] = await query(`WITH pointer AS MATERIALIZED (${registryPointer}), divisions AS (
    SELECT r.ordinal,jsonb_build_object('ocdId',r.value->'ocdId','label',reader_payload_value(r.value->'label'),
      'state',r.value->'state','sourceDataset',r.value->'sourceDataset') AS value
    FROM pointer p JOIN civic_data_rows r ON r.promotion_key=p.key AND r.version_id=p.current_version_id
    WHERE p.valid AND r.collection='registry.divisions' AND upper(r.value->>'state')=$2 AND r.label_key=ANY($3::text[])
  ) SELECT p.valid,coalesce((SELECT jsonb_agg(value ORDER BY ordinal) FROM divisions),'[]'::jsonb) AS divisions FROM pointer p`,
  [scope,jurisdiction,labels]);
  if (!row) return [];
  requireRegistryPointer(row,scope);
  return row.divisions as Pick<Division, "ocdId" | "label" | "state" | "sourceDataset">[];
}


/** Bulk pointer identity and fingerprints for the campaign readback scheduler. */
export const CAMPAIGN_READBACK_HEADS_SQL = `SELECT w.state,p.current_version_id AS version,
  coalesce(p.payload_fingerprint,p.payload->>'$civicPayloadPart',c.normalized_hash) AS fingerprint,
  (p.current_version_id=p.last_known_good_version_id AND c.id=p.current_version_id
    AND c.source_id=p.source_id AND c.record_class=p.record_class AND c.scope=p.scope
    AND c.state='PROMOTED' AND c.acquisition_succeeded AND c.promoted_version_id=c.id AND c.last_known_good_version_id=c.id
    AND p.validation_receipt=c.validation_receipt AND p.validation_receipt->>'decision'='GOOD'
    AND p.validation_receipt->>'candidateId'=c.id AND c.normalized_hash ~ '^[a-f0-9]{64}$') IS TRUE AS valid
  FROM unnest($1::text[]) w(state) LEFT JOIN civic_data_promotions p
    ON p.key='CURATED_READER_RECORD:US-'||w.state||':candidate-campaign-sites-derived'
  LEFT JOIN civic_data_candidates c ON c.id=p.current_version_id ORDER BY w.state`;

export async function readPublishedCampaignHeads(query: Query, states: readonly string[]) {
  return query(CAMPAIGN_READBACK_HEADS_SQL, [states]);
}

const placePublishedPointer = (recordClass: "STATE_LEGISLATOR" | "VOTING_SITE" | "CURATED_READER_RECORD") => `SELECT p.current_version_id,reader_payload_node(p.payload) AS root,
  (p.key='${recordClass}:'||$1 AND p.record_class='${recordClass}' AND p.scope=$1
    AND ($2::text IS NULL OR p.source_id=$2)
    AND c.id=p.current_version_id AND c.source_id=p.source_id AND c.record_class=p.record_class AND c.scope=p.scope
    AND c.state='PROMOTED' AND c.acquisition_succeeded AND p.current_version_id=p.last_known_good_version_id
    AND c.promoted_version_id=c.id AND c.last_known_good_version_id=c.id
    AND p.payload_fingerprint IS NOT DISTINCT FROM c.read_model_fingerprint
    AND (c.read_model_fingerprint IS NULL OR c.read_model_fingerprint=c.normalized_hash)
    AND c.normalized_hash ~ '^[a-f0-9]{64}$'
    AND c.candidate#>>'{normalization,normalizedHash}'=c.normalized_hash
    AND c.candidate#>'{normalization,succeeded}'='true'::jsonb
    AND c.validation_receipt=p.validation_receipt AND p.validation_receipt->>'decision'='GOOD'
    AND p.validation_receipt->>'candidateId'=c.id AND p.validation_receipt->>'sourceId'=p.source_id
    AND p.validation_receipt->>'recordClass'=p.record_class AND p.validation_receipt->>'scope'=p.scope
    AND c.retrieved_at<=(p.validation_receipt->>'validatedAt')::timestamptz
    AND (p.validation_receipt->>'validatedAt')::timestamptz<=p.promoted_at) IS TRUE AS published
  FROM civic_data_promotions p LEFT JOIN civic_data_candidates c ON c.id=p.current_version_id
  WHERE p.key='${recordClass}:'||$1`;

/** A selected canonical payload with the scalar publication proof checked in the same statement. */
export interface PlacePublicationRows<T> { readonly versionId: string; readonly payload: T }

export async function readPlaceOfficialLegislatorRows(query: Query, scope: string, sourceId: string, ids: readonly string[]): Promise<PlacePublicationRows<{ readonly roster: OfficeholderSet }> | null> {
  if (scope === "US-NH") {
    if (sourceId !== "nh-general-court") throw new Error("HELD_PLACE_READ_FAILED:STATE_LEGISLATOR:US-NH:STORE_UNREACHABLE");
    return readNhPlaceRosterRows((text, params) => query(text, params), ids);
  }
  const [row] = await query(`WITH pointer AS MATERIALIZED (${placePublishedPointer("STATE_LEGISLATOR")}), roster AS MATERIALIZED (
    SELECT current_version_id,published,root,reader_payload_node(root->'roster') AS value FROM pointer
  ), members AS MATERIALIZED (
    SELECT m.ordinal_index,reader_payload_node(m.item) AS value FROM roster r,
      LATERAL reader_payload_members(r.value->'officeholders') m
  ), divisions AS MATERIALIZED (
    SELECT d.ordinal_index,reader_payload_node(d.item) AS value FROM roster r,
      LATERAL reader_payload_members(r.value->'divisions') d
  ) SELECT r.current_version_id,
    (r.published AND r.root->>'formatVersion'='1' AND r.root->>'jurisdiction'=$1 AND r.root->>'sourceId'=$2
      AND jsonb_typeof(reader_payload_node(r.value->'officeholders'))='array'
      AND jsonb_typeof(reader_payload_node(r.value->'divisions'))='array'
      AND (SELECT count(*)=count(DISTINCT value->>'id') FROM members)
      AND NOT EXISTS(SELECT 1 FROM members WHERE NOT starts_with(value->>'id',$2||':'))
      AND NOT EXISTS(SELECT 1 FROM divisions d WHERE NOT EXISTS(SELECT 1 FROM members m
        WHERE m.value->>'id'=d.value->>'officeholderId'))) IS TRUE AS valid,
    jsonb_build_object('roster',jsonb_build_object('divisions',coalesce((SELECT jsonb_agg(jsonb_build_object(
      'officeholderId',value->'officeholderId','ocdId',value->'ocdId') ORDER BY ordinal_index)
      FROM divisions WHERE value->>'ocdId'=ANY($3::text[])),'[]'::jsonb),
      'officeholders',coalesce((SELECT jsonb_agg(reader_payload_value(jsonb_build_object(
        'id',value->'id','name',value->'name','officeTitle',value->'officeTitle','level',value->'level',
        'termStart',value->'termStart','termEnd',value->'termEnd','websiteUrl',value->'websiteUrl',
        'email',value->'email','phone',value->'phone','contactFormUrl',value->'contactFormUrl',
        'partyLabel',value->'partyLabel','provenance',jsonb_build_object(
          'sourceUrl',reader_payload_node(value->'provenance')->'sourceUrl',
          'collectedAt',reader_payload_node(value->'provenance')->'collectedAt'))) ORDER BY ordinal_index)
        FROM members WHERE value->>'id' IN (SELECT value->>'officeholderId' FROM divisions
          WHERE value->>'ocdId'=ANY($3::text[]))),'[]'::jsonb))) AS value FROM roster r`,
    [scope, sourceId, [...new Set(ids)]]);
  if (!row) return null;
  if (row.valid !== true) throw new Error(`HELD_PLACE_READ_FAILED:STATE_LEGISLATOR:${scope}:STORE_UNREACHABLE`);
  return { versionId: row.current_version_id as string, payload: row.value as { readonly roster: OfficeholderSet } };
}

export async function readPlaceVotingSiteRows(query: Query, scope: string, ids: readonly string[]): Promise<PlacePublicationRows<VotingSitesFile> | null> {
  const [row] = await query(`WITH pointer AS MATERIALIZED (${placePublishedPointer("VOTING_SITE")})
    SELECT current_version_id,published AS valid,jsonb_build_object('generatedAt',reader_payload_value(root->'generatedAt'),
      'jurisdictions',coalesce((SELECT jsonb_agg(reader_payload_value(m.item) ORDER BY m.ordinal_index)
        FROM reader_payload_members(root->'jurisdictions') m
        WHERE reader_payload_node(m.item)->>'ocdId'=ANY($3::text[])),'[]'::jsonb)) AS value FROM pointer`,
    [scope, null, [...new Set(ids)]]);
  if (!row) return null;
  if (row.valid !== true) throw new Error(`HELD_PLACE_READ_FAILED:VOTING_SITE:${scope}:STORE_UNREACHABLE`);
  return { versionId: row.current_version_id as string, payload: row.value as VotingSitesFile };
}

export async function readPlaceCampaignSiteRows(query: Query, scope: string, keys: readonly string[]): Promise<PlacePublicationRows<Pick<DerivedCampaignSitesProjection, "records">> | null> {
  if (!scope.endsWith(":candidate-campaign-sites-derived")) throw new Error("HELD_PLACE_CAMPAIGN_SCOPE_INVALID");
  const [row] = await query(`WITH pointer AS MATERIALIZED (${placePublishedPointer("CURATED_READER_RECORD")})
    SELECT current_version_id,published AS valid,jsonb_build_object('records',coalesce((
      SELECT jsonb_agg(reader_payload_value(m.item) ORDER BY m.ordinal_index)
      FROM reader_payload_members(root->'records') m WHERE reader_payload_node(m.item)->>'id'=ANY($3::text[])
        OR reader_payload_node(m.item)->>'candidacyId'=ANY($3::text[])),'[]'::jsonb)) AS value FROM pointer`,
    [scope, null, [...new Set(keys)]]);
  if (!row) return null;
  if (row.valid !== true) throw new Error(`HELD_PLACE_READ_FAILED:CURATED_READER_RECORD:${scope}:STORE_UNREACHABLE`);
  return { versionId: row.current_version_id as string, payload: row.value as Pick<DerivedCampaignSitesProjection, "records"> };
}
