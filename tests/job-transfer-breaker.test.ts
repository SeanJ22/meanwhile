import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { neon, neonConfig } from "@neondatabase/serverless";
import { evaluateJobBreaker, JOB_TRANSFER_SQL, jobTransfers, readJobBreakerStates, writeJobBreakerEvents,
  JOB_BREAKER_INTERVAL_MS, type JobBreakerState, type JobTransfer } from "../lib/control-plane/job-transfer-breaker.ts";
import { JOB_BREAKER_DDL } from "../lib/control-plane/repository/migrations/BB-01.ts";
import { admitJobLaunch, JOB_BREAKER_PATH_ENV, jobSourceIdentity, registeredJobIdentity, saveBreakerSnapshot } from "../lib/control-plane/job-breaker-local.ts";
import { runBoundedChildPass } from "../lib/civic-data/bounded-child-pass.ts";
import { routineDeferral } from "../lib/civic-data/runner.ts";
import { JobTransferBreaker } from "../lib/control-plane/job-breaker-loop.ts";
import { readJobBreakerEvents } from "../lib/control-plane/line-keeper/read.ts";
import { withKeeperFixes } from "../lib/control-plane/line-keeper/keep.ts";
import { defaultAdminConfig } from "../lib/control-plane/gateway/admin-config.ts";

const HOUR = Date.parse("2026-10-26T18:00:00Z");
const INCIDENT = 1_990_727_885;
const normal = {job:"other-source",requests:10,bytes:1_000_000,topTable:"cp_doors"};
const incident = {job:"legiscan-bulk",requests:933,bytes:INCIDENT,topTable:"civic_data_candidates"};

