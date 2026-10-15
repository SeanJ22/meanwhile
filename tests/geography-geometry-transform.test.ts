import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { GeographyGeometry } from "../lib/census-geography/contract.ts";
import { boundaryGeometries, roundBoundaryGeometry, simplifyDisplayGeometry } from "../lib/census-geography/geometry-transform.ts";
import { geometryPolygons, shapesToGeometry } from "../lib/overlay-geography/geometry.ts";
import { readBoundaryZip, readShp, readZip } from "../lib/geo/shapefile.ts";

type Point = [number, number];
function inRing([x, y]: Point, ring: number[][]): boolean {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const [ax, ay] = ring[index], [bx, by] = ring[previous];
    if ((ay > y) !== (by > y) && x < (bx - ax) * (y - ay) / (by - ay) + ax) inside = !inside;
  }
  return inside;
}
const contains = (point: Point, geometry: GeographyGeometry) => geometryPolygons(geometry).some((polygon) => inRing(point, polygon[0]) && !polygon.slice(1).some((ring) => inRing(point, ring)));
const square = (west: number, south: number, east: number, north: number) => [[west, south], [west, north], [east, north], [east, south], [west, south]];

test("accurate point boundaries retain a narrow peninsula removed from map display", () => {
  const source: GeographyGeometry = { type: "Polygon", coordinates: [[[-71, 43], [-71, 44], [-70, 44], [-70, 43], [-70.5, 42.99995], [-71, 43]]] };
  const { accurate, display } = boundaryGeometries(source);
  assert.ok(contains([-70.5, 42.99997], accurate));
  assert.ok(!contains([-70.5, 42.99997], display));
  assert.ok(contains([-70.5, 43.5], accurate));
  assert.ok(contains([-70.5, 43.5], display));
});

test("display simplification retains tiny islands, holes and an island inside a lake", () => {
  const source: GeographyGeometry = { type: "MultiPolygon", coordinates: [[square(0, 0, 1, 1), square(0.4, 0.4, 0.6, 0.6)], [square(0.49, 0.49, 0.51, 0.51)], [square(2, 2, 2.000002, 2.000002)]] };
  const { accurate, display } = boundaryGeometries(source);
  assert.deepEqual(geometryPolygons(display).map((polygon) => polygon.length), [2, 1, 1]);
  for (const shape of [accurate, display]) {
    assert.ok(contains([0.5, 0.5], shape));
    assert.ok(!contains([0.45, 0.45], shape));
    assert.ok(contains([2.000001, 2.000001], shape));
  }
});

test("simplification cannot cut across a hole inside a peninsula", () => {
  const source: GeographyGeometry = { type: "Polygon", coordinates: [[[0, 0], [0, 10], [10, 10], [10, 0], [5, -1], [0, 0]], square(4.9, -0.6, 5.1, -0.4)] };
  const accurate = roundBoundaryGeometry(source), display = simplifyDisplayGeometry(accurate, 2);
  assert.equal(geometryPolygons(display)[0].length, 2);
  assert.ok(!contains([5, -0.5], display));
  assert.ok(contains([5, -0.8], display));
});

test("six-decimal publication bounds coordinate error and rejects a collapsed ring", () => {
  const source: GeographyGeometry = { type: "Polygon", coordinates: [[[-0.00000001, 42.12345678], [0.12345678, 42.12345678], [0.12345678, 43.12345678], [-0.00000001, 43.12345678], [-0.00000001, 42.12345678]]] };
  const original = structuredClone(source), accurate = roundBoundaryGeometry(source);
  const points = geometryPolygons(accurate)[0][0];
  assert.ok(!Object.is(points[0][0], -0));
  for (let index = 0; index < points.length; index++) for (let axis = 0; axis < 2; axis++) {
    assert.equal(points[index][axis], Number(points[index][axis].toFixed(6)));
    assert.ok(Math.abs(points[index][axis] - source.coordinates[0][index][axis]) <= 0.0000005);
  }
  assert.deepEqual(source, original);
  assert.throws(() => roundBoundaryGeometry({ type: "Polygon", coordinates: [square(0, 0, 0.00000001, 0.00000001)] }), /collapses/);
});

test("the existing original overlay polygons shrink without changing point membership or ring topology", async () => {
  const base = new URL("./fixtures/geography/overlay/", import.meta.url);
  const original = JSON.parse(await readFile(new URL("original-polygons.json", base), "utf8"));
  const projection = await readFile(new URL("NHHouseDists2022_float.prj", base), "utf8");
  let sourceBytes = 0, displayBytes = 0;
  for (const feature of original) {
    const source = shapesToGeometry(feature.rings, projection), { accurate, display } = boundaryGeometries(source);
    sourceBytes += JSON.stringify(source).length; displayBytes += JSON.stringify(display).length;
    assert.deepEqual(geometryPolygons(display).map((polygon) => polygon.length), geometryPolygons(accurate).map((polygon) => polygon.length));
    const points = geometryPolygons(source).flatMap((polygon) => polygon[0]);
    const west = Math.min(...points.map((point) => point[0])), east = Math.max(...points.map((point) => point[0]));
    const south = Math.min(...points.map((point) => point[1])), north = Math.max(...points.map((point) => point[1]));
    for (let x = 1; x < 25; x++) for (let y = 1; y < 25; y++) {
      const point: Point = [west + (east - west) * x / 25, south + (north - south) * y / 25];
      assert.equal(contains(point, accurate), contains(point, source));
    }
    for (const coordinate of geometryPolygons(accurate).flat(2)) for (const value of coordinate) assert.equal(value, Number(value.toFixed(6)));
  }
  assert.ok(displayBytes < sourceBytes * 0.6, `${displayBytes} display bytes from ${sourceBytes} original bytes`);
});

test("merged memory and streamed shape readers preserve original record ordinals when filtering", async () => {
  const bytes = await readFile(new URL("./fixtures/geography/overlay/NHHouseDistricts2022_Float.zip", import.meta.url));
  const complete = readBoundaryZip(bytes).features;
  const selected = readBoundaryZip(bytes, (row) => ["RO31", "ST18"].includes(row.FloatHse22)).features;
  assert.deepEqual(selected, complete.filter((feature) => ["RO31", "ST18"].includes(feature.properties.FloatHse22)));
  const shp = readZip(bytes).find((entry) => entry.name.endsWith(".shp"))!.data;
  const records = readShp(shp, (index) => index === 24);
  assert.equal(records.length, 40);
  assert.equal(records[24].recordNumber, 25);
  assert.deepEqual(records[24].rings, selected.find((feature) => feature.properties.FloatHse22 === "RO31")!.rings);
  assert.deepEqual(records[23].rings, []);
});
