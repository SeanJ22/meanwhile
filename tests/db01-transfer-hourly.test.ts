import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { neonConfig } from "@neondatabase/serverless";
import { flushDatabaseTransfer, keepRunnerTransfer, pendingRunnerDatabaseTransfer, readDailyDatabaseTransfer, readRunnerDatabaseTransfer } from "../lib/db/transfer.ts";

test("hourly job totals persist atomically, tolerate replay and recover a failed flush", async t => {
  const pg = new PGlite(), originalFetch = neonConfig.fetchFunction, originalUrl = process.env.DATABASE_URL, originalReport = process.env.WTP_VITAL_SIGNS_REPORT;
  t.after(async () => { neonConfig.fetchFunction = originalFetch; if (originalUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = originalUrl;
    if (originalReport === undefined) delete process.env.WTP_VITAL_SIGNS_REPORT; else process.env.WTP_VITAL_SIGNS_REPORT = originalReport;
    await pg.close(); });
  // The supervisor owns these fixtures; the test's read-back queries report their own bytes separately.
  process.env.WTP_VITAL_SIGNS_REPORT = "1";
  await pg.exec(`CREATE TABLE civic_data_candidates(id text PRIMARY KEY,record_class text,scope text);
    CREATE TABLE civic_data_promotions(key text PRIMARY KEY,record_class text,scope text);
    CREATE TABLE civic_data_candidate_events(candidate_id text,sequence integer);
    CREATE TABLE owner_flag(id integer,fact_id bigint,reader_family text,reader_id text,resolved text);
    CREATE TABLE database_transfer_daily(day date,database_name text,client text,requests bigint,request_bytes bigint,response_bytes bigint,reads jsonb,updated_at timestamptz DEFAULT now(),PRIMARY KEY(day,database_name,client));`);
  await pg.exec(readFileSync(new URL("../lib/db/migrations/DB-01_read_versions.sql", import.meta.url), "utf8"));
  await pg.exec(readFileSync(new URL("../lib/db/migrations/DB-03_process_transfer.sql", import.meta.url), "utf8").replaceAll("--> statement-breakpoint", ""));
  let fail = true;
  const bodies = { database_transfer_hourly: 0, database_transfer_daily: 0 };
  let versions = 0;
  process.env.DATABASE_URL = "postgresql://local:local@ep-hourly-test.us-east-2.aws.neon.tech/neondb";
  neonConfig.fetchFunction = async (_input: RequestInfo | URL, init?: RequestInit) => {
    if (fail) throw new Error("accounting unavailable");
    const request = JSON.parse(String(init?.body));
    const execute = async (sql: Pick<PGlite, "query">, statement: { query: string; params: unknown[] }) => {
      if (/^SELECT\b/.test(statement.query.trim())) {
        if (/AS etag/.test(statement.query) && !/\breads\b/.test(statement.query)) versions++;
        for (const table of Object.keys(bodies) as (keyof typeof bodies)[])
          if (statement.query.includes(`FROM ${table}`) && /\breads\b/.test(statement.query)) bodies[table]++;
      }
      const result = await sql.query<Record<string, unknown>>(statement.query, statement.params);
      return { command: statement.query.trim().split(/\s/)[0].toUpperCase(), rowCount: result.affectedRows ?? result.rows.length, rowAsArray: true,
        fields: result.fields.map(field => ({ name: field.name,dataTypeID: field.dataTypeID })),
        rows: result.rows.map(row => result.fields.map(field => row[field.name] instanceof Date ? (row[field.name] as Date).toISOString()
          : row[field.name] !== null && typeof row[field.name] === "object" ? JSON.stringify(row[field.name]) : String(row[field.name]))) };
    };
    const response = request.queries ? await pg.transaction(async tx => {
      const results = [];
      for (const statement of request.queries) results.push(await execute(tx, statement));
      return { results };
    }) : await execute(pg, request);
    return new Response(JSON.stringify(response));
  };
  const hour = new Date(Math.floor(Date.now()/3_600_000)*3_600_000).toISOString();
  const part = (bytes: number) => ({ hour,pid: 99221,startedMs: 1,requests: bytes/100,
    bytes: { reader: bytes,"control-plane": 0 },sent: { reader: { requests: bytes/100,bytes: bytes/10 },"control-plane": { requests: 0,bytes: 0 } },
    reads: { "reader\tfema\tcivic_data_payload_parts": [bytes/100,bytes/10,bytes] as const },byCaller: {},processes: ["fema#99221"] });
  keepRunnerTransfer(part(100));
  assert.equal(await flushDatabaseTransfer(), false);
  assert.equal(pendingRunnerDatabaseTransfer()[0].responseBytes, 100);
  keepRunnerTransfer(part(200)); keepRunnerTransfer(part(100)); keepRunnerTransfer(part(200));
  fail = false;
  assert.equal(await flushDatabaseTransfer(), true);
  assert.deepEqual((await pg.query("SELECT requests::int,response_bytes::int,reads FROM database_transfer_hourly")).rows,
    [{ requests: 2,response_bytes: 200,reads: { "fema\tcivic_data_payload_parts": [2,20,200] } }]);
  const view = await readRunnerDatabaseTransfer(hour);
  assert.deepEqual(view.hours, [{ hour,readerBytes: 200,controlPlaneBytes: 0 }]);
  assert.deepEqual(view.reads.filter(row => row.job === "fema"), [{ hour,database: "reader",job: "fema",table: "civic_data_payload_parts",requests: 2,requestBytes: 20,responseBytes: 200 }]);
  const initialBodies = bodies.database_transfer_hourly, initialVersions = versions;
  assert.deepEqual(await readRunnerDatabaseTransfer(hour), view);
  assert.equal(bodies.database_transfer_hourly, initialBodies, "an unchanged hour's stored read map does not cross again");
  assert.ok(versions > initialVersions, "every use still checks the database row version");
  await pg.query("UPDATE database_transfer_hourly SET response_bytes=300,reads=$1::jsonb", [JSON.stringify({ "fema\tcivic_data_payload_parts": [3,30,300] })]);
  const changed = await readRunnerDatabaseTransfer(hour);
  assert.equal(changed.reads.find(row => row.job === "fema")!.responseBytes, 300, "the next read observes an update with no application timestamp change");
  assert.equal(changed.hours[0].readerBytes, 300);
  assert.equal(bodies.database_transfer_hourly, initialBodies + 1);

  const daily = await readDailyDatabaseTransfer(1);
  assert.equal(daily.kind, "RECORDED");
  const dailyBodies = bodies.database_transfer_daily;
  assert.deepEqual(await readDailyDatabaseTransfer(1), daily);
  assert.equal(bodies.database_transfer_daily, dailyBodies, "unchanged daily maps use the same version-checked copy mechanism");
  await pg.query("UPDATE database_transfer_daily SET response_bytes=400,reads=$1::jsonb", [JSON.stringify({ "route\tfact": [4,40,400] })]);
  const changedDay = await readDailyDatabaseTransfer(1);
  assert.equal(changedDay.kind, "RECORDED");
  assert.equal(changedDay.rows.find(row => row.client === "runner")!.responseBytes, 400);
  assert.deepEqual(changedDay.rows.find(row => row.client === "runner")!.reads, { "route\tfact": [4,40,400] });
  assert.equal(bodies.database_transfer_daily, dailyBodies + 1);
});
