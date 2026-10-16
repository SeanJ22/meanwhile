import type { GeographyGeometry } from "./contract.ts";
import { geometryPolygons, ringArea, ringContains } from "../overlay-geography/geometry.ts";
import type { Ring } from "../geo/shapefile.ts";

const PRECISION = 1e6;
const DISPLAY_TOLERANCE = 0.0001;
const ZERO = BigInt(0);
type Point = [number, number];
interface Edge { a: Point; b: Point; ring: number; index: number; count: number; minX: number; maxX: number; minY: number; maxY: number }

function samePoint(a: Point, b: Point): boolean { return a[0] === b[0] && a[1] === b[1]; }

export function roundBoundaryGeometry(geometry: GeographyGeometry): GeographyGeometry {
  const polygons = geometryPolygons(geometry);
  if (!polygons.length || polygons.some(polygon => !polygon.length)) throw new Error("Boundary has no polygon rings");
  for (const polygon of polygons) for (const ring of polygon) {
    let kept = 0;
    for (let index = 0; index < ring.length; index++) {
      const point = ring[index], [longitude, latitude] = point;
      if (!Number.isFinite(longitude) || !Number.isFinite(latitude) || Math.abs(longitude) > 180 || Math.abs(latitude) > 90) throw new Error("Invalid WGS84 boundary coordinate");
      point[0] = Math.round(longitude * PRECISION) / PRECISION || 0;
      point[1] = Math.round(latitude * PRECISION) / PRECISION || 0;
      if (!kept || !samePoint(point, ring[kept - 1])) ring[kept++] = point;
    }
    ring.length = kept;
    if (kept && !samePoint(ring[0], ring[kept - 1])) ring.push([ring[0][0], ring[0][1]]);
    if (ring.length < 4 || ringArea(ring) === 0) throw new Error("Boundary ring collapses at six-decimal precision");
  }
  return geometry;
}

function segmentDistanceSquared(point: Point, a: Point, b: Point): number {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const ratio = dx || dy ? Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / (dx * dx + dy * dy))) : 0;
  return (point[0] - a[0] - ratio * dx) ** 2 + (point[1] - a[1] - ratio * dy) ** 2;
}

function simplifyPath(points: Ring, toleranceSquared: number): Ring {
  const kept = new Uint8Array(points.length);
  kept[0] = kept[points.length - 1] = 1;
  const pending = [[0, points.length - 1]];
  while (pending.length) {
    const [first, last] = pending.pop()!;
    let farthest = -1, distance = toleranceSquared;
    for (let index = first + 1; index < last; index++) {
      const candidate = segmentDistanceSquared(points[index], points[first], points[last]);
      if (candidate > distance) { farthest = index; distance = candidate; }
    }
    if (farthest >= 0) { kept[farthest] = 1; pending.push([first, farthest], [farthest, last]); }
  }
  return points.filter((_, index) => kept[index]);
}

function simplifyRing(ring: Ring, tolerance: number): Ring {
  let split = 1, distance = 0;
  for (let index = 1; index < ring.length - 1; index++) {
    const candidate = (ring[index][0] - ring[0][0]) ** 2 + (ring[index][1] - ring[0][1]) ** 2;
    if (candidate > distance) { split = index; distance = candidate; }
  }
  const first = simplifyPath(ring.slice(0, split + 1), tolerance ** 2);
  const second = simplifyPath(ring.slice(split), tolerance ** 2);
  const result = [...first.slice(0, -1), ...second];
  return result.length >= 4 && ringArea(result) * ringArea(ring) > 0 ? result : ring;
}

function orientation(a: Point, b: Point, c: Point): bigint {
  return BigInt(b[0] - a[0]) * BigInt(c[1] - a[1]) - BigInt(b[1] - a[1]) * BigInt(c[0] - a[0]);
}

function intersects(a: Edge, b: Edge): boolean {
  if (a.maxY < b.minY || b.maxY < a.minY) return false;
  const p = orientation(a.a, a.b, b.a), q = orientation(a.a, a.b, b.b);
  const r = orientation(b.a, b.b, a.a), s = orientation(b.a, b.b, a.b);
  return ((p <= ZERO && q >= ZERO) || (p >= ZERO && q <= ZERO)) && ((r <= ZERO && s >= ZERO) || (r >= ZERO && s <= ZERO));
}

function preservesTopology(original: Ring[][], candidate: Ring[][]): boolean {
  const before = original.flat(), after = candidate.flat();
  const edges: Edge[] = [];
  for (const [ring, points] of after.entries()) for (let index = 0; index < points.length - 1; index++) {
    const a = points[index].map((value) => Math.round(value * PRECISION)) as Point;
    const b = points[index + 1].map((value) => Math.round(value * PRECISION)) as Point;
    edges.push({ a, b, ring, index, count: points.length - 1, minX: Math.min(a[0], b[0]), maxX: Math.max(a[0], b[0]), minY: Math.min(a[1], b[1]), maxY: Math.max(a[1], b[1]) });
  }
  edges.sort((a, b) => a.minX - b.minX);
  for (let index = 0; index < edges.length; index++) for (let next = index + 1; next < edges.length && edges[next].minX <= edges[index].maxX; next++) {
    const a = edges[index], b = edges[next], separation = Math.abs(a.index - b.index);
    if (a.ring === b.ring && (separation === 1 || separation === a.count - 1)) continue;
    if (intersects(a, b)) return false;
  }
  for (let a = 0; a < after.length; a++) for (let b = 0; b < after.length; b++) {
    if (a !== b && ringContains(before[a][0], before[b]) !== ringContains(after[a][0], after[b])) return false;
  }
  return true;
}

export function simplifyDisplayGeometry(accurate: GeographyGeometry, tolerance = DISPLAY_TOLERANCE): GeographyGeometry {
  if (!Number.isFinite(tolerance) || tolerance < 0) throw new Error("Invalid display simplification tolerance");
  const original = geometryPolygons(accurate);
  for (const factor of [1, 0.25, 0.0625]) {
    const candidate = original.map((polygon) => polygon.map((ring) => simplifyRing(ring, tolerance * factor)));
    if (preservesTopology(original, candidate)) return accurate.type === "Polygon" ? { type: "Polygon", coordinates: candidate[0] } : { type: "MultiPolygon", coordinates: candidate };
  }
  return accurate;
}

export function boundaryGeometries(source: GeographyGeometry): { accurate: GeographyGeometry; display: GeographyGeometry } {
  const accurate = roundBoundaryGeometry(source);
  return { accurate, display: simplifyDisplayGeometry(accurate) };
}
