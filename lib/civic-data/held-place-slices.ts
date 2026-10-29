import { readerQuery } from "./promoted-reader-query.ts";
import type { CivicDataReadResult, CivicDataReadMetadata } from "./read-model.ts";
import { readPlacePayloadParts } from "./place-payload-slices.ts";
import type { ReadOnlyQuery } from "../control-plane/admin-view/promoted-slices.ts";
import type { OfficeholderSet } from "../officials/types.ts";
import type { VotingSitesFile } from "../ballot/voting-sites.ts";
import type { DerivedCampaignSitesProjection } from "./derived-campaign-sites.ts";

/** A view of an already promoted pointer, like Admin's promoted slices. It
 * carries pointer metadata; it is not a newly validated candidate or receipt. */
export type PlaceCaptureRead<T> = {
  readonly kind: CivicDataReadResult<T>["kind"];
  readonly value: T | null;
  readonly metadata: Pick<CivicDataReadMetadata, "recordClass" | "scope"> & { readonly versionId?: string | null };
};

export function heldPlaceValue<T>(read: PlaceCaptureRead<T>): T | null {
  if (read.kind === "PROMOTED") return read.value;
  if (read.kind === "NOT_RECORDED") return null;
  throw new Error(`HELD_PLACE_READ_FAILED:${read.metadata.recordClass}:${read.metadata.scope}:${read.kind}`);
}

const array = (path: string, where: string) => `(SELECT COALESCE(jsonb_agg(x), '[]'::jsonb) FROM jsonb_array_elements(CASE WHEN jsonb_typeof(${path})='array' THEN ${path} ELSE '[]'::jsonb END) x WHERE ${where})`;
const division = "x->>'ocdId'=ANY($3::text[]) OR x->>'divisionId'=ANY($3::text[])";

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

/** Checklist facts come from the canonical roster, with its small publication
 * proof checked in the same statement. Source evidence and confirmation text
 * are not inputs to a place's captured-field counts. */
