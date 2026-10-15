import { readerQuery } from "./promoted-reader-query.ts";
import { factReader, statementQuery } from "../facts/db.ts";
import { withFactRegistry } from "../facts/registry-overlay.ts";
import type { RegistryRuntimeCarton } from "../registry/runtime-data-plane.ts";
import type { CivicDataReadResult, CivicDataReadMetadata } from "./read-model.ts";
import { placeProjectionSourceSql, readPlacePayloadParts } from "./place-payload-slices.ts";
import { placeValueOf } from "./place-rows.ts";
import type { ReadOnlyQuery } from "../control-plane/admin-view/promoted-slices.ts";

const accepted = new Map<string, { version: string; value: unknown }>();
const queryIds = new WeakMap<ReadOnlyQuery, number>();
let nextQueryId = 0;

/** A view of an already promoted pointer, like Admin's promoted slices. It
 * carries pointer metadata; it is not a newly validated candidate or receipt. */
export type PlaceCaptureRead<T> = {
  readonly kind: CivicDataReadResult<T>["kind"];
  readonly value: T | null;
  readonly metadata: Pick<CivicDataReadMetadata, "recordClass" | "scope"> & { readonly versionId?: string | null };
};

const array = (path: string, where: string) => `(SELECT COALESCE(jsonb_agg(x), '[]'::jsonb) FROM jsonb_array_elements(CASE WHEN jsonb_typeof(${path})='array' THEN ${path} ELSE '[]'::jsonb END) x WHERE ${where})`;
const division = "x->>'ocdId'=ANY($3::text[]) OR x->>'divisionId'=ANY($3::text[])";
const serves = `${division} OR x->'alsoServesOcdIds' ?| $3::text[] OR x->>'id'=ANY($4::text[])`;
const REGISTRY_VALUE = `jsonb_build_object('registry', jsonb_build_object('divisions', ${array("payload->'registry'->'divisions'", division)},
      'bodies', ${array("payload->'registry'->'bodies'", serves)}),
      'statewideExecutives', ${array("payload->'statewideExecutives'", "x->>'stateOcdId'=ANY($3::text[])")},
      'officialCandidacies', jsonb_build_object('rows', ${array("payload->'officialCandidacies'->'rows'", "x->'holder'->'divisions' ?| $3::text[]")}))`;

function withRegistryFacts<T>(reads: PlaceCaptureRead<T>[], injected?: ReadOnlyQuery): Promise<PlaceCaptureRead<T>[]> {
  const facts = injected ? statementQuery(injected) : factReader();
  return Promise.all(reads.map(async read => read.value === null ? read
    : { ...read, value: await withFactRegistry(read.value as unknown as RegistryRuntimeCarton, facts) as T }));
}

export async function readPlacePointerSlice<T>(recordClass: CivicDataReadMetadata["recordClass"], scope: string,
  ids: readonly string[], bodies: readonly string[] = [], targets: readonly string[] = []): Promise<PlaceCaptureRead<T>> {
  return (await readPlacePointerSlices<T>(recordClass, [scope], ids, bodies, targets))[0];
}

/** One place's slice of each current pointer, read from its per-division rows; the national payload is never opened. */
export async function readPlacePointerSlices<T>(recordClass: CivicDataReadMetadata["recordClass"], scopes: readonly string[],
  ids: readonly string[], bodies: readonly string[] = [], targets: readonly string[] = [], injected?: ReadOnlyQuery): Promise<PlaceCaptureRead<T>[]> {
  if (!scopes.length) return [];
  const query = injected ?? readerQuery();
  if (!query) throw new Error(`HELD_PLACE_READ_FAILED:${recordClass}:${scopes.join(",")}:STORE_UNCONFIGURED`);
  const keys = [...new Set([...ids.map(id => `d:${id}`), ...bodies.map(id => `b:${id}`), ...targets.map(id => `t:${id}`)])];
  const [rows] = await query([{ text: `WITH p AS (SELECT scope, current_version_id v FROM civic_data_promotions WHERE record_class=$1 AND scope=ANY($2::text[])),
      k AS (SELECT COALESCE(array_agg(p.v || '|' || x), '{}') keys FROM p CROSS JOIN unnest($3::text[]) x)
    SELECT p.scope, p.v, r.collection, r.member_key, r.ordinal, r.member FROM p LEFT JOIN civic_data_place_rows r ON r.version_id=p.v AND r.collection=''
    UNION ALL
    SELECT p.scope, p.v, r.collection, r.member_key, r.ordinal, r.member FROM p JOIN civic_data_place_rows r ON r.version_id=p.v
      WHERE r.keys && (SELECT keys FROM k)`, params: [recordClass, [...new Set(scopes)], keys] }]);
  const result = scopes.map((scope): PlaceCaptureRead<T> => {
    const own = rows.filter(row => row.scope === scope);
    const base = own.find(row => row.collection === "");
    if (!own.length) return { kind: "NOT_RECORDED", value: null, metadata: { recordClass, scope } };
    if (!base) throw new Error(`HELD_PLACE_ROWS_NOT_BUILT:${recordClass}:${scope}:${String(own[0]!.v)}`);
    const value = placeValueOf(base.member, own.filter(row => row.collection !== "" && row.collection !== null).map(row => ({
      collection: JSON.parse(row.collection as string) as (string | number)[], memberKey: row.member_key as string | null,
      ordinal: row.ordinal as number, member: row.member })));
    return { kind: "PROMOTED", value: value as T, metadata: { recordClass, scope, versionId: base.v as string } };
  });
  return recordClass === "REGISTRY_RUNTIME_BINDING" ? withRegistryFacts(result, injected) : result;
}

