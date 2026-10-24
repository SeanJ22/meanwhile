/** Read production; import and measure only in a local Postgres copy. */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { PGlite } from "@electric-sql/pglite";
import { neon } from "@neondatabase/serverless";
import { DurableEvidenceStore } from "../lib/control-plane/evidence/durable-store.ts";
import { memoryLockManager } from "../lib/control-plane/repository/memory.ts";
import { prepareStatePlaceMap } from "../lib/place-map/refresh.ts";
import { loadStatePlaceMap, type StatePlaceMap } from "../lib/place-map/load.ts";
import { placesForCode } from "../lib/place-map/read.ts";
import type { Query } from "../lib/facts/publish.ts";
import { FIPS_TO_STATE } from "../lib/ocd/fips.ts";

const root = process.cwd(), output = process.env.RB_A2_OUTPUT ?? "/tmp/rb-a2-replay";
const url = process.env.RB_A2_READER_URL;
if (!url || new URL(url).username !== "readonly") throw new Error("The specified production read-only role is required");
const sql = neon(url);
const production: Query = async (text, params = []) => (await sql.transaction([sql.query(text, [...params])], { readOnly: true }))[0] as Record<string, unknown>[];
const [identity] = await production("SELECT current_user AS role, current_setting('transaction_read_only') AS read_only");
if (identity.role !== "readonly" || identity.read_only !== "on") throw new Error("Production connection is not read only");
await mkdir(output, { recursive: true });
const requested = process.argv.slice(2);
const states = requested.length ? requested : Object.values(FIPS_TO_STATE).map(s => s.postal).sort();
const store = new DurableEvidenceStore(join(output, "sources"), { remote: null });
const cache = { store, locks: memoryLockManager() };
const results: Record<string, unknown>[] = [];
for (const state of states) {
  try {
    console.log(`${new Date().toISOString()} ${state} acquiring place map`);
    const path = join(output, `${state.toLowerCase()}-map.json`);
    let map: StatePlaceMap;
    if (process.env.RB_A2_REUSE === "1") map = JSON.parse(await readFile(path, "utf8"));
    else {
      map = await prepareStatePlaceMap(production, root, state, { cache, fetchImpl: async (url, init) => {
        console.log(`${state} source ${String(url)}`);
        return fetch(url, init);
      } });
      await writeFile(path, JSON.stringify(map));
    }
    const db = new PGlite();
    try {
      await db.exec(await readFile(join(root, "lib/db/migrations/0035_r1_fact_store.sql"), "utf8"));
      // Replaced by RB-A1's committed migration as soon as its branch supplies it.
      await db.exec(`CREATE TABLE zip_place(zip text,place_id text REFERENCES entity(id),share float8,boundary_year integer,PRIMARY KEY(zip,place_id,boundary_year));
        CREATE TABLE zcta_place(zcta text,place_id text REFERENCES entity(id),share float8,boundary_year integer,PRIMARY KEY(zcta,place_id,boundary_year));`);
      await db.exec(await readFile(join(root, "lib/db/migrations/RB-A2_place_boundaries.sql"), "utf8"));
      const query: Query = async (text, params = []) => (await db.query(text, [...params])).rows as Record<string, unknown>[];
      const transaction = <T>(work: (query: Query) => Promise<T>) => db.transaction(tx => work(async (text, params = []) => (await tx.query(text, [...params])).rows as Record<string, unknown>[]));
      const held = await production("SELECT id,kind,name,state FROM entity WHERE kind='place' AND (state=$1 OR id='ocd-division/country:us')", [state]);
      await query(`INSERT INTO entity(id,kind,name,state) SELECT id,kind,name,state FROM jsonb_to_recordset($1::jsonb) AS e(id text,kind text,name text,state char(2))`, [JSON.stringify(held)]);
      await loadStatePlaceMap({ transaction }, map);
      const first = (await query("SELECT count(*)::int AS n FROM zip_place"))[0].n;
      await loadStatePlaceMap({ transaction }, map);
      const second = (await query("SELECT count(*)::int AS n FROM zip_place"))[0].n;
      if (first !== second) throw new Error("A repeated import changes the ZIP edge count");
      let worstMs = 0;
      const codes = [...new Set(map.zipEdges.map(e => e.code))];
      for (const zip of codes) {
        const start = performance.now();
        const result = await placesForCode(query, "zip", zip, { purpose: "representation", asOf: "2026-10-24" });
        worstMs = Math.max(worstMs, performance.now() - start);
        if (!result.memberships.length) throw new Error(`Imported ZIP ${zip} cannot be read`);
      }
      const remaining = (await query("SELECT count(*)::int n FROM entity WHERE id=ANY($1::text[])", [held.map(e => e.id)]))[0].n;
      if (remaining !== held.length) throw new Error("A held entity id disappeared");
      const result = { state, places: map.places.length, zips: codes.length, zipEdges: second, zctaEdges: map.zctaEdges.length,
        heldPlaceIds: held.length, heldPlaceIdsPreserved: remaining, repeatImport: first === second, worstZipMs: Math.round(worstMs * 100) / 100 };
      results.push(result); console.log(JSON.stringify(result));
    } finally { await db.close(); }
  } catch (error) {
    const result = { state, error: error instanceof Error ? error.message : String(error) };
    results.push(result); console.error(JSON.stringify(result));
    process.exitCode = 1;
  }
  await writeFile(join(output, "results.json"), JSON.stringify({ production: identity, results }, null, 2));
}
