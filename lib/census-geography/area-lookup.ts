import { readerQuery } from "../civic-data/promoted-reader-query.ts";
import type { ReadOnlyQuery } from "../control-plane/admin-view/promoted-slices.ts";
import type { BuiltDataset } from "./dataset.ts";
import { createLookup, notYetPublishedLookup } from "./lookup.ts";
import { CENSUS_GEO_RECORD_CLASS, CENSUS_GEO_SCOPE } from "./publication.ts";
import type { PublishedLookupState } from "./reader.ts";

/** The stored place and its touching districts, confined to its county states.
 * Filtering happens in the existing promoted store: no national payload is
 * transferred to, parsed by, or cached in a worker or its parent. */
export async function loadPublishedAreaLookupState(zips: readonly string[], query?: ReadOnlyQuery | null): Promise<PublishedLookupState> {
  if (zips.some(zip => !/^\d{5}$/.test(zip))) throw new Error("A five-digit ZIP is required");
  if (!zips.length) return { lookup: notYetPublishedLookup("NO_PLACES_REQUESTED"), source: "unavailable", versionId: "NO_PLACES_REQUESTED" };
  if (query === undefined) query = readerQuery();
  if (!query) return { lookup: notYetPublishedLookup("STORE_UNAVAILABLE"), source: "unavailable", versionId: "STORE_UNAVAILABLE" };
  const [rows] = await query([{ params: [CENSUS_GEO_RECORD_CLASS, CENSUS_GEO_SCOPE, [...new Set(zips)]], text: `
    WITH source AS MATERIALIZED (
      SELECT current_version_id, payload FROM civic_data_promotions WHERE record_class=$1 AND scope=$2
    ), scopes AS MATERIALIZED (
      SELECT s FROM source CROSS JOIN LATERAL jsonb_array_elements(payload->'scopes') s
    ), counties AS MATERIALIZED (
      SELECT g FROM scopes CROSS JOIN LATERAL jsonb_array_elements(s->'groupings') g
      WHERE s->>'type'='county'
    ), states AS (
      SELECT DISTINCT g->>'stateAbbr' state FROM counties
      WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(g->'overlaps') o WHERE o->>'zcta5'=ANY($3::text[]))
    ), codes AS MATERIALIZED (
      SELECT DISTINCT o->>'zcta5' zip FROM counties CROSS JOIN LATERAL jsonb_array_elements(g->'overlaps') o
      WHERE g->>'stateAbbr' IN (SELECT state FROM states)
    ), pieces AS (
      SELECT s - 'groupings' AS s, jsonb_agg(jsonb_set(g, '{overlaps}',
        (SELECT COALESCE(jsonb_agg(o), '[]'::jsonb) FROM jsonb_array_elements(g->'overlaps') o
          WHERE o->>'zcta5' IN (SELECT zip FROM codes)))) groups
      FROM scopes CROSS JOIN LATERAL jsonb_array_elements(s->'groupings') g
      WHERE g->>'stateAbbr' IN (SELECT state FROM states)
        AND EXISTS (SELECT 1 FROM jsonb_array_elements(g->'overlaps') o WHERE o->>'zcta5'=ANY($3::text[]))
      GROUP BY s - 'groupings'
    ) SELECT current_version_id AS version_id,
      jsonb_build_object('formatVersion', 1, 'builtAt', payload->>'builtAt', 'coverage', 'Selected places and in-state touching districts',
        'scopes', (SELECT COALESCE(jsonb_agg(s || jsonb_build_object('groupings', groups,
          'instanceCount', jsonb_array_length(groups), 'zctaEdgeCount',
          (SELECT COALESCE(sum(jsonb_array_length(g->'overlaps')), 0) FROM jsonb_array_elements(groups) g))), '[]'::jsonb) FROM pieces),
        'zctaUniverse', (SELECT COALESCE(jsonb_agg(zip), '[]'::jsonb) FROM codes WHERE zip=ANY($3::text[]))) AS dataset
      FROM source` }]);
  const row = rows?.[0];
  if (typeof row?.version_id !== "string" || !row.dataset) return { lookup: notYetPublishedLookup("NOT_RECORDED"), source: "unavailable", versionId: "NOT_RECORDED" };
  return { lookup: createLookup(row.dataset as unknown as BuiltDataset, row.version_id), source: "published", versionId: row.version_id };
}
