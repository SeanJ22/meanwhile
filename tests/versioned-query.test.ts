import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { CivicReadCache } from "../lib/db/civic-read-cache.ts";
import { isVersionedSelectStatement, versionedSelect } from "../lib/db/versioned-query.ts";
import { legistarMemberClocks } from "../lib/sources/legistar/members-tasks.ts";

test("the dispatched member clock query keeps its source column and checks unchanged row versions", async () => {
  const pg = new PGlite(), held = new Map<string, string>();
  const cache = new CivicReadCache({read:async key=>held.get(key)??null,write:async(key,value)=>{held.set(key,value);}});
  const read = versionedSelect("member-clock-source-column",cache);
  const batches:Record<string,unknown>[][]=[];
  const query=async(text:string,params:readonly unknown[]=[])=>{
    const rows=(await pg.query<Record<string,unknown>>(text,[...params])).rows;
    batches.push(rows);return rows;
  };
  const tasks=["legistar-members:alpha","legistar-members:beta"];
  const clockRead=()=>legistarMemberClocks((text,params)=>read(query,text,params),tasks);
  try{
    await pg.exec(`CREATE TABLE fact_store_load(source text PRIMARY KEY,loaded_at timestamptz);
      CREATE TABLE pass_cursor(name text PRIMARY KEY,position text);
      INSERT INTO fact_store_load VALUES ('legistar-members:alpha','2026-10-26T00:10:00Z'),
        ('legistar-members:beta','2026-10-26T00:12:00Z'),('legistar-members:outside','2026-10-26T00:15:00Z');
      INSERT INTO pass_cursor VALUES ('source-attempt:legistar-members:beta','{"at":"2026-10-26T01:00:00.000Z"}');`);
    const expected=await legistarMemberClocks(query,tasks);
    batches.length=0;
    assert.deepEqual(await clockRead(),expected,"the actual scheduled clock query survives a text column named source");
    assert.equal(batches.length,1);
    assert.deepEqual(batches[0].map(row=>row.source).sort(),tasks);
    batches.length=0;
    assert.deepEqual(await clockRead(),expected);
    assert.equal(batches.length,1,"an unchanged clock still checks the current PostgreSQL result");
    assert.ok(batches[0].every(row=>row.source===null&&row.loaded_at===null&&row.position===null),
      "unchanged typed clock fields are suppressed by PostgreSQL");
    await pg.exec("UPDATE fact_store_load SET loaded_at='2026-10-26T02:00:00Z' WHERE source='legistar-members:alpha'");
    batches.length=0;
    const changed=await clockRead();
    assert.equal(changed.get(tasks[0])?.lastSucceededObservedAt,"2026-10-26T02:00:00.000Z");
    assert.deepEqual(changed.get(tasks[1]),expected.get(tasks[1]),"the independent retry clock stays intact");
    assert.deepEqual(batches[0].filter(row=>row.source!==null).map(row=>row.source),[tasks[0]],
      "only the changed source clock crosses the database connection");
  }finally{await pg.close();}
});

