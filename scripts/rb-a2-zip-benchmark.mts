/** Measure the reader separately from the source importer, as production runs it. */
import { readFile, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { gunzipSync } from "node:zlib";
import { loadStatePlaceMap, type StatePlaceMap } from "../lib/place-map/load.ts";
import { placesForCode } from "../lib/place-map/read.ts";
import { openMapCopy } from "./lib/rb-a2-copy.ts";

const state = process.argv[2];
if (!state || !/^[A-Z]{2}$/.test(state)) throw new Error("A state abbreviation is required");
const measuring = process.argv.includes("--measure");
const db = await openMapCopy(`benchmark_${state.toLowerCase()}`, !measuring);
const { query } = db;
try {
  if (!measuring) {
    const map = JSON.parse(gunzipSync(await readFile(`/tmp/rb-a2-replay/${state.toLowerCase()}-map.json.gz`)).toString("utf8")) as StatePlaceMap;
    await loadStatePlaceMap(db, map);
    await db.exec("ANALYZE zip_place; ANALYZE entity; ANALYZE place_boundary");
    console.log(`${state} database copy prepared; measure in a fresh reader process.`);
  } else {
    const codes = await query("SELECT DISTINCT zip FROM zip_place ORDER BY zip");
    let worstMs = 0, worstZip = "", worstRows = 0;
    for (const row of codes) {
      const zip = String(row.zip), start = performance.now();
      const result = await placesForCode(query, "zip", zip, { purpose: "representation", asOf: "2026-10-24" });
      const elapsed = performance.now() - start;
      if (elapsed > worstMs) { worstMs = elapsed; worstZip = zip; worstRows = result.memberships.length; }
    }
    const result = { state, engine: "PostgreSQL 17.11", zips: codes.length, worstZip, memberships: worstRows, worstZipMs: Math.round(worstMs * 100) / 100, passed: worstMs < 50 };
    await writeFile(`/tmp/rb-a2-replay/${state.toLowerCase()}-benchmark.json`, JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
    if (!result.passed) process.exitCode = 1;
  }
} finally { await db.close(); }
