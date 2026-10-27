import assert from "node:assert/strict";
import test, { after } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { CivicReadCache } from "../lib/db/civic-read-cache.ts";
import { shareVersionedRows } from "../lib/db/versioned-rows.ts";
import { pgAggregateRepository, pgDoorRepository, type Sql } from "../lib/control-plane/repository/pg-store.ts";

const db = new PGlite();
after(() => db.close());

async function fixture() {
  await db.exec(`DROP SCHEMA public CASCADE; CREATE SCHEMA public;
    CREATE TABLE cp_work_items(id text PRIMARY KEY,revision bigint NOT NULL,updated_at timestamptz NOT NULL,
      changed_at timestamptz NOT NULL DEFAULT now(),value jsonb NOT NULL);
    CREATE TABLE cp_work_items_archive(LIKE cp_work_items INCLUDING ALL);
    CREATE VIEW cp_work_items_history AS SELECT * FROM cp_work_items UNION ALL SELECT * FROM cp_work_items_archive;
    CREATE TABLE cp_doors(LIKE cp_work_items INCLUDING ALL);`);
  const held = new Map<string, string>();
  const queries: { text: string; params: readonly unknown[]; rows: Record<string, unknown>[] }[] = [];
  const sql: Sql = { query: async (text, params = []) => {
    const rows = (await db.query<Record<string, unknown>>(text, [...params])).rows;
    queries.push({ text, params, rows });
    return rows;
  } };
  shareVersionedRows(sql, "postgres://fixture:fixture@cr01.invalid/neondb", new CivicReadCache({
    read: async key => held.get(key) ?? null,
    write: async (key, body) => { held.set(key, body); },
  }));
  const repo = (table = "cp_work_items") => pgAggregateRepository<Record<string, unknown>>(sql, "WorkItem", table);
  const bodies = () => queries.flatMap(query => query.rows.filter(row => Object.hasOwn(row, "value") && row.__unchanged !== true));
  return { sql, queries, repo, bodies };
}

test("CAS metadata changes do not retransfer unchanged values, while metadata stays current", async () => {
  const f = await fixture(), repo = f.repo();
  const value = { id: "work", subject: "government", evidence: "saved source ".repeat(20_000) };
  await repo.put("work", value, "2026-10-25T04:00:00Z");
  const first = await repo.mustRead("work");
  f.queries.length = 0;
  await db.exec(`UPDATE cp_work_items SET revision=revision+1,updated_at='2026-10-26T04:00:00Z'`);
  const row = await repo.mustRead("work");
  assert.deepEqual(row.value, value);
  assert.equal(row.revision, first.revision + 1);
  assert.equal(row.updatedAt, "2026-10-26T04:00:00.000Z");
  assert.equal(f.bodies().length, 0);
  assert.equal((await repo.list())[0].revision, row.revision);
  assert.equal(f.bodies().length, 0, "point and list reads share the confirmed value");
  await db.exec(`UPDATE cp_work_items SET value=jsonb_set(value,'{subject}','"changed"')`);
  assert.equal((await repo.mustRead("work")).value.subject, "changed", "a changed value invalidates even without a revision bump");
  assert.equal(f.bodies().length, 1);
});

test("field reads transfer only those fields, and archive moves share their content versions", async () => {
  const f = await fixture(), repo = f.repo();
  await repo.put("work", { id: "work", state: "PENDING", evidence: "large evidence ".repeat(20_000) }, "2026-10-25T04:00:00Z");
  f.queries.length = 0;
  assert.deepEqual((await repo.listNarrowed({ state: true }))[0].value, { state: "PENDING" });
  assert.ok(f.bodies().every(row => !Object.hasOwn(row.value as object, "evidence")));
  await db.exec(`UPDATE cp_work_items SET revision=revision+1,value=jsonb_set(value,'{evidence}','"new evidence"');
    INSERT INTO cp_work_items_archive SELECT * FROM cp_work_items; DELETE FROM cp_work_items`);
  f.queries.length = 0;
  const history = f.repo("cp_work_items_history");
  assert.deepEqual((await history.listNarrowed({ state: true }))[0].value, { state: "PENDING" });
  assert.equal(f.bodies().length, 0, "unselected changes and an archive move leave the held field reusable");
  await db.exec(`UPDATE cp_work_items_archive SET value=jsonb_set(value,'{state}','"DONE"')`);
  assert.deepEqual((await history.readNarrowed("work", { state: true }))?.value, { state: "DONE" });
  assert.equal(f.bodies().length, 1);
});

