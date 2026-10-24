/** Compose the state imports in one disposable database, as the standing jobs do. */
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { neon } from "@neondatabase/serverless";
import { FIPS_TO_STATE } from "../lib/ocd/fips.ts";
import { loadStatePlaceMap, type StatePlaceMap } from "../lib/place-map/load.ts";
import { placesForCode } from "../lib/place-map/read.ts";
import { placeMapCounts } from "../lib/place-map/counts.ts";
import { readLegacyStateMemberships, heldStateDataset } from "../lib/place-map/refresh.ts";
import { censusWorkDivision } from "../lib/census-geography/division-id.ts";
import { CD_REDRAWN_FOR_2026 } from "../lib/census-geography/selection.ts";
import { openMapCopy } from "./lib/rb-a2-copy.ts";

const verifying = process.argv.includes("--verify"), aliasesOnly = process.argv.includes("--aliases"), shapesOnly = process.argv.includes("--shapes"), reporting = process.argv.includes("--report"), productionBaseline = process.argv.includes("--production-baseline"), zipLinksOnly = process.argv.includes("--zip-links");
const states = Object.values(FIPS_TO_STATE).map(state => state.postal).sort();
const db = await openMapCopy("national", !verifying && !aliasesOnly && !shapesOnly && !reporting && !productionBaseline && !zipLinksOnly);
try {
  if (productionBaseline) {
    const url = process.env.RB_A2_READER_URL;
    if (!url || new URL(url).username !== "readonly") throw new Error("Production read-only role is required");
    const sql = neon(url), results = [];
    for (const state of states) {
      const dataset = await heldStateDataset(async (text, params = []) => (await sql.transaction([sql.query(text, [...params])], { readOnly: true }))[0], state);
      if (!dataset) throw new Error(`No production Census baseline for ${state}`);
      const byZip = new Map<string, Set<string>>();
      for (const scope of dataset.scopes) if (["congressional_district", "state_leg_upper", "state_leg_lower"].includes(scope.type)) {
        for (const group of scope.groupings) {
          const id = censusWorkDivision({ ...group, type: scope.type, version: scope.version });
          if (!id) continue;
          for (const edge of group.overlaps) { const found = byZip.get(edge.zcta5) ?? new Set<string>(); found.add(id); byZip.set(edge.zcta5, found); }
        }
      }
      const missing = [];
      for (const [zip, previous] of byZip) {
        const current = await placesForCode(db.query, "zip", zip, { purpose: "representation", asOf: "2026-10-24" });
        const ids = new Set(current.memberships.map(row => row.placeId));
        for (const id of previous) if (!ids.has(id)) missing.push({ zip, id });
      }
      results.push({ state, checkedZips: byZip.size, missing });
      console.log(JSON.stringify({ state, checkedZips: byZip.size, missing: missing.length, examples: missing.slice(0, 3) }));
    }
    await writeFile("/tmp/rb-a2-replay/production-membership-preservation.json", JSON.stringify(results, null, 2));
    if (results.some(row => row.missing.length)) process.exitCode = 1;
  } else if (reporting) {
    const counts = await placeMapCounts(db.query), rows = [];
    await db.exec("CREATE TEMP TABLE baseline_zip_place(zip text,place_id text,PRIMARY KEY(zip,place_id))");
    for (const row of counts) {
      const baseline = await readLegacyStateMemberships(process.cwd(), row.state);
      const links = [...baseline].flatMap(([zip, entry]) => [...new Set([...entry.ids, ...entry.fringe ?? []])].map(place_id => ({ zip, place_id })));
      await db.exec("TRUNCATE baseline_zip_place");
      await db.query("INSERT INTO baseline_zip_place SELECT zip,place_id FROM jsonb_to_recordset($1::jsonb) AS b(zip text,place_id text)", [JSON.stringify(links)]);
      const [gains] = await db.query(`SELECT count(DISTINCT (m.zip,m.place_id))::int AS n
        FROM zip_place m JOIN entity e ON e.id=m.place_id JOIN place_boundary b ON b.place_id=m.place_id AND b.boundary_year=m.boundary_year
        WHERE e.state=$1 AND b.layer IN('cd','sldu','sldl','district','unsd','elsd','scsd')
          AND NOT EXISTS(SELECT 1 FROM baseline_zip_place old WHERE old.zip=m.zip AND old.place_id=m.place_id)`, [row.state]);
      const [plans] = await db.query(`SELECT count(*) FILTER(WHERE b.version='cd:120' AND b.geometry IS NOT NULL)::int AS cd120_shapes,
        count(*) FILTER(WHERE b.version IN('cd:120','sldu:2026','sldl:2026') AND b.geometry IS NULL)::int AS missing_current_shapes
        FROM place_boundary b JOIN entity e ON e.id=b.place_id WHERE e.state=$1`, [row.state]);
      assert.equal(plans.missing_current_shapes, 0, `${row.state} current district shapes`);
      let planProof = null;
      if (CD_REDRAWN_FOR_2026.some(state => state === row.state)) {
        const [sample] = await db.query(`SELECT m.zip,
          array_agg(DISTINCT b.place_id ORDER BY b.place_id) FILTER(WHERE b.version='cd:119') AS previous,
          array_agg(DISTINCT b.place_id ORDER BY b.place_id) FILTER(WHERE b.version='cd:120') AS upcoming
          FROM zip_place m JOIN place_boundary b ON b.place_id=m.place_id AND b.boundary_year=m.boundary_year JOIN entity e ON e.id=m.place_id
          WHERE e.state=$1 AND b.layer='cd' GROUP BY m.zip
          HAVING count(*) FILTER(WHERE b.version='cd:119')>0 AND count(*) FILTER(WHERE b.version='cd:120')>0
            AND array_agg(DISTINCT b.place_id ORDER BY b.place_id) FILTER(WHERE b.version='cd:119') IS DISTINCT FROM
                array_agg(DISTINCT b.place_id ORDER BY b.place_id) FILTER(WHERE b.version='cd:120') ORDER BY m.zip LIMIT 1`, [row.state]);
        assert.ok(sample, `${row.state} has a sourced congressional map change`);
        const zip = String(sample.zip);
        const current = await placesForCode(db.query, "zip", zip, { purpose: "representation", asOf: "2026-10-24" });
        const next = await placesForCode(db.query, "zip", zip, { purpose: "election", asOf: "2026-10-24", electionDate: "2026-11-03" });
        const congressional = (result: typeof current) => result.memberships.filter(m => m.state === row.state && m.layer === "cd").map(m => m.placeId).sort();
        assert.deepEqual(congressional(current), sample.previous); assert.deepEqual(congressional(next), sample.upcoming);
        planProof = { zip, representation: congressional(current), election: congressional(next) };
      }
      rows.push({ ...row, baselineZips: baseline.size, gainedDistrictRelationships: gains.n, cd120Shapes: plans.cd120_shapes, planProof });
      console.log(`${row.state}: ${row.places} mapped places, ${row.zips} ZIPs, ${gains.n} gained district links`);
    }
    await writeFile("/tmp/rb-a2-replay/final-state-results.json", JSON.stringify(rows, null, 2));
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
  } else if (aliasesOnly || shapesOnly || zipLinksOnly) {
    for (const state of states) {
      const map = JSON.parse(gunzipSync(await readFile(`/tmp/rb-a2-replay/${state.toLowerCase()}-map.json.gz`)).toString("utf8")) as StatePlaceMap;
      await loadStatePlaceMap(db, { places: zipLinksOnly ? [] : map.places, boundaries: shapesOnly ? map.boundaries : [], zipEdges: zipLinksOnly ? map.zipEdges : [], zctaEdges: [] });
      console.log(`${state}: ${zipLinksOnly ? "ZIP links" : shapesOnly ? "source shapes" : "source aliases"} loaded`);
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
