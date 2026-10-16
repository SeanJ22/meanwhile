import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import test from "node:test";
import { publishScopeBoundaries } from "../lib/census-geography/boundary-artifacts.ts";
import type { BuiltScope } from "../lib/census-geography/dataset.ts";
import { LocalFileArtifactStore } from "../lib/meetings/edge-store-local.ts";
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
  const original = structuredClone(source), coordinates = source.coordinates, ring = coordinates[0], first = ring[0];
  const accurate = roundBoundaryGeometry(source);
  assert.equal(accurate, source);
  assert.equal(accurate.coordinates, coordinates);
  assert.equal(source.coordinates[0], ring);
  assert.equal(source.coordinates[0][0], first);
  const points = geometryPolygons(accurate)[0][0];
  assert.ok(!Object.is(points[0][0], -0));
  for (let index = 0; index < points.length; index++) for (let axis = 0; axis < 2; axis++) {
    assert.equal(points[index][axis], Number(points[index][axis].toFixed(6)));
    assert.ok(Math.abs(points[index][axis] - original.coordinates[0][index][axis]) <= 0.0000005);
  }
  assert.notDeepEqual(source, original);
  assert.throws(() => roundBoundaryGeometry({ type: "Polygon", coordinates: [square(0, 0, 0.00000001, 0.00000001)] }), /collapses/);
});

test("the existing original overlay polygons shrink without changing point membership or ring topology", async () => {
  const base = new URL("./fixtures/geography/overlay/", import.meta.url);
  const original = JSON.parse(await readFile(new URL("original-polygons.json", base), "utf8"));
  const projection = await readFile(new URL("NHHouseDists2022_float.prj", base), "utf8");
  let sourceBytes = 0, displayBytes = 0;
  for (const feature of original) {
    const source = shapesToGeometry(feature.rings, projection), original = structuredClone(source);
    sourceBytes += JSON.stringify(original).length;
    const { accurate, display } = boundaryGeometries(source);
    displayBytes += JSON.stringify(display).length;
    assert.equal(accurate, source);
    assert.deepEqual(geometryPolygons(display).map((polygon) => polygon.length), geometryPolygons(accurate).map((polygon) => polygon.length));
    const points = geometryPolygons(original).flatMap((polygon) => polygon[0]);
    const west = Math.min(...points.map((point) => point[0])), east = Math.max(...points.map((point) => point[0]));
    const south = Math.min(...points.map((point) => point[1])), north = Math.max(...points.map((point) => point[1]));
    for (let x = 1; x < 25; x++) for (let y = 1; y < 25; y++) {
      const point: Point = [west + (east - west) * x / 25, south + (north - south) * y / 25];
      assert.equal(contains(point, accurate), contains(point, original));
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

test("rounding compacts duplicate coordinates inside the owned ring", () => {
  const ring: Point[] = [[0, 0], [0.0000001, 0.0000001], [1, 0], [1, 1], [0, 1], [0, 0]];
  const east = ring[2];
  const source: GeographyGeometry = { type: "Polygon", coordinates: [ring] };
  assert.equal(roundBoundaryGeometry(source), source);
  assert.equal(source.coordinates[0], ring);
  assert.equal(ring.length, 5);
  assert.equal(ring[1], east);
  assert.deepEqual(ring, [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]);
});

test("publication replaces each owned polygon only after its artifact is durable", async () => {
  const scope: BuiltScope = { type: "overlay_district", version: "overlay:owned", fractionBasis: "area", instanceCount: 2, zctaEdgeCount: 0,
    versionMeta: { key: "overlay:owned", type: "overlay_district", plan: "Constructed ownership test", zctaTabulation: "2020", effectiveFor: "Test representation",
      provenance: { sourceUrls: [], sourceDataset: "CONSTRUCTED_TEST", sourceFiles: [], sourceChecksums: [], method: "Constructed squares", computedAt: "2026-10-16T00:00:00Z" } },
    groupings: [0, 2].map(offset => ({ geoid: `33owned${offset}`, ocdId: null, label: "Constructed square", stateFips: "33", stateAbbr: "NH", memberStates: ["NH"],
      geometry: { type: "Polygon", coordinates: [square(offset, 0, offset + 1, 1)] }, overlaps: [] })),
  };
  const groups = scope.groupings, first = groups[0], second = groups[1];
  const directory = await mkdtemp(join(tmpdir(), "sl02-owned-boundary-"));
  const store = new LocalFileArtifactStore(directory), put = store.putImmutable.bind(store);
  let writes = 0;
  store.putImmutable = async (bytes, suffix) => {
    writes++;
    if (writes > 1) {
      assert.equal(first.geometry, undefined);
      assert.ok(first.geometryRef);
    }
    if (writes === 2) throw new Error("Constructed artifact write failure");
    return put(bytes, suffix);
  };
  try {
    await assert.rejects(publishScopeBoundaries(scope, store), /artifact write failure/);
    assert.equal(first.geometry, undefined);
    assert.ok(second.geometry);
    assert.equal(second.geometryRef, undefined);
    assert.equal(await publishScopeBoundaries(scope, store), scope);
    assert.equal(scope.groupings, groups);
    assert.equal(scope.groupings[0], first);
    assert.equal(scope.groupings[1], second);
    assert.equal(writes, 3);
    for (const group of groups) {
      assert.equal(group.geometry, undefined);
      const bytes = await store.readBytes(group.geometryRef!.key);
      assert.ok(bytes);
      const artifact = JSON.parse(gunzipSync(bytes).toString("utf8"));
      assert.equal(artifact.geoid, group.geoid);
      assert.equal(artifact.accurate.type, "Polygon");
      assert.equal(artifact.display.type, "Polygon");
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});
