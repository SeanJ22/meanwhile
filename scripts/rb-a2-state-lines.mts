import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { DurableEvidenceStore } from "../lib/control-plane/evidence/durable-store.ts";
import { memoryLockManager } from "../lib/control-plane/repository/memory.ts";
import { censusTigerArchive } from "../lib/census-geography/tiger-source.ts";
import { tigerFeatures } from "../lib/census-geography/tiger-shapefile.ts";
import { tigerGeometry } from "../lib/census-geography/tiger-overlap.ts";
import { FIPS_TO_STATE } from "../lib/ocd/fips.ts";
import { stateBase } from "../lib/ocd/divisions.ts";
import type { StatePlaceMap } from "../lib/place-map/load.ts";
import { placesAtPoint } from "../lib/place-map/read.ts";
import { openMapCopy } from "./lib/rb-a2-copy.ts";

const output = "/tmp/rb-a2-replay";
await mkdir(output, { recursive: true });
const points = JSON.parse(await readFile("tests/fixtures/place-map-state-lines.json", "utf8")) as [number, number, string][];
const states = new Set(points.map(p => p[2].toUpperCase()));
function milesToBoundary(lng: number, lat: number, geometry: NonNullable<StatePlaceMap["boundaries"][number]["geometry"]>): number {
  const scale = Math.cos(lat * Math.PI / 180), polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  let nearest = Infinity;
  for (const polygon of polygons) for (const ring of polygon) for (let n = 1; n < ring.length; n++) {
    const x = (ring[n - 1][0] - lng) * scale, y = ring[n - 1][1] - lat;
    const dx = (ring[n][0] - ring[n - 1][0]) * scale, dy = ring[n][1] - ring[n - 1][1];
    const t = dx || dy ? Math.max(0, Math.min(1, -(x * dx + y * dy) / (dx * dx + dy * dy))) : 0;
    nearest = Math.min(nearest, Math.hypot(x + t * dx, y + t * dy));
  }
  return nearest * 111.195 / 1.609344;
}
const options = { cache: { store: new DurableEvidenceStore(`${output}/sources`, { remote: null }), locks: memoryLockManager() } };
const map: { places: StatePlaceMap["places"][number][]; boundaries: StatePlaceMap["boundaries"][number][]; zipEdges: []; zctaEdges: [] } = { places: [], boundaries: [], zipEdges: [], zctaEdges: [] };
const source = "https://www2.census.gov/geo/tiger/TIGER2026/STATE/tl_2026_us_state.zip";
const archive = await censusTigerArchive(source, options, async path => {
  for await (const feature of tigerFeatures(path, undefined, undefined, p => states.has(FIPS_TO_STATE[p.STATEFP]?.postal))) {
    const id = stateBase(feature.properties.STATEFP)!.base;
    map.places.push({ id, name: feature.properties.NAME, state: FIPS_TO_STATE[feature.properties.STATEFP].postal, aliases: [] });
    map.boundaries.push({ placeId: id, boundaryYear: 2026, layer: "state", version: "state:2026", geometry: { type: "MultiPolygon", coordinates: tigerGeometry(feature) },
      hostCountyId: null, countyAttachment: false, sourceUrls: [source], checkedAt: new Date().toISOString() });
  }
});
await archive.dispose();
const db = await openMapCopy("national", false);
try {
  const results = [];
  let pointSql = "";
  for (const [lng, lat, expected] of points) {
    let calls = 0;
    const result = await placesAtPoint(async (text, params) => { calls++; pointSql = text; return db.query(text, params); }, [lng, lat]);
    assert.deepEqual(result.states, [expected.toUpperCase()], `${lng}, ${lat}`);
    assert.equal(calls, 1);
    const placeId = map.places.find(place => place.state === expected.toUpperCase())!.id;
    const miles = milesToBoundary(lng, lat, map.boundaries.find(boundary => boundary.placeId === placeId)!.geometry!);
    assert.ok(miles <= 2, `${lng},${lat} is ${miles} miles from the state boundary`);
    results.push({ lng, lat, state: result.states[0], queries: calls, milesToStateBoundary: Math.round(miles * 1000) / 1000 });
  }
  const plan = await db.query(`EXPLAIN (FORMAT JSON) ${pointSql}`, points[0].slice(0, 2));
  assert.ok(JSON.stringify(plan).includes('"Index Name":"place_boundary_point_idx"'), "The complete point lookup uses its GiST index");
  await writeFile(`${output}/state-lines.json`, JSON.stringify({ source, sha256: archive.sha256, pointIndex: "place_boundary_point_idx", nationalCopy: true, results }, null, 2));
  console.log(`${results.length} state-line points resolved correctly through one indexed query each.`);
} finally { await db.close(); }