/** The registry exactly as the serving manifest accepted it, even while the live pointer moves on. */
export async function readPlaceVersionSlice<T>(recordClass: "REGISTRY_RUNTIME_BINDING", scope: string,
  versionId: string, ids: readonly string[], bodies: readonly string[] = [], targets: readonly string[] = [],
  injected?: ReadOnlyQuery): Promise<PlaceCaptureRead<T>> {
  const query = injected ?? readerQuery();
  if (!query) throw new Error(`HELD_PLACE_READ_FAILED:${recordClass}:${scope}:STORE_UNCONFIGURED`);
  if (injected && !queryIds.has(injected)) queryIds.set(injected, ++nextQueryId);
  const versions = new Map([[scope, versionId]]);
  const cacheKey = JSON.stringify([injected ? queryIds.get(injected) : process.env.DATABASE_URL, scope, versionId,
    [...new Set(ids)].sort(), [...new Set(bodies)].sort(), [...new Set(targets)].sort()]);
  const carried = accepted.get(cacheKey);
  const [rows] = await query([{ text: `WITH selected AS (SELECT $3::text[] ids, $4::text[] bodies, $5::text[] targets),
    projections AS (${placeProjectionSourceSql(7)})
    SELECT scope, current_version_id, CASE WHEN ($6::jsonb->>scope)=current_version_id THEN NULL ELSE ${REGISTRY_VALUE} END AS value,
      CASE WHEN ($6::jsonb->>scope)=current_version_id THEN false ELSE jsonb_path_exists(payload, '$.**."$civicPayloadPart"') END AS encoded
      FROM projections WHERE record_class=$1 AND scope=$2`,
    params: [recordClass, scope, [...ids], [...bodies], [...targets],
      JSON.stringify(carried ? { [scope]: carried.version } : {}), JSON.stringify(Object.fromEntries(versions))] }]);
  const row = rows[0];
  if (!row) {
    accepted.delete(cacheKey);
    return { kind: "NOT_RECORDED", value: null, metadata: { recordClass, scope } };
  }
  const value = carried !== undefined && carried.version === row.current_version_id ? carried.value : row.encoded
    ? (await readPlacePayloadParts(query, recordClass, [scope], ids, bodies, targets, new Map([[scope, row.current_version_id as string]]), versions)).get(scope)
    : row.value;
  if (!accepted.has(cacheKey) && accepted.size >= 64) accepted.delete(accepted.keys().next().value!);
  accepted.set(cacheKey, { version: row.current_version_id as string, value });
  return (await withRegistryFacts([{ kind: "PROMOTED", value: value as T, metadata: { recordClass, scope, versionId: row.current_version_id as string } }], injected))[0]!;
}

/** Each division whose held rows changed after `since`, with when; only changes cross the wire. */
export async function readPlaceChangesSince(since: string, injected?: ReadOnlyQuery): Promise<ReadonlyMap<string, string>> {
  const query = injected ?? readerQuery();
  if (!query) throw new Error("HELD_PLACE_CHANGES_READ_FAILED:STORE_UNCONFIGURED");
  const [rows] = await query([{ text: `SELECT division_id, max(changed_at) AS changed_at FROM civic_data_place_changes
    WHERE changed_at > $1::timestamptz GROUP BY division_id`, params: [since] }]);
  return new Map(rows.map(row => [row.division_id as string, new Date(row.changed_at as string).toISOString()]));
}
