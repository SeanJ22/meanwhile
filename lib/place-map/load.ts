import type { FactDb, Query } from "../facts/publish.ts";
import { boundingBoxOf } from "../registry/resolve.ts";
import type { PlaceBoundary } from "./types.ts";
import type { EntityPlace } from "../core/shapes.ts";
import type { ZctaCentroid } from "../geo/zcta-core.ts";

export interface MapZipLocation extends Omit<ZctaCentroid,"lat"|"lng"> {
  readonly lat: number | null;
  readonly lng: number | null;
  readonly boundaryYear: number;
  readonly sourceUrls: readonly string[];
  readonly checkedAt: string;
}

export interface MapPlace {
  readonly id: string;
  readonly name: string;
  readonly state: string | null;
  readonly aliases: readonly { readonly scheme: string; readonly value: string }[];
}
export interface MapEdge {
  readonly code: string;
  readonly placeId: string;
  readonly boundaryYear: number;
  readonly share: number | null;
  readonly shareBasis: string;
  readonly partial: boolean;
  readonly fringe: boolean;
}
export interface StatePlaceMap {
  readonly places: readonly MapPlace[];
  readonly boundaries: readonly PlaceBoundary[];
  readonly zipEdges: readonly MapEdge[];
  readonly zctaEdges: readonly MapEdge[];
  readonly entityPlaces?: readonly EntityPlace[];
  readonly zipLocations?: readonly MapZipLocation[];
}

async function batches<T>(rows: readonly T[], run: (batch: readonly T[]) => Promise<void>): Promise<void> {
  for (let at = 0; at < rows.length; at += 500) await run(rows.slice(at, at + 500));
}

/** One state's source update is atomic. A failed update keeps its previous
 * rows; older plans and every existing id remain available on later runs. */
