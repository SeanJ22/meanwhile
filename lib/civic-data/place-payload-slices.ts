import type { ReadOnlyQuery } from "../control-plane/admin-view/promoted-slices.ts";
import { CivicPayloadParts } from "./payload-parts.ts";

const division = "x->>'ocdId'=ANY($3::text[]) OR x->>'divisionId'=ANY($3::text[])";
const serves = `(${division}) OR x->'alsoServesOcdIds' ?| $3::text[]`;

/** Field paths select only collections a place capture consumes. The database
 * follows immutable references and filters records before they cross the wire. */
function collections(recordClass: string): Record<string, string> {
  if (recordClass === "REGISTRY_RUNTIME_BINDING") return {
    "registry.divisions": division, "registry.bodies": serves,
    bodyRosters: `x->>'bodyId' IN (SELECT b.x->>'id' FROM records b WHERE b.scope=records.scope AND b.field='registry.bodies' AND (${serves.replaceAll("x->", "b.x->")}))`,
    statewideExecutives: "x->>'stateOcdId'=ANY($3::text[])",
    "officialCandidacies.rows": "x->'holder'->'divisions' ?| $3::text[]",
  };
  if (recordClass === "MEETING") return { meetings: `(${division}) OR x->>'bodyId'=ANY($4::text[])` };
  if (recordClass === "MEETING_OUTCOME") return { sittings: `(${division}) OR x->>'bodyId'=ANY($4::text[])` };
  if (recordClass === "FEDERAL_DIRECTORY" || recordClass === "STATE_LEGISLATOR") return {
    "roster.divisions": division,
    "roster.officeholders": `x->>'id' IN (SELECT b.x->>'officeholderId' FROM records b WHERE b.scope=records.scope AND b.field='roster.divisions' AND (${division.replaceAll("x->", "b.x->")}))`,
  };
  if (recordClass === "BALLOT_CANDIDACY" || recordClass === "BALLOT_FILING") return {
    "ballot.contests": "x->>'divisionId'=ANY($3::text[])",
    "ballot.candidacies": "x->>'contestId' IN (SELECT b.x->>'id' FROM records b WHERE b.scope=records.scope AND b.field='ballot.contests' AND b.x->>'divisionId'=ANY($3::text[]))",
    "ballot.measures": "x->>'contestId' IN (SELECT b.x->>'id' FROM records b WHERE b.scope=records.scope AND b.field='ballot.contests' AND b.x->>'divisionId'=ANY($3::text[]))",
  };
  if (recordClass === "FEC_FUNDING") return { candidates: "x->'targetKeys' ?| $5::text[]" };
  if (recordClass === "STATE_CAMPAIGN_FINANCE") return { records: "x->'targetKeys' ?| $5::text[]" };
  if (recordClass === "VOTING_SITE") return { jurisdictions: division };
  return { records: `(${division}) OR x->>'stateOcdId'=ANY($3::text[])` };
}

export async function readPlacePayloadParts(query: ReadOnlyQuery, recordClass: string, scopes: readonly string[],
  ids: readonly string[], bodies: readonly string[], targets: readonly string[],
  selection?: { readonly divisionNames: { readonly root: string; readonly names: readonly string[] } }): Promise<Map<string, unknown>> {
  const names = selection?.divisionNames;
  // Directory coverage statements can name a territory absent from the
  // current place slice. Select exact labels inside its canonical state root
  // in the database; retain all matches so ambiguity remains unresolved.
  const fields: Record<string, string> = names ? { "registry.divisions":
    "(x->>'ocdId'=$7 OR starts_with(x->>'ocdId',$7 || '/')) AND trim(regexp_replace(lower(x->>'label'),'[^[:alnum:]]+',' ','g'))=ANY($8::text[])" }
    : collections(recordClass);
  const paths = Object.keys(fields);
  const predicate = Object.entries(fields).map(([field, where]) => `(field='${field}' AND (${where}))`).join(" OR ");
  const [rows] = await query([{ text: `WITH RECURSIVE selected AS (SELECT $3::text[] ids,$4::text[] bodies,$5::text[] targets),
  walk(scope,path,step,node) AS (
    SELECT scope,string_to_array(f.field,'.'),0,payload FROM civic_data_promotions
      CROSS JOIN unnest($6::text[]) f(field) WHERE record_class=$1 AND scope=ANY($2::text[])
    UNION ALL
    SELECT w.scope,w.path,n.step,n.node FROM walk w
      LEFT JOIN civic_data_payload_parts p ON p.hash=w.node->>'$civicPayloadPart'
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
      WHERE step=cardinality(path) AND jsonb_typeof(node)='object' AND NOT node ? '$civicPayloadPart'
  )
  SELECT scope,field,jsonb_agg(x) rows FROM records WHERE ${predicate} GROUP BY scope,field
  UNION ALL
  SELECT scope,'$missing',jsonb_agg(node) FROM walk WHERE node ? '$civicPayloadPart'
    AND NOT EXISTS (SELECT 1 FROM civic_data_payload_parts p WHERE p.hash=node->>'$civicPayloadPart') GROUP BY scope`,
    params: [recordClass, [...scopes], [...ids], [...bodies], [...targets], paths,
      ...(names ? [names.root, [...names.names]] : [])] }]);
  if (rows.some(row => row.field === "$missing")) throw new Error("CIVIC_PAYLOAD_PART_MISSING");
  // Only selected records can still contain references (for example a long
  // biography). Their existing decoder preserves their exact field values.
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
  for (const row of rows) set(row.scope as string, row.field as string, await parts.load(row.rows));
  return values;
}
