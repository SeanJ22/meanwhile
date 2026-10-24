import polygonClipping, { type MultiPolygon } from "polygon-clipping";
import type { PlaceBoundary } from "./types.ts";
import type { MapEdge } from "./load.ts";
import { boundingBoxOf } from "../registry/resolve.ts";
import { tigerGeometry } from "../census-geography/tiger-overlap.ts";
import { tigerFeatures } from "../census-geography/tiger-shapefile.ts";
import { censusTigerArchive } from "../census-geography/tiger-source.ts";
import { TIGER_ZCTA_2020 } from "../census-geography/tiger-acquire.ts";
import type { CensusSourceOptions } from "../census-geography/source-release.ts";

/** Positive polygon intersection includes every sliver. A polygon's surface
 * is not tabulated Census land, so the share stays unknown. */
export async function acquireBoundaryOverlaps(boundaries: readonly PlaceBoundary[], zctas: ReadonlySet<string>,
  options: CensusSourceOptions = {}): Promise<MapEdge[]> {
  const shapes = boundaries.flatMap(boundary => boundary.geometry ? [{ boundary,
    box: boundingBoxOf({ properties: { ocdId: boundary.placeId, label: "" }, geometry: boundary.geometry }),
    geometry: (boundary.geometry.type === "Polygon" ? [boundary.geometry.coordinates] : boundary.geometry.coordinates) as MultiPolygon,
  }] : []);
  const archive = await censusTigerArchive(TIGER_ZCTA_2020, options, async path => {
    let count = 0;
    for await (const feature of tigerFeatures(path, zctas, options.signal)) {
      if (!/^\d{5}$/.test(feature.properties.ZCTA5CE20 ?? "")) throw new Error("ZCTA polygon lacks its Census code");
      count++;
    }
    if (!count && zctas.size) throw new Error("No requested ZCTA shapes were acquired");
  });
  try {
    const edges: MapEdge[] = [];
    for await (const feature of tigerFeatures(archive.path, zctas, options.signal)) {
      const box = feature.bbox;
      const candidates = shapes.filter(shape => shape.box[0] < box[2] && shape.box[2] > box[0] && shape.box[1] < box[3] && shape.box[3] > box[1]);
      if (!candidates.length) continue;
      const geometry = tigerGeometry(feature), code = feature.properties.ZCTA5CE20;
      for (const shape of candidates) {
        options.signal?.throwIfAborted();
        if (!polygonClipping.intersection(geometry, shape.geometry).length) continue;
        edges.push({ code, placeId: shape.boundary.placeId, boundaryYear: shape.boundary.boundaryYear, share: null, shareBasis: "unknown",
          partial: polygonClipping.difference(geometry, shape.geometry).length > 0, fringe: false });
      }
    }
    return edges;
  } finally { await archive.dispose(); }
}
