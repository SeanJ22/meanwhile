import { readerQuery } from "./promoted-reader-query.ts";
import type { CivicDataReadResult, CivicDataReadMetadata } from "./read-model.ts";
import { readPlacePayloadParts } from "./place-payload-slices.ts";
import type { ReadOnlyQuery } from "../control-plane/admin-view/promoted-slices.ts";

const slices = new Map<string, Map<string, { version: string; value: unknown }>>();
const queryIds = new WeakMap<ReadOnlyQuery, number>();
let nextQueryId = 0;

/** A view of an already promoted pointer, like Admin's promoted slices. It
 * carries pointer metadata; it is not a newly validated candidate or receipt. */
/** A caller retaining immutable inputs can reuse an unchanged source read. */
export type PlaceInputMemo = <T>(recordClass:string,scope:string,load:()=>Promise<T>)=>Promise<T>;

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
  if (injected && !queryIds.has(injected)) queryIds.set(injected, ++nextQueryId);
  const cacheKey = JSON.stringify([injected ? queryIds.get(injected) : process.env.DATABASE_URL, recordClass,
    [...new Set(ids)].sort(), [...new Set(bodies)].sort(), [...new Set(targets)].sort()]);
  const cached = slices.get(cacheKey) ?? new Map<string, { version: string; value: unknown }>();
  // Pin this call's carried values before any concurrent read can move the cache.
  const carried = new Map(cached);
  const versions = JSON.stringify(Object.fromEntries(scopes.flatMap(scope => carried.has(scope) ? [[scope, carried.get(scope)!.version]] : [])));
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
    SELECT scope, current_version_id, CASE WHEN ($6::jsonb->>scope)=current_version_id THEN NULL ELSE ${value} END AS value,
      CASE WHEN ($6::jsonb->>scope)=current_version_id THEN false ELSE jsonb_path_exists(payload, '$.**."$civicPayloadPart"') END AS encoded
      FROM projections WHERE record_class=$1 AND scope=ANY($2::text[])`,
    params: [recordClass, [...new Set(scopes)], [...ids], [...bodies], [...targets], versions] }]);
  const byScope = new Map(rows?.map(row => [row.scope, row]));
  const encoded = rows.filter(row => row.encoded).map(row => row.scope as string);
  const decoded = encoded.length ? await readPlacePayloadParts(query, recordClass, encoded, ids, bodies, targets,
    new Map(rows.map(row => [row.scope as string, row.current_version_id as string]))) : new Map();
  const result = scopes.map(scope => {
    const row = byScope.get(scope);
    const value = row ? carried.get(scope)?.version === row.current_version_id
      ? carried.get(scope)!.value : decoded.get(scope) ?? row.value : null;
    if (row) cached.set(scope, { version: row.current_version_id as string, value });
    else cached.delete(scope);
    return { kind: row ? "PROMOTED" as const : "NOT_RECORDED" as const, value: value as T ?? null,
      metadata: { recordClass, scope, ...(row ? { versionId: row.current_version_id as string } : {}) } };
  });
  if (!slices.has(cacheKey) && slices.size >= 64) slices.delete(slices.keys().next().value!);
  slices.set(cacheKey, cached);
  return result;
}
