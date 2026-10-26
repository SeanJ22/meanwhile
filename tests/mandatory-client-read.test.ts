import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { neon, neonConfig, Client, Pool } from "../lib/db/client.ts";
import { Client as RawClient } from "@neondatabase/serverless";
import { checkedDriverRead, decodeDriverResult } from "../lib/db/checked-driver.ts";
import { versionedSelect } from "../lib/db/versioned-query.ts";
import { readsStoredRows } from "../lib/db/statement-kind.ts";

type Field = { name: string; dataTypeID: number };
const wire = (value: unknown, field: Field): unknown => value === null ? null : value instanceof Date ? value.toISOString().replace("T", " ").replace("Z", "+00")
  : value instanceof Uint8Array ? "\\x" + Buffer.from(value).toString("hex")
    : field.dataTypeID === 114 || field.dataTypeID === 3802 ? JSON.stringify(value)
      : typeof value === "boolean" ? value ? "t" : "f" : String(value);

async function fixture(t: { after(fn: () => unknown): void }) {
  const db = new PGlite();
  await db.exec("CREATE TABLE held(id text PRIMARY KEY,body text,stamp timestamptz,bytes bytea); INSERT INTO held VALUES('a','before',now(),'\\x0102')");
  const originalFetch = neonConfig.fetchFunction, originalReport = process.env.WTP_VITAL_SIGNS_REPORT;
  process.env.WTP_VITAL_SIGNS_REPORT = "1";
  const calls: { text: string; rows: readonly unknown[][] }[] = [];
  let unavailable = false;
  const execute = async (text: string, params: readonly unknown[] = []) => {
    if (unavailable) throw Error("database unavailable");
    const result = await db.query<unknown[]>(text, [...params], { rowMode: "array" });
    const rows = result.rows.map(row => row.map((value, index) => wire(value, result.fields[index])));
    calls.push({ text, rows });
    return { fields: result.fields, rows, rowCount: /^\s*(SELECT|WITH)\b/i.test(text) ? rows.length : result.affectedRows ?? null,
      command: /^\s*(\w+)/.exec(text)?.[1].toUpperCase() ?? "SELECT", rowAsArray: true };
  };
  neonConfig.fetchFunction = async (_url: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    if (!body.queries) return new Response(JSON.stringify(await execute(body.query, body.params)));
    await db.exec("BEGIN");
    try {
      const results = [];
      for (const statement of body.queries) results.push(await execute(statement.query, statement.params));
      await db.exec("COMMIT"); return new Response(JSON.stringify({ results }));
    } catch (error) { await db.exec("ROLLBACK"); throw error; }
  };
  t.after(async () => {
    neonConfig.fetchFunction = originalFetch;
    if (originalReport === undefined) delete process.env.WTP_VITAL_SIGNS_REPORT; else process.env.WTP_VITAL_SIGNS_REPORT = originalReport;
    await db.close();
  });
  return { db, calls, execute, fail() { unavailable = true; } };
}
const checkedBodyRows = (calls: { text: string; rows: readonly unknown[][] }[]) => calls.flatMap(call => call.rows)
  .filter(row => row.includes("before") || row.includes("after"));

test("the mandatory Neon transport preserves lazy templates, duplicate columns, type parsers and changed-only bodies", async t => {
  const f = await fixture(t), sql = neon("postgres://fixture:fixture@ep-mandatory-http.invalid/neondb");
  const fragment = sql`body FROM held WHERE id=${"a"}`;
  const lazy = sql`SELECT ${fragment}`;
  assert.equal(f.calls.length, 0, "constructing and composing a Neon query stays lazy");
  assert.deepEqual(await lazy, [{ body: "before" }]);
  assert.ok(f.calls[0].text.includes("db04_source_"), "every executed SELECT enters the actual database version protocol");
  f.calls.length = 0;
  assert.deepEqual(await neon("postgres://fixture:fixture@ep-mandatory-http.invalid/neondb")`SELECT ${fragment}`, [{ body: "before" }]);
  assert.equal(checkedBodyRows(f.calls).length, 0, "a new client transfers no unchanged body");
  const typed = await sql.query("SELECT body AS duplicate,stamp AS duplicate,bytes FROM held WHERE id=$1", ["a"], { arrayMode: true, fullResults: true });
  assert.deepEqual(typed.fields.map(field => field.name), ["duplicate", "duplicate", "bytes"]);
  assert.equal(typed.rows[0][0], "before"); assert.ok(typed.rows[0][1] instanceof Date); assert.deepEqual(typed.rows[0][2], Buffer.from([1, 2]));
  const parser = { getTypeParser: (oid: number) => oid === 25 ? (value: string) => value.toUpperCase() : (value: string) => value };
  assert.deepEqual(await sql.query("SELECT body FROM held WHERE id='a'", [], { types: parser }), [{ body: "BEFORE" }]);
  assert.deepEqual(await sql.query("SELECT body FROM held WHERE id='a'"), [{ body: "before" }], "held raw cells use each invocation's decoder");
  await sql.query("UPDATE held SET body='after' WHERE id='a'");
  assert.deepEqual(await lazy, [{ body: "after" }], "an unchanged application id and timestamp cannot hide an UPDATE");
  f.fail(); await assert.rejects(lazy, /database unavailable/);
});

