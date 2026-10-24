import type { Query } from "./publish.ts";

export interface EntityPlace {
  readonly placeId: string;
  /** The source boundary's vintage; null means the source has not supplied one. */
  readonly boundaryYear: number | null;
  readonly basis: "SERVICE_AREA" | "HOST_COUNTY";
}

/** File the same durable entity everywhere it serves. A county filing without a shape remains explicit. */
export async function fileEntityPlaces(query: Query, entityId: string, places: readonly EntityPlace[], parentId?: string | null): Promise<void> {
  await query(`WITH supplied AS (
    SELECT * FROM unnest($2::text[], $3::int[], $4::text[]) AS p(place_id,boundary_year,placement_basis)
    UNION ALL
    SELECT place_id,boundary_year,placement_basis FROM entity_place WHERE entity_id=$5
    UNION ALL
    SELECT id,NULL::int,'SERVICE_AREA' FROM entity WHERE id=$5 AND kind='place'
  ), located AS (
    SELECT DISTINCT ON (p.place_id) p.* FROM supplied p
    JOIN entity place ON place.id=p.place_id AND place.kind='place'
    JOIN entity subject ON subject.id=$1 AND (place.state=subject.state OR place.state IS NULL)
    ORDER BY p.place_id,p.boundary_year DESC NULLS LAST
  ) INSERT INTO entity_place(entity_id,place_id,boundary_year,placement_basis)
    SELECT $1,place_id,boundary_year,placement_basis FROM located
    WHERE place_id !~ '^ocd-division/country:us/(state|district|territory):[^/]+$'
      OR NOT EXISTS (SELECT 1 FROM located WHERE place_id ~ '^ocd-division/country:us/(state|district|territory):[^/]+/')
    ON CONFLICT(entity_id,place_id) DO UPDATE SET
      boundary_year=coalesce(EXCLUDED.boundary_year,entity_place.boundary_year),placement_basis=EXCLUDED.placement_basis`,
  [entityId,places.map(p => p.placeId),places.map(p => p.boundaryYear),places.map(p => p.basis),parentId ?? null]);
  await query(`DELETE FROM entity_place root WHERE root.entity_id=$1
    AND root.place_id ~ '^ocd-division/country:us/(state|district|territory):[^/]+$'
    AND EXISTS (SELECT 1 FROM entity_place local WHERE local.entity_id=root.entity_id
      AND local.place_id ~ '^ocd-division/country:us/(state|district|territory):[^/]+/')`, [entityId]);
}
