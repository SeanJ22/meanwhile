import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { BANK_WRITE_HEALTH_ID } from "../lib/control-plane/bank-write-health.ts";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { applyControlPlaneMigrations, controlPlaneMigrationHash, productionControlPlaneTarget } from "../scripts/control-plane-migrations.mts";
import { BOOTSTRAP_DDL, CONTROL_READS_EXPAND_DDL } from "../lib/control-plane/repository/pg-schema.ts";
import { pgControlReadsBackfill } from "../lib/control-plane/repository/control-reads-backfill.ts";
import { runStateControlBackfill,PLANNING_STATES } from "../lib/control-plane/scheduler/state-planning.ts";
import type { Sql } from "../lib/control-plane/repository/pg-store.ts";
import { pgSpendRepository } from "../lib/control-plane/repository/model-charges.ts";
import { pricedModelCharge } from "../lib/control-plane/fleet-safety.ts";
import { costRecordId } from "../lib/control-plane/spend-window.ts";
import { ZERO_COST } from "../lib/control-plane/attempt.ts";
import type { CostEntry } from "../lib/control-plane/cost.ts";

const connection = "postgresql://writer:fixture@ep-dark-night-aeo1ekz3.c-2.us-east-2.aws.neon.tech/control";
const buildEnv: NodeJS.ProcessEnv = { NODE_ENV: "test", NETLIFY: "true", CONTEXT: "production", BRANCH: "main", WTP_CONTROL_PLANE_DATABASE_URL: connection };
const expandArgs = ["--target=production", "--phase=expand", "--production-build"];
const committed = (path: string) => readFileSync(path);
const now = "2026-10-15T12:00:00.000Z";
const entry = (id: string): CostEntry => ({ attemptId: id, routeTaskId: `task-${id}`, workItemId: "work", routeId: null,
  source: "api.anthropic.com", jurisdiction: "place", project: "freshness", role: "SCOUT", model: "claude-haiku-4-5-20251001",
  recordedAt: now, cost: { ...ZERO_COST, usd: 1, requestCount: 1 } });

test("control-plane migrations use only the declared production context and its separate connection", () => {
  assert.equal(productionControlPlaneTarget(expandArgs, buildEnv), connection);
  const pooled = connection.replace("ep-dark-night-aeo1ekz3.", "ep-dark-night-aeo1ekz3-pooler.");
  assert.equal(productionControlPlaneTarget(expandArgs, { ...buildEnv, WTP_CONTROL_PLANE_DATABASE_URL: pooled }), pooled);
  for (const env of [{ ...buildEnv, CONTEXT: "deploy-preview" }, { ...buildEnv, BRANCH: "feature" },
    { ...buildEnv, WTP_CONTROL_PLANE_DATABASE_URL: undefined, DATABASE_URL: connection },
    { ...buildEnv, WTP_CONTROL_PLANE_DATABASE_URL: "postgresql://writer:fixture@ep-wrong-branch.us-east-2.aws.neon.tech/control" },
    { ...buildEnv, WTP_CONTROL_PLANE_DATABASE_URL: "postgresql://writer:fixture@ep-dry-river-axwtolzc-pooler.us-east-2.aws.neon.tech/neondb" }]) {
    assert.throws(() => productionControlPlaneTarget(expandArgs, env), /REFUSED/);
  }
  assert.throws(() => productionControlPlaneTarget(["--phase=expand"], buildEnv), /REFUSED/);
});

test("committed journal hashes cover the expand-only definition", () => {
  const journal = JSON.parse(readFileSync("lib/control-plane/repository/migrations/meta/_journal.json", "utf8"));
  assert.deepEqual(journal.entries.map((row: { id: string }) => row.id), ["CP-01_expand", "DT-01_expand", "RB-A1_expand", "RIVER-KEYS_expand", "RB-A8_expand"]);
  for (const row of journal.entries) assert.equal(row.hash, controlPlaneMigrationHash(process.cwd(), row.id));
});

test("uncommitted migrations and contract checks refuse before a database opens", async () => {
  let opened = false;
  const withDatabase = async <T>(_connection: string, _operation: (sql: Sql) => Promise<T>): Promise<T> => { opened = true; throw Error("unexpected database"); };
  await assert.rejects(applyControlPlaneMigrations(expandArgs, { env: buildEnv, committed: () => Buffer.from("changed"), withDatabase }), /differs from its committed/);
  await assert.rejects(applyControlPlaneMigrations(["--target=production","--phase=contract","--production-runtime"],{env:{...buildEnv,WTP_RUNTIME_MODE:"production"},committed,withDatabase}),/REFUSED/);
  assert.equal(opened, false);
});

test("dry migration only reads an existing control plane and reports a pending committed phase", async () => {
  const queries: string[] = [];
  await applyControlPlaneMigrations([...expandArgs, "--dry"], { env: buildEnv, committed,
    withDatabase: async (_connection, operation) => operation({ query: async statement => {
      queries.push(statement);
      return statement.includes("to_regclass") ? [{ schema: "cp_schema_version", journal: null }] : [];
    } }),
  });
  assert.equal(queries.length, 1);
  assert.ok(queries.every(query => query.startsWith("SELECT")));
});

