import proj4 from "proj4";
import type { Ring } from "../geo/shapefile.ts";
import type { GeographyGeometry } from "../census-geography/contract.ts";

export function ringArea(ring: readonly (readonly number[])[]): number {
  let sum = 0;
  // Translate first: State Plane coordinates otherwise lose precision by cancellation.
  const [originX, originY] = ring[0] ?? [0, 0];
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    sum += (ring[j][0] - originX) * (ring[i][1] - originY) - (ring[i][0] - originX) * (ring[j][1] - originY);
  }
  return sum / 2;
}

export function ringContains(point: readonly number[], ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [x, y] = ring[i], [xj, yj] = ring[j];
    if ((y > point[1]) !== (yj > point[1]) && point[0] < (xj - x) * (point[1] - y) / (yj - y) + x) inside = !inside;
  }
  return inside;
}

/** Shapefile exteriors are clockwise; holes may precede their exterior in file order. */
export function shapesToGeometry(rings: Ring[], sourceProjection = "EPSG:4269"): GeographyGeometry {
  if (!rings.length) throw new Error("boundary has no polygon rings");
  const outer = rings.filter((ring) => ringArea(ring) < 0);
  const holes = rings.filter((ring) => ringArea(ring) >= 0);
  if (!outer.length) throw new Error("boundary has no clockwise exterior ring");
  const polygons = outer.map((ring) => [ring]);
  for (const hole of holes) {
    const containers = outer.flatMap((ring, index) => ringContains(hole[0], ring) ? [{ index, area: Math.abs(ringArea(ring)) }] : []);
    containers.sort((a, b) => a.area - b.area);
    if (!containers.length) throw new Error("boundary hole has no containing exterior");
    polygons[containers[0].index].push(hole);
  }
  const conversion = proj4(sourceProjection, "EPSG:4326");
  return {
    type: "MultiPolygon",
    coordinates: polygons.map((polygon) => polygon.map((ring) => ring.map(([x, y]) => {
      const point = conversion.forward([x, y]) as [number, number];
      if (!point.every(Number.isFinite) || Math.abs(point[0]) > 180 || Math.abs(point[1]) > 90) throw new Error("boundary reprojection produced invalid longitude/latitude");
      return point;
    }))),
  };
}

export function geometryPolygons(geometry: GeographyGeometry): Ring[][] {
  return (geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates) as Ring[][];
}

export function geometryArea(polygons: Ring[][]): number {
  return polygons.reduce((sum, polygon) => sum + Math.abs(ringArea(polygon[0])) - polygon.slice(1).reduce((n, ring) => n + Math.abs(ringArea(ring)), 0), 0);
}