test("mixed Neon transactions keep statement ordering, atomicity and array result options", async t => {
  const f = await fixture(t), sql = neon("postgres://fixture:fixture@ep-mandatory-batch.invalid/neondb");
  const result = await sql.transaction(tx => [
    tx`UPDATE held SET body='after' WHERE id='a' RETURNING body`,
    tx`SELECT body FROM held WHERE id='a'`,
  ], { arrayMode: true, fullResults: true });
  assert.deepEqual(result.map(row => row.rows), [[["after"]], [["after"]]]);
  assert.deepEqual(result.map(row => row.command), ["UPDATE", "SELECT"]);
  assert.equal(f.calls.length, 2);
  await assert.rejects(sql.transaction([sql`UPDATE held SET body='bad' WHERE id='a'`, sql`SELECT missing_column FROM held`]), /missing_column/);
  assert.equal((await f.db.query<{ body: string }>("SELECT body FROM held")).rows[0].body, "after");
});

test("SQL classification cannot be changed by quoted writer words and preserves control statements", () => {
  for (const text of ["(SELECT body FROM held)", "((SELECT body FROM held)) UNION ALL (SELECT body FROM held)", "SELECT 'UPDATE' AS body", 'SELECT "delete" FROM held', "/* INSERT */ WITH rows AS (SELECT * FROM held) SELECT * FROM rows",
    "WITH rows AS (SELECT * FROM held FOR UPDATE) SELECT * FROM rows", "SELECT $$DELETE$$ AS body", "SELECT * FROM held; -- DELETE\n", "SELECT pg_sleep(0), custom_stored_body()", "SELECT pg_sleep_custom_body()", "WITH selected AS (SELECT body FROM held) SELECT body AS update FROM selected", "WITH selected AS (SELECT body FROM held) SELECT body AS delete FROM selected", "SELECT body AS into FROM held", "WITH written AS (UPDATE held SET body='after' RETURNING *) SELECT * FROM written", "SELECT pg_advisory_xact_lock(1)", "SELECT pg_sleep(1)", "SELECT pg_catalog.pg_sleep(1) AS waited"]) assert.ok(readsStoredRows(text), text);
  for (const text of ["BEGIN READ ONLY", "SET LOCAL statement_timeout=1000", "UPDATE held SET body='before' RETURNING *",
    "SELECT body INTO new_held FROM held", "WITH rows AS (SELECT 1) UPDATE held SET body='before' RETURNING *"]) assert.ok(!readsStoredRows(text), text);
  assert.ok(readsStoredRows(String.raw`WITH marker AS (SELECT '\\' AS marker) SELECT body FROM held`));
  assert.throws(() => readsStoredRows("SELECT body FROM held; SELECT body FROM held"), /one SQL statement/);
  assert.throws(() => readsStoredRows("BEGIN; SELECT body FROM held; COMMIT"), /one SQL statement/);
});

