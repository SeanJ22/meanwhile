import type { ReadOnlyQuery } from "../control-plane/admin-view/promoted-slices.ts";
import { CivicPayloadParts } from "./payload-parts.ts";

const division = "x->>'ocdId'=ANY($3::text[]) OR x->>'divisionId'=ANY($3::text[])";
const serves = `(${division}) OR x->'alsoServesOcdIds' ?| $3::text[] OR x->>'id'=ANY($4::text[])`;

/** The manifest may still serve an earlier accepted version after its mutable
 * pointer advances. Its immutable candidate and payload parts remain the same
 * promoted evidence; no current pointer or whole-country payload is substituted. */
export function placeProjectionSourceSql(acceptedVersionsParameter?: number): string {
  return acceptedVersionsParameter === undefined
    ? "SELECT record_class,scope,current_version_id,payload FROM civic_data_promotions"
    : `SELECT c.record_class,c.scope,c.id current_version_id,c.candidate->'readModel' payload
       FROM jsonb_each_text($${acceptedVersionsParameter}::jsonb) accepted(scope,version_id)
       JOIN civic_data_candidates c ON c.id=accepted.version_id AND c.scope=accepted.scope
       WHERE c.state='PROMOTED' AND c.promoted_version_id=c.id`;
}

function collections(recordClass: string): Record<string, string> {
  if (recordClass === "REGISTRY_RUNTIME_BINDING") return {
    "registry.divisions": division, "registry.bodies": serves,
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
    "ballot.election": "TRUE",
    "ballot.contests": division,
    "ballot.candidacies": `x->>'contestId' IN (SELECT b.x->>'id' FROM records b WHERE b.scope=records.scope AND b.field='ballot.contests' AND (${division.replaceAll("x->", "b.x->")}))`,
    "ballot.measures": `x->>'contestId' IN (SELECT b.x->>'id' FROM records b WHERE b.scope=records.scope AND b.field='ballot.contests' AND (${division.replaceAll("x->", "b.x->")}))`,
    "generalLineup.contests": `x->>'contestId' IN (SELECT b.x->>'id' FROM records b WHERE b.scope=records.scope AND b.field='ballot.contests' AND (${division.replaceAll("x->", "b.x->")}))`,
  };
  if (recordClass === "CANDIDATE_PROFILE") return { "cards.cards": "member_key=ANY($5::text[])", "links.links": "member_key=ANY($5::text[])" };
  if (recordClass === "CANDIDATE_PUBLICATION") return { documents: "x->>'candidateKey'=ANY($5::text[])" };
  if (recordClass === "FEC_FUNDING") return { candidates: "x->'targetKeys' ?| $5::text[]" };
  if (recordClass === "STATE_CAMPAIGN_FINANCE") return { records: "x->'targetKeys' ?| $5::text[]" };
  if (recordClass === "VOTING_SITE") return { jurisdictions: division };
  return { records: `(${division}) OR x->>'stateOcdId'=ANY($3::text[])` };
}

