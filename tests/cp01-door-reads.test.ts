import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { CivicReadCache } from "../lib/db/civic-read-cache.ts";
import { shareVersionedRows } from "../lib/db/versioned-rows.ts";
import { CONTROL_COUNTS_DDL } from "../lib/control-plane/repository/control-counts.ts";
import { pgDoorRepository, type Sql } from "../lib/control-plane/repository/pg-store.ts";
import { applyManualEdit, editableFieldsOf, seedDerivedDoors, type DoorDraft } from "../lib/doors/registry.ts";
import { DOOR_READS_DDL } from "../lib/doors/read-changes.ts";
import { readDoorImport, seedAllDoors } from "../lib/doors/seed-all.ts";
import { retireCensusDuplicates } from "../lib/doors/platform-census.ts";

const AT = "2026-10-28T12:00:00.000Z";
const LATER = "2026-10-28T13:00:00.000Z";
const draft = (id: string): DoorDraft => ({ doorId: id, kind: "ical", ocdId: "ocd-division/country:us/state:az", bodyIds: [id],
  hosts: ["example.gov"], config: { icalUrl: `https://example.gov/${id}.ics` }, holds: ["meetings"], notes: id,
  meeting: { agendaSourceType: "ICAL", jurisdiction: "Example", publishingOrg: "Example", timeZone: "America/Phoenix", verifiedAt: AT, family: null } });

async function fixture() {
  const db = new PGlite();
  await db.exec(`CREATE TABLE cp_doors(id text PRIMARY KEY,revision bigint NOT NULL,updated_at timestamptz NOT NULL,
    changed_at timestamptz NOT NULL DEFAULT now(),value jsonb NOT NULL)`);
  for (const ddl of CONTROL_COUNTS_DDL) await db.exec(ddl);
  await db.exec(`INSERT INTO cp_control_counts(table_name,bucket,n) VALUES('cp_doors','*',0);
    CREATE TRIGGER a_cp_control_counts AFTER INSERT OR UPDATE OR DELETE ON cp_doors FOR EACH ROW EXECUTE FUNCTION cp_touch_control_counts()`);
  for (const ddl of DOOR_READS_DDL) await db.exec(ddl);
  const copies = new Map<string, string>();
  const cache = new CivicReadCache({ read: async key => copies.get(key) ?? null, write: async (key, value) => { copies.set(key, value); } });
  const queries: { text: string; params: readonly unknown[]; rows: unknown[] }[] = [];
  let bytes = 0;
  const freshRepo = () => {
    const sql: Sql = { query: async (text, params = []) => {
      const rows = (await db.query(text, [...params])).rows;
      bytes += Buffer.byteLength(JSON.stringify({ text, params })) + Buffer.byteLength(JSON.stringify(rows));
      queries.push({ text, params, rows });
      return rows;
    } };
    shareVersionedRows(sql, "postgres://test:test@cp01-door.invalid/db", cache);
    return pgDoorRepository(sql);
  };
  return { db, freshRepo, queries, bytes: () => bytes, reset: () => { bytes = 0; queries.length = 0; } };
}

