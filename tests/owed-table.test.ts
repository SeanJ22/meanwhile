import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { factDb } from "./helpers/fact-db.ts";
import { DEFAULT_OWED_TABLE, OWED_TABLE_SETTING, owedTable, owedTableValid, type OwedTable } from "../lib/coverage/owed-table.ts";
import { readPlaceNeeds, readStateOwedCounts } from "../lib/coverage/owed-read.ts";
import { placeNeeds } from "../lib/hunt/place-needs.ts";
import { ADMIN_SECTIONS_EXPAND_DDL, pgAdminConfigRepository } from "../lib/control-plane/repository/admin-config.ts";
import { pgAggregateRepository } from "../lib/control-plane/repository/pg-store.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { defaultAdminConfig, type AdminConfig } from "../lib/control-plane/gateway/admin-config.ts";
import { lookupAction } from "../lib/control-plane/gateway/registry.ts";
import { withSetting, type SettingValue } from "../lib/control-plane/settings.ts";
import { US_STATES } from "../lib/control-plane/readiness/catalog.ts";
import { readFileSync } from "node:fs";
import { publishClaim } from "../lib/facts/publish.ts";
import { factClocks } from "../lib/facts/clocks.ts";

const now = "2026-10-24T12:00:00.000Z";
const table: OwedTable = { base: [
  { kind: "body", field: "name", label: "Name", clock: "officeholder", checklist: ["GOV-02"] },
  { kind: "body", field: "office_phone", label: "Office phone", clock: "contact", checklist: [] },
], states: { AZ: [{ kind: "body", field: "agenda_url", label: "Agenda", clock: "agenda", checklist: ["DOC-01"] }] } };
const config = (after: OwedTable = table) => withSetting(defaultAdminConfig(now), { id: "setup", key: OWED_TABLE_SETTING, after: after as unknown as SettingValue, at: now, why: "" });

test("the editable seed has valid checklist references, kind/field identities and state additions", () => {
  assert.ok(owedTableValid(DEFAULT_OWED_TABLE));
  assert.ok(owedTableValid(table));
  assert.equal(owedTableValid({ ...table, states: { ZZ: table.states.AZ } }), false);
  assert.equal(owedTableValid({ ...table, base: [...table.base, table.base[0]] }), false);
  assert.equal(owedTableValid({ ...table, states: { AZ: [table.base[0]] } }), false);
  assert.equal(owedTableValid({ ...table, base: [{ ...table.base[0], clock: "invented" }] }), false);
  assert.equal(owedTableValid({ ...table, base: [{ ...table.base[0], checklist: ["BAD-99"] }] }), false);
});

test("Admin's actual setting action stores the old table in SQL history and undo restores it", async () => {
  const pg = new PGlite();
  try {
    await pg.exec("CREATE TABLE cp_admin_config (id text PRIMARY KEY,revision bigint NOT NULL,updated_at timestamptz NOT NULL,value jsonb NOT NULL,changed_at timestamptz DEFAULT now())");
    for (const ddl of ADMIN_SECTIONS_EXPAND_DDL) await pg.exec(ddl);
    const query = async (text: string, params: readonly unknown[] = []) => (await pg.query<Record<string, unknown>>(text, [...params])).rows;
    const repos = { ...createMemoryRepositories(),
      adminConfig: pgAdminConfigRepository(pgAggregateRepository<AdminConfig>({ query }, "AdminConfig", "cp_admin_config"), query) };
    const action = lookupAction("config.setSetting")!;
    const deps = { repos, now: () => now, currentStateVersion: null, codeSha: null };
    const execute = async (id: string, input: Record<string, unknown>) => {
      const validated = action.validate(input);
      assert.ok(validated.ok);
      const result = await action.execute(deps, { at: now, receiptId: id, request: {} as never }, validated.value);
      assert.ok(result.ok, JSON.stringify(result));
    };
    await execute("edit", { key: OWED_TABLE_SETTING, value: table, why: "Add state requirements" });
    const [row] = await query("SELECT value FROM cp_admin_setting_history WHERE id='edit'");
    const change = row.value as { before: OwedTable; after: OwedTable };
    assert.deepEqual(change.before, DEFAULT_OWED_TABLE);
    assert.deepEqual(change.after, table);
    await execute("undo", { key: OWED_TABLE_SETTING, value: change.before, undoOf: "edit" });
    assert.deepEqual(owedTable((await repos.adminConfig.mustRead("current")).value), DEFAULT_OWED_TABLE);
    assert.equal((await query("SELECT count(*)::int AS n FROM cp_admin_setting_history"))[0].n, 2);
  } finally { await pg.close(); }
});