test("mandatory Client and Pool reads retain callback and array modes on pinned clients", async t => {
  const f = await fixture(t);
  t.mock.method(RawClient.prototype, "connect", function(this: RawClient, callback?: (error?: Error) => void) {
    callback?.(); return Promise.resolve();
  });
  t.mock.method(RawClient.prototype, "query", function(statement: string | { text: string; values?: unknown[]; rowMode?: string; binary?: boolean; types?: {getTypeParser(oid: number): (value: never) => unknown} }, params?: unknown[], callback?: (error: unknown, result?: unknown) => void) {
    const config = typeof statement === "string" ? { text: statement } : statement;
    const done = f.execute(config.text, params ?? config.values).then(result => {
      const tuples = result.rows.map(row => row.map((value, index) => {
        const field = result.fields[index];
        const raw = config.binary && /^db04_.*_[a-f0-9]+$/.test(field.name) && field.dataTypeID === 16
          ? String.fromCharCode(value === "t" ? 1 : 0) : value;
        return raw === null ? null : (config.types?.getTypeParser(field.dataTypeID) ?? ((cell: unknown) => cell))(raw as never);
      }));
      return { ...result, rows: config.rowMode === "array" ? tuples : tuples.map(row => Object.fromEntries(result.fields.map((field, index) => [field.name, row[index]]))) };
    });
    if (callback) { void done.then(result => callback(null, result), callback); return; }
    return done;
  });
  const binaryRead: import("@neondatabase/serverless").QueryConfig & { readonly binary: true } = { text: "SELECT body FROM held", binary: true };
  const connectionString = "postgres://fixture:fixture@ep-mandatory-pool.invalid/neondb";
  const client = new Client({ connectionString });
  assert.deepEqual((await client.query("SELECT body FROM held")).rows, [{ body: "before" }]);
  f.calls.length = 0;
  assert.deepEqual((await client.query({ text: "SELECT body FROM held", rowMode: "array" })).rows, [["before"]]);
  assert.equal(checkedBodyRows(f.calls).length, 0);
  assert.deepEqual((await client.query(binaryRead)).rows, [{ body: "before" }]);
  assert.deepEqual((await client.query(binaryRead)).rows, [{ body: "before" }], "binary bool metadata confirms held cells without overwriting them with nulls");
  const upper = { getTypeParser: (_oid: number) => (value: string) => value.toUpperCase() };
  const typedClient = new Client({ connectionString, types: upper });
  assert.deepEqual((await typedClient.query("SELECT body FROM held")).rows, [{ body: "BEFORE" }], "constructor parsers apply even to held raw cells");
  client.setTypeParser(25, value => value.toUpperCase());
  assert.deepEqual((await client.query("SELECT body FROM held")).rows, [{ body: "BEFORE" }], "live per-client parser changes are honored");
  client.setTypeParser(25, value => value);
  const value = await new Promise(resolve => client.query("SELECT body FROM held", (error, result) => { assert.ifError(error); resolve(result.rows); }));
  assert.deepEqual(value, [{ body: "before" }]);
  const pool = new Pool({ connectionString });
  t.after(() => pool.end());
  const pinned = await pool.connect();
  assert.deepEqual((await pinned.query("SELECT body FROM held")).rows, [{ body: "before" }]);
  pinned.release();
  const before = f.calls.length;
  await Promise.all([client.query("BEGIN"), client.query("SELECT body FROM held"), client.query("COMMIT")]);
  assert.deepEqual(f.calls.slice(before).map(call => call.text.startsWith("WITH db04_") ? "SELECT" : call.text), ["BEGIN", "SELECT", "COMMIT"],
    "asynchronous copy lookup must preserve the physical client's original submission order");
  await f.db.exec("INSERT INTO held VALUES('b','new',now(),'\\x03')");
  const binaryMembers = { ...binaryRead, text: "SELECT body FROM held ORDER BY id" };
  assert.deepEqual((await client.query(binaryMembers)).rows, [{ body: "before" }, { body: "new" }]);
  await f.db.exec("INSERT INTO held VALUES('c','newer',now(),'\\x04')");
  assert.deepEqual((await client.query(binaryMembers)).rows, [{ body: "before" }, { body: "new" }, { body: "newer" }],
    "mixed retained/new rows decode binary retained flags rather than saving null bodies");
});


test("plain reader and raw driver codecs cannot poison each other's held rows", async t => {
  const f = await fixture(t), connection = "postgres://fixture:fixture@ep-codecs.invalid/neondb", text = "SELECT body,stamp FROM held";
  const plain = () => versionedSelect(connection)(async (sql, params) => (await f.db.query<Record<string, unknown>>(sql, [...params])).rows, text);
  const raw = async () => decodeDriverResult(await checkedDriverRead(connection, text, [], f.execute), { fullResults: false });
  const first = await plain();
  assert.ok(first[0].stamp instanceof Date);
  assert.deepEqual(await raw(), first);
  assert.deepEqual(await plain(), first);
  assert.deepEqual(await raw(), first);
});

test("locks, volatile expressions and void-returning writers execute exactly once per invocation", async t => {
  const f = await fixture(t), sql = neon("postgres://fixture:fixture@ep-single-evaluation.invalid/neondb");
  await f.db.exec(`CREATE SEQUENCE invocations;
    CREATE TABLE counter(n integer); INSERT INTO counter VALUES(0);
    CREATE FUNCTION bump() RETURNS void LANGUAGE sql AS $$ UPDATE counter SET n=n+1 $$;`);
  assert.equal((await sql`SELECT nextval('invocations') AS tick,body FROM held`)[0].tick, "1");
  assert.equal((await sql`SELECT nextval('invocations') AS tick,body FROM held`)[0].tick, "2");
  await sql`SELECT bump()`;
  await sql`SELECT bump()`;
  assert.equal((await f.db.query<{n:number}>("SELECT n FROM counter")).rows[0].n, 2);
  const [lock, row] = await sql.transaction(tx => [tx`SELECT pg_advisory_xact_lock(123)`, tx`SELECT body FROM held FOR UPDATE`]);
  assert.equal(lock.length, 1); assert.deepEqual(row, [{ body: "before" }]);
});
