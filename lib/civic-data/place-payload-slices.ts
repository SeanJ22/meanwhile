import type { ReadOnlyQuery } from "../control-plane/admin-view/promoted-slices.ts";
import { CivicPayloadParts } from "./payload-parts.ts";

const division = "x->>'ocdId'=ANY($3::text[]) OR x->>'divisionId'=ANY($3::text[])";

function collections(recordClass: string): Record<string, string> {
  if (recordClass === "CENSUS_REFERENCE") {
    const population = "(x->>'geography' || ':' || x->>'code')=ANY($3::text[]) OR x->'divisionIds' ?| $3::text[]";
    return { state: population, zcta: population, geographies: population };
  }
  if (recordClass === "MEETING") return { meetings: `(${division}) OR x->>'bodyId'=ANY($4::text[])` };
  if (recordClass === "MEETING_OUTCOME") return { sittings: `(${division}) OR x->>'bodyId'=ANY($4::text[])` };
  if (recordClass === "FEDERAL_DIRECTORY" || recordClass === "STATE_LEGISLATOR") return {
    "roster.divisions": division,
    "roster.officeholders": `x->>'id' IN (SELECT b.x->>'officeholderId' FROM records b WHERE b.scope=records.scope AND b.field='roster.divisions' AND (${division.replaceAll("x->", "b.x->")}))`,
  };
  if (recordClass === "FEC_FUNDING") return { candidates: "x->'targetKeys' ?| $5::text[]" };
  if (recordClass === "STATE_CAMPAIGN_FINANCE") return { records: "x->'targetKeys' ?| $5::text[]" };
  return { records: `(${division}) OR x->>'stateOcdId'=ANY($3::text[])` };
}

export async function readPlacePayloadParts(query: ReadOnlyQuery, recordClass: string, scopes: readonly string[],
  ids: readonly string[], bodies: readonly string[], targets: readonly string[], versions: ReadonlyMap<string, string> = new Map()): Promise<Map<string, unknown>> {
  if (["REGISTRY_RUNTIME_BINDING", "BALLOT_CANDIDACY", "CANDIDATE_PROFILE", "CANDIDATE_PUBLICATION", "VOTING_SITE"].includes(recordClass) || scopes.some(scope => scope.endsWith(":candidate-campaign-sites-derived")))
    throw new Error("STATE_AUTHORITY_REQUIRES_KEYED_READ");
  const fields = collections(recordClass), paths = Object.keys(fields);
  const predicate = Object.entries(fields).map(([field, where]) => `(field='${field.replaceAll("'", "''")}' AND (${where}))`).join(" OR ");
  const [rows] = await query([{ text: `WITH RECURSIVE
  projections AS (SELECT record_class,scope,current_version_id,payload FROM civic_data_promotions
    WHERE record_class=$1 AND scope=ANY($2::text[])),
  walk(scope,path,step,node) AS (
    SELECT scope,string_to_array(f.field,'.'),0,payload FROM projections
      CROSS JOIN unnest($6::text[]) f(field) WHERE record_class=$1 AND scope=ANY($2::text[])
    UNION ALL
    SELECT w.scope,w.path,n.step,n.node FROM walk w
      LEFT JOIN LATERAL (SELECT hash,payload FROM civic_data_payload_parts
        WHERE hash=w.node->>'$civicPayloadPart' OFFSET 0) p ON true
      CROSS JOIN LATERAL (SELECT CASE WHEN p.hash IS NULL THEN w.node
        WHEN p.payload->>'kind'='object' THEN p.payload->'value'
        WHEN p.payload->>'kind'='array' THEN p.payload->'groups' ELSE p.payload END node) r
      CROSS JOIN LATERAL (
        SELECT w.step+1 step,r.node->w.path[w.step+1] node
          WHERE jsonb_typeof(r.node)='object' AND w.step<cardinality(w.path)
        UNION ALL
        SELECT w.step,e.node FROM jsonb_array_elements(CASE WHEN jsonb_typeof(r.node)='array'
          THEN r.node ELSE '[]'::jsonb END) e(node)
        UNION ALL
        SELECT w.step,r.node WHERE p.hash IS NOT NULL AND jsonb_typeof(r.node)='object'
          AND w.step=cardinality(w.path)

      ) n WHERE n.node IS NOT NULL
  ), records AS (
    SELECT DISTINCT scope,array_to_string(path,'.') field,node x FROM walk
      WHERE step=cardinality(path) AND NOT node ? '$civicPayloadPart'
        AND jsonb_typeof(node)<>'array'
  )
  SELECT scope,field,jsonb_agg(x) rows FROM records WHERE ${predicate} GROUP BY scope,field
  UNION ALL
  SELECT scope,'$missing',jsonb_agg(node) FROM walk WHERE node ? '$civicPayloadPart'
    AND (SELECT p.hash IS NULL FROM (VALUES (node->>'$civicPayloadPart')) wanted(hash)
        LEFT JOIN LATERAL (SELECT hash FROM civic_data_payload_parts WHERE hash=wanted.hash OFFSET 0) p ON true) GROUP BY scope
  UNION ALL
  SELECT scope,'$version',to_jsonb(current_version_id) FROM projections WHERE record_class=$1 AND scope=ANY($2::text[])`,
    params: [recordClass, [...scopes], [...ids], [...bodies], [...targets], paths] }]);
  if (rows.some(row => row.field === "$missing")) throw new Error("CIVIC_PAYLOAD_PART_MISSING");
  for (const scope of scopes) if (versions.has(scope) && rows.find(row => row.scope === scope && row.field === "$version")?.rows !== versions.get(scope)) {
    throw new Error("CIVIC_POINTER_CHANGED_DURING_READ");
  }
  const parts = new CivicPayloadParts({ existing: async () => [], write: async () => { throw new Error("READ_ONLY"); },
    read: async hashes => {
      const [found] = await query([{ text: "SELECT hash,payload FROM civic_data_payload_parts WHERE hash=ANY($1::text[])", params: [[...hashes]] }]);
      return found as unknown as { hash: string; payload: unknown }[];
    } });
  const values = new Map<string, Record<string, unknown>>(scopes.map(scope => [scope, {}]));
  const set = (scope: string, field: string, value: unknown) => {
    let object = values.get(scope)!;
    const keys = field.split(".");
    for (const key of keys.slice(0, -1)) object = (object[key] ??= {}) as Record<string, unknown>;
    object[keys.at(-1)!] = value;
  };
  for (const scope of scopes) for (const field of paths) set(scope, field, []);
  for (const row of rows) if (row.field !== "$version") set(row.scope as string, row.field as string, await parts.load(row.rows));

  return values;
}
