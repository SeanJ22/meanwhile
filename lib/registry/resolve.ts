import type { Body, Division } from "./types.ts";
import { bodyIdsAtPoint, bodyIdsWithTerritory, type BodyTerritoryFile } from "./body-territory.ts";
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

interface ShapeIndex {
  box: BoundingBox;
  leaves?: { feature: GeoFeature; order: number; box: BoundingBox }[];
  children?: ShapeIndex[];
}
const indexes = new WeakMap<GeoFeature[], ShapeIndex>();

function shapeIndex(features: GeoFeature[]): ShapeIndex {
  const held = indexes.get(features);
  if (held) return held;
  const build = (leaves: NonNullable<ShapeIndex["leaves"]>, depth: number): ShapeIndex => {
    const box: BoundingBox = [Infinity, Infinity, -Infinity, -Infinity];
    for (const leaf of leaves) {
      box[0] = Math.min(box[0], leaf.box[0]); box[1] = Math.min(box[1], leaf.box[1]);
      box[2] = Math.max(box[2], leaf.box[2]); box[3] = Math.max(box[3], leaf.box[3]);
    }
    if (leaves.length <= 12) return { box, leaves };
    const axis = depth % 2;
    leaves.sort((a, b) => (a.box[axis] + a.box[axis + 2]) - (b.box[axis] + b.box[axis + 2]));
    const middle = Math.floor(leaves.length / 2);
    return { box, children: [build(leaves.slice(0, middle), depth + 1), build(leaves.slice(middle), depth + 1)] };
  };
  const index = build(features.map((feature, order) => ({ feature, order, box: boundingBoxOf(feature) })), 0);
  indexes.set(features, index);
  return index;
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
  const candidates: NonNullable<ShapeIndex["leaves"]> = [];
  const visit = (node: ShapeIndex) => {
    if (!inBox(point, node.box)) return;
    if (node.leaves) candidates.push(...node.leaves.filter(leaf => inBox(point, leaf.box)));
    else node.children?.forEach(visit);
  };
  visit(shapeIndex(features));
  // Keep the existing return order, including duplicate ids with disjoint shapes.
  for (const { feature } of candidates.sort((a, b) => a.order - b.order)) {
    const ocdId = feature.properties.ocdId;
    if (seen.has(ocdId)) continue;
    // The cheap test first. A point outside the box is outside the polygon.
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
  // A body with its own polygons is decided by them alone, whatever division it was filed on.
  const territorial = bodyIdsWithTerritory(territory ?? null);

  const serves = (b: Body): boolean =>
    territoryHits.has(b.id) || (!territorial.has(b.id) &&
      ((b.ocdId !== null && ids.has(b.ocdId)) || (b.alsoServesOcdIds ?? []).some((id) => ids.has(id))));
  return { divisions: hit, bodies: bodies.filter(serves) };
}
