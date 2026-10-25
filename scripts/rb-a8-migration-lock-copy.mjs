import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import pg from "pg";
import { lockFirstStatement } from "./apply-migrations.mts";
import { hourlyCountMigrationSql } from "./control-plane-migrations.mts";
import { installHourlyCounts } from "../lib/control-plane/repository/migrations/RB-A8.ts";

// A disposable local database only. Ambient production URLs are never read.
const port = Number(process.argv[2] ?? 55438);
assert.ok(Number.isInteger(port) && port > 1024 && port < 65536);
const options = { host: "127.0.0.1", port, user: "rb_a8_copy", database: "postgres" };
const database = `rb_a8_lock_copy_${process.pid}`;
const admin = new pg.Client(options);
await admin.connect();
await admin.query(`CREATE DATABASE ${database}`);
const clients = [];
const connect = async name => {
  const client = new pg.Client({ ...options, database, application_name: name });
  await client.connect(); clients.push(client); return client;
};
const statements = readFileSync("lib/db/migrations/RB-A8_count_hour.sql", "utf8")
  .split("--> statement-breakpoint").map(text => text.trim()).filter(Boolean);
const quote = text => `'${text.replaceAll("'", "''")}'`;
const setup = `
  DROP SCHEMA public CASCADE; CREATE SCHEMA public;
  CREATE TABLE entity(id text PRIMARY KEY,state text,kind text,label text);
  CREATE TABLE fact(id text PRIMARY KEY,entity_id text REFERENCES entity(id),field text,status text,value jsonb);
  CREATE TABLE civic_data_promotions(scope text,record_class text,current_version_id text);
  CREATE TABLE count_hour(state char(2),hour timestamptz,step text,n bigint NOT NULL DEFAULT 0 CHECK(n>=0),PRIMARY KEY(state,hour,step));
  INSERT INTO entity VALUES('az:body','AZ','body','Original');
  INSERT INTO fact VALUES('az:fact','az:body','name','live','"Original"');
  INSERT INTO civic_data_promotions VALUES('state:az','meetings','original');`;
