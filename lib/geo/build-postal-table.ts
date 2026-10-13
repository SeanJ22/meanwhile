import { FIPS_TO_STATE } from "../ocd/fips.ts";
import { buildGrid, candidatesAt, containsPoint, indexPolygon } from "./point-in-polygon.ts";
import type { Feature } from "./shapefile.ts";
import type { CentroidTable } from "./zcta-core.ts";
import type { PostalTable } from "./postal-core.ts";
import type { PostalSourceRow } from "./zip-source.ts";

/** A spatial join, not a nearest-centroid guess. Holes and coastal gaps stay unmapped. */
export function areaLookup(features: Feature[]) {
  const polygons = features.map(feature => indexPolygon(feature.rings, feature.bbox));
  const grid = buildGrid(features.map(feature => feature.bbox));
  return (lat: number, lng: number): Record<string, string> | null => {
    const hits = candidatesAt(grid, lng, lat).filter(i => containsPoint(polygons[i], lng, lat));
    return hits.length === 1 ? features[hits[0]].properties : null;
  };
}

export function buildPostalTable(
  centroids: CentroidTable,
  geoNames: Record<string, PostalSourceRow>,
  types: Record<string, PostalSourceRow>,
  boundaries: { zcta: Feature[]; place: Feature[]; county: Feature[] },
): PostalTable {
  const zctaAt = areaLookup(boundaries.zcta), placeAt = areaLookup(boundaries.place), countyAt = areaLookup(boundaries.county);
  const stateFips = Object.fromEntries(Object.entries(FIPS_TO_STATE).map(([fips, entry]) => [entry.postal, fips]));
  const out: PostalTable = {};
  for (const zip of [...new Set([...Object.keys(types), ...Object.keys(geoNames), ...Object.keys(centroids)])].sort()) {
    const source = geoNames[zip] ?? types[zip];
    const typed = types[zip];
    // Census internal points win for ZCTAs; non-ZCTAs keep their own postal coordinates.
    const [lat, lng] = centroids[zip] ?? [source?.lat ?? null, source?.lng ?? null];
    const county = lat !== null && lng !== null ? countyAt(lat, lng) : null;
    const place = lat !== null && lng !== null ? placeAt(lat, lng) : null;
    const zcta = centroids[zip] ? zip : lat !== null && lng !== null ? zctaAt(lat, lng)?.ZCTA5CE20 ?? null : null;
    const state = county ? FIPS_TO_STATE[county.STATEFP]?.postal ?? source?.state ?? "" : source?.state ?? "";
    const countyFips = county?.GEOID ?? (source?.countyCode && stateFips[state] ? stateFips[state] + source.countyCode : null);
    const countyName = county?.NAMELSAD ?? typed?.county ?? source?.county ?? "";
    out[zip] = [lat, lng, typed?.type ?? (['AA', 'AE', 'AP'].includes(state) ? "military" : null),
      zcta, source?.place ?? place?.NAME ?? "", state, countyName, countyFips, place?.GEOID ?? null];
  }
  return out;
}
