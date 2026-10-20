import { readerQuery } from "../civic-data/promoted-reader-query.ts";
import type { ReadOnlyQuery } from "../control-plane/admin-view/promoted-slices.ts";
import type { ExpansionScopeGeography } from "../control-plane/expansion/scopes.ts";
import type { BuiltDataset } from "./dataset.ts";
import { createLookup, notYetPublishedLookup } from "./lookup.ts";
import { CENSUS_GEO_RECORD_CLASS, CENSUS_GEO_SCOPE } from "./publication.ts";
import type { PublishedLookupState } from "./reader.ts";

/** Resolve existing owner instructions with only their selected groupings.
 * A small Send never copies the national geography payload into a runner. */
export async function loadPublishedScopeLookupState(scopes: readonly ExpansionScopeGeography[], query: ReadOnlyQuery | null = readerQuery()): Promise<PublishedLookupState> {
  if (!query) return { lookup: notYetPublishedLookup("STORE_UNAVAILABLE"), source: "unavailable", versionId: "STORE_UNAVAILABLE" };
  const [rows] = await query([{ params: [CENSUS_GEO_RECORD_CLASS, CENSUS_GEO_SCOPE, JSON.stringify(scopes)], text: `
    WITH source AS MATERIALIZED (
      SELECT current_version_id, payload FROM civic_data_promotions WHERE record_class=$1 AND scope=$2
    ), wanted AS MATERIALIZED (SELECT w FROM jsonb_array_elements($3::jsonb) w),
    pieces AS (
      SELECT s - 'groupings' AS s, jsonb_agg(g) groups
      FROM source CROSS JOIN LATERAL jsonb_array_elements(payload->'scopes') s
      CROSS JOIN LATERAL jsonb_array_elements(s->'groupings') g
      WHERE EXISTS (SELECT 1 FROM wanted WHERE
        (w->>'type'='state' AND s->>'type'='county' AND g->>'stateAbbr'=w->>'stateAbbr') OR
        (w->>'type'=s->>'type' AND g->>'geoid'=w->>'geoid' AND s->>'version'=w->>'version') OR
        (w->>'type'='zcta' AND EXISTS (SELECT 1 FROM jsonb_array_elements(g->'overlaps') o WHERE o->>'zcta5'=w->>'geoid')))
      GROUP BY s - 'groupings'
    ) SELECT current_version_id AS version_id,
      jsonb_build_object('formatVersion', 1, 'builtAt', payload->>'builtAt', 'coverage', 'Explicit owner scope groupings',
        'scopes', (SELECT COALESCE(jsonb_agg(s || jsonb_build_object('groupings', groups,
          'instanceCount', jsonb_array_length(groups), 'zctaEdgeCount',
          (SELECT COALESCE(sum(jsonb_array_length(g->'overlaps')),0) FROM jsonb_array_elements(groups) g))), '[]'::jsonb) FROM pieces),
        'zctaUniverse', (SELECT COALESCE(jsonb_agg(DISTINCT o->>'zcta5'), '[]'::jsonb) FROM pieces
          CROSS JOIN LATERAL jsonb_array_elements(groups) g CROSS JOIN LATERAL jsonb_array_elements(g->'overlaps') o)) AS dataset
      FROM source` }]);
  const row = rows?.[0];
  if (typeof row?.version_id !== "string" || !row.dataset) return { lookup: notYetPublishedLookup("NOT_RECORDED"), source: "unavailable", versionId: "NOT_RECORDED" };
  return { lookup: createLookup(row.dataset as unknown as BuiltDataset, row.version_id), source: "published", versionId: row.version_id };
}
