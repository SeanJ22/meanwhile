/** Read production; import and measure only in a local Postgres copy. */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { gzipSync, gunzipSync } from "node:zlib";
import { neon } from "@neondatabase/serverless";
import { DurableEvidenceStore } from "../lib/control-plane/evidence/durable-store.ts";
import { memoryLockManager } from "../lib/control-plane/repository/memory.ts";
import { prepareStatePlaceMap, readLegacyStateMemberships } from "../lib/place-map/refresh.ts";
import { loadStatePlaceMap, type StatePlaceMap } from "../lib/place-map/load.ts";
import { placesForCode } from "../lib/place-map/read.ts";
import type { Query } from "../lib/facts/publish.ts";
import { FIPS_TO_STATE } from "../lib/ocd/fips.ts";
import { openMapCopy } from "./lib/rb-a2-copy.ts";
import { ocdStateCode } from "../lib/ocd/state-of.ts";

const root = process.cwd(), output = process.env.RB_A2_OUTPUT ?? "/tmp/rb-a2-replay";
const url = process.env.RB_A2_READER_URL;
if (!url || new URL(url).username !== "readonly") throw new Error("The specified production read-only role is required");
const sql = neon(url);
const production: Query = async (text, params = []) => (await sql.transaction([sql.query(text, [...params])], { readOnly: true }))[0] as Record<string, unknown>[];
const [identity] = await production("SELECT current_user AS role,current_setting('transaction_read_only') AS read_only,has_table_privilege(current_user,'entity','SELECT') AS can_select,has_table_privilege(current_user,'entity','INSERT') AS can_insert");
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
    const path = join(output, `${state.toLowerCase()}-map.json.gz`);
    let map: StatePlaceMap;
    if (process.env.RB_A2_REUSE === "1") map = JSON.parse(gunzipSync(await readFile(path)).toString("utf8"));
    else {
      ({ map } = await prepareStatePlaceMap(production, root, state, { cache, fetchImpl: async (url, init) => {
        console.log(`${state} source ${String(url)}`);
        return fetch(url, init);
      } }));
      await writeFile(path, gzipSync(JSON.stringify(map)));
    }
    const sourcePeakMiB = Math.round(process.resourceUsage().maxRSS / 1024);
    const db = await openMapCopy(`replay_${state.toLowerCase()}`);
    try {
      const { query, transaction } = db;
      const held = await production("SELECT id,kind,name,state FROM entity WHERE kind='place' AND (state=$1 OR id='ocd-division/country:us')", [state]);
      await query(`INSERT INTO entity(id,kind,name,state) SELECT id,kind,name,state FROM jsonb_to_recordset($1::jsonb) AS e(id text,kind text,name text,state char(2))`, [JSON.stringify(held)]);
      const governments = await production("SELECT id,kind,name,state FROM entity WHERE id=ANY($1::text[])", [map.entityPlaces?.map(p => p.entityId) ?? []]);
      await query(`INSERT INTO entity(id,kind,name,state) SELECT id,kind,name,state FROM jsonb_to_recordset($1::jsonb) AS e(id text,kind text,name text,state char(2)) ON CONFLICT DO NOTHING`, [JSON.stringify(governments)]);
      await loadStatePlaceMap({ transaction }, map);
      const first = (await query("SELECT count(*)::int AS n FROM zip_place"))[0].n;
      await loadStatePlaceMap({ transaction }, map);
      const second = (await query("SELECT count(*)::int AS n FROM zip_place"))[0].n;
      if (first !== second) throw new Error("A repeated import changes the ZIP edge count");
      let worstMs = 0;
      const codes = [...new Set(map.zipEdges.map(e => e.code))];
      const baseline = await readLegacyStateMemberships(root, state);
      const missing: { zip: string; id: string }[] = [];
      for (const zip of codes) {
        const start = performance.now();
        const result = await placesForCode(query, "zip", zip, { purpose: "representation", asOf: "2026-10-24" });
        worstMs = Math.max(worstMs, performance.now() - start);
        if (!result.memberships.length) throw new Error(`Imported ZIP ${zip} cannot be read`);
        const ids = new Set(result.memberships.map(m => m.placeId));
        for (const id of baseline.get(zip)?.ids ?? []) if ((!ocdStateCode(id) || ocdStateCode(id)?.toUpperCase() === state) && !ids.has(id)) missing.push({ zip, id });
      }
      for (const zip of baseline.keys()) if (!codes.includes(zip)) missing.push({ zip, id: 'entire ZIP' });
      if (missing.length) throw new Error(`Legacy memberships missing: ${JSON.stringify(missing.slice(0, 8))} (${missing.length} total)`);
      const layers = new Map(map.boundaries.map(b => [b.placeId, b.layer]));
      const districtLayers = new Set(['cd', 'sldu', 'sldl', 'district', 'unsd', 'elsd', 'scsd']);
      const gains = new Set(map.zipEdges.filter(e => districtLayers.has(layers.get(e.placeId) ?? '') &&
        !baseline.get(e.code)?.ids.includes(e.placeId)).map(e => `${e.code}|${e.placeId}`));
      const remaining = (await query("SELECT count(*)::int n FROM entity WHERE id=ANY($1::text[])", [held.map(e => e.id)]))[0].n;
      if (remaining !== held.length) throw new Error("A held entity id disappeared");
      const result = { state, places: map.places.length, zips: codes.length, zipEdges: second, zctaEdges: map.zctaEdges.length,
        heldPlaceIds: held.length, heldPlaceIdsPreserved: remaining, missingLegacyMemberships: missing.length,
        gainedDistrictRelationships: gains.size, governmentConnections: governments.length, sourcePeakMiB,
        repeatImport: first === second, worstZipMs: Math.round(worstMs * 100) / 100 };
      results.push(result); console.log(JSON.stringify(result));
      await writeFile(join(output, `${state.toLowerCase()}-result.json`), JSON.stringify({ production: identity, ...result }, null, 2));
    } finally { await db.close(); }
  } catch (error) {
    const result = { state, error: error instanceof Error ? error.message : String(error) };
    results.push(result); console.error(JSON.stringify(result));
    process.exitCode = 1;
  }
  await writeFile(join(output, "results.json"), JSON.stringify({ production: identity, results }, null, 2));
}
