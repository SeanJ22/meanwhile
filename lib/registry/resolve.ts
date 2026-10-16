import type { Body, Division } from "./types.ts";
import { bodyIdsAtPoint, type BodyTerritoryFile } from "./body-territory.ts";
import { polygonContains } from "../geo/polygon.ts";



export type Ring = [number, number][];
export type Polygon = Ring[];

export interface GeoFeature {
  properties: { ocdId: string; label: string; lsad?: string };
  geometry:
    | { type: "Polygon"; coordinates: Ring[] }
    | { type: "MultiPolygon"; coordinates: Ring[][] };
}

// The shared even-odd implementation (lib/geo/polygon.ts), exterior then holes.
const inPolygon = (point: [number, number], poly: Polygon): boolean =>
  polygonContains(point, poly);

export function contains(point: [number, number], feature: GeoFeature): boolean {
  const polys =
    feature.geometry.type === "Polygon"
      ? [feature.geometry.coordinates]
      : feature.geometry.coordinates;
  return polys.some((poly) => inPolygon(point, poly as Polygon));
}


let sweeps = 0;

/** Sweeps run since the process started. Monotonic; read deltas, never totals. */
export function sweepsRun(): number {
  return sweeps;
}


let candidatesTested = 0;

/** Features given an exact point-in-polygon test. Monotonic; read deltas. */
export function candidateFeaturesTested(): number {
  return candidatesTested;
}

/** A feature's bounding box: [west, south, east, north]. */
export type BoundingBox = [number, number, number, number];

export function boundingBoxOf(feature: GeoFeature): BoundingBox {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  const polys =
    feature.geometry.type === "Polygon"
      ? [feature.geometry.coordinates]
      : feature.geometry.coordinates;
  for (const poly of polys) {
    for (const ring of poly as Ring[]) {
      for (const [x, y] of ring) {
        if (x < west) west = x;
        if (x > east) east = x;
        if (y < south) south = y;
        if (y > north) north = y;
      }
    }
  }
  return [west, south, east, north];
}

const inBox = (point: [number, number], box: BoundingBox): boolean =>
  point[0] >= box[0] && point[0] <= box[2] && point[1] >= box[1] && point[1] <= box[3];


const boxes = new WeakMap<GeoFeature[], BoundingBox[]>();

function boxesFor(features: GeoFeature[]): BoundingBox[] {
  let cached = boxes.get(features);
  if (!cached) {
    cached = features.map(boundingBoxOf);
    boxes.set(features, cached);
  }
  return cached;
}

/** Every division whose boundary contains the point. */
export function divisionsAt(
  point: [number, number],
  features: GeoFeature[],
  divisions: Map<string, Division>,
): Division[] {
  return divisionIdsAt(point, features).flatMap(id => divisions.has(id) ? [divisions.get(id)!] : []);
}

export function divisionIdsAt(point: [number, number], features: GeoFeature[]): string[] {
  sweeps += 1;
  const hits: string[] = [];
  const seen = new Set<string>();
  const featureBoxes = boxesFor(features);

  for (const [index, feature] of features.entries()) {
    const ocdId = feature.properties.ocdId;
    if (seen.has(ocdId)) continue;
    // The cheap test first. A point outside the box is outside the polygon.
    if (!inBox(point, featureBoxes[index])) continue;
    candidatesTested += 1;
    if (!contains(point, feature)) continue;

    seen.add(ocdId);
    hits.push(ocdId);
  }

  return hits;
}


export function bodiesAt(
  point: [number, number],
  features: GeoFeature[],
  divisions: Map<string, Division>,
  bodies: Body[],
  resolved?: Division[],
  /** The committed body-territory polygons. Null when not loaded. */
  territory?: BodyTerritoryFile | null,
): { divisions: Division[]; bodies: Body[] } {
  const hit = resolved ?? divisionsAt(point, features, divisions);
  const ids = new Set(hit.map((d) => d.ocdId));
  const territoryHits = bodyIdsAtPoint(point, territory ?? null);

  const serves = (b: Body): boolean =>
    (b.ocdId !== null && ids.has(b.ocdId)) ||
    (b.alsoServesOcdIds ?? []).some((id) => ids.has(id)) ||
    territoryHits.has(b.id);
  return { divisions: hit, bodies: bodies.filter(serves) };
}
