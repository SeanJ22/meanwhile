/**
 * Point-in-polygon, accelerated by a latitude-band edge index (Prompt B item
 * 5, 2026-08-20).
 *
 * The national join asks "which governments contain this point" a few million
 * times across six boundary layers. A plain ray cast is O(vertices), and the
 * layers this runs against carry 3.4 million vertices (county subdivisions)
 * and 2.2 million (unified school districts). Done plainly the join does not
 * finish; done with an index it takes minutes.
 *
 * THE INDEX. A ray cast only ever consults edges whose latitude range spans
 * the query point. So each polygon's edges are bucketed by latitude band
 * once, and a query touches one band instead of every edge. Bands are sized
 * from the polygon's own height, so a small place and a large county each get
 * a useful bucket size.
 *
 * THE RULE IS EVEN-ODD, ACROSS ALL RINGS TOGETHER. A shapefile polygon's
 * inner rings are holes, and counting crossings across every ring at once is
 * exactly what makes a point in a hole read as outside. That is the correct
 * answer for a lake inside a county: the county does not govern the water's
 * surface any differently, but the boundary file says the ring is not part of
 * the polygon, and this reader reports what the boundary file says rather
 * than what it supposes.
 */

import type { Ring } from "./shapefile.ts";

export type IndexedPolygon = {
  bbox: [number, number, number, number];
  /** Bands of edges, each edge as [x1, y1, x2, y2]. */
  bands: Float64Array[];
  bandCount: number;
  minY: number;
  bandHeight: number;
};

const TARGET_EDGES_PER_BAND = 8;

export function indexPolygon(rings: Ring[], bbox: [number, number, number, number]): IndexedPolygon {
  const [minX, minY, maxX, maxY] = bbox;
  void minX;
  void maxX;

  let edgeCount = 0;
  for (const ring of rings) edgeCount += ring.length;

  const bandCount = Math.max(1, Math.min(4096, Math.ceil(edgeCount / TARGET_EDGES_PER_BAND)));
  const height = maxY - minY;
  // A zero-height polygon is degenerate but present in boundary data; one
  // band handles it without a divide-by-zero.
  const bandHeight = height > 0 ? height / bandCount : 1;

  const buckets: number[][] = Array.from({ length: bandCount }, () => []);

  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
      const [x1, y1] = ring[j]!;
      const [x2, y2] = ring[i]!;
      // A horizontal edge can never be crossed by a horizontal ray under the
      // half-open rule below, so it is dropped rather than bucketed.
      if (y1 === y2) continue;

      const lo = Math.min(y1, y2);
      const hi = Math.max(y1, y2);
      let first = Math.floor((lo - minY) / bandHeight);
      let last = Math.floor((hi - minY) / bandHeight);
      if (first < 0) first = 0;
      if (last >= bandCount) last = bandCount - 1;
      if (last < 0 || first >= bandCount) continue;

      for (let b = first; b <= last; b += 1) buckets[b]!.push(x1, y1, x2, y2);
    }
  }

  return {
    bbox,
    bands: buckets.map((b) => Float64Array.from(b)),
    bandCount,
    minY,
    bandHeight,
  };
}

/**
 * Even-odd ray cast to the east.
 *
 * The `(y1 > y) !== (y2 > y)` test is the half-open convention: an edge
 * counts when the ray passes its lower endpoint and not its upper one. That
 * is what stops a ray passing exactly through a shared vertex from counting
 * the crossing twice, which would flip an interior point to exterior — the
 * classic failure, and the one that would show up here as a zip losing its
 * county along a straight boundary.
 */
export function containsPoint(poly: IndexedPolygon, x: number, y: number): boolean {
  const [minX, minY, maxX, maxY] = poly.bbox;
  if (x < minX || x > maxX || y < minY || y > maxY) return false;

  let band = Math.floor((y - poly.minY) / poly.bandHeight);
  if (band < 0) band = 0;
  if (band >= poly.bandCount) band = poly.bandCount - 1;

  const edges = poly.bands[band]!;
  let inside = false;
  for (let i = 0; i < edges.length; i += 4) {
    const x1 = edges[i]!;
    const y1 = edges[i + 1]!;
    const x2 = edges[i + 2]!;
    const y2 = edges[i + 3]!;
    if (y1 > y !== y2 > y) {
      const t = (y - y1) / (y2 - y1);
      if (x < x1 + t * (x2 - x1)) inside = !inside;
    }
  }
  return inside;
}

/* -------------------------------------------------------------------------- */
/* A coarse grid, so a query does not consider every polygon in the country.   */
/* -------------------------------------------------------------------------- */

export type GridIndex = {
  cell: number;
  buckets: Map<number, number[]>;
};

const GRID_CELL_DEGREES = 0.25;

const cellKey = (cx: number, cy: number) => cy * 100_000 + cx;

export function buildGrid(bboxes: Array<[number, number, number, number]>): GridIndex {
  const buckets = new Map<number, number[]>();
  bboxes.forEach((bbox, i) => {
    const [minX, minY, maxX, maxY] = bbox;
    const x0 = Math.floor(minX / GRID_CELL_DEGREES);
    const x1 = Math.floor(maxX / GRID_CELL_DEGREES);
    const y0 = Math.floor(minY / GRID_CELL_DEGREES);
    const y1 = Math.floor(maxY / GRID_CELL_DEGREES);
    for (let cy = y0; cy <= y1; cy += 1) {
      for (let cx = x0; cx <= x1; cx += 1) {
        const k = cellKey(cx, cy);
        const b = buckets.get(k);
        if (b) b.push(i);
        else buckets.set(k, [i]);
      }
    }
  });
  return { cell: GRID_CELL_DEGREES, buckets };
}

export function candidatesAt(grid: GridIndex, x: number, y: number): number[] {
  return (
    grid.buckets.get(cellKey(Math.floor(x / grid.cell), Math.floor(y / grid.cell))) ?? []
  );
}
