/** Replay the actual referenced reader ids around a place refresh; remote reads only. */
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { neon } from "@neondatabase/serverless";
import { openMapCopy } from "./lib/rb-a2-copy.ts";
import { loadStatePlaceMap, type StatePlaceMap } from "../lib/place-map/load.ts";
import type { Query } from "../lib/facts/publish.ts";

const url = process.env.RB_A2_READER_URL;
if (!url || new URL(url).username !== "readonly") throw new Error("The specified read-only role is required");
const sql = neon(url);
const production: Query = async (text, params = []) => (await sql.transaction([sql.query(text, [...params])], { readOnly: true }))[0] as Record<string, unknown>[];
const events = await production(`SELECT 'reactions' AS source,target_id AS id,target_type AS kind FROM reactions
  UNION ALL SELECT 'speak',subject_id,subject_type FROM speak_your_mind
  UNION ALL SELECT 'demand',subject_id,subject_type FROM demand_signals
  UNION ALL SELECT 'ask',s.item#>>'{}','ASK' FROM ask_interactions a,LATERAL reader_payload_members(a.subject_ids) s`);
const ids = [...new Set(events.map(row => String(row.id)))];
const candidates = await production(`SELECT p.key,p.scope,jsonb_build_object('fecCandidateId',c.value->'fecCandidateId','name',c.value->'name','state',c.value->'state',
  'targetKeys',(SELECT jsonb_agg(t.item) FROM reader_payload_members(c.value->'targetKeys') t)) AS candidate
  FROM civic_data_promotions p,LATERAL reader_payload_members(reader_payload_node(p.payload)->'candidates') item,
    LATERAL (SELECT reader_payload_node(item.item) AS value) c
  WHERE p.record_class='FEC_FUNDING' AND c.value->>'fecCandidateId'=ANY($1::text[])`, [ids]);
const lookup = [...ids, ...candidates.flatMap(row => (row.candidate as { targetKeys: string[] }).targetKeys ?? [])];
lookup.push(...lookup.flatMap(id => /^congress:([A-Z]\d{6})$/.test(id) ? [id.slice(9), `congress-api:${id.slice(9)}`] : []));
const entities = await production(`WITH RECURSIVE held AS (
  SELECT * FROM entity WHERE id=ANY($1::text[]) OR id IN(SELECT entity_id FROM entity_external_id WHERE value=ANY($1::text[]))
  UNION SELECT parent.* FROM entity parent JOIN held child ON child.parent_id=parent.id
) SELECT DISTINCT id,kind,name,state,parent_id FROM held`, [lookup]);
const aliases = await production("SELECT entity_id,scheme,value FROM entity_external_id WHERE entity_id=ANY($1::text[])", [entities.map(row => row.id)]);
const db = await openMapCopy("national", false);
try {
  await db.query(`INSERT INTO entity(id,kind,name,state,parent_id) SELECT id,kind,name,state,parent_id FROM jsonb_to_recordset($1::jsonb)
    AS e(id text,kind text,name text,state char(2),parent_id text) ON CONFLICT DO NOTHING`, [JSON.stringify(entities)]);
  await db.query(`INSERT INTO entity_external_id(entity_id,scheme,value) SELECT entity_id,scheme,value FROM jsonb_to_recordset($1::jsonb)
    AS a(entity_id text,scheme text,value text) ON CONFLICT DO NOTHING`, [JSON.stringify(aliases)]);
  for (const key of new Set(candidates.map(row => String(row.key)))) {
    const rows = candidates.filter(row => row.key === key);
    await db.query(`INSERT INTO civic_data_promotions(key,record_class,scope,payload) VALUES($1,'FEC_FUNDING',$2,$3::jsonb)
      ON CONFLICT(key) DO UPDATE SET payload=EXCLUDED.payload`, [key, rows[0].scope, JSON.stringify({ candidates: rows.map(row => row.candidate) })]);
  }
  await db.exec("TRUNCATE reactions,speak_your_mind,demand_signals,ask_interactions");
  for (const [source, table, idColumn, kindColumn] of [["reactions", "reactions", "target_id", "target_type"], ["speak", "speak_your_mind", "subject_id", "subject_type"], ["demand", "demand_signals", "subject_id", "subject_type"]]) {
    await db.query(`INSERT INTO ${table}(${idColumn},${kindColumn}) SELECT id,kind FROM jsonb_to_recordset($1::jsonb) AS e(id text,kind text)`, [JSON.stringify(events.filter(row => row.source === source))]);
  }
  for (const event of events.filter(row => row.source === "ask")) await db.query("INSERT INTO ask_interactions(subject_ids) VALUES($1::jsonb)", [JSON.stringify([event.id])]);
  await db.query("SELECT reader_sync_ids()");
  const before = await db.query("SELECT id,reader_resolve_id(id) AS resolved FROM unnest($1::text[]) id ORDER BY id", [ids]);
  assert.ok(before.every(row => row.resolved), "Every current event id resolves before refresh");
  for (const state of ["AZ", "CO", "NH", "NJ"]) {
    const map = JSON.parse(gunzipSync(await readFile(`/tmp/rb-a2-replay/${state.toLowerCase()}-map.json.gz`)).toString("utf8")) as StatePlaceMap;
    await loadStatePlaceMap(db, map);
  }
  await db.query("SELECT reader_sync_ids()");
  const after = await db.query("SELECT id,reader_resolve_id(id) AS resolved FROM unnest($1::text[]) id ORDER BY id", [ids]);
  assert.deepEqual(after, before);
  const result = { eventReferences: events.length, distinctIds: ids.length, existingEntities: entities.length, existingAliases: aliases.length,
    sources: Object.fromEntries(["reactions", "speak", "ask", "demand"].map(source => [source, events.filter(row => row.source === source).length])),
    allIdsResolve: true, mappingsUnchangedAfterRefresh: true, databaseWrites: "local PostgreSQL copy only" };
  await writeFile("/tmp/rb-a2-replay/event-preservation.json", JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally { await db.close(); }