test("every state's totals match direct SQL and a hunter read preserves duplicates, sources, blanks and the state boundary", async () => {
  const db = await factDb();
  try {
    for (const state of US_STATES) {
      const s = state.code.toUpperCase();
      await db.query("INSERT INTO entity(id,kind,name,state) VALUES ($1,'place',$1,$2),($3,'body',$3,$2)", [`place:${s}`, s, `body:${s}`]);
      await db.query("INSERT INTO entity_place VALUES ($1,$2)", [`body:${s}`, `place:${s}`]);
      await db.query(`INSERT INTO fact(entity_id,field,value,value_text,status,provenance_kind,quote,checked_at,produced_by)
        VALUES($1,'name','"Verified board"','Verified board','live','OWNER','',$2,'test'),
          ($1,'name','"Old alternative"','Old alternative','held','OWNER','',$2,'test')`, [`body:${s}`, now]);
      await db.query("INSERT INTO blank(entity_id,field,stage,reason,next_try_at) VALUES($1,'office_phone','ACQUIRE','NOT_FOUND',$2)", [`body:${s}`, now]);
    }
    await db.query("INSERT INTO entity_place VALUES ('body:CA','place:AZ')");
    await db.query("INSERT INTO entity(id,kind,name,state,parent_id) VALUES ('meeting:AZ','meeting','Meeting','AZ','body:AZ')");
    await db.query("INSERT INTO entity(id,kind,name,state,parent_id) VALUES ('other-place:AZ','place','Another place','AZ','place:AZ'),('other-body:AZ','body','Another board','AZ','other-place:AZ')");
    const all = await readStateOwedCounts(db.query, config(), now);
    const direct = await db.query(`WITH expected AS (SELECT e.id,e.state,x.field FROM entity e CROSS JOIN LATERAL
        (SELECT 'name' AS field UNION ALL SELECT 'office_phone' UNION ALL SELECT 'agenda_url' WHERE e.state='AZ') x WHERE e.kind='body'),
      held AS (SELECT DISTINCT entity_id,field FROM fact WHERE status IN ('live','held'))
      SELECT e.state,count(*)::int AS owed,count(h.entity_id)::int AS held,(count(*)-count(h.entity_id))::int AS missing
      FROM expected e LEFT JOIN held h ON h.entity_id=e.id AND h.field=e.field GROUP BY e.state`);
    for (const row of direct) {
      const got = all.find(state => state.state === row.state)!;
      assert.equal(got.owed, row.owed, String(row.state)); assert.equal(got.held, row.held, String(row.state)); assert.equal(got.missing, row.missing, String(row.state));
      assert.equal(got.owed, got.held + got.missing); assert.equal(got.stuck, 1);
      const scoped = await readStateOwedCounts(db.query, config(), now, String(row.state));
      assert.deepEqual(scoped, [got], `State-selected reading: ${row.state}`);
    }
    assert.equal(all.length, US_STATES.length + 1);
    assert.equal(all.find(row => row.state === "US")?.owed, 0);
    const needs = await readPlaceNeeds(db.query, config(), "place:AZ", now);
    assert.equal(needs.counts.owed, 3);
    assert.deepEqual(needs.missing.map(item => item.field), ["agenda_url", "office_phone"]);
    assert.equal(needs.held[0].facts.length, 2);
    assert.equal(needs.missing.find(item => item.field === "office_phone")?.blank?.reason, "NOT_FOUND");
    assert.ok([...needs.missing, ...needs.held].every(item => item.entityId === "body:AZ"));
    await assert.rejects(readPlaceNeeds(db.query, config(), "unknown-place", now), /no coverage/);
  } finally { await db.pg.close(); }
});

test("the hunter entry point uses RB-A2's selected ZIP places without adding another town in the county", async () => {
  const db = await factDb();
  try {
    await db.pg.exec(`CREATE TABLE zip_place(zip text,place_id text REFERENCES entity(id),share float8,boundary_year integer,PRIMARY KEY(zip,place_id,boundary_year));
      CREATE TABLE zcta_place(zcta text,place_id text REFERENCES entity(id),share float8,boundary_year integer,PRIMARY KEY(zcta,place_id,boundary_year));`);
    await db.pg.exec(readFileSync("lib/db/migrations/RB-A2_place_boundaries.sql", "utf8"));
    await db.query("INSERT INTO entity(id,kind,name,state) VALUES ('county','place','County','AZ'),('town','place','Town','AZ'),('elsewhere','place','Another town','AZ')");
    await db.query("UPDATE entity SET parent_id='county' WHERE id IN ('town','elsewhere')");
    await db.query("INSERT INTO entity(id,kind,name,state,parent_id) VALUES ('county-board','body','County board','AZ','county'),('town-board','body','Town board','AZ','town'),('other-board','body','Other board','AZ','elsewhere')");
    await db.query(`INSERT INTO place_boundary(place_id,boundary_year,layer,version,checked_at)
      VALUES ('county',2023,'county','county:2023',$1),('town',2023,'place','place:2023',$1)`, [now]);
    await db.query("INSERT INTO zip_place(zip,place_id,boundary_year) VALUES ('85701','county',2023),('85701','town',2023)");
    const repos = createMemoryRepositories();
    await repos.adminConfig.save(null, config(), now);
    const needs = await placeNeeds(repos, { kind: "zip", code: "85701" }, now, db.query);
    assert.deepEqual(needs.memberships.map(row => row.placeId), ["county", "town"]);
    assert.deepEqual([...new Set(needs.missing.map(row => row.entityId))], ["county-board", "town-board"]);
    await assert.rejects(placeNeeds(repos, { kind: "zcta", code: "85701" }, now, db.query), /no coverage/);
  } finally { await db.pg.close(); }
});

