import type { FilterSpecification } from "maplibre-gl";
import { pointInRings } from "../geo/polygon.ts";

/**
 * The active state rises out of the map. A shadow is cast by the shape, not
 * drawn along its edge: two blurred silhouettes of the state, one white offset
 * toward a top-left light and one black offset away from it, each masked to
 * the region outside the state.
 *
 * 1. No visible line: the mask's inner edge is feathered (`FEATHER_PX`), a
 *    blurred `<mask>` rather than a binary `<clipPath>`.
 * 2. One light source: the offset is in screen space, so the light does not
 *    rotate or scale with the map, and each silhouette is offset a full
 *    `OFFSET_PX` before blurring, so neither reaches the other's side.
 * 3. The projected rings are simplified in screen space at a sub-pixel
 *    tolerance (`simplifyScreenRing`), so digitization never shows.
 *
 * The effect never releases on zoom-out; only the size of the rise scales
 * with zoom, and it stays well above zero.
 */

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
    if (pointInPolygon(lng, lat, feature.geometry.coordinates)) {
      return feature.properties.ocdId;
    }
  }
  return null;
}

export function outlineFor(
  outlines: StateOutlines | null,
  ocdId: string | null,
): StateOutlineFeature | null {
  if (!outlines || !ocdId) return null;
  return outlines.features.find((f) => f.properties.ocdId === ocdId) ?? null;
}

/**
 * The two-letter state code inside a state OCD-ID, upper-cased, or null: the
 * one place the OCD-ID focus meets the overlays' USPS `state` property.
 */
export function stateAbbrFromOcdId(ocdId: string | null): string | null {
  if (!ocdId) return null;
  const match = /\/state:([a-z]{2})$/.exec(ocdId);
  return match ? match[1].toUpperCase() : null;
}

/** Even-odd ray casting over a polygon's rings; see lib/geo/polygon.ts. */
const pointInPolygon = (x: number, y: number, rings: number[][][]): boolean =>
  pointInRings(x, y, rings);

export interface ScreenPoint {
  x: number;
  y: number;
}

/**
 * Ramer–Douglas–Peucker, in screen pixels. Simplifying after projection
 * makes one sub-pixel tolerance zoom-adaptive, and drops most points to
 * serialize at continental zoom. A ring is never simplified below a triangle.
 */
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

/**
 * The rise, in screen pixels, as a function of zoom. `offset` equals `blur`:
 * smaller and the silhouettes overlap toward grey; much larger and each
 * shadow detaches into a second outline.
 */
export interface ExtrusionSpec {
  /** How far each silhouette is displaced along the light's axis. */
  offsetPx: number;
  /** Gaussian sigma applied to each displaced silhouette. */
  blurPx: number;
  /**
   * Gaussian sigma of the mask's edge: how far the shadow takes to rise from
   * nothing at the border.
   */
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

/**
 * The rise, capped by the size of the shape it marks, so a small state at
 * far zoom keeps a fully masked interior: the feather may not exceed a sixth
 * of the state's smaller on-screen dimension, and the offset and blur a
 * third. Nothing reaches zero.
 */
export function capSpecToSpan(spec: ExtrusionSpec, span: number): ExtrusionSpec {
  if (!Number.isFinite(span) || span <= 0) return spec;
  return {
    offsetPx: Math.max(2, Math.min(spec.offsetPx, span / 3)),
    blurPx: Math.max(2, Math.min(spec.blurPx, span / 3)),
    featherPx: Math.max(1, Math.min(spec.featherPx, span / 6)),
    simplifyPx: spec.simplifyPx,
  };
}

/**
 * Opacity of each silhouette, by theme. A white silhouette barely shows on a
 * pale basemap, and the mute darkens outside the state in dark mode and
 * brightens it in light mode, so the pairs differ. Both stay low: the effect
 * carries no information.
 */
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

/**
 * The box a projected ring is cut down to before it reaches a mask, clip or
 * filter. Chromium silently drops a `clip-path` that is too large (a state at
 * city zoom projects to tens of thousands of pixels), and a dropped clip lets
 * the scrim cover the whole frame. Everything beyond `FILTER_PAD` of the
 * canvas cannot contribute a visible pixel, so cutting there loses nothing.
 *
 * An empty result is a real answer: the viewport does not touch the active
 * state, and the frame renders fully muted. Callers treat "no rings" as
 * "everything is outside", never as "draw nothing".
 */
export interface ScreenBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * Sutherland–Hodgman: one polygon ring cut down to an axis-aligned box. Rings
 * are clipped independently and the result is still evaluated even-odd, so
 * holes survive (and a viewport inside a hole cancels to nothing). The
 * connecting edges along the box enclose no area.
 */
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

/**
 * Which state a district layer's filter is pinned to, read back off the map
 * by `__wtpMapProbe`. Null for the "no active state" filter.
 */
export function filterStateAbbr(
  // `map.getFilter()` may return nothing for an unfiltered layer.
  filter: FilterSpecification | void | undefined,
): string | null {
  if (!Array.isArray(filter) || filter.length < 3) return null;
  const value = filter[2];
  return typeof value === "string" && value !== NO_STATE ? value : null;
}

/**
 * The sentinel a layer is filtered to when no state is active: a string no
 * state code can equal. Never rendered.
 */
export const NO_STATE = "__none__";

/** The filter that pins a district layer to one state, or to nothing. */
export function stateFilter(abbr: string | null): FilterSpecification {
  return ["==", ["get", "state"], abbr ?? NO_STATE] as FilterSpecification;
}
