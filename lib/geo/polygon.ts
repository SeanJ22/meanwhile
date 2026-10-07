/**
 * One even-odd point-in-polygon and one ring flattener. The first ring of a
 * GeoJSON polygon is the outer boundary and the rest are holes; even-odd
 * handles both without the caller distinguishing them.
 */

export type Ring = number[][];
export interface RingGeometry {
  type: string;
  coordinates: unknown;
}

/**
 * Every ring in a `Polygon` or a `MultiPolygon`, flattened. Any other
 * geometry type yields no rings.
 */
export function ringsOf(geom: RingGeometry): Ring[] {
  const out: Ring[] = [];
  if (geom.type === "Polygon") out.push(...(geom.coordinates as Ring[]));
  else if (geom.type === "MultiPolygon")
    for (const poly of geom.coordinates as Ring[][]) out.push(...poly);
  return out;
}

/**
 * Even-odd ray casting over a list of rings, in the rings' own units
 * (longitude/latitude for GeoJSON, pixels for a projected map).
 */
export function pointInRings(x: number, y: number, rings: readonly Ring[]): boolean {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i]!;
      const [xj, yj] = ring[j]!;
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
        inside = !inside;
      }
    }
  }
  return inside;
}

/** The GeoJSON-shaped convenience: does this geometry contain `[x, y]`? */
export function containsPoint(point: readonly [number, number], geom: RingGeometry): boolean {
  return pointInRings(point[0], point[1], ringsOf(geom));
}

/**
 * Exterior ring first, then reject any point in a hole. Agrees with
 * `pointInRings` for well-formed GeoJSON but not for malformed input, so it
 * stays a separate function; `lib/registry/resolve.ts` uses this one.
 */
export function inRing(point: readonly [number, number], ring: Ring): boolean {
  return pointInRings(point[0], point[1], [ring]);
}

/** One polygon: inside its exterior ring and inside none of its holes. */
export function polygonContains(point: readonly [number, number], poly: readonly Ring[]): boolean {
  if (poly.length === 0) return false;
  if (!inRing(point, poly[0]!)) return false;
  for (let h = 1; h < poly.length; h++) if (inRing(point, poly[h]!)) return false;
  return true;
}