test("wrong database, applied hash drift and missing expand never issue DDL", async () => {
  for (const scenario of ["database", "hash"] as const) {
    const queries: string[] = [];
    await assert.rejects(applyControlPlaneMigrations(
      expandArgs, {
        env: { ...buildEnv, WTP_RUNTIME_MODE: "production" }, committed,
        withDatabase: async (_connection, operation) => operation({ query: async statement => {
          queries.push(statement);
          if (statement.includes("to_regclass")) return [{ schema: scenario === "database" ? null : "cp_schema_version", journal: "cp_migrations" }];
          return scenario === "hash" ? [{ id: "CP-01_expand", hash: "changed" }] : [];
        } }),
      }), /REFUSED/);
    assert.ok(queries.every(query => query.startsWith("SELECT")));
  }
});

test("expand copies no production rows; runner jobs backfill one state and retain exact charge prices", async()=>{
  const db=new PGlite();
  let requests=0;
  const sql={query:async(text:string,params:readonly unknown[]=[]) => {requests++;return (await db.query<Record<string,unknown>>(text,[...params])).rows;}};
  try {
    const skipped=new Set(CONTROL_READS_EXPAND_DDL);
    for(const ddl of BOOTSTRAP_DDL) if(!skipped.has(ddl) || ddl.startsWith("CREATE TABLE IF NOT EXISTS cp_pass_cursors"))
      await sql.query(ddl.replace("CREATE INDEX CONCURRENTLY","CREATE INDEX"));
    await sql.query("CREATE TABLE cp_spend_window(id text PRIMARY KEY,value jsonb)");
    const az={...entry("az"),jurisdiction:"ocd-division/country:us/state:az/county:pima"};
    const nh={...entry("nh"),jurisdiction:"ocd-division/country:us/state:nh/county:coos"};
    const charges=[az,nh].map((record,index)=>({...pricedModelCharge(record,costRecordId(record))!,usd:index?11:7,knownUsd:index?11:7}));
    await sql.query("INSERT INTO cp_spend_window VALUES('model-charges',$1::jsonb)",[JSON.stringify({charges})]);
    for(const [index,state] of ["az","nh"].entries()) {
      await sql.query("INSERT INTO cp_log_costs(log_key,record_id,position,recorded_at,record) VALUES('work',$1,$2,$3,$4::jsonb)",[state,index,now,JSON.stringify(index?nh:az)]);
      const obligationId=`freshness:hunt-packet:ocd-division/country:us/state:${state}/county:fixture`;
      await sql.query("INSERT INTO cp_occurrences(id,revision,updated_at,value) VALUES($1,1,$2,$3::jsonb)",[state,now,JSON.stringify({obligationId,workItemId:`work-${state}`,routeTaskId:`task-${state}`,closedAt:now})]);
      await sql.query("INSERT INTO cp_work_items(id,revision,updated_at,value) VALUES($1,1,$2,$3::jsonb)",[`work-${state}`,now,JSON.stringify({subject:`ocd-division/country:us/state:${state}/county:fixture`})]);
      await sql.query("INSERT INTO cp_route_tasks(id,revision,updated_at,value) VALUES($1,1,$2,$3::jsonb)",[`task-${state}`,now,JSON.stringify({workItemId:`work-${state}`,state:"DISPOSED"})]);
    }
    const config={formatVersion:1,apiFallback:{enabled:false,decidedAt:null,decidedBy:null,receiptId:null},updatedAt:now,
      expansionScopes:[{key:"st:az",geography:{stateAbbr:"AZ"},decidedAt:"2026-10-14T12:00:00.000Z"},
        {key:"st:nh",geography:{stateAbbr:"NH"},decidedAt:"2026-10-14T12:00:00.000Z"},
        {key:"new-az",geography:{stateAbbr:"AZ"},decidedAt:"2026-10-16T12:00:00.000Z"},
        {key:"cross-nh",geography:{stateAbbr:"NH"},planningStates:["AZ","NH"],decidedAt:"2026-10-14T12:00:00.000Z"}],
      placeTargets:[{key:"st:az",goalPercent:75},{key:"st:nh",goalPercent:80}],settingHistory:[{id:"old-change",key:"alerts.on",before:false,after:true,at:now}]};
    await sql.query("INSERT INTO cp_admin_config(id,revision,updated_at,value) VALUES('current',1,$1,$2::jsonb)",[now,JSON.stringify(config)]);
    const {newFieldManualEntry,normalizeEntry}=await import("../lib/control-plane/field-manual.ts");
    const notes=[...Array.from({length:105},(_,n)=>normalizeEntry(newFieldManualEntry("backfill",`az-${String(n).padStart(3,"0")}`,{
      role:"SCOUT",kind:"METHOD",title:"Existing method",summary:"A method to inherit",outcome:"YIELDED",states:["az"]}))),
      normalizeEntry(newFieldManualEntry("backfill","nh",{role:"SCOUT",kind:"METHOD",title:"Other state",summary:"Other state",outcome:"YIELDED",states:["nh"]}))];
    await sql.query("INSERT INTO cp_field_manual_entries(id,revision,updated_at,value) SELECT entry->>'id',1,$2::timestamptz,entry FROM jsonb_array_elements($1::jsonb) entry",[JSON.stringify(notes),now]);
    await applyControlPlaneMigrations(expandArgs,{env:buildEnv,committed,withDatabase:async(_connection,operation)=>operation(sql)});
    assert.equal((await sql.query("SELECT count(*)::integer AS n FROM cp_occurrences"))[0].n,2);
    for(const table of ["cp_occurrences_archive","cp_model_charges","cp_admin_place_targets","cp_admin_setting_history","cp_manual_method_rank","cp_manual_source_facts"])
      assert.equal((await sql.query(`SELECT count(*)::integer AS n FROM ${table}`))[0].n,0,`${table} stays empty during expand`);
    assert.deepEqual((await sql.query("SELECT value FROM cp_admin_config"))[0].value,config);
    await sql.query("CREATE TABLE cp_field_manual(id text PRIMARY KEY,revision bigint NOT NULL,updated_at timestamptz NOT NULL,value jsonb NOT NULL)");
    await sql.query("INSERT INTO cp_field_manual(id,revision,updated_at,value) VALUES('write-errors',1,$1,$2::jsonb)",[now,JSON.stringify({entries:[{payload:{count:3}}]})]);
    await sql.query("INSERT INTO cp_field_manual_entries(id,revision,updated_at,value) VALUES($1,1,$2,$3::jsonb)",[BANK_WRITE_HEALTH_ID,now,JSON.stringify({id:BANK_WRITE_HEALTH_ID,payload:{count:2}})]);
    await sql.query("INSERT INTO cp_hunt_orders(id,revision,updated_at,value) VALUES('stop-az',1,$1,$2::jsonb)",[now,
      JSON.stringify({id:"stop-az",state:"az",scopeKey:null,requestedAt:now,confirmedAt:null,receiptId:"stop-az"})]);
    const manual=createMemoryRepositories();
    const jobs=pgControlReadsBackfill(sql,()=>manual);const first=await jobs.runState("az");assert.equal(first.complete,false);
    assert.equal((await sql.query("SELECT count(*)::int AS n FROM cp_manual_method_meta"))[0].n,100);
    assert.equal((await sql.query("SELECT count(*)::int AS n FROM cp_manual_method_meta WHERE states ? 'nh'"))[0].n,0);
    assert.equal((await jobs.runState("az")).complete,true);
    assert.equal((await sql.query("SELECT count(*)::int AS n FROM cp_manual_method_meta"))[0].n,105);
    assert.deepEqual((await sql.query("SELECT id FROM cp_occurrences_archive")).map(row=>row.id),["az"]);
    assert.deepEqual((await sql.query("SELECT id FROM cp_admin_place_targets")).map(row=>row.id),["st:az"]);
    assert.equal((await pgSpendRepository(sql).aggregate({since:"2026-10-14T12:00:00Z",until:now})).usd,7);
    assert.deepEqual((await sql.query("SELECT id FROM cp_admin_expansion_scopes ORDER BY id")).map(row=>row.id),["new-az"],"a recorded stop cannot be undone by copying an older scope; a later Send survives");
    assert.equal((await jobs.runState("az")).copied,0);
    for(const state of PLANNING_STATES)await runStateControlBackfill(jobs,state,()=>{});
    await jobs.finish(PLANNING_STATES);
    assert.deepEqual((await sql.query("SELECT id FROM cp_admin_expansion_scopes ORDER BY id")).map(row=>row.id),["new-az","st:nh"]);
    assert.equal((await sql.query("SELECT count(*)::integer AS n FROM cp_occurrences"))[0].n,0);
    assert.equal((await pgSpendRepository(sql).aggregate({since:"2026-10-14T12:00:00Z",until:now})).usd,18);
    assert.deepEqual((await sql.query("SELECT id FROM cp_migrations ORDER BY id")).map(row=>row.id),["CP-01_expand","DT-01_expand","RB-A1_expand","RB-A8_expand","RIVER-KEYS_expand"]);
    assert.equal((await sql.query("SELECT value ? 'placeTargets' AS embedded FROM cp_admin_config"))[0].embedded,false);
    assert.deepEqual(await sql.query("SELECT to_regclass('cp_spend_window') AS old"),[{old:null}]);
    assert.equal((await sql.query("SELECT (value #>> '{payload,count}')::integer AS n FROM cp_field_manual_entries WHERE id=$1",[BANK_WRITE_HEALTH_ID]))[0].n,5);
    requests=0;assert.equal(await jobs.finished(),true);assert.equal(requests,1,"completed backfills read one marker and perform no writes");
  } finally {await db.close();}
});
