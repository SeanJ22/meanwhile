/**
 * **ONE EVEN-ODD POINT-IN-POLYGON, AND ONE RING FLATTENER.**
 * (`NH79`, consolidated 2026-08-23. RULING 103.)
 *
 * Four copies of this arithmetic existed in the tree: `ringsOf` and `contains`
 * in `lib/geo/zip-geography.ts` and again in `scripts/zip-universe.mts`, and
 * `pointInPolygon` in `lib/map/state-focus.ts` and again in
 * `scripts/fetch-zcta-outlines.mts`. The dupe sweep caught them as two groups
 * because they take different arguments; they compute the same thing.
 *
 * **Geometry is the worst place in this repo to keep four copies of anything.**
 * A ray-casting bug does not throw and does not return zero — it returns a
 * WRONG answer for points near an edge, which is precisely the class of defect
 * `CLAUDE.md` names as unsurvivable: a confident claim about which government
 * covers a reader's street. Four copies means a fix to one is invisible from
 * the other three, and the ones in `scripts/` decide what gets COMMITTED.
 *
 * ## Why even-odd, and why the caller never has to know about holes
 *
 * The first ring of a GeoJSON polygon is the outer boundary and the rest are
 * holes. Even-odd handles both without the caller distinguishing them — a point
 * inside an outer ring and inside a hole crosses an even number of edges and
 * comes back outside, which is correct. New Jersey ships three rings.
 */

export type Ring = number[][];
export interface RingGeometry {
  type: string;
  coordinates: unknown;
}

/**
 * Every ring in a `Polygon` or a `MultiPolygon`, flattened.
 *
 * A geometry of any other type yields NO rings rather than throwing — a
 * `Point` or a `LineString` genuinely contains no area, and an empty list is
 * the honest answer for it. Callers that need to tell "no rings" from
 * "unsupported type" should check `geom.type` themselves.
 */
export function ringsOf(geom: RingGeometry): Ring[] {
  const out: Ring[] = [];
  if (geom.type === "Polygon") out.push(...(geom.coordinates as Ring[]));
  else if (geom.type === "MultiPolygon")
    for (const poly of geom.coordinates as Ring[][]) out.push(...poly);
  return out;
}

/**
 * Even-odd ray casting over a list of rings, in whatever units the rings use.
 *
 * `x` and `y` are coordinates in the rings' own space — longitude and latitude
 * for GeoJSON, screen pixels for a projected map. The arithmetic does not care
 * which, and naming them `x`/`y` rather than `lng`/`lat` is what keeps both
 * callers on one implementation.
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
 * **EXTERIOR-THEN-HOLES, kept as its OWN function rather than folded into
 * `pointInRings`.**
 *
 * `pointInRings` flattens every ring and lets even-odd cancel the holes.
 * `polygonContains` tests the exterior ring first and then rejects any point
 * that also falls in a hole. **For well-formed GeoJSON the two agree**, and for
 * malformed input they do not — nested or self-intersecting rings make even-odd
 * and exterior-minus-holes disagree, and which one is "right" depends on what
 * the malformed file meant.
 *
 * So they stay two functions with two names. `lib/registry/resolve.ts` decides
 * which government covers a reader's point and has always used this one;
 * quietly moving it onto the other while consolidating would be changing an
 * answer about a real street under cover of a tidy-up.
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