test("production 2 PM totals replay on a test store: only the bill job pauses, next hour half rate, second trip persists through restart and midnight", async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE TABLE database_transfer_hourly(hour timestamptz,database_name text,reads jsonb,PRIMARY KEY(hour,database_name));${JOB_BREAKER_DDL}`);
    // These are the real 26 October 2 PM Admin-hour totals, transferred as aggregates only.
    await db.query("INSERT INTO database_transfer_hourly VALUES($1,'control-plane',$2::jsonb)",[
      new Date(HOUR).toISOString(),JSON.stringify({
        "legiscan-bulk\tcivic_data_candidates":[390,126850,1623621517],
        "legiscan-bulk\tother":[543,340082568,26896950],
        "other-source\tcp_doors":[10,0,1_000_000],
        "pilot-runner\tcp_budget":[100,0,9e9],"index\tentity":[100,0,9e9],"admin:Now\tcp_doors":[100,0,9e9],
      })]);
    await db.query("INSERT INTO database_transfer_hourly VALUES($1,'reader',$2::jsonb)",[
      new Date(HOUR-3_600_000).toISOString(),JSON.stringify({"other-source\told":[1,0,9e12]})]);
    const sql = { query:async (text:string,params:readonly unknown[]=[]) => (await db.query<Record<string,unknown>>(text,[...params])).rows };
    let states: Record<string,JobBreakerState> = {};
    const check = async (now:number,rows: readonly JobTransfer[]= [incident,normal],code="v1") => {
      const result=evaluateJobBreaker({now,rows,states,code:()=>code});
      await writeJobBreakerEvents(sql,result.events);
      states=await readJobBreakerStates(sql);
      return result;
    };
    const aggregate=jobTransfers(await sql.query(JOB_TRANSFER_SQL,[new Date(HOUR).toISOString()]));
    assert.equal(aggregate.find(row=>row.job==="legiscan-bulk")?.bytes,INCIDENT);
    assert.equal(aggregate.find(row=>row.job==="legiscan-bulk")?.topTable,"civic_data_candidates");
    assert.equal(aggregate.find(row=>row.job==="other-source")?.bytes,1_000_000,"historical read maps are excluded");
    const first=await check(HOUR+JOB_BREAKER_INTERVAL_MS,aggregate);
    assert.deepEqual(first.events.map(row=>[row.action,row.job]),[["PAUSE","legiscan-bulk"]]);
    assert.equal(first.events[0]!.gb,1.990727885);
    assert.equal(first.events[0]!.bytes_per_request,INCIDENT/933);
    assert.equal(first.events[0]!.top_table,"civic_data_candidates");
    assert.equal((await check(HOUR+2*JOB_BREAKER_INTERVAL_MS)).events.length,0,"rechecks are not new trips");
    assert.equal((await check(HOUR+3*JOB_BREAKER_INTERVAL_MS,[incident,normal],"v2")).events.length,0,
      "a first trip stays paused until the next hour even if a release arrives");
    const resumed=await check(HOUR+3_600_000,[normal]);
    assert.equal(resumed.events[0]?.action,"RESUME");
    assert.equal(resumed.events[0]?.top_table,"civic_data_candidates");
    assert.equal(resumed.events[0]?.bytes_per_request,INCIDENT/933);
    assert.equal(states["legiscan-bulk"]?.mode,"HALF_RATE");
    const second=await check(HOUR+3_600_000+JOB_BREAKER_INTERVAL_MS);
    assert.equal(second.events[0]?.state?.mode,"PAUSED_CODE");
    states=await readJobBreakerStates(sql); // The runner restarted.
    assert.equal((await check(HOUR+86_400_000,[normal])).events.length,0);
    assert.equal(states["legiscan-bulk"]?.mode,"PAUSED_CODE","midnight never clears a code hold");
    assert.equal((await check(HOUR+86_400_000,[normal],"v2")).events[0]?.action,"RESUME");
    const audit=await sql.query("SELECT action,job,hour,gb,top_table,bytes_per_request FROM cp_job_transfer_breaker ORDER BY checked_at,id");
    assert.deepEqual(audit.map(row=>row.action),["PAUSE","RESUME","PAUSE","RESUME"]);
    assert.ok(audit.every(row=>row.job==="legiscan-bulk"));
  } finally { await db.close(); }
});

test("a normal hour and the exact threshold pause nothing; both database byte totals are used",()=>{
  for(const rows of [[normal],[{...incident,bytes:500_000_000}]])
    assert.deepEqual(evaluateJobBreaker({now:HOUR,rows,states:{},code:()=>"v1"}).events,[]);
  assert.match(JOB_TRANSFER_SQL,/WHERE h\.hour=\$1::timestamptz/);
});

test("job code identity follows local dependencies and survives an unrelated release; new code does not inherit old bytes",()=>{
  const root=mkdtempSync(join(tmpdir(),"bb-code-"));
  try {
    mkdirSync(join(root,"scripts"));
    writeFileSync(join(root,"scripts/job.mts"),'import { value } from "./dep.ts"; console.log(value);');
    writeFileSync(join(root,"scripts/dep.ts"),'export const value=1;');
    const first=jobSourceIdentity(root,"scripts/job.mts")!;
    const path=join(root,"breaker.json");
    saveBreakerSnapshot(path,{checkedAt:new Date(HOUR).toISOString(),states:{}});
    writeFileSync(join(root,"scripts/loader.mjs"),'export const loader=true;');
    admitJobLaunch({id:"job",args:["--import","./scripts/loader.mjs","scripts/job.mts"]},root,
      {...process.env,[JOB_BREAKER_PATH_ENV]:path},HOUR);
    assert.equal(registeredJobIdentity(path,root,"job"),first,"the source identity is the job, not Node's loader");
    let state=evaluateJobBreaker({now:HOUR,rows:[incident],states:{},code:()=>first}).snapshot.states;
    state=evaluateJobBreaker({now:HOUR+3_600_000,rows:[incident],states:state,code:()=>first}).snapshot.states;
    assert.equal(state[incident.job]?.mode,"PAUSED_CODE");
    writeFileSync(join(root,"unrelated.ts"),'export const change=1;');
    assert.equal(jobSourceIdentity(root,"scripts/job.mts"),first);
    assert.equal(evaluateJobBreaker({now:HOUR+4e6,rows:[incident],states:state,code:()=>jobSourceIdentity(root,"scripts/job.mts")}).events.length,0);
    writeFileSync(join(root,"scripts/dep.ts"),'export const value=2;');
    const second=jobSourceIdentity(root,"scripts/job.mts")!;
    assert.notEqual(second,first);
    const released=evaluateJobBreaker({now:HOUR+4e6,rows:[incident],states:state,code:()=>second});
    assert.deepEqual(released.events.map(row=>row.action),["RESUME"]);
    const next=evaluateJobBreaker({now:HOUR+4.1e6,rows:[{...incident,bytes:INCIDENT+500_000_001}],states:released.snapshot.states,code:()=>second});
    assert.equal(next.events[0]?.action,"PAUSE","fresh code's own new bytes remain guarded");
  } finally {rmSync(root,{recursive:true,force:true});}
});

test("launch admission is local, halves the scheduled rate across restarts, and a paused bill does not stop other children",async()=>{
  const root=mkdtempSync(join(tmpdir(),"bb-launch-")),path=join(root,"breaker.json");
  const env={...process.env,[JOB_BREAKER_PATH_ENV]:path};
  try {
    const paused=evaluateJobBreaker({now:HOUR,rows:[incident],states:{},code:()=>"v1"}).snapshot;
    saveBreakerSnapshot(path,paused);
    const commands=[{id:incident.job,executable:process.execPath,args:["scripts/legiscan-bulk.mts"],launchEveryMs:300_000},
      {id:"normal",executable:process.execPath,args:["scripts/normal.mts"]}];
    const launched:string[]=[];
    const results=await runBoundedChildPass(commands,{cwd:root,env},async command=>{
      launched.push(command.id);return {id:command.id,status:0,signal:null,stdout:"",stderr:"",termination:"EXITED",errorMessage:null};
    });
    assert.deepEqual(launched,["normal"]);
    assert.match(routineDeferral(results[0]!,false)!,/^JOB_TRANSFER_BREAKER:/);
    assert.equal(admitJobLaunch({...commands[0]!,id:"pilot-runner"},root,env,HOUR),true);
    const half=evaluateJobBreaker({now:HOUR+3_600_000,rows:[],states:paused.states,code:()=>"v1"}).snapshot;
    saveBreakerSnapshot(path,half);
    const start=HOUR+3_600_000;
    assert.equal(admitJobLaunch(commands[0]!,root,env,start,false),true,"probe does not consume a turn");
    assert.equal(admitJobLaunch(commands[0]!,root,env,start),true);
    assert.equal(admitJobLaunch(commands[0]!,root,{...env},start+300_000),false,"a fresh caller reads the durable previous launch");
    assert.equal(admitJobLaunch(commands[0]!,root,env,start+600_000),true);
    assert.equal(JSON.parse(readFileSync(path,"utf8")).states[incident.job].mode,"HALF_RATE");
  } finally {rmSync(root,{recursive:true,force:true});}
});

test("the actual controller survives an uncertain control write, restarts and sends each pause exactly once",async()=>{
  const db=new PGlite(),root=mkdtempSync(join(tmpdir(),"bb-outbox-")),path=join(root,"breaker.json");
  try {
    await db.exec(`CREATE TABLE database_transfer_hourly(hour timestamptz,database_name text,reads jsonb);${JOB_BREAKER_DDL}`);
    await db.query("INSERT INTO database_transfer_hourly VALUES($1,'reader',$2::jsonb)",[new Date(HOUR).toISOString(),
      JSON.stringify({"legiscan-bulk\tcivic_data_candidates":[incident.requests,0,incident.bytes]})]);
    let fail=true;
    const sql={query:async(text:string,params:readonly unknown[]=[])=>{
      const result=await db.query<Record<string,unknown>>(text,[...params]);
      if(text.startsWith("INSERT INTO cp_job_transfer_breaker")&&fail){fail=false;throw new Error("Connection lost after commit");}
      return result.rows;
    }};
    const options={path,reader:sql,control:sql,code:()=>"v1",release:()=>"release-v1",meter:()=>[]};
    await assert.rejects(new JobTransferBreaker(options).check(HOUR+JOB_BREAKER_INTERVAL_MS),/Connection lost after commit/);
    const local=JSON.parse(readFileSync(path,"utf8"));
    assert.equal(local.states[incident.job].mode,"PAUSED_HOUR");
    assert.equal(local.pendingEvents.length,2,"the pause and check survived the uncertain commit");
    assert.equal(admitJobLaunch({id:incident.job,args:[]},root,{...process.env,[JOB_BREAKER_PATH_ENV]:path},HOUR+1),false);
    await new JobTransferBreaker(options).check(HOUR+2*JOB_BREAKER_INTERVAL_MS);
    assert.equal((await sql.query("SELECT count(*)::int n FROM cp_job_transfer_breaker WHERE action='PAUSE'"))[0]!.n,1);
    assert.equal((await sql.query("SELECT count(*)::int n FROM cp_job_transfer_breaker WHERE action='CHECK'"))[0]!.n,2);
    assert.equal(JSON.parse(readFileSync(path,"utf8")).pendingEvents,undefined);
    const events=await readJobBreakerEvents(sql,new Date(HOUR).toISOString(),new Date(HOUR+3_600_000).toISOString());
    assert.equal(events.length,1);
    const config={...defaultAdminConfig(new Date(HOUR).toISOString()),settings:{"fleet.budget.dailyUsd":{key:"fleet.budget.dailyUsd",value:0}},
      settingHistory:[]};
    const saved=withKeeperFixes(config,{from:new Date(HOUR).toISOString(),through:new Date(HOUR+3_600_000).toISOString(),
      measuredAt:new Date(HOUR+3_600_001).toISOString(),counts:[],waiting:[],problems:[],own:{bytesRead:0},breakerEvents:events});
    assert.match(saved.latestBrief!.updates[0]!.what,/Legiscan bulk paused new launches.*1\.991 GB/);
    assert.deepEqual(saved.settings,config.settings,"the hourly report leaves the owner's settings alone");
    assert.deepEqual(saved.settingHistory,config.settingHistory);
  } finally {await db.close();rmSync(root,{recursive:true,force:true});}
});

test("six scheduled checks use under 5 MB/hour including real Neon request and response envelopes",async(t)=>{
  const db=new PGlite(),root=mkdtempSync(join(tmpdir(),"bb-wire-")),previous=neonConfig.fetchFunction;
  let requests=0,sent=0,received=0;
  try {
    await db.exec(`CREATE TABLE database_transfer_hourly(hour timestamptz,database_name text,reads jsonb);${JOB_BREAKER_DDL}`);
    await db.query("INSERT INTO database_transfer_hourly VALUES($1,'reader',$2::jsonb)",[new Date(HOUR).toISOString(),
      JSON.stringify({"normal\tcp_doors":[10,1000,10000]})]);
    neonConfig.fetchFunction=async(_input:Parameters<typeof fetch>[0],init?:RequestInit)=>{
      const body=String(init?.body);requests++;sent+=Buffer.byteLength(body);
      const query=JSON.parse(body),result=await db.query<Record<string,unknown>>(query.query,query.params);
      const fields=result.fields;
      const encode=(value:unknown)=>value==null?null:value instanceof Date?value.toISOString():typeof value==="object"?JSON.stringify(value):String(value);
      const answer=JSON.stringify({command:"SELECT",rowCount:result.rows.length,rowAsArray:true,fields,
        rows:result.rows.map(row=>fields.map(field=>encode(row[field.name])))});
      received+=Buffer.byteLength(answer);
      return new Response(answer);
    };
    const sql=neon("postgresql://fixture:fixture@ep-bb-wire-fixture.us-east-2.aws.neon.tech/neondb");
    const breaker=new JobTransferBreaker({path:join(root,"breaker.json"),reader:sql,control:sql,code:()=>"v1",release:()=>"v1",
      meter:()=>[{hour:new Date(HOUR).toISOString(),requests,bytes:sent+received}]});
    const before=sent+received;
    for(let tick=0;tick<6;tick++)await breaker.check(HOUR+tick*JOB_BREAKER_INTERVAL_MS);
    const after=sent+received;
    assert.ok(after-before<5_000_000,`${after-before} bytes/hour`);
    const checks=(await db.query<{n:number}>("SELECT count(*)::int n FROM cp_job_transfer_breaker WHERE action='CHECK'")).rows[0]!.n;
    assert.equal(checks,6);
    assert.equal((await db.query<{n:number}>("SELECT count(*)::int n FROM cp_job_transfer_breaker WHERE action='PAUSE'")).rows[0]!.n,0);
    t.diagnostic(JSON.stringify({testStore:true,beforeGbPerHour:before/1e9,afterGbPerHour:after/1e9,requestBytes:sent,responseBytes:received,requests}));
  } finally {neonConfig.fetchFunction=previous;await db.close();rmSync(root,{recursive:true,force:true});}
});
