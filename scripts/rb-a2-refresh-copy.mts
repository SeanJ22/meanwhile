/** Measure a complete standing refresh against production reads and local writes. */
import { writeFile } from "node:fs/promises";
import { neon } from "@neondatabase/serverless";
import { prepareStatePlaceMap } from "../lib/place-map/refresh.ts";
import { loadStatePlaceMap } from "../lib/place-map/load.ts";
import { DurableEvidenceStore } from "../lib/control-plane/evidence/durable-store.ts";
import { memoryLockManager } from "../lib/control-plane/repository/memory.ts";
import { censusGeographyCandidate } from "../lib/census-geography/candidate.ts";
import { processRegisteredRoutineCandidate } from "../lib/civic-data/promotion.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { ROUTINE_SOURCE_TASKS, routineTaskDue } from "../lib/civic-data/runner.ts";
import type { Query } from "../lib/facts/publish.ts";
import { openMapCopy } from "./lib/rb-a2-copy.ts";

const state = process.argv[2];
const url = process.env.RB_A2_READER_URL;
if (!/^[A-Z]{2}$/.test(state ?? "") || !url || new URL(url).username !== "readonly") throw new Error("State and production read-only role are required");
const sql = neon(url);
const production: Query = async (text, params = []) => (await sql.transaction([sql.query(text, [...params])], { readOnly: true }))[0] as Record<string, unknown>[];
const started = Date.now(), copy = await openMapCopy(`refresh_${state.toLowerCase()}`);
try {
  const { map, dataset } = await prepareStatePlaceMap(production, process.cwd(), state, {
    cache: { store: new DurableEvidenceStore("/tmp/rb-a2-replay/sources", { remote: null }), locks: memoryLockManager() },
  });
  const owners = await production("SELECT id,kind,name,state FROM entity WHERE id=ANY($1::text[])", [map.entityPlaces?.map(row => row.entityId) ?? []]);
  await copy.query(`INSERT INTO entity(id,kind,name,state) SELECT id,kind,name,state FROM jsonb_to_recordset($1::jsonb) AS e(id text,kind text,name text,state char(2)) ON CONFLICT DO NOTHING`, [JSON.stringify(owners)]);
  await loadStatePlaceMap(copy, map);
  const store = new MemoryRoutineDataStore(), id = `place-map-${state.toLowerCase()}`;
  const candidate = censusGeographyCandidate(dataset, `US-${state}:place-map`);
  const published = await processRegisteredRoutineCandidate(store, id, candidate, dataset.builtAt);
  if (!published.promoted) throw new Error(`Refresh publication ${published.candidate.state}`);
  const task = ROUTINE_SOURCE_TASKS.find(task => task.id === id)!;
  const clock = { lastAttemptedAt: dataset.builtAt, lastSucceededAt: dataset.builtAt, lastSucceededObservedAt: dataset.builtAt, lastSucceededParserVersion: task.parserVersion };
  const due = Date.parse(dataset.builtAt) + task.cadenceMs;
  if (routineTaskDue(task, clock, due - 1) || !routineTaskDue(task, clock, due)) throw new Error("Next refresh is not due on schedule");
  const peakRssBytes = process.resourceUsage().maxRSS * 1024;
  const [before] = await copy.query("SELECT count(*)::int n FROM zip_place");
  await loadStatePlaceMap(copy, map);
  const [after] = await copy.query("SELECT count(*)::int n FROM zip_place");
  if (before.n !== after.n) throw new Error("The next import changes the membership count");
  const nextDate = new Date(due).toISOString();
  const next = censusGeographyCandidate({ ...dataset, builtAt: nextDate }, `US-${state}:place-map`);
  const repeated = await processRegisteredRoutineCandidate(store, id, next, nextDate);
  if (!repeated.promoted) throw new Error(`Next refresh publication ${repeated.candidate.state}`);
  const proof = { state, elapsedMs: Date.now() - started, peakRssBytes: process.resourceUsage().maxRSS * 1024,
    firstRunPeakRssBytes: peakRssBytes, nextPublication: repeated.candidate.state, nextImportPreserved: true,
    places: map.places.length, zipEdges: map.zipEdges.length, zctaEdges: map.zctaEdges.length,
    publication: published.candidate.state, nextDueAt: new Date(due).toISOString(), nextRunDue: true,
    databaseWrites: "local PostgreSQL copy only" };
  await writeFile(`/tmp/rb-a2-replay/${state.toLowerCase()}-refresh.json`, JSON.stringify(proof, null, 2));
  console.log(JSON.stringify(proof));
} finally { await copy.close(); }