test("changed-row pages retain fresh metadata, preserve every page and reuse unchanged fields", async () => {
  const f = await fixture();
  await db.exec(`INSERT INTO cp_work_items SELECT lpad(i::text,3,'0'),1,now(),now(),
    jsonb_build_object('state','PENDING','evidence',repeat('x',1000)) FROM generate_series(1,205) i`);
  const read = async () => {
    const ids: string[] = [];
    const result = await f.repo().listChangedSince!(null, [], { projection: { state: true }, page: rows => { ids.push(...rows.map(row => row.id)); } });
    assert.equal(result.rows.length, 0);
    return ids;
  };
  const expected = await read();
  assert.equal(expected.length, 205);
  const texts = f.queries.filter(query => query.text.startsWith("SELECT id,revision,updated_at") && !query.text.includes(" AS value,"));
  assert.equal(new Set(texts.map(query => query.text)).size, 1, "all pages use identical SQL text");
  await db.exec("UPDATE cp_work_items SET revision=revision+1,updated_at=now(),changed_at=now()");
  f.queries.length = 0;
  assert.deepEqual(await read(), expected);
  assert.equal(f.bodies().length, 0);
  await db.exec("DELETE FROM cp_work_items WHERE id='100'");
  assert.equal((await read()).length, 204, "current membership removes a deleted row");
});

test("meeting installation selects meeting doors without transferring voting source bodies", async () => {
  const f = await fixture();
  await db.exec(`INSERT INTO cp_doors VALUES ('meeting',1,now(),now(),'{"meeting":{"family":null}}'),
    ('voting',1,now(),now(),jsonb_build_object('meeting',null,'savedPage',repeat('x',1000000)))`);
  const rows = await pgDoorRepository(f.sql).meetingRecords!();
  assert.deepEqual(rows.map(row => row.id), ["meeting"]);
  assert.ok(f.bodies().every(row => row.id !== "voting"));
});

test("large exact-id reads keep every request bounded and reuse a confirmed selection", async () => {
  const f = await fixture();
  await db.exec(`INSERT INTO cp_work_items SELECT lpad(i::text,3,'0'),1,now(),now(),
    jsonb_build_object('state','PENDING') FROM generate_series(1,231) i`);
  const ids = Array.from({ length: 231 }, (_, i) => String(231-i).padStart(3, "0"));
  const rows = await f.repo().readMany!(ids);
  assert.deepEqual(rows.map(row => row.id), [...ids].reverse());
  assert.ok(f.queries.every(query => query.params.every(param => !Array.isArray(param) || param.length <= 100)),
    "the original whole id set is never resent with each page or value batch");
  f.queries.length = 0;
  assert.deepEqual(await f.repo().readMany!(ids), rows);
  assert.equal(f.queries.length, 3, "one scalar membership confirmation per bounded id batch");
  assert.equal(f.bodies().length, 0);
});

test("held revisions stay local and suppress values before a changed-row fetch", async () => {
  const f = await fixture();
  await db.exec(`INSERT INTO cp_work_items SELECT lpad(i::text,3,'0'),1,now(),now(),
    jsonb_build_object('state','PENDING') FROM generate_series(1,231) i`);
  const held = Array.from({ length: 231 }, (_, i) => [String(i+1).padStart(3, "0"), 1] as const);
  assert.deepEqual((await f.repo().listChangedSince!(null, held)).rows, []);
  assert.equal(f.bodies().length, 0);
  assert.ok(f.queries.every(query => query.params.every(param => !Array.isArray(param) || param.length <= 100)));
  await db.exec("UPDATE cp_work_items SET revision=2,value=jsonb_set(value,'{state}','\"DONE\"') WHERE id='101'");
  f.queries.length = 0;
  const changed = await f.repo().listChangedSince!(null, held);
  assert.deepEqual(changed.rows.map(row => row.id), ["101"]);
  assert.equal(changed.rows[0].value.state, "DONE");
  assert.deepEqual(f.bodies().map(row => row.id), ["101"]);
});
