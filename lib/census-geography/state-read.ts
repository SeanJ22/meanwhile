import type { BuiltDataset, BuiltScope } from "./dataset.ts";
import { CENSUS_GEO_RECORD_CLASS, CENSUS_GEO_SCOPE, censusGeographyScope, censusGeographyState } from "./publication.ts";
import { readerQuery } from "../civic-data/promoted-reader-query.ts";
import type { ReadOnlyQuery } from "../control-plane/admin-view/promoted-slices.ts";
import { CivicPayloadParts } from "../civic-data/payload-parts.ts";

/** Old source evidence remains useful while state publications replace it. SQL
 * selects the state before a payload part or grouping crosses into the job. */
export async function readCensusStateDataset(state: string, query: ReadOnlyQuery | null = readerQuery()): Promise<BuiltDataset | null> {
  const selected = censusGeographyState(state);
  if (!query) throw new Error("CENSUS_STATE_STORE_UNAVAILABLE");
  const [rows] = await query([{ params: [CENSUS_GEO_RECORD_CLASS, censusGeographyScope(state), CENSUS_GEO_SCOPE, selected.state], text: `
    WITH RECURSIVE source AS MATERIALIZED (
      SELECT payload,current_version_id,scope AS source_scope FROM civic_data_promotions WHERE record_class=$1 AND scope IN ($2,$3)
      ORDER BY (scope=$2) DESC LIMIT 1
    ), walk(step,node,meta) AS (
      SELECT 0,payload,'{}'::jsonb FROM source
      UNION ALL
      SELECT n.step,n.node,n.meta FROM walk w
      LEFT JOIN civic_data_payload_parts p ON p.hash=w.node->>'$civicPayloadPart'
      CROSS JOIN LATERAL (SELECT CASE WHEN p.hash IS NULL THEN w.node
        WHEN p.payload->>'kind'='object' THEN p.payload->'value'
        WHEN p.payload->>'kind'='array' THEN p.payload->'groups' ELSE p.payload END node) r
      CROSS JOIN LATERAL (
        SELECT w.step+1 step,r.node->(CASE w.step WHEN 0 THEN 'scopes' ELSE 'groupings' END) node,
          CASE WHEN w.step=1 THEN r.node - 'groupings' ELSE w.meta END meta
          WHERE w.step<2 AND jsonb_typeof(r.node)='object' AND NOT r.node ? '$civicPayloadPart'
        UNION ALL SELECT w.step,e.node,w.meta FROM jsonb_array_elements(CASE WHEN jsonb_typeof(r.node)='array' THEN r.node ELSE '[]'::jsonb END) e(node)
        UNION ALL SELECT w.step,r.node,w.meta WHERE w.step=2 AND p.hash IS NOT NULL AND jsonb_typeof(r.node)='object'
      ) n WHERE n.node IS NOT NULL
    ) SELECT DISTINCT meta,node grouping FROM walk WHERE step=2 AND NOT node ? '$civicPayloadPart'
      AND (node->>'stateAbbr'=$4 OR node->'memberStates' @> jsonb_build_array($4::text))
      AND (meta->>'type'<>'cbsa' OR (SELECT source_scope FROM source)=$2)
    UNION ALL SELECT '{}'::jsonb,jsonb_build_object('$missing',true) FROM walk WHERE node ? '$civicPayloadPart'
      AND NOT EXISTS(SELECT 1 FROM civic_data_payload_parts p WHERE p.hash=node->>'$civicPayloadPart')` }]);
  if (!rows.length) return null;
  if (rows.some(row => (row.grouping as { $missing?: boolean }).$missing)) throw new Error("CIVIC_PAYLOAD_PART_MISSING");
  const parts = new CivicPayloadParts({ existing: async () => [], write: async () => { throw new Error("READ_ONLY"); }, read: async hashes => {
    const [found] = await query([{ text: "SELECT hash,payload FROM civic_data_payload_parts WHERE hash=ANY($1::text[])", params: [[...hashes]] }]);
    return found as unknown as { hash: string; payload: unknown }[];
  } });
  const scopes = new Map<string, BuiltScope>();
  for (const row of await parts.load(rows) as { meta: Omit<BuiltScope,"groupings">; grouping: BuiltScope["groupings"][number] }[]) {
    const key = `${row.meta.type}:${row.meta.version}`;
    const scope = scopes.get(key) ?? { ...row.meta, groupings: [], instanceCount: 0, zctaEdgeCount: 0 };
    (scope.groupings as BuiltScope["groupings"][number][]).push(row.grouping);
    scopes.set(key, scope);
  }
  const values = [...scopes.values()].map(scope => ({ ...scope, groupings: [...scope.groupings].sort((a,b)=>a.geoid.localeCompare(b.geoid)), instanceCount: scope.groupings.length,
    zctaEdgeCount: scope.groupings.reduce((n,g) => n + g.overlaps.length,0) })).sort((a,b)=>`${a.type}:${a.version}`.localeCompare(`${b.type}:${b.version}`));
  return { formatVersion: 1, builtAt: values.flatMap(s => s.versionMeta.provenance.computedAt).sort().at(-1) ?? "",
    coverage: `state:${selected.state}`, scopes: values,
    zctaUniverse: [...new Set(values.flatMap(s => s.groupings.flatMap(g => g.overlaps.map(o => o.zcta5))))].sort() };
}
