import assert from "node:assert/strict";
import test, { after } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { pgAggregateRepository, type Sql } from "../lib/control-plane/repository/pg-store.ts";
import { projectAggregate } from "../lib/control-plane/repository/types.ts";

// Execute PostgreSQL instead of teaching a fake parser each reader's SQL shape.
const db = new PGlite();
after(() => db.close());
const at = "2026-09-17T00:00:00.000Z";
const seq = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `row-${String(i).padStart(6, "0")}`, seq: i,
  routeTaskId: i % 3 === 0 ? "wanted" : "other", dropped: "saved source ".repeat(100), nested: { kept: 1, gone: 2 } }));

async function fixture(n: number, table = "cp_work_items") {
  await db.exec(`DROP SCHEMA public CASCADE; CREATE SCHEMA public;
    CREATE TABLE ${table}(id text PRIMARY KEY,revision bigint NOT NULL,updated_at timestamptz NOT NULL,
      changed_at timestamptz NOT NULL DEFAULT now(),value jsonb NOT NULL)`);
  const values = seq(n);
  await db.query(`INSERT INTO ${table} SELECT v->>'id',1,$1::timestamptz,now(),v
    FROM jsonb_array_elements($2::jsonb) v`, [at, JSON.stringify(values)]);
  const calls: { text: string; params: readonly unknown[]; rows: Record<string, unknown>[] }[] = [];
  const sql: Sql = { query: async (text, params = []) => {
    if (!/LIMIT\s+100/.test(text) && !text.includes(" AS etag")) {
      assert.ok(text.includes("id=ANY("), `unbounded aggregate read: ${text}`);
      assert.ok(Array.isArray(params.at(-1)) && (params.at(-1) as unknown[]).length <= 100);
    }
    const rows = (await db.query<Record<string, unknown>>(text, [...params])).rows;
    if (text.includes(" AS etag")) assert.equal(rows.length, 1, "a whole-selection confirmation returns one scalar version");
    calls.push({ text, params, rows });
    return rows;
  } };
  const repo = pgAggregateRepository<(typeof values)[number]>(sql, "Aggregate", table);
  const bodies = () => calls.flatMap(call => call.rows.filter(row => Object.hasOwn(row, "value")));
  return { repo, values, calls, bodies, table };
}

for (const table of ["cp_work_items", "cp_attempts"]) {
  test(`${table}: list pages every value in order and fetches only changed values on another pass`, async () => {
    const f = await fixture(230, table);
    const first = await f.repo.list();
    assert.deepEqual(first.map(row => row.value), f.values);
    assert.equal(f.calls.length, table === "cp_work_items" ? 7 : 6);
    f.calls.length = 0;
    assert.deepEqual(await f.repo.list(), first);
    assert.equal(f.calls.length, table === "cp_work_items" ? 1 : 3);
    assert.equal(f.bodies().length, 0);
    await db.query(`UPDATE ${table} SET revision=2,value=jsonb_set(value,'{seq}','-150') WHERE id=$1`, [f.values[150].id]);
    f.calls.length = 0;
    const changed = await f.repo.list();
    assert.equal(changed[150].value.seq, -150);
    assert.equal(changed[150].revision, 2);
    assert.deepEqual(f.bodies().map(row => row.id), [f.values[150].id]);
  });

  test(`${table}: empty and exact-page reads terminate on a bounded empty version page`, async () => {
    const empty = await fixture(0, table);
    assert.deepEqual(await empty.repo.list(), []);
    assert.equal(empty.calls.length, 1);
    const exact = await fixture(100, table);
    assert.equal((await exact.repo.list()).length, 100);
    assert.equal(exact.calls.length, table === "cp_work_items" ? 4 : 3);
    assert.ok(exact.calls.some(call => call.text.includes("LIMIT 100") && call.rows.length === 0));
  });

  test(`${table}: listNarrowed transfers only projected fields across all pages`, async () => {
    const f = await fixture(201, table);
    const projection = { seq: true, nested: ["kept"] } as const;
    const rows = await f.repo.listNarrowed(projection);
    assert.deepEqual(rows.map(row => row.id), f.values.map(row => row.id));
    assert.deepEqual(rows.map(row => row.value), f.values.map(value => projectAggregate(value, projection)));
    assert.ok(f.bodies().every(row => !Object.hasOwn(row.value as object, "dropped")));
    assert.deepEqual((await f.repo.listNarrowed({})).map(row => row.value), f.values.map(() => ({})));
  });

  test(`${table}: filtered field reads preserve database membership and omit unselected sources`, async () => {
    const f = await fixture(307, table);
    const expected = (await f.repo.list()).filter(row => row.value.routeTaskId === "wanted");
    assert.ok(expected.length > 100);
    assert.deepEqual(await f.repo.listWhere(["routeTaskId"], "wanted"), expected);
    f.calls.length = 0;
    const rows = await f.repo.listWhereNarrowed(["routeTaskId"], "wanted", { seq: true });
    assert.deepEqual(rows.map(row => row.value), expected.map(row => ({ seq: row.value.seq })));
    assert.ok(f.bodies().every(row => !Object.hasOwn(row.value as object, "dropped")));
    assert.ok(f.calls.every(call => !call.text.includes("wanted") && call.params.includes("wanted")));
    const scans = f.calls.filter(call => call.text.includes("LIMIT 100"));
    assert.equal(scans.length, 2);
    if (table === "cp_work_items") assert.equal(new Set(scans.map(call => call.text)).size, 1);
  });
}

test("selective filters read only their matches and unsafe paths never reach the database", async () => {
  const f = await fixture(400);
  const rows = await f.repo.listWhere(["seq"], "391");
  assert.deepEqual(rows.map(row => row.value.seq), [391]);
  assert.equal(f.calls.length, 3);
  assert.deepEqual(f.bodies().map(row => row.id), [f.values[391].id]);
  f.calls.length = 0;
  await assert.rejects(f.repo.listWhere(["bad'path"], "anything"), /unsafe JSON path/);
  assert.equal(f.calls.length, 0);
});
