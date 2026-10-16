import type { FilterSpecification } from "maplibre-gl";
import { pointInRings } from "../geo/polygon.ts";

export const STATE_FOCUS_SOURCE = "state-outlines";

/** Where the outlines live. Generalized geometry — see the fetch script. */
export const STATE_OUTLINES_URL = "/geo/state-outlines.geojson";

export interface StateOutlineFeature {
  type: "Feature";
  properties: { statefp: string; name: string; ocdId: string };
  geometry: { type: "Polygon"; coordinates: number[][][] };
}

export interface StateOutlines {
  type: "FeatureCollection";
  features: StateOutlineFeature[];
}

/* ------------------------------------------------------------ geometry --- */

/** The state OCD-ID a point falls in, or null. Ray casting, no dependency. */
export function stateOcdIdAt(
  outlines: StateOutlines | null,
  lat: number,
  lng: number,
): string | null {
  if (!outlines) return null;
  for (const feature of outlines.features) {
    if (stateContainsPoint(feature, lat, lng)) return feature.properties.ocdId;
  }
  return null;
}

const ringBounds = new WeakMap<number[][], { west: number; south: number; east: number; north: number }>();

export function stateContainsPoint(feature: StateOutlineFeature | null, lat: number, lng: number): boolean {
  if (!feature) return false;
  const longitude = ((lng + 180) % 360 + 360) % 360 - 180;
  for (const x of [longitude, longitude - 360, longitude + 360]) {
    const rings = feature.geometry.coordinates.filter(ring => {
      let bounds = ringBounds.get(ring);
      if (!bounds) {
        bounds = { west: Infinity, south: Infinity, east: -Infinity, north: -Infinity };
        for (const [rx, ry] of ring) {
          bounds.west = Math.min(bounds.west, rx);
          bounds.south = Math.min(bounds.south, ry);
          bounds.east = Math.max(bounds.east, rx);
          bounds.north = Math.max(bounds.north, ry);
        }
        ringBounds.set(ring, bounds);
      }
      return lat >= bounds.south && lat <= bounds.north && x >= bounds.west && x <= bounds.east;
    });
    if (pointInRings(x, lat, rings)) return true;
  }
  return false;
}

export function outlineFor(
  outlines: StateOutlines | null,
  ocdId: string | null,
): StateOutlineFeature | null {
  if (!outlines || !ocdId) return null;
  return outlines.features.find((f) => f.properties.ocdId === ocdId) ?? null;
}

export function stateAbbrFromOcdId(ocdId: string | null): string | null {
  if (!ocdId) return null;
  const match = /\/(?:state|district|territory):([a-z]{2})$/.exec(ocdId);
  return match ? match[1].toUpperCase() : null;
}

export interface ScreenPoint {
  x: number;
  y: number;
}

export function simplifyScreenRing(
  points: readonly ScreenPoint[],
  tolerance: number,
): ScreenPoint[] {
  if (points.length <= 3 || tolerance <= 0) return [...points];

  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;

  // Iterative: an explicit stack cannot blow up on a pathological input.
  const stack: [number, number][] = [[0, points.length - 1]];
  const toleranceSquared = tolerance * tolerance;

  while (stack.length > 0) {
    const [first, last] = stack.pop()!;
    if (last <= first + 1) continue;

    let farthest = -1;
    let farthestDistance = -1;
    for (let i = first + 1; i < last; i += 1) {
      const distance = perpendicularDistanceSquared(
        points[i],
        points[first],
        points[last],
      );
      if (distance > farthestDistance) {
        farthestDistance = distance;
        farthest = i;
      }
    }

    if (farthestDistance > toleranceSquared && farthest > 0) {
      keep[farthest] = 1;
      stack.push([first, farthest], [farthest, last]);
    }
  }

  const simplified: ScreenPoint[] = [];
  for (let i = 0; i < points.length; i += 1) {
    if (keep[i]) simplified.push(points[i]);
  }

  // A ring reduced past a triangle falls back to an evenly sampled triangle:
  // an empty path would clear the mask and un-mute the whole country.
  if (simplified.length < 3) {
    const step = Math.floor(points.length / 3) || 1;
    return [points[0], points[step], points[Math.min(2 * step, points.length - 1)]];
  }

  return simplified;
}

function perpendicularDistanceSquared(
  point: ScreenPoint,
  start: ScreenPoint,
  end: ScreenPoint,
): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (dx === 0 && dy === 0) {
    return (point.x - start.x) ** 2 + (point.y - start.y) ** 2;
  }
  const numerator = dy * point.x - dx * point.y + end.x * start.y - end.y * start.x;
  return (numerator * numerator) / (dx * dx + dy * dy);
}

/* ----------------------------------------------------------- the light --- */

export interface ExtrusionSpec {
  /** How far each silhouette is displaced along the light's axis. */
  offsetPx: number;
  /** Gaussian sigma applied to each displaced silhouette. */
  blurPx: number;