export async function readPlacePayloadParts(query: ReadOnlyQuery, recordClass: string, scopes: readonly string[],
  ids: readonly string[], bodies: readonly string[], targets: readonly string[], versions: ReadonlyMap<string, string> = new Map(),
  acceptedVersions?: ReadonlyMap<string, string>): Promise<Map<string, unknown>> {
  const derived = recordClass === "CURATED_READER_RECORD" && scopes.every(scope => scope === "US:candidate-campaign-sites-derived");
  const fields = derived ? { records: "x->>'id'=ANY($5::text[]) OR x->>'candidacyId'=ANY($5::text[])", kind: "TRUE", formatVersion: "TRUE" } : collections(recordClass);
  const maps = recordClass === "CANDIDATE_PROFILE" ? ["cards.cards", "links.links"] : [];
  const single = ["ballot.election", ...(derived ? ["kind", "formatVersion"] : [])];
  const paths = Object.keys(fields);
  const predicate = Object.entries(fields).map(([field, where]) => `(field='${field}' AND (${where}))`).join(" OR ");
  const [rows] = await query([{ text: `WITH RECURSIVE selected AS (SELECT $3::text[] ids,$4::text[] bodies,$5::text[] targets),
  projections AS (${placeProjectionSourceSql(acceptedVersions === undefined ? undefined : 8)}),
  walk(scope,path,step,node,member_key) AS (
    SELECT scope,string_to_array(f.field,'.'),0,payload,NULL::text FROM projections
      CROSS JOIN unnest($6::text[]) f(field) WHERE record_class=$1 AND scope=ANY($2::text[])
    UNION ALL
    SELECT w.scope,w.path,n.step,n.node,n.member_key FROM walk w
      LEFT JOIN civic_data_payload_parts p ON p.hash=w.node->>'$civicPayloadPart'
      CROSS JOIN LATERAL (SELECT CASE WHEN p.hash IS NULL THEN w.node
        WHEN p.payload->>'kind'='object' THEN p.payload->'value'
        WHEN p.payload->>'kind'='array' THEN p.payload->'groups' ELSE p.payload END node) r
      CROSS JOIN LATERAL (
        SELECT w.step+1 step,r.node->w.path[w.step+1] node,w.member_key
          WHERE jsonb_typeof(r.node)='object' AND w.step<cardinality(w.path)
        UNION ALL
        SELECT w.step,e.node,w.member_key FROM jsonb_array_elements(CASE WHEN jsonb_typeof(r.node)='array'
          THEN r.node ELSE '[]'::jsonb END) e(node)
        UNION ALL
        SELECT w.step,r.node,w.member_key WHERE p.hash IS NOT NULL AND jsonb_typeof(r.node)='object'
          AND w.step=cardinality(w.path)
          AND (NOT array_to_string(w.path,'.')=ANY($7::text[]) OR w.member_key IS NOT NULL)
        UNION ALL
        SELECT w.step,e.value,e.key FROM jsonb_each(CASE WHEN jsonb_typeof(r.node)='object' THEN r.node ELSE '{}'::jsonb END) e
          WHERE w.step=cardinality(w.path) AND array_to_string(w.path,'.')=ANY($7::text[])
            AND w.member_key IS NULL AND e.key=ANY($5::text[])
      ) n WHERE n.node IS NOT NULL
  ), records AS (
    SELECT DISTINCT scope,array_to_string(path,'.') field,node x,member_key FROM walk
      WHERE step=cardinality(path) AND NOT node ? '$civicPayloadPart'
        AND (jsonb_typeof(node)='object' OR array_to_string(path,'.') IN ('kind','formatVersion'))
        AND (NOT array_to_string(path,'.')=ANY($7::text[]) OR member_key IS NOT NULL)
  )
  SELECT scope,field,jsonb_agg(CASE WHEN member_key IS NULL THEN x ELSE jsonb_build_object('key',member_key,'value',x) END) rows FROM records WHERE ${predicate} GROUP BY scope,field
  UNION ALL
  SELECT scope,'$missing',jsonb_agg(node) FROM walk WHERE node ? '$civicPayloadPart'
    AND NOT EXISTS (SELECT 1 FROM civic_data_payload_parts p WHERE p.hash=node->>'$civicPayloadPart') GROUP BY scope
  UNION ALL
  SELECT scope,'$version',to_jsonb(current_version_id) FROM projections WHERE record_class=$1 AND scope=ANY($2::text[])`,
    params: [recordClass, [...scopes], [...ids], [...bodies], [...targets], paths, maps,
      ...(acceptedVersions === undefined ? [] : [JSON.stringify(Object.fromEntries(acceptedVersions))])] }]);
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
  for (const scope of scopes) for (const field of paths) set(scope, field, maps.includes(field) ? {} : []);
  for (const row of rows) if (row.field !== "$version") {
    const decoded = await parts.load(row.rows);
    set(row.scope as string, row.field as string, maps.includes(row.field as string)
      ? Object.fromEntries((decoded as { key: string; value: unknown }[]).map(entry => [entry.key, entry.value]))
      : single.includes(row.field as string) ? (decoded as unknown[])[0] : decoded);
  }
  return values;
}
