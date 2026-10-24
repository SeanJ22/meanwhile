import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { DurableEvidenceStore } from "../lib/control-plane/evidence/durable-store.ts";
import { memoryLockManager } from "../lib/control-plane/repository/memory.ts";
import { censusTigerArchive } from "../lib/census-geography/tiger-source.ts";
import { tigerFeatures } from "../lib/census-geography/tiger-shapefile.ts";
import { tigerGeometry } from "../lib/census-geography/tiger-overlap.ts";
import { FIPS_TO_STATE } from "../lib/ocd/fips.ts";
import { stateBase } from "../lib/ocd/divisions.ts";
import { loadStatePlaceMap, type StatePlaceMap } from "../lib/place-map/load.ts";
import { placesAtPoint } from "../lib/place-map/read.ts";
import type { Query } from "../lib/facts/publish.ts";
import { identitySourceTables, identityEventTables, readerIdentityMigration } from "../tests/helpers/reader-identity-db.ts";

const output = "/tmp/rb-a2-replay";
await mkdir(output, { recursive: true });
const points = JSON.parse(await readFile("tests/fixtures/place-map-state-lines.json", "utf8")) as [number, number, string][];
const states = new Set(points.map(p => p[2].toUpperCase()));
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
const db = new PGlite();
try {
  await db.exec(await readFile("lib/db/migrations/0035_r1_fact_store.sql", "utf8"));
  await identitySourceTables(db); await identityEventTables(db); await db.exec(readerIdentityMigration());
  await db.exec(await readFile("lib/db/migrations/RB-A2_place_boundaries.sql", "utf8"));
  const query: Query = async (text, params = []) => (await db.query(text, [...params])).rows as Record<string, unknown>[];
  const transaction = <T,>(run: (query: Query) => Promise<T>) => db.transaction(tx => run(async (text, params = []) => (await tx.query(text, [...params])).rows as Record<string, unknown>[]));
  await loadStatePlaceMap({ transaction }, map);
  const results = [];
  for (const [lng, lat, expected] of points) {
    let calls = 0;
    const result = await placesAtPoint(async (text, params) => { calls++; return query(text, params); }, [lng, lat]);
    assert.deepEqual(result.states, [expected.toUpperCase()], `${lng}, ${lat}`);
    assert.equal(calls, 1);
    results.push({ lng, lat, state: result.states[0], queries: calls });
  }
  await writeFile(`${output}/state-lines.json`, JSON.stringify({ source, sha256: archive.sha256, results }, null, 2));
  console.log(`${results.length} state-line points resolved correctly through one indexed query each.`);
} finally { await db.close(); }
