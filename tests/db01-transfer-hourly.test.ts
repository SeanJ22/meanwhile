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
  let totalBodies = 0;
  let versions = 0;
  process.env.DATABASE_URL = "postgresql://local:local@ep-hourly-test.us-east-2.aws.neon.tech/neondb";
  neonConfig.fetchFunction = async (_input: RequestInfo | URL, init?: RequestInit) => {
    if (fail) throw new Error("accounting unavailable");
    const request = JSON.parse(String(init?.body));
    const execute = async (sql: Pick<PGlite, "query">, statement: { query: string; params: unknown[] }) => {
      if (/^SELECT\b/.test(statement.query.trim())) {
        if (/AS etag/.test(statement.query) && !/\breads\b/.test(statement.query)) versions++;
        if (/\bresponse_bytes\b/.test(statement.query) && !/\breads\b/.test(statement.query)) totalBodies++;
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
  const initialBodies = bodies.database_transfer_hourly, initialVersions = versions, initialTotalBodies = totalBodies;
  assert.deepEqual(await readRunnerDatabaseTransfer(hour), view);
  assert.equal(bodies.database_transfer_hourly, initialBodies, "an unchanged hour's stored read map does not cross again");
  assert.equal(totalBodies, initialTotalBodies, "unchanged hour totals also require only fresh versions");
  assert.ok(versions > initialVersions, "every use still checks the database row version");
  await pg.query("UPDATE database_transfer_hourly SET response_bytes=300,reads=$1::jsonb", [JSON.stringify({ "fema\tcivic_data_payload_parts": [3,30,300] })]);
  const changed = await readRunnerDatabaseTransfer(hour);
  assert.equal(changed.reads.find(row => row.job === "fema")!.responseBytes, 300, "the next read observes an update with no application timestamp change");
  assert.equal(changed.hours[0].readerBytes, 300);
  assert.equal(totalBodies, initialTotalBodies + 1, "the changed total has its own projection copy");
  assert.equal(bodies.database_transfer_hourly, initialBodies + 1);

  const daily = await readDailyDatabaseTransfer(1);
  assert.equal(daily.kind, "RECORDED");
  const today = daily.rows[0]!.day;
  assert.deepEqual(daily.rows, [{ day: today, database: "reader", client: "runner", requests: 2, requestBytes: 20, responseBytes: 300, reads: {} }],
    "the runner's day is rebuilt from its hours");
  await pg.query("INSERT INTO database_transfer_daily VALUES($1,'reader','reader',1,10,50,$2::jsonb)", [today, JSON.stringify({ "route\tfact": [1,10,50] })]);
  const split = await readDailyDatabaseTransfer(1);
  assert.deepEqual(split.rows.map(row => [row.client, row.responseBytes]), [["reader", 50], ["runner", 250]],
    "the hour holds reader functions' bytes too, so the day still totals 300");
  const dailyBodies = bodies.database_transfer_daily;
  assert.deepEqual(await readDailyDatabaseTransfer(1), split);
  assert.equal(bodies.database_transfer_daily, dailyBodies, "unchanged daily maps use the same version-checked copy mechanism");
  await pg.query("UPDATE database_transfer_daily SET response_bytes=60,reads=$1::jsonb", [JSON.stringify({ "route\tfact": [2,20,60] })]);
  const changedDay = await readDailyDatabaseTransfer(1);
  assert.equal(changedDay.kind, "RECORDED");
  assert.deepEqual(changedDay.rows.find(row => row.client === "reader")!.reads, { "route\tfact": [2,20,60] });
  assert.equal(bodies.database_transfer_daily, dailyBodies + 1);
  await pg.query("INSERT INTO database_transfer_daily VALUES($1,'reader','runner',9,90,900,'{}'::jsonb)", [today]);
  assert.equal((await readDailyDatabaseTransfer(1)).rows.find(row => row.client === "runner")!.responseBytes, 900,
    "a runner day saved before every hour was kept stands where it holds more");
  await pg.query("UPDATE database_transfer_daily SET response_bytes=100 WHERE client='runner'");
  assert.equal((await readDailyDatabaseTransfer(1)).rows.find(row => row.client === "runner")!.responseBytes, 240,
    "a runner row that stopped saving mid-day yields to its hours");
});

test("an hour lands every flush while its day's write times out, and the retried day counts once", async t => {
  const pg = new PGlite(), originalFetch = neonConfig.fetchFunction, originalUrl = process.env.DATABASE_URL, warn = console.warn;
  const warnings: string[] = [];
  console.warn = (line: string) => { warnings.push(line); };
  // A real stalled request holds its socket open; the stand-in holds the loop open the same way.
  const held = setInterval(() => {}, 1_000);
  t.after(async () => { clearInterval(held); neonConfig.fetchFunction = originalFetch; console.warn = warn;
    if (originalUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = originalUrl; await pg.close(); });
  await pg.exec(`CREATE TABLE database_transfer_daily(day date,database_name text,client text,requests bigint,request_bytes bigint,response_bytes bigint,
      reads jsonb DEFAULT '{}',updated_at timestamptz DEFAULT now(),PRIMARY KEY(day,database_name,client));
    CREATE TABLE database_transfer_hourly(hour timestamptz,database_name text,requests bigint,request_bytes bigint,response_bytes bigint,
      reads jsonb DEFAULT '{}',PRIMARY KEY(hour,database_name));`);
  await pg.exec(readFileSync(new URL("../lib/db/migrations/DB-03_process_transfer.sql", import.meta.url), "utf8").replaceAll("--> statement-breakpoint", ""));
  process.env.DATABASE_URL = "postgresql://local:local@ep-hour-apart-test.us-east-2.aws.neon.tech/neondb";
  let slowDay = true;
  neonConfig.fetchFunction = async (_input: RequestInfo | URL, init?: RequestInit) => {
    const { queries } = JSON.parse(String(init?.body)) as { queries: { query: string; params: unknown[] }[] };
    if (slowDay && queries.some(statement => statement.query.includes("INTO database_transfer_daily")))
      await new Promise((_resolve, reject) => init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason)));
    await pg.transaction(async tx => { for (const statement of queries) await tx.query(statement.query, statement.params); });
    return new Response(JSON.stringify({ results: queries.map(() => ({ command: "INSERT", rowCount: 1, rowAsArray: true, fields: [], rows: [] })) }));
  };
  const hour = "2026-10-28T18:00:00.000Z";
  const part = (pid: number, bytes: number, client: "reader" | "runner") => ({ hour, pid, startedMs: 1, client, requests: bytes / 100,
    bytes: { reader: bytes, "control-plane": 0 }, sent: { reader: { requests: bytes / 100, bytes: bytes / 10 }, "control-plane": { requests: 0, bytes: 0 } },
    reads: { [`reader\t${client === "reader" ? "index" : "door-probes"}\tcp_doors`]: [bytes / 100, bytes / 10, bytes] as const }, byCaller: {}, processes: [] });
  const hourly = async () => (await pg.query<{ requests: number; response_bytes: number; reads: unknown }>(
    "SELECT requests::int,response_bytes::int,reads FROM database_transfer_hourly")).rows;
  const daily = async () => (await pg.query<{ client: string; response_bytes: number }>("SELECT client,response_bytes::int FROM database_transfer_daily")).rows;

  keepRunnerTransfer(part(4101, 1000, "runner"));
  keepRunnerTransfer(part(9, 200, "reader"));
  assert.equal(await flushDatabaseTransfer(), false, "the timed-out day is reported as unsaved");
  assert.deepEqual(await hourly(), [{ requests: 12, response_bytes: 1200,
    reads: { "door-probes\tcp_doors": [10, 100, 1000], "index\tcp_doors": [2, 20, 200] } }], "the breaker's hour landed anyway");
  assert.deepEqual(await daily(), []);
  assert.deepEqual(warnings, ["DATABASE_TRANSFER database_transfer_daily could not be saved (NeonDbError TimeoutError); its counts are kept for the next flush."]);

  keepRunnerTransfer(part(4101, 1500, "runner"));
  keepRunnerTransfer(part(9, 200, "reader"));
  assert.equal(await flushDatabaseTransfer(), false);
  assert.equal((await hourly())[0]!.response_bytes, 1700, "each flush lands the hour's new bytes, once");
  assert.equal(warnings.length, 1, "repeated failures warn once per ten minutes");

  slowDay = false;
  keepRunnerTransfer(part(9, 300, "reader"));
  assert.equal(await flushDatabaseTransfer(), true);
  assert.deepEqual(await daily(), [{ client: "reader", response_bytes: 300 }], "only reader functions keep a day row, counted once across retries");
  assert.equal((await hourly())[0]!.response_bytes, 1800);
  keepRunnerTransfer(part(9, 300, "reader"));
  keepRunnerTransfer(part(4101, 1500, "runner"));
  assert.equal(await flushDatabaseTransfer(), true);
  assert.equal((await hourly())[0]!.response_bytes, 1800, "a replayed report adds nothing");
  assert.deepEqual(await daily(), [{ client: "reader", response_bytes: 300 }]);
});
