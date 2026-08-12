import type { Body, Division } from "./types.ts";

/**
 * Point → divisions → bodies.
 *
 * Pure: geometry comes in as an argument, so this runs in a test, on a server,
 * or against tiles later without change. **A point is in a *set* of divisions,
 * never one** — Rockaway sits in a K-8 elementary district and a regional high
 * school district at once, and Arizona's legislative districts elect three
 * people between two chambers.
 *
 * A zip centroid is orientation only, never a claim about where anyone lives.
 * CLAUDE.md is explicit that a ZCTA cannot resolve a ballot, and nothing here
 * changes that: this answers "which bodies cover this point on the map".
 */

export type Ring = [number, number][];
export type Polygon = Ring[];

export interface GeoFeature {
  properties: { ocdId: string; label: string; lsad?: string };
  geometry:
    | { type: "Polygon"; coordinates: Ring[] }
    | { type: "MultiPolygon"; coordinates: Ring[][] };
}

function inRing(point: [number, number], ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (
      yi > point[1] !== yj > point[1] &&
      point[0] < ((xj - xi) * (point[1] - yi)) / (yj - yi) + xi
    ) {
      inside = !inside;
    }
  }
  return inside;
}

function inPolygon(point: [number, number], poly: Polygon): boolean {
  // Exterior ring first, then holes: a point inside a hole is outside.
  if (!inRing(point, poly[0])) return false;
  for (let h = 1; h < poly.length; h++) if (inRing(point, poly[h])) return false;
  return true;
}

export function contains(point: [number, number], feature: GeoFeature): boolean {
  const polys =
    feature.geometry.type === "Polygon"
      ? [feature.geometry.coordinates]
      : feature.geometry.coordinates;
  return polys.some((poly) => inPolygon(point, poly as Polygon));
}

/** Every division whose boundary contains the point. */
export function divisionsAt(
  point: [number, number],
  features: GeoFeature[],
  divisions: Map<string, Division>,
): Division[] {
  const hits: Division[] = [];
  const seen = new Set<string>();

  for (const feature of features) {
    const ocdId = feature.properties.ocdId;
    if (seen.has(ocdId)) continue;
    if (!contains(point, feature)) continue;

    const division = divisions.get(ocdId);
    if (!division) continue;

    seen.add(ocdId);
    hits.push(division);
  }

  return hits;
}

/** Every body associated with the divisions covering a point. */
export function bodiesAt(
  point: [number, number],
  features: GeoFeature[],
  divisions: Map<string, Division>,
  bodies: Body[],
): { divisions: Division[]; bodies: Body[] } {
  const hit = divisionsAt(point, features, divisions);
  const ids = new Set(hit.map((d) => d.ocdId));
  return { divisions: hit, bodies: bodies.filter((b) => b.ocdId && ids.has(b.ocdId)) };
}