const waitUntil = async (check, why) => {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out: ${why}`);
};
const proofs = [];
try {
  const observer = await connect("rb-a8-observer");
  for (const shape of ["original migration", "blocking multi-table LOCK"]) {
    await observer.query(setup);
    const writer = await connect(`rb-a8-old-writer-${proofs.length}`);
    const migration = await connect(`rb-a8-old-migration-${proofs.length}`);
    await writer.query("BEGIN; SET LOCAL deadlock_timeout='5s'; UPDATE entity SET label='Writer' WHERE id='az:body'");
    await migration.query("BEGIN; SET LOCAL deadlock_timeout='100ms'");
    let pending;
    if (shape === "original migration") {
      const beforeEntity = statements.findIndex(text => text.startsWith("CREATE TRIGGER count_hour_entity"));
      assert.ok(beforeEntity > 0);
      for (const statement of statements.slice(0, beforeEntity)) await migration.query(statement);
      pending = migration.query(statements[beforeEntity]).then(() => null, error => error);
    } else {
      pending = migration.query("LOCK TABLE fact,civic_data_promotions,entity IN SHARE ROW EXCLUSIVE MODE").then(() => null, error => error);
    }
    await waitUntil(async () => (await observer.query("SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1", [migration.processID])).rows[0]?.wait_event_type === "Lock", shape);
    const write = writer.query("UPDATE fact SET value='\"Writer\"' WHERE id='az:fact'");
    const failure = await pending;
    assert.equal(failure?.code, "40P01", failure?.message);
    await migration.query("ROLLBACK"); await write; await writer.query("COMMIT");
    assert.equal((await observer.query("SELECT to_regprocedure('count_fact_write()') IS NULL AS rolled_back")).rows[0].rolled_back, true);
    proofs.push({ shape, result: "40P01 reproduced; migration rolled back; writer committed" });
  }
  for (const [first, second] of [["entity", "fact"], ["fact", "entity"], ["count_hour", "entity"]]) {
    await observer.query(setup);
    const writer = await connect(`rb-a8-writer-${first}`);
    const migration = await connect(`rb-a8-migration-${first}`);
    await writer.query(`BEGIN; SET LOCAL statement_timeout='1000ms'; LOCK TABLE ${first} IN ROW EXCLUSIVE MODE`);
    await migration.query("BEGIN");
    const pending = migration.query(`DO $copy$ BEGIN ${lockFirstStatement("RB-A8_count_hour")}
      ${statements.map(statement => `EXECUTE ${quote(statement)};`).join("\n")}
      END $copy$;`).then(() => null, error => error);
    await waitUntil(async () => (await observer.query("SELECT wait_event FROM pg_stat_activity WHERE pid=$1", [migration.processID])).rows[0]?.wait_event === "PgSleep", `nonblocking retry behind ${first}`);
    const locks = (await observer.query("SELECT count(*)::int AS n FROM pg_locks WHERE pid=$1 AND mode='ShareRowExclusiveLock' AND granted", [migration.processID])).rows[0].n;
    assert.equal(locks, 0, "every partial table lock must be released before sleeping");
    await observer.query("SET statement_timeout='500ms'; SELECT * FROM entity; SELECT * FROM fact");
    await writer.query(`LOCK TABLE ${second} IN ROW EXCLUSIVE MODE`);
    await writer.query("UPDATE entity SET label='Writer' WHERE id='az:body'; UPDATE fact SET value='\"Writer\"' WHERE id='az:fact'; COMMIT");
    const failure = await pending; assert.equal(failure, null, failure?.message);
    await migration.query("COMMIT");
    const parity = await observer.query(`WITH actual AS (
      SELECT state, (substring(step from 4)::jsonb->>0) family, (substring(step from 4)::jsonb->>1) stage,
      sum(CASE WHEN substring(step from 4)::jsonb->>2='stock out' THEN -n ELSE n END) n
      FROM count_hour WHERE step LIKE 'v1:%' AND substring(step from 4)::jsonb->>2 IN ('stock in','stock out') GROUP BY 1,2,3
    ), expected AS (
      SELECT count_state(d.state)::char(2) state,d.family,d.stage,count(*) n FROM fact f CROSS JOIN LATERAL count_fact_dimension(to_jsonb(f)) d GROUP BY 1,2,3
      UNION ALL SELECT count_state(state)::char(2),kind,'subjects',count(*) FROM entity GROUP BY 1,2
      UNION ALL SELECT count_state(scope)::char(2),record_class,'published sets',count(*) FROM civic_data_promotions GROUP BY 1,2
    ) SELECT * FROM actual FULL JOIN expected USING(state,family,stage) WHERE actual.n IS DISTINCT FROM expected.n`);
    assert.deepEqual(parity.rows, []);
    assert.equal((await observer.query("SELECT label FROM entity")).rows[0].label, "Writer");
    assert.deepEqual((await observer.query("SELECT value FROM fact")).rows[0].value, "Writer");
    proofs.push({ shape: `${first} then ${second}`, result: "writer and migration committed; readers responsive; partial locks=0; all stock dimensions equal direct SQL" });
  }
  const controlSetup = `DROP SCHEMA public CASCADE; CREATE SCHEMA public;
    CREATE TABLE count_hour(state char(2),hour timestamptz,step text,n bigint NOT NULL DEFAULT 0 CHECK(n>=0),PRIMARY KEY(state,hour,step));
    CREATE FUNCTION cp_control_state(v jsonb) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT coalesce(v->>'stateCode','system') $$;
    ${["cp_doors", "cp_work_items", "cp_work_items_archive", "cp_box_findings", "cp_owner_snapshots"].map(table => `CREATE TABLE ${table}(id text PRIMARY KEY,revision bigint,updated_at timestamptz,value jsonb);`).join("\n")}
    CREATE TABLE work_row(id text PRIMARY KEY,state text,kind text,status text,not_before timestamptz);
    INSERT INTO cp_doors VALUES('door',1,now(),'{"stateCode":"AZ","status":"OPEN","kind":"meetings"}');
    INSERT INTO cp_work_items VALUES('work',1,now(),'{"stateCode":"AZ","state":"WAITING","kind":"meetings"}');
    INSERT INTO cp_box_findings VALUES('finding',1,now(),'{"stateCode":"AZ","state":"waiting","kind":"meetings"}');
    INSERT INTO cp_owner_snapshots VALUES('current:AZ',1,now(),'{"allRowsIndex":[]}');
    INSERT INTO work_row VALUES('shared-work','AZ','meetings','ready',now()-interval '1 hour');`;
  const controlActual = `SELECT d.state,d.family,d.stage FROM cp_doors w CROSS JOIN LATERAL count_control_dimensions(w.value,'door') d
    UNION ALL SELECT d.state,d.family,d.stage FROM cp_work_items w CROSS JOIN LATERAL count_control_dimensions(w.value,'work') d
    UNION ALL SELECT d.state,d.family,d.stage FROM cp_work_items_archive w CROSS JOIN LATERAL count_control_dimensions(w.value,'work') d
    UNION ALL SELECT d.state,d.family,d.stage FROM cp_box_findings w CROSS JOIN LATERAL count_control_dimensions(w.value,'box') d
    UNION ALL SELECT d.state,d.family,d.stage FROM cp_owner_snapshots w CROSS JOIN LATERAL count_work_segments(w.value,w.id,statement_timestamp()) d WHERE w.id LIKE 'current:%' AND d.from_at<=statement_timestamp()
    UNION ALL SELECT d.state,d.family,d.stage FROM work_row w CROSS JOIN LATERAL count_work_segments(count_work_row_index(to_jsonb(w),statement_timestamp()),'current:'||w.state,statement_timestamp()) d WHERE d.from_at<=statement_timestamp()`;
  for (const first of ["blocking control-plane LOCK", "cp_work_items", "cp_owner_snapshots", "count_hour"]) {
    await observer.query(controlSetup);
    const writer = await connect(`rb-a8-control-writer-${proofs.length}`);
    const migration = await connect(`rb-a8-control-migration-${proofs.length}`);
    await writer.query(`BEGIN; SET LOCAL deadlock_timeout='5s'; LOCK TABLE ${first === "blocking control-plane LOCK" ? "cp_work_items" : first} IN ROW EXCLUSIVE MODE`);
    await migration.query("SET deadlock_timeout='100ms'");
    const original = { query: async (text, params) => (await migration.query(text, params)).rows };
    const pending = installHourlyCounts(first === "blocking control-plane LOCK" ? original : hourlyCountMigrationSql(original)).then(() => null, error => error);
    await waitUntil(async () => {
      const row = (await observer.query("SELECT wait_event_type,wait_event FROM pg_stat_activity WHERE pid=$1", [migration.processID])).rows[0];
      return first === "blocking control-plane LOCK" ? row?.wait_event_type === "Lock" : row?.wait_event === "PgSleep";
    }, `control-plane migration behind ${first}`);
    if (first !== "blocking control-plane LOCK") {
      assert.equal((await observer.query("SELECT count(*)::int n FROM pg_locks WHERE pid=$1 AND mode='ShareRowExclusiveLock' AND granted", [migration.processID])).rows[0].n, 0);
      await observer.query("SET statement_timeout='500ms'; SELECT * FROM cp_doors; SELECT * FROM cp_work_items");
    }
    const write = writer.query("UPDATE cp_doors SET revision=2 WHERE id='door'");
    if (first === "blocking control-plane LOCK") {
      const failure = await pending; assert.equal(failure?.code, "40P01", failure?.message);
      await write; await writer.query("COMMIT");
      proofs.push({ shape: first, result: "40P01 reproduced; immutable migration rolled back; writer committed" });
      continue;
    }
    await write; await writer.query("COMMIT");
    const failure = await pending; assert.equal(failure, null, failure?.message);
    const parity = await observer.query(`WITH expected AS (SELECT state,family,stage,count(*)::bigint n FROM (${controlActual}) x GROUP BY 1,2,3),
      actual AS (SELECT state,substring(step from 4)::jsonb->>0 family,substring(step from 4)::jsonb->>1 stage,
        sum(CASE substring(step from 4)::jsonb->>2 WHEN 'stock in' THEN n WHEN 'stock out' THEN -n ELSE 0 END)::bigint n
        FROM count_hour WHERE step LIKE 'v1:%' AND hour<=statement_timestamp() GROUP BY 1,2,3)
      SELECT * FROM actual FULL JOIN expected USING(state,family,stage) WHERE coalesce(actual.n,0)<>coalesce(expected.n,0)`);
    assert.deepEqual(parity.rows, []);
    assert.equal((await observer.query("SELECT revision::int FROM cp_doors WHERE id='door'")).rows[0].revision, 2);
    proofs.push({ shape: `control plane: ${first} then cp_doors`, result: "writer and complete immutable migration committed; partial locks=0; readers responsive; all stock dimensions equal direct SQL" });
  }
  console.log(JSON.stringify({ checkedAt: new Date().toISOString(), postgres: (await admin.query("SHOW server_version")).rows[0].server_version, proofs }, null, 2));
} finally {
  await Promise.allSettled(clients.map(client => client.end()));
  await admin.query(`DROP DATABASE ${database} WITH (FORCE)`);
  await admin.end();
}
