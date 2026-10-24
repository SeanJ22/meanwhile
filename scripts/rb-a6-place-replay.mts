/** Real held ZIP references and production facts through RB-A2 into the hunter call; writes only to disposable Postgres. */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
import { PGlite } from "@electric-sql/pglite";
import { indexedZipDivisionEntry } from "../lib/geo/zip-division-index.ts";
import { loadRegistrationReference } from "../lib/registration/reference.ts";
import { buildStatePlaceMap } from "../lib/place-map/build.ts";
import { loadStatePlaceMap } from "../lib/place-map/load.ts";
import { placesForCode } from "../lib/place-map/read.ts";
import { placeNeeds } from "../lib/hunt/place-needs.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { defaultAdminConfig, isAdminConfig } from "../lib/control-plane/gateway/admin-config.ts";
import type { Query } from "../lib/facts/publish.ts";

function connection(flag: string, role: string) {
  const at = process.argv.indexOf(flag);
  if (at < 0) throw new Error(`Supply ${flag}`);
  const url = readFileSync(process.argv[at + 1], "utf8").trim();
  assert.equal(new URL(url).username, role);
  return neon(url);
}
const reader = connection("--reader-url-file", "readonly");
const control = connection("--control-url-file", "wtp_cp_release_readonly");
const [setting] = await control.query("SELECT value FROM cp_admin_config WHERE id='current'");
assert.ok(!setting || isAdminConfig(setting.value));
const now = new Date().toISOString();
const results = [];
for (const [state, zip] of [["AZ", "85701"], ["CA", "94553"], ["CO", "80012"], ["FL", "32601"], ["GA", "30120"],
  ["IL", "60602"], ["NH", "03301"], ["NJ", "07601"], ["TX", "77515"], ["WI", "53703"]]) {
  const entry = await indexedZipDivisionEntry(zip);
  assert.ok(entry, `${zip} has a held ZIP reference`);
  const registration = loadRegistrationReference(process.cwd(), state);
  const map = buildStatePlaceMap({ registration: registration.reference, scopes: [], legacyZips: new Map([[zip, entry]]),
    legacyZctas: new Set(), boundaries: [], checkedAt: registration.generatedAt });
  const db = new PGlite();
  try {
    // Exact columns this read uses; identity/schema constraints are separately covered by RB-A1's production-copy tests.
    await db.exec(`CREATE TABLE entity(id text PRIMARY KEY,kind text,name text,state char(2),parent_id text);
      CREATE TABLE entity_external_id(entity_id text,scheme text,value text,PRIMARY KEY(scheme,value));
      CREATE TABLE entity_place(entity_id text,place_id text,boundary_year int NOT NULL DEFAULT 0,PRIMARY KEY(entity_id,place_id,boundary_year));
      CREATE TABLE source_copy(id bigint PRIMARY KEY,final_url text);
      CREATE TABLE fact(id bigint PRIMARY KEY,entity_id text,field text,value jsonb,status text,provenance_kind text,checked_at timestamptz,source_copy_id bigint);
      CREATE TABLE blank(entity_id text,field text,stage text,reason text,next_try_at timestamptz,PRIMARY KEY(entity_id,field));
      CREATE TABLE zip_place(zip text,place_id text,share float8 NOT NULL CHECK(share>0 AND share<=1),boundary_year int,PRIMARY KEY(zip,place_id,boundary_year));
      CREATE TABLE zcta_place(zcta text,place_id text,share float8 NOT NULL CHECK(share>0 AND share<=1),boundary_year int,PRIMARY KEY(zcta,place_id,boundary_year));`);
    await db.exec(readFileSync("lib/db/migrations/RB-A2_place_boundaries.sql", "utf8"));
    const query: Query = async (text, params = []) => (await db.query<Record<string, unknown>>(text, [...params])).rows;
    const transaction = <T,>(work: (query: Query) => Promise<T>) => db.transaction(tx => work(async (text, params = []) => (await tx.query<Record<string, unknown>>(text, [...params])).rows));
    await loadStatePlaceMap({ transaction }, map);
    const selected = await placesForCode(query, "zip", zip);
    const ids = [...new Set([...selected.memberships.map(row => row.placeId), "ocd-division/country:us"])];
    const governments = (map.entityPlaces ?? []).filter(row => ids.includes(row.placeId)).map(row => row.entityId);
    const [snapshot] = await reader.query(`WITH RECURSIVE roots AS (SELECT * FROM entity WHERE id=ANY($1::text[]) AND kind='place'),
      seeds AS (SELECT id FROM roots UNION SELECT ep.entity_id FROM entity_place ep JOIN roots r ON r.id=ep.place_id
        UNION SELECT id FROM entity WHERE id=ANY($2::text[]) AND state=$3),
      family(id) AS (SELECT id FROM seeds UNION SELECT e.id FROM entity e JOIN family p ON e.parent_id=p.id JOIN entity parent ON parent.id=p.id
        WHERE e.kind<>'place' AND coalesce(e.state,'US') IN ($3,'US')
          AND (parent.kind<>'place' OR NOT EXISTS(SELECT 1 FROM entity_place ep WHERE ep.entity_id=e.id))),
      retained(id) AS (SELECT id FROM family UNION SELECT e.parent_id FROM entity e JOIN retained r ON e.id=r.id WHERE e.parent_id IS NOT NULL),
      entities AS MATERIALIZED (SELECT e.* FROM entity e JOIN retained r ON r.id=e.id WHERE coalesce(e.state,'US') IN ($3,'US')),
      facts AS MATERIALIZED (SELECT f.* FROM fact f JOIN entities e ON e.id=f.entity_id WHERE f.status IN ('live','held'))
      SELECT (SELECT coalesce(jsonb_agg(to_jsonb(e)),'[]') FROM entities e) AS entities,
        (SELECT coalesce(jsonb_agg(to_jsonb(ep)),'[]') FROM entity_place ep JOIN entities e ON e.id=ep.entity_id) AS links,
        (SELECT coalesce(jsonb_agg(to_jsonb(f)),'[]') FROM facts f) AS facts,
        (SELECT coalesce(jsonb_agg(to_jsonb(b)),'[]') FROM blank b JOIN entities e ON e.id=b.entity_id) AS blanks,
        (SELECT coalesce(jsonb_agg(jsonb_build_object('id',s.id,'final_url',s.final_url)),'[]') FROM source_copy s
          WHERE EXISTS(SELECT 1 FROM facts f WHERE f.source_copy_id=s.id)) AS sources`, [ids, governments, state]);
    await query(`INSERT INTO entity SELECT id,kind,name,state,parent_id FROM jsonb_to_recordset($1::jsonb)
      AS e(id text,kind text,name text,state char(2),parent_id text) ON CONFLICT(id) DO UPDATE SET parent_id=EXCLUDED.parent_id,name=EXCLUDED.name`, [JSON.stringify(snapshot.entities)]);
    await query(`INSERT INTO entity_place SELECT entity_id,place_id,0 FROM jsonb_to_recordset($1::jsonb) AS e(entity_id text,place_id text) ON CONFLICT DO NOTHING`, [JSON.stringify(snapshot.links)]);
    await query(`INSERT INTO source_copy SELECT id,final_url FROM jsonb_to_recordset($1::jsonb) AS s(id bigint,final_url text)`, [JSON.stringify(snapshot.sources)]);
    await query(`INSERT INTO fact SELECT id,entity_id,field,value,status,provenance_kind,checked_at,source_copy_id
      FROM jsonb_to_recordset($1::jsonb) AS f(id bigint,entity_id text,field text,value jsonb,status text,provenance_kind text,checked_at timestamptz,source_copy_id bigint)`, [JSON.stringify(snapshot.facts)]);
    await query(`INSERT INTO blank SELECT entity_id,field,stage,reason,next_try_at FROM jsonb_to_recordset($1::jsonb)
      AS b(entity_id text,field text,stage text,reason text,next_try_at timestamptz)`, [JSON.stringify(snapshot.blanks)]);
    await loadStatePlaceMap({ transaction }, map);
    const repos = createMemoryRepositories();
    await repos.adminConfig.save(null, setting?.value ?? defaultAdminConfig(now), now);
    const needs = await placeNeeds(repos, { kind: "zip", code: zip }, now, query);
    const held = new Map((snapshot.facts as {id: number; value: unknown}[]).map(row => [Number(row.id), row.value]));
    assert.ok(needs.held.length > 0, `${state} has real held facts`);
    for (const item of needs.held) for (const fact of item.facts) {
      assert.ok(held.has(fact.id)); assert.deepEqual(fact.value, held.get(fact.id));
    }
    const direct = await query(`SELECT DISTINCT f.entity_id,f.field FROM fact f WHERE f.status IN ('live','held') AND f.entity_id=ANY($1::text[])`,
      [[...new Set([...needs.held, ...needs.missing].map(row => row.entityId))]]);
    assert.equal(direct.length, needs.counts.held);
    const keys = (rows: readonly {entityId: string; field: string}[]) => rows.map(row => JSON.stringify([row.entityId,row.field])).sort();
    await loadStatePlaceMap({ transaction }, map);
    const next = await placeNeeds(repos, { kind: "zip", code: zip }, new Date(Date.parse(now) + 20 * 60_000).toISOString(), query);
    assert.deepEqual(keys(next.held), keys(needs.held)); assert.deepEqual(keys(next.missing), keys(needs.missing));
    const result = { state, zip, memberships: needs.memberships.length, productionEntities: (snapshot.entities as unknown[]).length,
      ...needs.counts, nextPass: next.counts, heldExample: needs.held.find(item => item.facts.some(fact => fact.sourceUrl)) ?? null };
    results.push(result); console.log(`${state} ${zip}: ${result.memberships} mapped places; ${result.held} held, ${result.missing} missing; repeat import and next pass agree.`);
  } finally { await db.close(); }
}
writeFileSync("docs/rb-a6/place-replay.json", JSON.stringify({ observedAt: now, productionRoles: ["readonly", "wtp_cp_release_readonly"],
  geography: "Held registration and indexed ZIP references through RB-A2", results }, null, 2) + "\n");
