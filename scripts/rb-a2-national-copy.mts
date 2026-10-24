/** Compose the state imports in one disposable database, as the standing jobs do. */
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { performance } from "node:perf_hooks";
import { neon } from "@neondatabase/serverless";
import { FIPS_TO_STATE } from "../lib/ocd/fips.ts";
import { loadStatePlaceMap, type StatePlaceMap } from "../lib/place-map/load.ts";
import { placesForCode } from "../lib/place-map/read.ts";
import { placeMapCounts } from "../lib/place-map/counts.ts";
import { readLegacyStateMemberships } from "../lib/place-map/refresh.ts";
import { openMapCopy } from "./lib/rb-a2-copy.ts";

const measuring = process.argv.includes("--measure"), verifying = process.argv.includes("--verify"), aliasesOnly = process.argv.includes("--aliases");
const states = Object.values(FIPS_TO_STATE).map(state => state.postal).sort();
const db = await openMapCopy("national", !measuring && !verifying && !aliasesOnly);
try {
  if (measuring) {
    const codes = await db.query("SELECT DISTINCT zip FROM zip_place ORDER BY zip");
    let worstMs = 0, worstZip = "", worstRows = 0;
    for (const row of codes) {
      const zip = String(row.zip), start = performance.now();
      const result = await placesForCode(db.query, "zip", zip, { purpose: "representation", asOf: "2026-10-24" });
      const elapsed = performance.now() - start;
      if (elapsed > worstMs) { worstMs = elapsed; worstZip = zip; worstRows = result.memberships.length; }
    }
    const result = { engine: "PostgreSQL 17.11", states: 56, zips: codes.length, worstZip, memberships: worstRows,
      worstZipMs: Math.round(worstMs * 100) / 100, passed: worstMs < 50 };
    await writeFile("/tmp/rb-a2-replay/national-benchmark.json", JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
    if (!result.passed) process.exitCode = 1;
  } else if (verifying) {
    const results = [];
    for (const state of states) {
      const baseline = await readLegacyStateMemberships(process.cwd(), state);
      let missing = 0;
      for (const [zip, entry] of baseline) {
        const result = await placesForCode(db.query, "zip", zip, { purpose: "representation", asOf: "2026-10-24" });
        const ids = new Set(result.memberships.map(row => row.placeId));
        for (const id of [...entry.ids, ...entry.fringe ?? []]) if (!ids.has(id)) { console.error({ state, zip, missing: id }); missing++; }
      }
      assert.equal(missing, 0, state);
      results.push({ state, baselineZips: baseline.size, missing });
      console.log(`${state}: ${baseline.size} legacy ZIPs, no missing districts including fringe and adjacent-state IDs`);
    }
    await writeFile("/tmp/rb-a2-replay/national-preservation.json", JSON.stringify(results, null, 2));
  } else if (aliasesOnly) {
    for (const state of states) {
      const map = JSON.parse(gunzipSync(await readFile(`/tmp/rb-a2-replay/${state.toLowerCase()}-map.json.gz`)).toString("utf8")) as StatePlaceMap;
      await loadStatePlaceMap(db, { places: map.places, boundaries: [], zipEdges: [], zctaEdges: [] });
      console.log(`${state}: source aliases loaded`);
    }
  } else {
    const url = process.env.RB_A2_READER_URL;
    if (!url || new URL(url).username !== "readonly") throw new Error("Production read-only role is required");
    const sql = neon(url);
    for (const state of states) {
      const map = JSON.parse(gunzipSync(await readFile(`/tmp/rb-a2-replay/${state.toLowerCase()}-map.json.gz`)).toString("utf8")) as StatePlaceMap;
      // Seed one state's real production identities under SELECT-only access.
      // A national entity payload never crosses into worker memory.
      const held = (await sql.transaction([sql.query(`SELECT id,kind,name,state FROM entity WHERE (kind='place' AND state=$1) OR id='ocd-division/country:us' OR id=ANY($2::text[])`,
        [state, map.entityPlaces?.map(row => row.entityId) ?? []])], { readOnly: true }))[0];
      await db.query(`INSERT INTO entity(id,kind,name,state) SELECT id,kind,name,state FROM jsonb_to_recordset($1::jsonb) AS e(id text,kind text,name text,state char(2)) ON CONFLICT DO NOTHING`, [JSON.stringify(held)]);
      const unplaced = map.boundaries.filter(boundary => boundary.layer === "district" && !boundary.geometry && !boundary.countyAttachment);
      assert.equal(unplaced.length, 0, `${state}: special districts without shape or host county: ${unplaced.slice(0, 3).map(row => row.placeId).join(", ")}`);
      await loadStatePlaceMap(db, map);
      const [preserved] = await db.query("SELECT count(*)::int n FROM entity WHERE id=ANY($1::text[])", [held.map(row => row.id)]);
      assert.equal(preserved.n, held.length, `${state}: held production IDs`);
      console.log(`${state}: composed ${map.places.length} places and ${map.zipEdges.length} ZIP memberships`);
    }
    await db.exec("ANALYZE entity; ANALYZE entity_external_id; ANALYZE entity_place; ANALYZE place_boundary; ANALYZE zip_place; ANALYZE zcta_place");
    const counts = await placeMapCounts(db.query);
    await writeFile("/tmp/rb-a2-replay/national-counts.json", JSON.stringify(counts, null, 2));
    console.log("All 56 state imports composed; measure and verify in separate reader processes.");
  }
} finally { await db.close(); }
