import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The results map's national House layer: every congressional district of the 50 states and DC, simplified for first paint.
 * Derived from the resolver's own `public/geo/cd119.geojson` (the same Census cd119 geometry and OCD IDs the boundary tiles
 * carry), so it needs no network. Run: node --experimental-strip-types scripts/build-national-districts.mts
 */
const TOLERANCE = 0.03, PRECISION = 200, MIN_AREA = 0.004;
type Ring = number[][];
const here = (name: string) => join(process.cwd(), "public", "geo", name);
const source = JSON.parse(readFileSync(here("cd119.geojson"), "utf8")) as {
  features: { properties: { ocdId: string }; geometry: { type: "Polygon"; coordinates: Ring[] } | { type: "MultiPolygon"; coordinates: Ring[][] } }[];
};

/** Douglas-Peucker over one open run of points. */
function simplify(points: Ring, tolerance: number): Ring {
  if (points.length < 3) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [start, end] = stack.pop()!;
    const [ax, ay] = points[start], [bx, by] = points[end], dx = bx - ax, dy = by - ay, length = dx * dx + dy * dy;
    let far = -1, worst = tolerance * tolerance;
    for (let index = start + 1; index < end; index += 1) {
      const [px, py] = points[index];
      const t = length ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / length)) : 0;
      const distance = (px - ax - t * dx) ** 2 + (py - ay - t * dy) ** 2;
      if (distance > worst) { worst = distance; far = index; }
    }
    if (far > 0) { keep[far] = 1; stack.push([start, far], [far, end]); }
  }
  return points.filter((_, index) => keep[index]);
}
const area = (ring: Ring) => Math.abs(ring.reduce((sum, [x, y], index) => { const [x1, y1] = ring[(index + 1) % ring.length]; return sum + x * y1 - x1 * y; }, 0) / 2);
const round = (value: number) => Math.round(value * PRECISION) / PRECISION;

const features = source.features.filter(({ properties }) => /\/state:[a-z]{2}\/cd:|\/district:dc\/cd:/.test(properties.ocdId)).map(({ properties, geometry }) => {
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  const kept = polygons.flatMap(polygon => {
    const outer = polygon[0];
    if (area(outer) < MIN_AREA && polygons.length > 1) return [];
    const ring = simplify(outer.slice(0, -1), TOLERANCE).map(([x, y]) => [round(x), round(y)]);
    return ring.length < 3 ? [] : [[[...ring, ring[0]]]];
  });
  const biggest = kept.length ? kept : [[simplify(polygons[0][0].slice(0, -1), TOLERANCE / 4).map(([x, y]) => [round(x), round(y)])]];
  return { type: "Feature", properties: { ocdId: properties.ocdId },
    geometry: biggest.length === 1 ? { type: "Polygon", coordinates: biggest[0] } : { type: "MultiPolygon", coordinates: biggest } };
}).sort((a, b) => a.properties.ocdId.localeCompare(b.properties.ocdId));
if (features.length !== 436) throw new Error(`Expected 435 districts and DC, got ${features.length}`);
const text = JSON.stringify({ type: "FeatureCollection", features }) + "\n";
mkdirSync(join(process.cwd(), "public", "geo"), { recursive: true });
writeFileSync(here("cd-national.json"), text);
console.log(JSON.stringify({ districts: features.length, points: JSON.stringify(features).match(/\],\[/g)?.length, bytes: Buffer.byteLength(text) }));
