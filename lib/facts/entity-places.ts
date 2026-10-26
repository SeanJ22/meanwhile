import type { Query } from "./publish.ts";
import type { EntityPlace as SharedEntityPlace } from "../core/shapes.ts";
import { enqueueReaderPlaces } from "../reader/cache.ts";

export interface EntityPlace extends Pick<SharedEntityPlace,"placeId" | "boundaryYear"> {
  readonly basis: "SERVICE_AREA" | "HOST_COUNTY";
}

/** File the same durable entity everywhere it serves. A county filing without a shape remains explicit. */
export async function fileEntityPlaces(query: Query, entityId: string, places: readonly EntityPlace[], parentId?: string | null,
  changedEntities:readonly string[]=[]): Promise<boolean> {
  const inserted=await query(`WITH RECURSIVE ancestors AS (
    SELECT id,kind,parent_id,ARRAY[id] AS path FROM entity WHERE id=$5
    UNION ALL SELECT e.id,e.kind,e.parent_id,a.path || e.id FROM entity e JOIN ancestors a ON e.id=a.parent_id
      WHERE NOT e.id=ANY(a.path)
  ), supplied AS (
    SELECT * FROM unnest($2::text[], $3::int[], $4::text[]) AS p(place_id,boundary_year,placement_basis)
    UNION ALL
    SELECT p.place_id,p.boundary_year,p.placement_basis FROM entity_place p JOIN ancestors a ON p.entity_id=a.id
    UNION ALL
    SELECT id,0,'SERVICE_AREA' FROM ancestors WHERE kind='place'
  ), located AS (
    SELECT DISTINCT ON (p.place_id,p.boundary_year) p.* FROM supplied p
    JOIN entity place ON place.id=p.place_id AND place.kind='place'
    JOIN entity subject ON subject.id=$1 AND (place.state=subject.state OR place.state IS NULL)
    WHERE p.boundary_year<>0 OR NOT EXISTS (
      SELECT 1 FROM supplied dated WHERE dated.place_id=p.place_id AND dated.boundary_year>0
    ) AND NOT EXISTS (
      SELECT 1 FROM entity_place dated WHERE dated.entity_id=$1 AND dated.place_id=p.place_id AND dated.boundary_year>0
    )
    ORDER BY p.place_id,p.boundary_year,CASE WHEN p.placement_basis='SERVICE_AREA' THEN 0 ELSE 1 END
  ) INSERT INTO entity_place(entity_id,place_id,boundary_year,placement_basis)
    SELECT $1,place_id,boundary_year,placement_basis FROM located
    WHERE (place_id<>'ocd-division/country:us' OR NOT EXISTS (SELECT 1 FROM located WHERE place_id<>'ocd-division/country:us'))
      AND (place_id !~ '^ocd-division/country:us/(state|district|territory):[^/]+$'
      OR NOT EXISTS (SELECT 1 FROM located WHERE place_id ~ '^ocd-division/country:us/(state|district|territory):[^/]+/'))
    ON CONFLICT(entity_id,place_id,boundary_year) DO UPDATE SET placement_basis=EXCLUDED.placement_basis
      WHERE entity_place.placement_basis IS DISTINCT FROM EXCLUDED.placement_basis
        AND EXCLUDED.placement_basis='SERVICE_AREA' RETURNING place_id`,
  [entityId,places.map(p => p.placeId),places.map(p => p.boundaryYear),places.map(p => p.basis),parentId ?? null]);
  const unknown=await query(`DELETE FROM entity_place unknown WHERE unknown.entity_id=$1 AND unknown.boundary_year=0
    AND EXISTS (SELECT 1 FROM entity_place dated WHERE dated.entity_id=unknown.entity_id
      AND dated.place_id=unknown.place_id AND dated.boundary_year>0) RETURNING place_id`,[entityId]);
  const country=await query(`DELETE FROM entity_place country WHERE country.entity_id=$1 AND country.place_id='ocd-division/country:us'
    AND EXISTS (SELECT 1 FROM entity_place local WHERE local.entity_id=country.entity_id AND local.place_id<>country.place_id) RETURNING place_id`,[entityId]);
  const root=await query(`DELETE FROM entity_place root WHERE root.entity_id=$1
    AND root.place_id ~ '^ocd-division/country:us/(state|district|territory):[^/]+$'
    AND EXISTS (SELECT 1 FROM entity_place local WHERE local.entity_id=root.entity_id
      AND local.place_id ~ '^ocd-division/country:us/(state|district|territory):[^/]+/') RETURNING place_id`, [entityId]);
  const moved=inserted.length+unknown.length+country.length+root.length>0;
  if(moved || changedEntities.length)await enqueueReaderPlaces({entities:[...new Set([entityId,...changedEntities])],
    places:[...unknown,...country,...root].map(row=>String(row.place_id))},query);
  return moved;
}
