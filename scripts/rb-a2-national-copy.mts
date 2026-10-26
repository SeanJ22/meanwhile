import { CD_REDRAWN_FOR_2026 } from "../lib/census-geography/selection.ts";
/** Compose the state imports in one disposable database, as the standing jobs do. */
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { FIPS_TO_STATE } from "../lib/ocd/fips.ts";
import { loadStatePlaceMap, type StatePlaceMap } from "../lib/place-map/load.ts";
import { placesForCode } from "../lib/place-map/read.ts";
import { placeMapCounts } from "../lib/place-map/counts.ts";
import { readLegacyStateMemberships } from "../lib/place-map/refresh.ts";
import { openMapCopy } from "./lib/rb-a2-copy.ts";

const verifying = process.argv.includes("--verify"), aliasesOnly = process.argv.includes("--aliases"), shapesOnly = process.argv.includes("--shapes"), reporting = process.argv.includes("--report"), zipLinksOnly = process.argv.includes("--zip-links");
const states = Object.values(FIPS_TO_STATE).map(state => state.postal).sort();
const db = await openMapCopy("national", false);
try {
  if (reporting) {
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
    console.log(JSON.stringify(await placeMapCounts(db.query), null, 2));
  }
} finally { await db.close(); }