export async function readPlaceOfficialLegislatorRoster(scope: string, sourceId: string, ids: readonly string[],
  injected?: ReadOnlyQuery): Promise<PlaceCaptureRead<{ readonly roster: OfficeholderSet }>> {
  const metadata = { recordClass: "STATE_LEGISLATOR" as const, scope };
  const query = injected ?? readerQuery();
  if (!query) throw new Error(`HELD_PLACE_READ_FAILED:STATE_LEGISLATOR:${scope}:STORE_UNCONFIGURED`);
  const [rows] = await query([{ text: `WITH pointer AS MATERIALIZED (${placePublishedPointer("STATE_LEGISLATOR")}), roster AS MATERIALIZED (
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
    params: [scope, sourceId, [...new Set(ids)]] }]);
  const row = rows[0];
  if (!row) return { kind: "NOT_RECORDED", value: null, metadata };
  if (row.valid !== true) throw new Error(`HELD_PLACE_READ_FAILED:STATE_LEGISLATOR:${scope}:STORE_UNREACHABLE`);
  return { kind: "PROMOTED", value: row.value as { readonly roster: OfficeholderSet },
    metadata: { ...metadata, versionId: row.current_version_id as string } };
}

/** The checklist needs the requested jurisdictions' sites, never the other
 * counties' site geometry, schedules or source inventories. */
export async function readPlaceVotingSites(scope: string, ids: readonly string[], injected?: ReadOnlyQuery): Promise<PlaceCaptureRead<VotingSitesFile>> {
  const metadata = { recordClass: "VOTING_SITE" as const, scope };
  const query = injected ?? readerQuery();
  if (!query) throw new Error(`HELD_PLACE_READ_FAILED:VOTING_SITE:${scope}:STORE_UNCONFIGURED`);
  const [rows] = await query([{ text: `WITH pointer AS MATERIALIZED (${placePublishedPointer("VOTING_SITE")})
    SELECT current_version_id,published AS valid,jsonb_build_object('generatedAt',reader_payload_value(root->'generatedAt'),
      'jurisdictions',coalesce((SELECT jsonb_agg(reader_payload_value(m.item) ORDER BY m.ordinal_index)
        FROM reader_payload_members(root->'jurisdictions') m
        WHERE reader_payload_node(m.item)->>'ocdId'=ANY($3::text[])),'[]'::jsonb)) AS value FROM pointer`,
    params: [scope, null, [...new Set(ids)]] }]);
  const row = rows[0];
  if (!row) return { kind: "NOT_RECORDED", value: null, metadata };
  if (row.valid !== true) throw new Error(`HELD_PLACE_READ_FAILED:VOTING_SITE:${scope}:STORE_UNREACHABLE`);
  return { kind: "PROMOTED", value: row.value as VotingSitesFile,
    metadata: { ...metadata, versionId: row.current_version_id as string } };
}

/** Candidate lookup keys come from this place's canonical ballot plan. */
export async function readPlaceDerivedCampaignSites(scope: string, keys: readonly string[], injected?: ReadOnlyQuery): Promise<PlaceCaptureRead<Pick<DerivedCampaignSitesProjection, "records">>> {
  if (!scope.endsWith(":candidate-campaign-sites-derived")) throw new Error("HELD_PLACE_CAMPAIGN_SCOPE_INVALID");
  const metadata = { recordClass: "CURATED_READER_RECORD" as const, scope };
  const query = injected ?? readerQuery();
  if (!query) throw new Error(`HELD_PLACE_READ_FAILED:CURATED_READER_RECORD:${scope}:STORE_UNCONFIGURED`);
  const [rows] = await query([{ text: `WITH pointer AS MATERIALIZED (${placePublishedPointer("CURATED_READER_RECORD")})
    SELECT current_version_id,published AS valid,jsonb_build_object('records',coalesce((
      SELECT jsonb_agg(reader_payload_value(m.item) ORDER BY m.ordinal_index)
      FROM reader_payload_members(root->'records') m WHERE reader_payload_node(m.item)->>'id'=ANY($3::text[])
        OR reader_payload_node(m.item)->>'candidacyId'=ANY($3::text[])),'[]'::jsonb)) AS value FROM pointer`,
    params: [scope, null, [...new Set(keys)]] }]);
  const row = rows[0];
  if (!row) return { kind: "NOT_RECORDED", value: null, metadata };
  if (row.valid !== true) throw new Error(`HELD_PLACE_READ_FAILED:CURATED_READER_RECORD:${scope}:STORE_UNREACHABLE`);
  return { kind: "PROMOTED", value: row.value as Pick<DerivedCampaignSitesProjection, "records">,
    metadata: { ...metadata, versionId: row.current_version_id as string } };
}


/** Only the selected divisions and their bodies cross the wire. All filters
 * run against the existing canonical pointer in the existing read-only store. */
export async function readPlacePointerSlice<T>(recordClass: CivicDataReadMetadata["recordClass"], scope: string,
  ids: readonly string[], bodies: readonly string[] = [], targets: readonly string[] = []): Promise<PlaceCaptureRead<T>> {
  return (await readPlacePointerSlices<T>(recordClass, [scope], ids, bodies, targets))[0];
}

export async function readPlacePointerSlices<T>(recordClass: CivicDataReadMetadata["recordClass"], scopes: readonly string[],
  ids: readonly string[], bodies: readonly string[] = [], targets: readonly string[] = [], injected?: ReadOnlyQuery): Promise<PlaceCaptureRead<T>[]> {
  if (!scopes.length) return [];
  if (["REGISTRY_RUNTIME_BINDING", "BALLOT_CANDIDACY", "CANDIDATE_PROFILE", "CANDIDATE_PUBLICATION", "VOTING_SITE"].includes(recordClass) || scopes.some(scope => scope.endsWith(":candidate-campaign-sites-derived")))
    throw new Error("STATE_AUTHORITY_REQUIRES_KEYED_READ");
  const query = injected ?? readerQuery();
  if (!query) throw new Error(`HELD_PLACE_READ_FAILED:${recordClass}:${scopes.join(",")}:STORE_UNCONFIGURED`);
  let value: string;
  if (recordClass === "MEETING") {
    value = `jsonb_build_object('meetings', ${array("payload->'meetings'", `${division} OR x->>'bodyId'=ANY($4::text[])`)})`;
  } else if (recordClass === "MEETING_OUTCOME") {
    value = `jsonb_build_object('sittings', ${array("payload->'sittings'", `${division} OR x->>'bodyId'=ANY($4::text[])`)})`;
  } else if (recordClass === "FEDERAL_DIRECTORY" || recordClass === "STATE_LEGISLATOR") {
    const members = array("payload->'roster'->'divisions'", division);
    value = `jsonb_build_object('roster', ((payload->'roster') - 'divisions' - 'officeholders' - 'unmatched') || jsonb_build_object(
      'divisions', ${members}, 'unmatched', '[]'::jsonb,
      'officeholders', ${array("payload->'roster'->'officeholders'", `x->>'id' IN (SELECT m->>'officeholderId' FROM jsonb_array_elements(${members}) m)`)}))`;
  } else if (recordClass === "FEC_FUNDING") {
    value = `(payload - 'candidates') || jsonb_build_object('candidates', ${array("payload->'candidates'", "x->'targetKeys' ?| $5::text[]")})`;
  } else if (recordClass === "STATE_CAMPAIGN_FINANCE") {
    value = `(payload - 'records') || jsonb_build_object('records', ${array("payload->'records'", "x->'targetKeys' ?| $5::text[]")})`;
  } else {
    value = `(payload - 'records') || jsonb_build_object('records', ${array("payload->'records'", `${division} OR x->>'stateOcdId'=ANY($3::text[])`)})`;
  }
  const [rows] = await query([{ text: `WITH selected AS (SELECT $3::text[] ids, $4::text[] bodies, $5::text[] targets),
    projections AS (SELECT record_class,scope,current_version_id,payload FROM civic_data_promotions)
    SELECT scope, current_version_id, ${value} AS value,
      jsonb_path_exists(payload, '$.**."$civicPayloadPart"') AS encoded
      FROM projections WHERE record_class=$1 AND scope=ANY($2::text[])`,
    params: [recordClass, [...new Set(scopes)], [...ids], [...bodies], [...targets]] }]);
  const byScope = new Map(rows?.map(row => [row.scope, row]));
  const encoded = rows.filter(row => row.encoded).map(row => row.scope as string);
  const decoded = encoded.length ? await readPlacePayloadParts(query, recordClass, encoded, ids, bodies, targets,
    new Map(rows.map(row => [row.scope as string, row.current_version_id as string]))) : new Map();
  const result = scopes.map(scope => {
    const row = byScope.get(scope);
    const value = row ? decoded.get(scope) ?? row.value : null;
    return { kind: row ? "PROMOTED" as const : "NOT_RECORDED" as const, value: value as T ?? null,
      metadata: { recordClass, scope, ...(row ? { versionId: row.current_version_id as string } : {}) } };
  });
  return result;
}