test("the next scheduled pass reads edited settings and undo again, and staleness uses fact clocks without losing held values", async () => {
  const db = await factDb();
  try {
    await db.query("INSERT INTO entity(id,kind,name,state) VALUES ('place:AZ','place','Place','AZ'),('body:AZ','body','Board','AZ')");
    await db.query("INSERT INTO entity_place VALUES ('body:AZ','place:AZ')");
    await db.query(`INSERT INTO source_copy(url,final_url,fetched_at,sha256,blob_key) VALUES('https://example.gov/board','https://example.gov/board',$1,repeat('a',64),'copy')`, [now]);
    await db.query(`INSERT INTO fact(entity_id,field,value,value_text,status,provenance_kind,source_copy_id,quote,checked_at,produced_by)
      VALUES('body:AZ','name','"Board"','Board','live','OFFICIAL',1,'Board',$1,'test')`, [now]);
    const repos = createMemoryRepositories();
    await repos.adminConfig.save(null, config(), now);
    const first = await placeNeeds(repos, "place:AZ", now, db.query);
    assert.equal(first.held[0].facts[0].sourceUrl, "https://example.gov/board");
    const held = await repos.adminConfig.mustRead("current", { settingHistory: true });
    const faster = withSetting(held.value, { id: "clocks", key: "facts.freshnessHours", at: now, why: "", after: {
      officeholder: 1, contact: 720, comment_rule: 720, meeting: 168, agenda: 168, outcome: 720, vote: 8760,
      money: 2160, statement: 87600, portrait: 8760, ballot: 720, law: 8760, news: 87600, same_person_link: 87600,
    } });
    const more = { ...table, states: { AZ: [...table.states.AZ, { ...table.base[0], field: "office_address", label: "Office address" }] } };
    const edited = withSetting(faster, { id: "table-edit", key: OWED_TABLE_SETTING, at: now, why: "", after: more as unknown as SettingValue });
    const saved = await repos.adminConfig.save(held, edited, now);
    const next = await placeNeeds(repos, "place:AZ", "2026-10-24T13:00:00.001Z", db.query);
    assert.equal(next.counts.owed, first.counts.owed + 1);
    assert.equal(next.counts.stale, 1);
    assert.equal(next.held[0].facts[0].stale, true);
    assert.ok(!next.missing.some(item => item.field === "name"));
    await repos.adminConfig.save(saved, withSetting(saved.value, { id: "undo-table", key: OWED_TABLE_SETTING, at: now, why: "Undo", undoOf: "table-edit", after: table as unknown as SettingValue }), now);
    const afterUndo = await placeNeeds(repos, "place:AZ", "2026-10-24T13:20:00.000Z", db.query);
    assert.equal(afterUndo.counts.owed, first.counts.owed);
  } finally { await db.pg.close(); }
});

test("a verified fact publishes while other owed fields remain missing", async () => {
  const db = await factDb();
  try {
    await db.query("INSERT INTO entity(id,kind,name,state,parent_id) VALUES ('county','place','County','AZ',NULL),('board','body','Arizona Board','AZ','county')");
    await db.query("INSERT INTO source_copy(url,final_url,fetched_at,sha256,blob_key) VALUES('https://example.gov/board','https://example.gov/board',$1,repeat('a',64),'publication-copy')", [now]);
    const before = await readPlaceNeeds(db.query, config(), "county", now);
    assert.ok(before.missing.length > 1);
    const result = await publishClaim(db, { entity: { id: "board", fullName: "Arizona Board", stateName: "Arizona", hosts: ["example.gov"], externalIds: [] },
      field: "name", fieldKind: "officeholder", provenance: "OFFICIAL", value: "Arizona Board", valueText: "Arizona Board", quote: "Arizona Board",
      copy: { id: 1, finalUrl: "https://example.gov/board", text: "Arizona Board", fetchedAt: new Date(now), isArchive: false }, producedBy: "test", costUsd: 0 },
    factClocks(config()), new Date(now), { purge: async () => ({ purged: true }) });
    assert.ok("decision" in result && result.decision === "PUBLISH");
    assert.equal((await db.query("SELECT count(*)::int AS n FROM fact WHERE status='live'"))[0].n, 1);
    assert.equal((await readPlaceNeeds(db.query, config(), "county", now)).missing.length, before.missing.length - 1);
  } finally { await db.pg.close(); }
});
