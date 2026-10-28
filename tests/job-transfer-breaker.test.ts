import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PGlite } from "@electric-sql/pglite";
import { neonConfig } from "@neondatabase/serverless";
import { neon } from "../lib/db/client.ts";
import { evaluateJobBreaker, JOB_TRANSFER_SQL, jobTransfers, pausedStates, readJobBreakerLatest, releaseJob, writeJobBreakerEvents,
  JOB_BREAKER_INTERVAL_MS, type BreakerSql, type JobBreakerState, type JobTransfer } from "../lib/control-plane/job-transfer-breaker.ts";
import { JOB_BREAKER_DDL } from "../lib/control-plane/repository/migrations/BB-01.ts";
import { admitJobLaunch, JOB_BREAKER_PATH_ENV, saveBreakerSnapshot } from "../lib/control-plane/job-breaker-local.ts";
import { runBoundedChildPass } from "../lib/civic-data/bounded-child-pass.ts";
import { routineDeferral } from "../lib/civic-data/runner.ts";
import { ROUTINE_JOBS, runRoutineJob } from "../lib/civic-data/routine-jobs.ts";
import { JobTransferBreaker } from "../lib/control-plane/job-breaker-loop.ts";
import { readJobBreakerEvents } from "../lib/control-plane/line-keeper/read.ts";
import { withKeeperFixes } from "../lib/control-plane/line-keeper/keep.ts";
import { defaultAdminConfig } from "../lib/control-plane/gateway/admin-config.ts";
import { countNeonBytes, processNeonBytes } from "../lib/db/transfer-by-caller.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { submit } from "../lib/control-plane/gateway/gateway.ts";
import { pausedJobsView } from "../lib/control-plane/admin-view/paused-jobs.ts";
import { jobLabel } from "../lib/control-plane/job-names.ts";
import { PausedJobsList } from "../app/(admin)/_mw/admin-v6/paused-jobs-panel.tsx";
import { V6Context, type V6 } from "../app/(admin)/_mw/admin-v6/context.tsx";
import { actionDef } from "../app/(admin)/_mw/admin-v6/actions.ts";
import { actionInput } from "../app/(admin)/_mw/admin-v6/contract.ts";

const HOUR = Date.parse("2026-10-26T18:00:00Z");
const INCIDENT = 1_990_727_885;
const normal = {job:"other-source",requests:10,bytes:1_000_000,topTable:"cp_doors"};
const incident = {job:"legiscan-bulk",requests:933,bytes:INCIDENT,topTable:"civic_data_candidates"};
const pglite = (db: PGlite): BreakerSql => ({ query: async (text, params = []) => (await db.query<Record<string, unknown>>(text, [...params])).rows });
const hourly = (db: PGlite, at: number, reads: Record<string, readonly number[]>) =>
  db.query("INSERT INTO database_transfer_hourly VALUES($1,'reader',$2::jsonb) ON CONFLICT (hour,database_name) DO UPDATE SET reads=excluded.reads",
    [new Date(at).toISOString(), JSON.stringify(reads)]);