test("door sync compares fingerprints in batches and preserves manual edits and operational fields", async () => {
  const f = await fixture();
  try {
    const repo = f.freshRepo(), drafts = Array.from({ length: 205 }, (_, index) => draft(`door-${index}`));
    assert.equal((await seedDerivedDoors(repo, drafts, AT, AT)).created, 205);
    await f.db.exec(`UPDATE cp_doors SET value=value||'{"validators":{"contentHash":"hash"},"readNow":true,"status":"SHUT","shutSince":"2026-10-28T12:30:00.000Z","transportFailures":3,"shutReason":"timeout"}'::jsonb WHERE id='door-0'`);
    const first = await repo.mustRead("door-1");
    await repo.compareAndSet(first.id, first.revision, applyManualEdit(first.value,
      { ...editableFieldsOf(first.value), notes: "kept by hand" }, LATER), LATER);
    f.reset();
    const unchanged = await seedDerivedDoors(f.freshRepo(), drafts, AT, LATER);
    assert.deepEqual(unchanged, { created: 0, updated: 0, unchanged: 204, keptManualEdit: 1, refused: [] });
    assert.ok(f.queries.every(query => !/SELECT[\s\S]*\bvalue\s+FROM cp_doors/i.test(query.text)), "sync never downloads stored records");
    assert.ok(f.queries.length <= 6, "one counter and one changed-pointer query per 100 proposed doors");
    assert.ok(!f.queries.some(query => query.text.includes("WITH incoming")), "unchanged source fingerprints never resend the drafts");
    assert.ok(f.bytes() < 100_000, `${f.bytes()} bytes for 205 proposed doors`);
    const changed = await seedDerivedDoors(repo, [{ ...drafts[0], notes: "a new note" }], LATER, LATER);
    assert.equal(changed.updated, 1);
    const door = (await repo.mustRead("door-0")).value;
    assert.equal(door.notes, "a new note");
    assert.equal(door.status, "SHUT");
    assert.equal(door.readNow, true);
    assert.equal(door.transportFailures, 3);
    assert.equal(door.validators?.contentHash, "hash");
    assert.equal(door.shutReason, "timeout");
    assert.equal((await repo.mustRead("door-1")).value.notes, "kept by hand");
  } finally { await f.db.close(); }
});

test("door installation crosses process boundaries with a generation cursor and no full-record or membership fallback", async () => {
  const f = await fixture();
  try {
    const repo = f.freshRepo();
    await seedDerivedDoors(repo, Array.from({ length: 205 }, (_, index) => draft(`door-${index}`)), AT, AT);
    await f.db.exec(`UPDATE cp_doors SET value=value||jsonb_build_object('savedPage',repeat('x',100000))`);
    const first = await repo.meetingRecords!();
    assert.equal(first.length, 205);
    assert.ok(first.every(row => !("savedPage" in row.value)), "installation transfers only its fields");
    f.reset();
    assert.equal((await f.freshRepo().meetingRecords!()).length, 205);
    assert.equal(f.queries.length, 1);
    assert.ok(f.bytes() < 1000, `${f.bytes()} bytes for unchanged install`);
    await f.db.exec(`UPDATE cp_doors SET revision=revision+1,value=jsonb_set(value,'{config,icalUrl}','"https://example.gov/new.ics"') WHERE id='door-120';
      DELETE FROM cp_doors WHERE id='door-3'`);
    f.reset();
    const next = await f.freshRepo().meetingRecords!();
    assert.equal(next.length, 204);
    assert.ok(!next.some(row => row.id === "door-3"));
    assert.equal(next.find(row => row.id === "door-120")?.value.config.icalUrl, "https://example.gov/new.ics");
    assert.ok(f.bytes() < 10_000, `${f.bytes()} bytes for edit and deletion`);
    assert.ok(f.queries.filter(query => query.text.includes("currentRecords") || query.text.includes("FROM cp_door_changes")).every(query => query.text.includes("c.generation,c.id")));
    await f.db.exec(`UPDATE cp_doors SET revision=revision+1,value=jsonb_set(value,'{lastSuccessAt}','"2026-10-28T13:10:00.000Z"') WHERE id='door-120'`);
    f.reset();
    assert.equal((await f.freshRepo().meetingRecords!()).length, 204);
    assert.ok(!f.queries.some(query => query.text.includes(" AS value,")), "operational changes do not download adapter fields again");
  } finally { await f.db.close(); }
});