test("projected SQL reads transfer only changed rows and retain ordering, removals and driver types", async () => {
  const pg = new PGlite();
  const held = new Map<string, string>();
  const cache = () => new CivicReadCache({ read: async key => held.get(key) ?? null,
    write: async (key, value) => { held.set(key, value); } });
  const statements: { text: string; rows: Record<string, unknown>[] }[] = [];
  const query = async (text: string, params: readonly unknown[] = []) => {
    const rows = (await pg.query<Record<string, unknown>>(text, [...params])).rows;
    statements.push({ text, rows });
    return rows;
  };
  const text = `WITH selected AS (SELECT * FROM selected_rows WHERE state=$1)
    SELECT id, body, observed_at, bytes FROM selected ORDER BY id DESC;`;
  const read = () => versionedSelect("fixture", cache())(query, text, ["AZ"]);
  const bodyRows = () => statements.flatMap(statement => statement.rows.filter(row =>
    Object.entries(row).some(([key, value]) => key.startsWith("db04_retained_") && value === false)));
  try {
    await pg.exec(`CREATE TABLE selected_rows(id text PRIMARY KEY,state text,body jsonb,observed_at timestamptz,bytes bytea);
      INSERT INTO selected_rows VALUES ('b','AZ','{"name":"Before"}','2026-10-26T00:00:00Z','\\x010203'),
        ('a','AZ','{"name":"Other"}','2026-10-25T00:00:00Z','\\x04'),
        ('outside','NM','{}','2026-10-25T00:00:00Z','\\x');`);
    const expected = await query(text, ["AZ"]);
    statements.length = 0;
    assert.deepEqual(await read(), expected);
    assert.equal(statements.length, 1, "cold reads check versions and send changed bodies in one statement");
    assert.equal(bodyRows().length, 2);
    statements.length = 0;
    assert.deepEqual(await read(), expected, "a fresh cache instance preserves Dates and binary fields");
    assert.equal(bodyRows().length, 0, "unchanged bodies do not cross again");
    assert.ok(statements[0].rows.every(row => row.id === null && row.body === null && row.observed_at === null && row.bytes === null), "the database suppresses unchanged typed body fields");
    assert.equal(statements.length, 1, "the next read still checks current database versions");
    await pg.exec(`UPDATE selected_rows SET body='{"name":"Changed"}' WHERE id='b'`);
    statements.length = 0;
    assert.deepEqual(await read(), await query(text, ["AZ"]));
    assert.equal(bodyRows().length, 1, "only the changed projected row crosses");
    await pg.exec(`DELETE FROM selected_rows WHERE id='a';
      INSERT INTO selected_rows VALUES ('z','AZ','{"name":"New"}','2026-10-26T00:00:00Z','\\x05')`);
    statements.length = 0;
    assert.deepEqual(await read(), await query(text, ["AZ"]), "fresh membership and order preserve the SQL result");
    assert.equal(bodyRows().length, 1, "reordering does not transfer an unchanged row again");
    await pg.exec("DELETE FROM selected_rows WHERE state='AZ'");
    assert.deepEqual(await read(), []);
    statements.length = 0;
    const duplicates = "SELECT 7 AS value UNION ALL SELECT 7 AS value";
    assert.deepEqual(await versionedSelect("fixture", cache())(query, duplicates), [{ value: 7 }, { value: 7 }]);
    assert.equal(bodyRows().length, 1, "identical result rows share one transferred body");
    statements.length = 0;
    assert.deepEqual(await versionedSelect("fixture", cache())(query, "SELECT $1::integer AS value", [7]), [{ value: 7 }]);
    assert.equal(bodyRows().length, 1, "a new query first obtains its typed result");
    await pg.exec("CREATE TABLE typed_value(value integer); INSERT INTO typed_value VALUES(7)");
    const typed = "SELECT value FROM typed_value";
    await versionedSelect("fixture", cache())(query, typed);
    await pg.exec("ALTER TABLE typed_value ALTER COLUMN value TYPE bigint");
    statements.length = 0;
    assert.deepEqual(await versionedSelect("fixture", cache())(query, typed), [{ value: 7 }]);
    assert.equal(bodyRows().length, 1, "a stored field-type change invalidates the same query even when JSON is identical");
    statements.length = 0;
    const window = "SELECT 7 AS value WHERE $1::timestamptz IS NOT NULL";
    await versionedSelect("fixture", cache())(query, window, ["2026-10-26T00:00:00Z"]);
    statements.length = 0;
    assert.deepEqual(await versionedSelect("fixture", cache())(query, window, ["2026-10-26T01:00:00Z"]), [{ value: 7 }]);
    assert.equal(bodyRows().length, 0, "the next time window checks current versions without redownloading unchanged bodies");
  } finally { await pg.close(); }
});

test("a failed fresh version query never returns a held SQL result", async () => {
  const pg = new PGlite();
  const held = new Map<string, string>();
  const cache = new CivicReadCache({ read: async key => held.get(key) ?? null,
    write: async (key, value) => { held.set(key, value); } });
  const read = versionedSelect("fixture", cache);
  try {
    await read(async (text, params) => (await pg.query<Record<string, unknown>>(text, [...params])).rows, "SELECT 1 AS value");
    await assert.rejects(read(async () => { throw Error("Database unavailable"); }, "SELECT 1 AS value"), /Database unavailable/);
    await assert.rejects(read(async () => [{ value: 2 }], "SELECT 1 AS value"), /no database row version/,
      "a missing version can never turn into a permanent unchanged cache key");
  } finally { await pg.close(); }
});

test("checked SQL text is fixed across parameters, cache contents and overlapping executions", async () => {
  const pg = new PGlite();
  const cache = new CivicReadCache({ read: async () => null, write: async () => {} });
  const read = versionedSelect("fixed-sql", cache);
  const text = "SELECT $1::integer AS value";
  const statements: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let arrived!: () => void;
  const started = new Promise<void>(resolve => { arrived = resolve; });
  try {
    const first = await read(async (sql, params) => {
      statements.push(sql);
      return (await pg.query<Record<string, unknown>>(sql, [...params])).rows;
    }, text, [1]);
    assert.deepEqual(first, [{ value: 1 }]);
    const waiting = read(async (sql, params) => {
      statements.push(sql); arrived(); await gate;
      return (await pg.query<Record<string, unknown>>(sql, [...params])).rows;
    }, text, [2]);
    await started;
    await read(async (sql, params) => {
      statements.push(sql);
      return (await pg.query<Record<string, unknown>>(sql, [...params])).rows;
    }, text, [3]);
    assert.equal(new Set(statements).size, 1);
    assert.equal(isVersionedSelectStatement(statements[0]), true, "finishing one call leaves the identical pending call registered");
    release();
    assert.deepEqual(await waiting, [{ value: 2 }]);
    assert.equal(isVersionedSelectStatement(statements[0]), false);
  } finally { release?.(); await pg.close(); }
});