export async function loadStatePlaceMap(db: FactDb, map: StatePlaceMap): Promise<void> {
  await db.transaction(async query => {
    await batches(map.zipLocations ?? [], async locations => {
      await query(`INSERT INTO zip_location(zip,boundary_year,lat,lng,postal,source_urls,checked_at)
        SELECT zip,boundary_year,lat,lng,postal,source_urls,checked_at FROM jsonb_to_recordset($1::jsonb)
          AS p(zip text,boundary_year integer,lat float8,lng float8,postal jsonb,source_urls jsonb,checked_at timestamptz)
        ON CONFLICT(zip,boundary_year) DO UPDATE SET lat=EXCLUDED.lat,lng=EXCLUDED.lng,postal=EXCLUDED.postal,
          source_urls=EXCLUDED.source_urls,checked_at=EXCLUDED.checked_at`,
      [JSON.stringify(locations.map(row => ({zip:row.zip,boundary_year:row.boundaryYear,lat:row.lat,lng:row.lng,
        postal:row.postal ?? null,source_urls:row.sourceUrls,checked_at:row.checkedAt})))]);
    });
    await batches(map.places, async places => {
      await query(`INSERT INTO entity(id,kind,name,state)
        SELECT id,'place',name,state FROM jsonb_to_recordset($1::jsonb) AS p(id text,name text,state char(2))
        ON CONFLICT(id) DO NOTHING`, [JSON.stringify(places)]);
      const aliases = places.flatMap(place => place.aliases.map(alias => ({ entity_id: place.id, ...alias })));
      await query(`INSERT INTO entity_external_id AS held(entity_id,scheme,value)
        SELECT entity_id,scheme,value FROM jsonb_to_recordset($1::jsonb) AS a(entity_id text,scheme text,value text)
        ON CONFLICT(scheme,value) DO UPDATE SET entity_id=EXCLUDED.entity_id
        WHERE held.entity_id IS DISTINCT FROM EXCLUDED.entity_id
          AND EXISTS(SELECT 1 FROM entity e WHERE e.id=held.entity_id AND e.kind='place')`, [JSON.stringify(aliases)]);
    });
    await batches(map.boundaries, async boundaries => {
      const rows = boundaries.map(b => ({ place_id: b.placeId, boundary_year: b.boundaryYear, layer: b.layer, version: b.version,
        geometry: b.geometry, bounds: b.geometry ? boundingBoxOf({ properties: { ocdId: b.placeId, label: "" }, geometry: b.geometry }) : null,
        host_county_id: b.hostCountyId, county_attachment: b.countyAttachment, source_urls: b.sourceUrls, checked_at: b.checkedAt }));
      await query(`INSERT INTO place_boundary(place_id,boundary_year,layer,version,geometry,bounds,host_county_id,county_attachment,source_urls,checked_at)
        SELECT place_id,boundary_year,layer,version,geometry,
          CASE WHEN bounds IS NULL THEN NULL ELSE box(point((bounds->>0)::float8,(bounds->>1)::float8),point((bounds->>2)::float8,(bounds->>3)::float8)) END,
          host_county_id,county_attachment,source_urls,checked_at
        FROM jsonb_to_recordset($1::jsonb) AS b(place_id text,boundary_year integer,layer text,version text,geometry jsonb,bounds jsonb,
          host_county_id text,county_attachment boolean,source_urls jsonb,checked_at timestamptz)
        ON CONFLICT(place_id,boundary_year) DO UPDATE SET geometry=coalesce(EXCLUDED.geometry,place_boundary.geometry),
          bounds=coalesce(EXCLUDED.bounds,place_boundary.bounds), source_urls=EXCLUDED.source_urls, checked_at=EXCLUDED.checked_at,
          county_attachment=CASE WHEN coalesce(EXCLUDED.geometry,place_boundary.geometry) IS NOT NULL THEN false ELSE EXCLUDED.county_attachment END,
          host_county_id=coalesce(EXCLUDED.host_county_id,place_boundary.host_county_id)`, [JSON.stringify(rows)]);
    });
    await loadEdges(query, "zip", map.zipEdges);
    await loadEdges(query, "zcta", map.zctaEdges);
    await batches(map.entityPlaces ?? [], async rows => {
      await query(`INSERT INTO entity_place(entity_id,place_id,boundary_year)
        SELECT e.id,p.id,r.boundary_year FROM jsonb_to_recordset($1::jsonb) AS r(entity_id text,place_id text,boundary_year integer)
        JOIN entity e ON e.id=r.entity_id JOIN entity p ON p.id=r.place_id
        ON CONFLICT(entity_id,place_id,boundary_year) DO NOTHING`,
      [JSON.stringify(rows.map(row => ({ entity_id: row.entityId, place_id: row.placeId, boundary_year: row.boundaryYear })))]);
    });
  });
}

async function loadEdges(query: Query, kind: "zip" | "zcta", edges: readonly MapEdge[]): Promise<void> {
  const table = kind === "zip" ? "zip_place" : "zcta_place";
  await batches(edges, async batch => {
    await query(`INSERT INTO ${table}(${kind},place_id,boundary_year,share,share_basis,partial,fringe)
      SELECT code,place_id,boundary_year,share,share_basis,partial,fringe FROM jsonb_to_recordset($1::jsonb)
        AS m(code text,place_id text,boundary_year integer,share float8,share_basis text,partial boolean,fringe boolean)
      ON CONFLICT(${kind},place_id,boundary_year) DO UPDATE SET share=coalesce(EXCLUDED.share,${table}.share),
        share_basis=CASE WHEN EXCLUDED.share IS NULL THEN ${table}.share_basis ELSE EXCLUDED.share_basis END,
        partial=${table}.partial AND EXCLUDED.partial, fringe=${table}.fringe AND EXCLUDED.fringe`,
    [JSON.stringify(batch.map(e => ({ code: e.code, place_id: e.placeId, boundary_year: e.boundaryYear,
      share: e.share, share_basis: e.shareBasis, partial: e.partial, fringe: e.fringe })))]);
  });
}