test("the 26 October 2 PM totals pause only the bill job, and it stays paused through the next hour, midnight, a restart and a code change", async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE TABLE database_transfer_hourly(hour timestamptz,database_name text,reads jsonb,PRIMARY KEY(hour,database_name));${JOB_BREAKER_DDL}`);
    // The real 26 October 2 PM Admin-hour totals, transferred as aggregates only.
    await db.query("INSERT INTO database_transfer_hourly VALUES($1,'control-plane',$2::jsonb)",[
      new Date(HOUR).toISOString(),JSON.stringify({
        "legiscan-bulk\tcivic_data_candidates":[390,126850,1623621517],
        "legiscan-bulk\tother":[543,340082568,26896950],
        "other-source\tcp_doors":[10,0,1_000_000],
        "pilot-runner\tcp_budget":[100,0,9e9],"index\tentity":[100,0,9e9],"admin:Now\tcp_doors":[100,0,9e9],
        "routine-civic-data\tcp_doors":[100,0,9e9],"publish-now\tcp_doors":[100,0,9e9],
      })]);
    await hourly(db, HOUR-3_600_000, {"other-source\told":[1,0,9e12]});
    const sql = pglite(db);
    let states: Record<string,JobBreakerState> = {};
    const check = async (now:number,rows:readonly JobTransfer[]=[incident,normal]) => {
      const result=evaluateJobBreaker({now,rows,states});
      await writeJobBreakerEvents(sql,result.events);
      states=result.snapshot.states;
      return result;
    };
    const aggregate=jobTransfers(await sql.query(JOB_TRANSFER_SQL,[new Date(HOUR).toISOString()]));
    assert.equal(aggregate.find(row=>row.job==="legiscan-bulk")?.bytes,INCIDENT);
    assert.equal(aggregate.find(row=>row.job==="legiscan-bulk")?.topTable,"civic_data_candidates");
    assert.equal(aggregate.find(row=>row.job==="other-source")?.bytes,1_000_000,"historical read maps are excluded");
    const first=await check(HOUR+JOB_BREAKER_INTERVAL_MS,aggregate);
    assert.deepEqual(first.events.map(row=>[row.action,row.job]),[["PAUSE","legiscan-bulk"]],"supervisors and serving identities never pause");
    assert.equal(first.events[0]!.gb,1.990727885);
    assert.equal(first.events[0]!.bytes_per_request,INCIDENT/933);
    assert.equal(first.events[0]!.top_table,"civic_data_candidates");
    assert.equal((await check(HOUR+2*JOB_BREAKER_INTERVAL_MS)).events.length,0,"rechecks are not new trips");
    for (const at of [HOUR+3_600_000, HOUR+86_400_000, HOUR+7*86_400_000]) {
      const later=await check(at,[normal]);
      assert.deepEqual(later.events,[],"no automatic resume, in the next hour or any later one");
      assert.equal(states["legiscan-bulk"]?.mode,"PAUSED");
    }
    states=pausedStates(await readJobBreakerLatest(sql)); // The runner restarted, on new code.
    assert.equal(states["legiscan-bulk"]?.mode,"PAUSED","a restart and a code change keep the pause");
    assert.equal((await check(HOUR+8*86_400_000,[normal])).events.length,0);
    const audit=await sql.query("SELECT action,job FROM cp_job_transfer_breaker ORDER BY checked_at,id");
    assert.deepEqual(audit.map(row=>[row.action,row.job]),[["PAUSE","legiscan-bulk"]],"the breaker itself never writes a resume");
  } finally { await db.close(); }
});

test("a normal hour and the exact threshold pause nothing; both database byte totals are used",()=>{
  for(const rows of [[normal],[{...incident,bytes:500_000_000}]])
    assert.deepEqual(evaluateJobBreaker({now:HOUR,rows,states:{}}).events,[]);
  assert.match(JOB_TRANSFER_SQL,/WHERE h\.hour=\$1::timestamptz/);
});

test("a hot in-process routine task is metered under its own name and pauses alone; the other tasks and children still run",async()=>{
  const root=mkdtempSync(join(tmpdir(),"bb-routine-")),path=join(root,"breaker.json");
  const env={...process.env,[JOB_BREAKER_PATH_ENV]:path};
  const previousJournal=process.env.WTP_DATABASE_TRANSFER_DIR;
  process.env.WTP_DATABASE_TRANSFER_DIR=join(root,"transfer");
  try {
    saveBreakerSnapshot(path,{checkedAt:new Date().toISOString(),states:{}});
    const now=Date.now(), portraits="people-portraits-ca";
    // One pass: the portrait list reads 0.6 GB in process; door install and meeting pins read a little.
    await runRoutineJob({id:portraits},async()=>{countNeonBytes("reader",600_000_000,now,{requests:40,bytes:0},undefined,"civic_data_promotions:STATE_LEGISLATOR");},()=>undefined,env);
    await runRoutineJob(ROUTINE_JOBS.doors,async()=>{countNeonBytes("control-plane",20_000_000,now,{requests:5,bytes:0},undefined,"cp_doors");},()=>undefined,env);
    await runRoutineJob(ROUTINE_JOBS.meetingPins,async()=>{countNeonBytes("reader",3_000_000,now,{requests:5,bytes:0},undefined,"fact");},()=>undefined,env);
    const reads=processNeonBytes().find(part=>Object.keys(part.reads??{}).some(key=>key.includes(portraits)))!.reads!;
    const byJob=new Map<string,number>();
    for(const [key,[,sent,received]] of Object.entries(reads)) {
      const job=key.split("\t")[1]!;
      if([portraits,"doors","meeting-pins"].includes(job)) byJob.set(job,(byJob.get(job)??0)+sent!+received!);
    }
    assert.deepEqual([...byJob].sort(),[["doors",20_000_000],["meeting-pins",3_000_000],[portraits,600_000_000]],"each task's bytes carry its own name");
    assert.ok(!Object.keys(reads).some(key=>key.split("\t")[1]==="routine-civic-data"),"none count as the routine lane's");
    const checked=evaluateJobBreaker({now,rows:[...byJob].map(([job,bytes])=>({job,requests:1,bytes,topTable:null})),states:{}});
    assert.deepEqual(checked.events.map(event=>event.job),[portraits],"only the hot task pauses");
    saveBreakerSnapshot(path,checked.snapshot);

    const ran:string[]=[];
    for(const job of [{id:portraits},ROUTINE_JOBS.doors,ROUTINE_JOBS.meetingPins,ROUTINE_JOBS.boxFacts])
      await runRoutineJob(job,async()=>{ran.push(job.id);},id=>{ran.push(`held ${id}`);},env);
    assert.deepEqual(ran,[`held ${portraits}`,"doors","meeting-pins","box-facts"]);

    const launched:string[]=[];
    const results=await runBoundedChildPass([{id:portraits,executable:process.execPath,args:["scripts/people-portraits-refresh.mts"]},
      {id:"place-map-ca",executable:process.execPath,args:["scripts/place-map-refresh.mts"]}],{cwd:root,env},async command=>{
      launched.push(command.id);return {id:command.id,status:0,signal:null,stdout:"",stderr:"",termination:"EXITED",errorMessage:null};
    });
    assert.deepEqual(launched,["place-map-ca"],"the paused task's child waits; another state's map still launches");
    assert.match(routineDeferral(results[0]!,false)!,/^JOB_TRANSFER_BREAKER:.*paused until released in Admin/);
    for(const supervisor of ["routine-civic-data","publish-now","pilot-runner"]) assert.equal(admitJobLaunch(supervisor,env),true);
  } finally {
    if(previousJournal===undefined)delete process.env.WTP_DATABASE_TRANSFER_DIR;else process.env.WTP_DATABASE_TRANSFER_DIR=previousJournal;
    rmSync(root,{recursive:true,force:true});
  }
});

test("Admin lists the paused job with a Release button; Release resumes it on the runner's next check, and it can pause again",async()=>{
  const db=new PGlite(),root=mkdtempSync(join(tmpdir(),"bb-release-")),path=join(root,"breaker.json");
  const env={...process.env,[JOB_BREAKER_PATH_ENV]:path},job="people-portraits-ca";
  try {
    await db.exec(`CREATE TABLE database_transfer_hourly(hour timestamptz,database_name text,reads jsonb,PRIMARY KEY(hour,database_name));${JOB_BREAKER_DDL}`);
    const sql=pglite(db);
    await hourly(db,HOUR,{[`${job}\tcivic_data_promotions:STATE_LEGISLATOR\tlib/photos/portrait-run.ts`]:[40,0,600_000_000],"doors\tcp_doors":[5,0,20_000_000]});
    const breaker=new JobTransferBreaker({path,reader:sql,control:sql,release:()=>"v1",meter:()=>[]});
    await breaker.check(HOUR+JOB_BREAKER_INTERVAL_MS);
    assert.equal(admitJobLaunch(job,env),false);
    assert.equal(admitJobLaunch("doors",env),true);
    await breaker.check(HOUR+3_600_000+JOB_BREAKER_INTERVAL_MS);
    assert.equal(admitJobLaunch(job,env),false,"the next hour does not resume it");

    // Admin: the command center lists it in plain words, with the Release control.
    const repos={...createMemoryRepositories(),jobTransferPauses:{latest:()=>readJobBreakerLatest(sql),
      release:(input:Parameters<typeof releaseJob>[1])=>releaseJob(sql,input)}};
    const view=pausedJobsView(await repos.jobTransferPauses.latest(),new Date(HOUR+3_700_000).toISOString());
    assert.deepEqual(view.jobs.map(row=>[row.job,row.label,row.gb,row.topTableWords]),[[job,"Portraits · CA",0.6,"civic data promotions (state legislator)"]]);
    const v6={place:{key:"us",name:"United States",kind:"Country",navParent:null,within:[]},access:{role:"owner",canSpend:true,outreachAuthorized:false},
      defOf:(ref:{kind:Parameters<typeof actionDef>[0]})=>actionDef(ref.kind),whyNot:()=>null,act:()=>{}} as unknown as V6;
    const html=renderToStaticMarkup(h(V6Context.Provider,{value:v6},h(PausedJobsList,{jobs:view.jobs})));
    const face=html.replace(/<details\b[^>]*>[\s\S]*?<\/details>/g,"").replace(/<[^>]+>/g," ").replace(/\s+/g," ");
    assert.match(face,/Portraits · CA Paused Paused Oct 26, 2:10 PM ET after reading 0\.60 GB in one hour, most of it from civic data promotions \(state legislator\)\./);
    assert.match(html,/<button[^>]*>Release<\/button>/);
    assert.doesNotMatch(face,/people-portraits-ca|civic_data_promotions/,"the job id and table name stay behind Technical details");
    assert.match(html,/<summary>Technical details<\/summary><ul[^>]*><li>Job: people-portraits-ca<\/li>/);
    assert.equal(actionDef("job-release").gateway?.type,"jobs.release");
    const input=actionInput("job-release",{target:job,scopeKey:"us",option:null,words:"",amount:"",selected:[]});

    // Release: a control-plane write through the gateway, with a receipt, needing nothing from the owner's PC.
    const request={type:"jobs.release",subject:job,input,caller:"OWNER_SESSION" as const,actorRef:"owner-session",stateVersion:null,idempotencyKey:"release-portraits-ca"};
    const at=new Date(HOUR+3_600_000+15*60_000).toISOString();
    const deps={repos,now:()=>at,currentStateVersion:null,codeSha:null};
    const released=await submit(request,deps);
    assert.equal(released.ok,true,released.receipt.says);
    assert.equal(released.receipt.outcome,"DONE");
    assert.equal(released.receipt.says,"Released Portraits · CA. It starts again within ten minutes.");
    assert.equal((await submit(request,deps)).replayed,true,"a double click is one release");
    const resume=await sql.query("SELECT detail FROM cp_job_transfer_breaker WHERE action='RESUME'");
    assert.equal(resume.length,1);
    const detail=resume[0]!.detail as Record<string,unknown>;
    assert.deepEqual([detail.receiptId,detail.actorRef],[released.receipt.receiptId,"owner-session"],"the release says who and when, beside its receipt");
    assert.equal(admitJobLaunch(job,env),false,"launches wait for the runner's next check");
    assert.deepEqual(pausedJobsView(await repos.jobTransferPauses.latest(),at).jobs,[],"Admin no longer lists it");
    const refused=await submit({...request,idempotencyKey:"release-again"},deps);
    assert.equal(refused.ok,false);
    assert.equal(refused.receipt.says,"Portraits · CA is not paused.");

    await hourly(db,HOUR+3_600_000,{[`${job}\tcivic_data_promotions:STATE_LEGISLATOR`]:[10,0,450_000_000]});
    await breaker.check(HOUR+3_600_000+2*JOB_BREAKER_INTERVAL_MS);
    assert.equal(admitJobLaunch(job,env),true,"the next check, within ten minutes, lets its launches start again");
    const checks=await sql.query("SELECT detail FROM cp_job_transfer_breaker WHERE action='CHECK' ORDER BY checked_at DESC LIMIT 1");
    assert.deepEqual((checks[0]!.detail as {released:string[]}).released,[job]);
    await hourly(db,HOUR+3_600_000,{[`${job}\tcivic_data_promotions:STATE_LEGISLATOR`]:[20,0,900_000_000]});
    await breaker.check(HOUR+3_600_000+3*JOB_BREAKER_INTERVAL_MS);
    assert.equal(admitJobLaunch(job,env),true,"bytes read before the release do not count again");
    await hourly(db,HOUR+3_600_000,{[`${job}\tcivic_data_promotions:STATE_LEGISLATOR`]:[30,0,950_000_001]});
    await breaker.check(HOUR+3_600_000+4*JOB_BREAKER_INTERVAL_MS);
    assert.equal(admitJobLaunch(job,env),false,"over 0.5 GB after its release, it pauses again and waits for another release");
    assert.equal(pausedJobsView(await repos.jobTransferPauses.latest(),at).jobs.length,1);

    const events=await readJobBreakerEvents(sql,new Date(HOUR+3_600_000).toISOString(),new Date(HOUR+7_200_000).toISOString());
    const saved=withKeeperFixes({...defaultAdminConfig(at),settingHistory:[]},{from:new Date(HOUR+3_600_000).toISOString(),through:new Date(HOUR+7_200_000).toISOString(),
      measuredAt:new Date(HOUR+7_200_001).toISOString(),counts:[],waiting:[],problems:[],own:{bytesRead:0},breakerEvents:events});
    assert.deepEqual(saved.latestBrief!.updates.map(update=>update.what).sort(),["Portraits · CA paused after 0.950 GB in one hour. It waits until you release it in Admin.",
      "Portraits · CA was released and may start again."]);
  } finally {await db.close();rmSync(root,{recursive:true,force:true});}
});

test("a hold stands whatever release wrote it; a snapshot that cannot be read admits only the supervisors that never pause",()=>{
  const root=mkdtempSync(join(tmpdir(),"bb-admit-")),path=join(root,"breaker.json"),env={...process.env,[JOB_BREAKER_PATH_ENV]:path};
  try {
    // A release's first launches can read the snapshot the previous release wrote, in its own words.
    writeFileSync(path,JSON.stringify({checkedAt:"2026-10-28T04:48:18.539Z",states:{
      "place-pages":{job:"place-pages",mode:"PAUSED_HOUR",trips:1},"publish-now":{job:"publish-now",mode:"PAUSED_CODE"},
      "voting-sites:WI":{job:"voting-sites:WI",mode:"HALF_RATE"},"doors":{job:"doors",mode:"RELEASED"}}}));
    for(const job of ["place-pages","voting-sites:WI"]) assert.equal(admitJobLaunch(job,env),false,`${job} stays held`);
    for(const job of ["doors","meeting-pins","publish-now","routine-civic-data"]) assert.equal(admitJobLaunch(job,env),true,`${job} launches`);
    rmSync(path);
    for(const job of ["place-pages","doors","people-portraits-ca"]) assert.equal(admitJobLaunch(job,env),false,`${job} waits while the snapshot is missing`);
    writeFileSync(path,"{");
    assert.equal(admitJobLaunch("place-pages",env),false,"a torn snapshot holds too");
    for(const supervisor of ["routine-civic-data","publish-now","pilot-runner"]) assert.equal(admitJobLaunch(supervisor,env),true);
  } finally { rmSync(root,{recursive:true,force:true}); }
});

test("the runner's first breaker check runs before the release handoff can reopen the standing clock",()=>{
  const runner=readFileSync(new URL("../scripts/pilot-runner.mts",import.meta.url),"utf8");
  const first=runner.indexOf("\nawait jobTransferTick();"),handoff=runner.indexOf("\nlet handoffExitCode = await reconcileRuntimeReleaseAtBoundary();");
  assert.ok(first>0&&handoff>first,"the breaker writes this release's snapshot before anything launches");
  assert.equal(runner.split("\nawait jobTransferTick();").length,2,"one startup check");
});

test("plain job names: per-state tasks say their state, in-process tasks their own words",()=>{
  assert.equal(jobLabel("people-portraits-ca"),"Portraits · CA");
  assert.equal(jobLabel("voting-sites:TX"),"Voting places · TX");
  assert.equal(jobLabel("place-map-ny"),"Place maps · NY");
  assert.equal(jobLabel("door-sync"),"Door registry sync");
  assert.equal(jobLabel("place-pages"),"Place pages");
  assert.equal(jobLabel("meeting-partition:legistar-tucson"),"Meeting calendar");
  for(const job of Object.values(ROUTINE_JOBS)) {
    assert.ok(Number.isSafeInteger(job.databaseBytesPerRun) && job.databaseBytesPerRun > 0,`${job.id} states its bytes per run`);
    assert.ok(job.databaseBytesPerRun <= 500_000_000,`${job.id} fits under the hourly limit in one run`);
  }
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
    const options={path,reader:sql,control:sql,release:()=>"release-v1",meter:()=>[]};
    await assert.rejects(new JobTransferBreaker(options).check(HOUR+JOB_BREAKER_INTERVAL_MS),/Connection lost after commit/);
    const local=JSON.parse(readFileSync(path,"utf8"));
    assert.equal(local.states[incident.job].mode,"PAUSED");
    assert.equal(local.pendingEvents.length,2,"the pause and check survived the uncertain commit");
    assert.equal(admitJobLaunch(incident.job,{...process.env,[JOB_BREAKER_PATH_ENV]:path}),false);
    await new JobTransferBreaker(options).check(HOUR+2*JOB_BREAKER_INTERVAL_MS);
    assert.equal((await sql.query("SELECT count(*)::int n FROM cp_job_transfer_breaker WHERE action='PAUSE'"))[0]!.n,1);
    assert.equal((await sql.query("SELECT count(*)::int n FROM cp_job_transfer_breaker WHERE action='CHECK'"))[0]!.n,2);
    assert.equal(JSON.parse(readFileSync(path,"utf8")).pendingEvents,undefined);
    assert.equal(admitJobLaunch(incident.job,{...process.env,[JOB_BREAKER_PATH_ENV]:path}),false);
    const events=await readJobBreakerEvents(sql,new Date(HOUR).toISOString(),new Date(HOUR+3_600_000).toISOString());
    assert.equal(events.length,1);
    const config={...defaultAdminConfig(new Date(HOUR).toISOString()),settings:{"fleet.budget.dailyUsd":{key:"fleet.budget.dailyUsd",value:0}},
      settingHistory:[]};
    const saved=withKeeperFixes(config,{from:new Date(HOUR).toISOString(),through:new Date(HOUR+3_600_000).toISOString(),
      measuredAt:new Date(HOUR+3_600_001).toISOString(),counts:[],waiting:[],problems:[],own:{bytesRead:0},breakerEvents:events});
    assert.match(saved.latestBrief!.updates[0]!.what,/Legiscan bulk paused after 1\.991 GB in one hour/);
    assert.deepEqual(saved.settings,config.settings,"the hourly report leaves the owner's settings alone");
    assert.deepEqual(saved.settingHistory,config.settingHistory);
  } finally {await db.close();rmSync(root,{recursive:true,force:true});}
});

test("six scheduled checks use under 5 MB/hour including real Neon request and response envelopes",async(t)=>{
  const db=new PGlite(),root=mkdtempSync(join(tmpdir(),"bb-wire-")),previous=neonConfig.fetchFunction;
  const previousReport=process.env.WTP_VITAL_SIGNS_REPORT;
  process.env.WTP_VITAL_SIGNS_REPORT="1";
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
    const breaker=new JobTransferBreaker({path:join(root,"breaker.json"),reader:sql,control:sql,release:()=>"v1",
      meter:()=>[{hour:new Date(HOUR).toISOString(),requests,bytes:sent+received}]});
    const before=sent+received;
    for(let tick=0;tick<6;tick++)await breaker.check(HOUR+tick*JOB_BREAKER_INTERVAL_MS);
    const after=sent+received;
    assert.ok(after-before<5_000_000,`${after-before} bytes/hour`);
    const checks=(await db.query<{n:number}>("SELECT count(*)::int n FROM cp_job_transfer_breaker WHERE action='CHECK'")).rows[0]!.n;
    assert.equal(checks,6);
    assert.equal((await db.query<{n:number}>("SELECT count(*)::int n FROM cp_job_transfer_breaker WHERE action='PAUSE'")).rows[0]!.n,0);
    t.diagnostic(JSON.stringify({testStore:true,beforeGbPerHour:before/1e9,afterGbPerHour:after/1e9,requestBytes:sent,responseBytes:received,requests}));
  } finally {
    neonConfig.fetchFunction=previous;
    if(previousReport===undefined)delete process.env.WTP_VITAL_SIGNS_REPORT;else process.env.WTP_VITAL_SIGNS_REPORT=previousReport;
    await db.close();rmSync(root,{recursive:true,force:true});
  }
});
