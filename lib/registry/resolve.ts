import type { Body, Division } from "./types.ts";
import { bodyIdsAtPoint, type BodyTerritoryFile } from "./body-territory.ts";
import { polygonContains } from "../geo/polygon.ts";

/**
 * Point → divisions → bodies. Pure. A point is in a set of divisions, never one. A ZIP centroid is
 * orientation only, never a claim about where anyone lives: this answers "which bodies cover this point
 * on the map".
 */

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

/**
 * How many point-in-polygon sweeps this process has run. A second sweep returns an identical answer, so
 * only a count can show one; `tests/resolve-once.test.ts` asserts one per request.
 */
let sweeps = 0;

/** Sweeps run since the process started. Monotonic; read deltas, never totals. */
export function sweepsRun(): number {
  return sweeps;
}

/**
 * How many features a sweep tested exactly. The bounding-box prefilter has no false negatives and
 * `polygonContains` stays the final authority, so the answer cannot change; this count shows the
 * prefilter is still filtering.
 */
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

/**
 * The boxes, computed once per feature array.
 *
 * Keyed on the array identity rather than recomputed per call: the server
 * caches one `features` array for the life of the process, so this is built on
 * the first sweep and read on every one after. A `WeakMap` so a test that
 * builds its own array does not leak.
 */
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
  sweeps += 1;
  const hits: Division[] = [];
  const seen = new Set<string>();
  const featureBoxes = boxesFor(features);

  for (const [index, feature] of features.entries()) {
    const ocdId = feature.properties.ocdId;
    if (seen.has(ocdId)) continue;
    // The cheap test first. A point outside the box is outside the polygon.
    if (!inBox(point, featureBoxes[index])) continue;
    candidatesTested += 1;
    if (!contains(point, feature)) continue;

    const division = divisions.get(ocdId);
    if (!division) continue;

    seen.add(ocdId);
    hits.push(division);
  }

  return hits;
}

/**
 * Every body associated with the divisions covering a point. `resolved` lets a caller that already ran
 * `divisionsAt` for this exact point skip a second sweep; it must be this point's own result.
 */
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
  // A body that spans several divisions is found from any of them: one body, one id, rendered under every
  // division it governs (`alsoServesOcdIds`).
  // And a body whose own territory contains the point: governments smaller than any Census division,
  // tested with the same even-odd implementation. See `lib/registry/body-territory.ts`.
  const territoryHits = bodyIdsAtPoint(point, territory ?? null);

  const serves = (b: Body): boolean =>
    (b.ocdId !== null && ids.has(b.ocdId)) ||
    (b.alsoServesOcdIds ?? []).some((id) => ids.has(id)) ||
    territoryHits.has(b.id);
  return { divisions: hit, bodies: bodies.filter(serves) };
}