test("a checked writer CTE runs once per call, including unchanged results, and stays inside its transaction", async () => {
  const pg = new PGlite();
  const held = new Map<string, string>();
  const cache = new CivicReadCache({ read: async key => held.get(key) ?? null,
    write: async (key, value) => { held.set(key, value); } });
  const read = versionedSelect("writer-fixture", cache);
  let statements = 0;
  const query = async (text: string, params: readonly unknown[]) => {
    statements++;
    return (await pg.query<Record<string, unknown>>(text, [...params])).rows;
  };
  const text = `WITH changed AS (UPDATE mutation_counter SET hits=hits+1 WHERE id=$1 RETURNING id)
    SELECT id AS update FROM changed; -- the write and result share this statement`;
  try {
    await pg.exec("CREATE TABLE mutation_counter(id integer PRIMARY KEY,hits integer); INSERT INTO mutation_counter VALUES(1,0)");
    assert.deepEqual(await read(query, text, [1]), [{ update: 1 }]);
    assert.deepEqual(await read(query, text, [1]), [{ update: 1 }]);
    assert.equal(statements, 2, "a writer runs exactly once even when its projected result is unchanged");
    assert.deepEqual((await pg.query("SELECT hits FROM mutation_counter")).rows, [{ hits: 2 }]);
    await pg.exec("BEGIN");
    assert.deepEqual(await read(query, text, [1]), [{ update: 1 }]);
    await pg.exec("ROLLBACK");
    assert.deepEqual((await pg.query("SELECT hits FROM mutation_counter")).rows, [{ hits: 2 }], "the wrapper does not move a write outside its caller's transaction");
    const grouped = `((WITH changed AS (UPDATE mutation_counter SET hits=hits+1 WHERE id=$1 RETURNING id)
      SELECT id FROM changed)); -- enclosing parentheses`;
    const original = (await pg.query<Record<string, unknown>>(grouped, [1])).rows;
    assert.deepEqual(await read(query, grouped, [1]), original);
    assert.deepEqual((await pg.query("SELECT hits FROM mutation_counter")).rows, [{ hits: 4 }], "a parenthesized writer CTE retains the original single execution");
  } finally { await pg.close(); }
});

test("checked SQL preserves quoted delimiters, trailing comments, parentheses and recursive CTEs", async () => {
  const pg = new PGlite();
  const cache = new CivicReadCache({ read: async () => null, write: async () => {} });
  const read = versionedSelect("syntax-fixture", cache);
  const query = async (text: string, params: readonly unknown[]) =>
    (await pg.query<Record<string, unknown>>(text, [...params])).rows;
  try {
    for (const text of [
      "SELECT ';' AS value; -- trailing comment",
      "SELECT $$literal; /* not a comment */$$ AS value; /* trailing */",
      "((SELECT 7 AS value)); -- parenthesized read",
      "VALUES (7), (8); -- value rows",
      "WITH RECURSIVE numbers(value) AS (VALUES(1) UNION ALL SELECT value+1 FROM numbers WHERE value<3) SELECT value FROM numbers ORDER BY value; -- recursive read",
    ]) assert.deepEqual(await read(query, text), (await pg.query(text)).rows, text);
  } finally { await pg.close(); }
});

test("a selected column named source does not shadow the checked row", async () => {
  // Production: the routine task clock read selects a `source` column, and row_to_json(source) resolved to that text.
  const pg = new PGlite();
  const held = new Map<string, string>();
  const cache = new CivicReadCache({ read: async key => held.get(key) ?? null, write: async (key, value) => { held.set(key, value); } });
  const query = async (text: string, params: readonly unknown[] = []) => (await pg.query<Record<string, unknown>>(text, [...params])).rows;
  try {
    await pg.exec(`CREATE TABLE clocks(task text PRIMARY KEY, source text, due timestamptz);
      INSERT INTO clocks VALUES ('a','legiscan','2026-10-26T00:00:00Z'),('b','census','2026-10-27T00:00:00Z');`);
    const text = "SELECT task, source, due FROM clocks ORDER BY task";
    assert.deepEqual(await versionedSelect("fixture", cache)(query, text), await query(text));
  } finally { await pg.close(); }
});