  featherPx: number;
  /** Sub-pixel simplification tolerance for the projected rings. */
  simplifyPx: number;
}

/** Neighbourhood zoom and closer: the border is a detail in the corner. */
const NEAR: ExtrusionSpec = {
  offsetPx: 16,
  blurPx: 16,
  featherPx: 7,
  simplifyPx: 0.9,
};

/** Continental zoom: the whole outline is on screen. The floor is non-zero. */
const FAR: ExtrusionSpec = {
  offsetPx: 8,
  blurPx: 9,
  featherPx: 4,
  simplifyPx: 0.9,
};

const NEAR_ZOOM = 10;
const FAR_ZOOM = 4;

export function extrusionSpecForZoom(zoom: number): ExtrusionSpec {
  const t = Math.min(1, Math.max(0, (zoom - FAR_ZOOM) / (NEAR_ZOOM - FAR_ZOOM)));
  const mix = (far: number, near: number) =>
    Math.round((far + (near - far) * t) * 100) / 100;
  return {
    offsetPx: mix(FAR.offsetPx, NEAR.offsetPx),
    blurPx: mix(FAR.blurPx, NEAR.blurPx),
    featherPx: mix(FAR.featherPx, NEAR.featherPx),
    simplifyPx: NEAR.simplifyPx,
  };
}

export function capSpecToSpan(spec: ExtrusionSpec, span: number): ExtrusionSpec {
  if (!Number.isFinite(span) || span <= 0) return spec;
  return {
    offsetPx: Math.max(2, Math.min(spec.offsetPx, span / 3)),
    blurPx: Math.max(2, Math.min(spec.blurPx, span / 3)),
    featherPx: Math.max(1, Math.min(spec.featherPx, span / 6)),
    simplifyPx: spec.simplifyPx,
  };
}

export interface RiseAlphas {
  /** The silhouette displaced TOWARD the light, at top-left. */
  light: number;
  /** The silhouette displaced away from it. */
  dark: number;
}

export function riseAlphasFor(theme: "light" | "dark"): RiseAlphas {
  return theme === "light"
    ? { light: 0.85, dark: 0.3 }
    : { light: 0.5, dark: 0.42 };
}

/* ------------------------------------------------- the viewport clip --- */

export interface ScreenBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function clipRingToBox(
  points: readonly ScreenPoint[],
  box: ScreenBox,
): ScreenPoint[] {
  if (points.length < 3) return [];

  let ring: ScreenPoint[] = [...points];

  // 0: x ≥ minX, 1: x ≤ maxX, 2: y ≥ minY, 3: y ≤ maxY.
  for (let edge = 0; edge < 4; edge += 1) {
    if (ring.length === 0) break;
    const next: ScreenPoint[] = [];
    for (let i = 0; i < ring.length; i += 1) {
      const current = ring[i];
      const previous = ring[(i + ring.length - 1) % ring.length];
      const currentIn = insideEdge(current, edge, box);
      const previousIn = insideEdge(previous, edge, box);
      if (currentIn !== previousIn) {
        next.push(intersectEdge(previous, current, edge, box));
      }
      if (currentIn) next.push(current);
    }
    ring = next;
  }

  return ring.length >= 3 ? ring : [];
}

function insideEdge(point: ScreenPoint, edge: number, box: ScreenBox): boolean {
  if (edge === 0) return point.x >= box.minX;
  if (edge === 1) return point.x <= box.maxX;
  if (edge === 2) return point.y >= box.minY;
  return point.y <= box.maxY;
}

function intersectEdge(
  from: ScreenPoint,
  to: ScreenPoint,
  edge: number,
  box: ScreenBox,
): ScreenPoint {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  // A zero denominator cannot arise: the two points straddle this edge, so
  // they differ along the axis the edge is measured on.
  if (edge === 0 || edge === 1) {
    const limit = edge === 0 ? box.minX : box.maxX;
    const t = (limit - from.x) / dx;
    return { x: limit, y: from.y + t * dy };
  }
  const limit = edge === 2 ? box.minY : box.maxY;
  const t = (limit - from.y) / dy;
  return { x: from.x + t * dx, y: limit };
}

export function filterStateAbbr(
  // `map.getFilter()` may return nothing for an unfiltered layer.
  filter: FilterSpecification | void | undefined,
): string | null {
  if (!Array.isArray(filter)) return null;
  if (filter[0] === "all") {
    for (const part of filter.slice(1)) {
      const state = filterStateAbbr(part as FilterSpecification);
      if (state) return state;
    }
    return null;
  }
  if (filter[0] !== "==" || JSON.stringify(filter[1]) !== '["get","state"]') return null;
  const value = filter[2];
  return typeof value === "string" && value !== NO_STATE ? value : null;
}

export const NO_STATE = "__none__";

/** The filter that pins a district layer to one state, or to nothing. */
export function stateFilter(abbr: string | null): FilterSpecification {
  return ["==", ["get", "state"], abbr ?? NO_STATE] as FilterSpecification;
}