test("explicit JSON projections preserve absent fields, JSON nulls and nested field selections", async () => {
  const f = await fixture();
  try {
    await seedDerivedDoors(f.freshRepo(), [draft("door")], AT, AT);
    await f.db.exec(`UPDATE cp_doors SET value=value||'{"present":null,"nested":{"kept":null,"other":"large"},"scalar":"text"}'`);
    const [row] = await f.freshRepo().currentRecords!({ present: true, absent: true, nested: ["kept", "missing"], scalar: ["kept"] });
    assert.deepEqual(row.value, { present: null, nested: { kept: null }, scalar: "text" });
    assert.ok(f.queries.every(query => !query.text.includes("jsonb_each")));
  } finally { await f.db.close(); }
});

test("duplicate retirement examines changed pointers in the store and retains other boards and operational fields", async () => {
  const f = await fixture();
  try {
    const repo = f.freshRepo();
    const held = { ...draft("hand"), kind: "legistar", bodyIds: ["body"], config: { slug: "tenant", bodyName: "Parks & Recreation" } };
    const duplicate = { ...held, doorId: "census", bodyIds: ["renamed-body"], config: { ...held.config, bodyName: "Parks and Recreation", crosswalkRowId: "census-source" } };
    const other = { ...duplicate, doorId: "other-board", bodyIds: ["other-body"], config: { ...duplicate.config, bodyName: "Planning" } };
    await seedDerivedDoors(repo, [held, duplicate, other], AT, AT);
    await f.db.exec(`UPDATE cp_doors SET value=value||'{"lastSuccessAt":"2026-10-28T12:30:00.000Z","readNow":true}'::jsonb WHERE id='census'`);
    f.reset();
    assert.deepEqual(await retireCensusDuplicates(repo, LATER), ["census"]);
    assert.ok(f.queries.every(query => !query.rows.some(row => Object.hasOwn(row as object, "value"))), "only changed result IDs cross the connection");
    const retired = (await repo.mustRead("census")).value;
    assert.equal(retired.status, "SUSPENDED");
    assert.equal(retired.readNow, false);
    assert.equal(retired.lastSuccessAt, "2026-10-28T12:30:00.000Z");
    assert.equal((await repo.mustRead("other-board")).value.status, "OPEN");
    assert.deepEqual(await retireCensusDuplicates(f.freshRepo(), LATER), []);
    await seedDerivedDoors(repo, [{ ...held, doorId: "new-hand", bodyIds: ["other-body"], config: { ...held.config, bodyName: "Planning" } }], AT, AT);
    assert.deepEqual(await retireCensusDuplicates(f.freshRepo(), LATER), ["other-board"], "a newly added hand-wired door retires its existing census duplicate");
  } finally { await f.db.close(); }
});

test("the held door import uses the batched database path and the next sync writes no unchanged door", async t => {
  const f = await fixture();
  try {
    const imported = readDoorImport();
    const first = await seedAllDoors({ repo: f.freshRepo(), imported, derived: [], now: AT });
    assert.deepEqual([first.imported.refused, first.feeds.refused, first.routeHints.refused], [[], [], []]);
    assert.ok(first.total > 100);
    f.reset();
    const next = await seedAllDoors({ repo: f.freshRepo(), imported, derived: [], now: LATER });
    assert.deepEqual([next.imported.created, next.imported.updated, next.feeds.created, next.feeds.updated, next.routeHints.created, next.routeHints.updated], [0, 0, 0, 0, 0, 0]);
    assert.equal(next.total, first.total);
    assert.ok(f.bytes() < 1_000_000, `${f.bytes()} bytes for an unchanged held door sync`);
    t.diagnostic(`${first.total} imported doors: ${f.bytes()} request+response bytes on the second sync`);
    f.reset();
    await seedAllDoors({ repo: f.freshRepo(), imported, derived: [], now: LATER });
    assert.ok(f.bytes() < 20_000, `${f.bytes()} bytes for stable unchanged sync`);
    t.diagnostic(`${f.bytes()} request+response bytes on the stable unchanged sync`);
  } finally { await f.db.close(); }
});
