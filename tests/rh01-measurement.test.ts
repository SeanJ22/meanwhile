import assert from "node:assert/strict";
import test from "node:test";
import { allowedMeasurementRequest, assertNeededProductionRead } from "../scripts/rh01-network.mjs";
import { spawn } from "node:child_process";
import { copyFile, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { once } from "node:events";
import { DatabaseSync } from "node:sqlite";
import { measuredCompletion } from "../scripts/rh01-completion.mts";
import { projectedRead, updateRead, shadowRead } from "../scripts/rh01-sql.mts";
import { commandIdentity, workloadOffers } from "../scripts/rh01-workload.mts";
import { physicalRunReads, reserveProductionReadRun } from "../scripts/rh01-read-accounting.mts";

test("all-offer ownership retains exact modes and aliases only identical authority and commands", () => {
  const job = (id: string, command: readonly string[], source = "standing runner") => ({ id, command, source, script: command[0] });
  const rows = workloadOffers([
    job("runtime:pilot-runner", ["scripts/pilot-runner.mts", "--staging"]),
    job("runtime:routine-civic-data-runner", ["scripts/routine-civic-data-runner.mts"]),
    job("runtime:freshness-shadow", ["scripts/freshness-shadow.mts", "--no-model"]),
    job("source:CA", ["scripts/source.mts", "--state=CA"], "standing source contract"),
    job("source:TX", ["scripts/source.mts", "--state=TX"], "standing source contract"),
    job("source:CA-alias", ["scripts/source.mts", "--state=CA"], "standing source contract"),
    { ...job("source:CA-manual", ["scripts/source.mts", "--state=CA"], "standing source contract"), authority: { capability: "MANUAL_CONTRACT", contract: "CA" } },
  ]);
  assert.equal(rows[1].ownerId, "runtime:pilot-runner"); assert.equal(rows[2].ownerId, null);
  assert.equal(rows[3].ownerId, "runtime:routine-civic-data-runner"); assert.equal(rows[4].aliasOf, null);
  assert.equal(rows[5].aliasOf, "source:CA"); assert.equal(rows[6].aliasOf, null);
  assert.equal(commandIdentity(["--experimental-strip-types", "--import", "/workspace/archive/scripts/register-test-loader.mjs", "/workspace/archive/scripts/source.mts", "--state=CA"]), commandIdentity(["scripts/source.mts", "--state=CA"]));
  assert.notEqual(commandIdentity(["scripts/source.mts", "--state=CA"]), commandIdentity(["scripts/source.mts", "--state=TX"]));
});

test("SQL hydration retains the outer predicate and reads every UPDATE predecessor without executing its mutation remotely", () => {
  const source = "SELECT f.id,(SELECT s.url FROM source_copy s WHERE s.id=f.source_copy_id) AS url FROM fact f WHERE f.entity_id=$1 FOR UPDATE";
  assert.equal(projectedRead(source, "f.*"), "SELECT f.* FROM fact f WHERE f.entity_id=$1 ");
  assert.equal(projectedRead("WITH f AS (SELECT * FROM fact) SELECT * FROM f", "f.*"), null);
  assert.deepEqual(updateRead("UPDATE fact f SET status='superseded' FROM source_copy s WHERE s.id=f.source_copy_id AND f.entity_id=$1 RETURNING f.id"), {
    table: "fact", text: "SELECT f.* FROM fact f,  source_copy s  WHERE s.id=f.source_copy_id AND f.entity_id=$1 ",
  });
  assert.deepEqual(updateRead("UPDATE fact SET status=$1 WHERE entity_id=$2"), {
    table: "fact", text: "WITH rh01_unused AS (SELECT $1::text) SELECT fact.* FROM fact fact WHERE entity_id=$2",
  });
});

test("read-only SQL shadows preserve mixed production/local joins, filters, keysets and aggregates", async () => {
  const { PGlite } = await import("@electric-sql/pglite");
  const db = new PGlite();
  try {
    await db.exec("CREATE TABLE entity(id text PRIMARY KEY,name text,state text,parent_id text); INSERT INTO entity VALUES ('a','A','CA',null),('b','B','CA','a'),('z','Z','TX',null)");
    const shadows = [{ table: "entity", keys: ["id"], rows: [
      { id: "b", name: "B moved", state: "TX", parent_id: "a" }, { id: "c", name: "C new", state: "CA", parent_id: "a" },
    ] }];
    const query = shadowRead("WITH RECURSIVE selected AS (SELECT e.id,e.parent_id FROM public.entity e WHERE e.state=$1) SELECT s.id,p.name AS parent FROM selected s LEFT JOIN entity p ON p.id=s.parent_id WHERE s.id>$2 ORDER BY s.id LIMIT 1", ["CA", "a"], shadows);
    assert.deepEqual((await db.query(query.text, query.params)).rows, [{ id: "c", parent: "A" }]);
    const count = shadowRead("SELECT count(*)::integer AS n FROM entity WHERE state=$1", ["CA"], shadows);
    assert.deepEqual((await db.query(count.text, count.params)).rows, [{ n: 2 }]);
    assert.throws(() => shadowRead("WITH x AS (DELETE FROM entity RETURNING *) SELECT * FROM x", [], shadows), /REQUIRES_READ/);
    assert.throws(() => shadowRead("SELECT * FROM entity", [], [{ table: "entity;DELETE", keys: ["id"], rows: [{}] }]), /IDENTITY_INVALID/);
  } finally { await db.close(); }
});

test("completion evidence refuses exit-only, failed receipts, incomplete parents, and refused worker replays", () => {
  const check = (script: string, stdout = "", stderr = "", receipt?: { acquisitionSucceeded: boolean; decision: string; state?: string }) =>
    measuredCompletion({ script, stdout, stderr, receipt, code: 0, timedOut: false }).complete;
  assert.equal(check("scripts/look-pass.mts"), false);
  assert.equal(check("scripts/source.mts", "", "", { acquisitionSucceeded: true, decision: "FAIL", state: "SOURCE_BLOCKED" }), false);
  const held = measuredCompletion({ script: "scripts/source.mts", stdout: "", stderr: "", code: 2, timedOut: false,
    receipt: { acquisitionSucceeded: true, decision: "FAIL", state: "HORIZON_UNRESOLVED" } });
  assert.equal(held.complete, true); assert.equal(held.successful, false);
  assert.equal(check("scripts/source.mts", "", "", { acquisitionSucceeded: true, decision: "GOOD" }), true);
  assert.equal(check("scripts/promote-registry-runtime.mts", "", "", { acquisitionSucceeded: true, decision: "GOOD" }), false);
  assert.equal(check("scripts/promote-registry-runtime.mts", 'RH01_NATIONAL_RESULT {"zip":"85535","completed":true}', "", { acquisitionSucceeded: true, decision: "GOOD" }), true);
  assert.equal(check("scripts/claim-audit-pass.mts", "claim audit: this week is already checked; nothing to do"), false);
  const parent = 'RCD_OPERATIONAL_OUTCOME={"state":"SUCCEEDED","durable":true}\n';
  assert.equal(check("scripts/routine-civic-data-runner.mts", parent + 'RCD_RUN={"denominator":2,"attempted":1,"failed":0,"skipped":1}'), false);
  assert.equal(check("scripts/routine-civic-data-runner.mts", parent + 'RCD_RUN={"denominator":2,"attempted":2,"failed":0,"skipped":0}'), true);
  assert.equal(check("scripts/rh01-control-replay.mts", 'RH01_REPLAY {"complete":true,"reports":[{"claimed":true,"outcome":"FAILED"}]}'), false);
  assert.equal(check("scripts/rh01-control-replay.mts", 'RH01_REPLAY {"complete":true,"committedResultId":"wr-measured","reports":[{"claimed":true,"outcome":"WORKED"}]}'), true);
  assert.equal(check("scripts/rh01-control-replay.mts", 'RH01_REPLAY {"complete":true,"reports":[{"claimed":true,"outcome":"COMPLETED"}]}', "RH01_REMOTE_WRITE_BLOCKED:POST"), false);
  assert.equal(check("scripts/freshness-shadow.mts", 'RH01_FRESHNESS_RESULT {"state":"SUCCEEDED","durable":true,"simulated":false,"filtered":false,"registeredUnits":10,"workedUnits":9,"cycleId":"one"}'), false);
  assert.equal(check("scripts/freshness-shadow.mts", 'RH01_FRESHNESS_RESULT {"state":"SUCCEEDED","durable":true,"simulated":false,"filtered":false,"registeredUnits":10,"workedUnits":10,"cycleId":"one"}'), true);
  assert.equal(check("scripts/hunter-lane.mts", 'hunter lane: armed; paid work held\nhunter lane: ended after 1 wave(s), 2 task result(s): a release asked it to drain'), false);
  assert.equal(check("scripts/hunter-lane.mts", 'hunter lane: armed; paid work held\nhunter lane: ended after 1 wave(s), 2 task result(s): its life ended; the runner starts a fresh lane'), true);
  assert.equal(check("scripts/hunter-lane.mts", 'hunter lane: armed; paid work held\nhunter lane: ended after 0 wave(s), 0 task result(s): its life ended; the runner starts a fresh lane'), false);
  assert.equal(check("scripts/pilot-runner.mts", 'pilot-runner · 1 cycle(s) complete.'), false);
  assert.equal(check("scripts/pilot-runner.mts", 'RH01_PILOT_CYCLE {"ok":true,"recorded":true,"registeredUnits":10,"workedUnits":10}\npilot-runner · 1 cycle(s) complete.'), true);
});

test("measurement permits source reads and declared public query forms while refusing external writes and model calls", () => {
  assert.equal(allowedMeasurementRequest("https://api.github.com/repos/unitedstates/congress-legislators/commits", "GET"), true);
  assert.equal(allowedMeasurementRequest("https://api.github.com/repos/owner/repo/issues", "POST"), false);
  assert.equal(allowedMeasurementRequest("https://api.netlify.com/api/v1/purge", "POST"), false);
  assert.equal(allowedMeasurementRequest("https://hooks.slack.com/services/test", "POST"), false);
  assert.equal(allowedMeasurementRequest("https://api.anthropic.com/v1/messages", "POST"), false);
  assert.equal(allowedMeasurementRequest("https://api.exa.ai/search", "GET"), false);
  assert.equal(allowedMeasurementRequest("https://meanwhile.example/api/ask?question=test", "GET"), false);
  assert.equal(allowedMeasurementRequest("https://cfsapi.sos.nh.gov/api/PublicFilerDetails/GetFilingEntityDetails", "POST"), true);
  assert.equal(allowedMeasurementRequest("https://mesa.legistar.com/Calendar.aspx", "POST"), true);
  assert.equal(allowedMeasurementRequest("https://mesa.legistar.com/Admin.aspx", "POST"), false);
  assert.equal(allowedMeasurementRequest("http://127.0.0.1:1234/query", "POST"), true);
});

test("production checks reject whole rows without job scope while allowing exact identities and projected fields", () => {
  assert.throws(() => assertNeededProductionRead("SELECT id,revision,value FROM cp_work_items ORDER BY id"), /whole rows require exact job scope/);
  assert.throws(() => assertNeededProductionRead("SELECT id,revision,value FROM cp_work_items WHERE id>$1 ORDER BY id LIMIT 32"), /cursor-only hydration/);
  assert.throws(() => assertNeededProductionRead("SELECT * FROM fact WHERE TRUE"), /whole rows require exact job scope/);
  assert.throws(() => assertNeededProductionRead("WITH x AS (DELETE FROM fact RETURNING *) SELECT * FROM x"), /only read SQL/);
  assert.doesNotThrow(() => assertNeededProductionRead("SELECT id,revision,value FROM cp_work_items WHERE id=$1"));
  assert.doesNotThrow(() => assertNeededProductionRead("SELECT position,record FROM cp_log_worker_results WHERE log_key=$1 AND position>$2 ORDER BY position LIMIT 100"));
  assert.doesNotThrow(() => assertNeededProductionRead("SELECT f.* FROM fact f WHERE f.entity_id=ANY($1::text[])"));
  assert.doesNotThrow(() => assertNeededProductionRead("SELECT id,value->>'state' AS state FROM cp_work_items WHERE id>$1 ORDER BY id LIMIT 32"));
  assert.doesNotThrow(() => assertNeededProductionRead("SELECT current_user,has_table_privilege(current_user,'fact','INSERT') AS can_write"));
});

test("the installed boundary refuses fetch, native HTTPS, shell, and GitHub writes before any network call", async () => {
  const moduleUrl = new URL("../scripts/rh01-network.mjs", import.meta.url).href;
  const source = `import { installMeasurementNetworkBoundary } from ${JSON.stringify(moduleUrl)};
    import https from 'node:https'; import child from 'node:child_process';
    installMeasurementNetworkBoundary();
    const refused=[];
    for (const operation of [()=>fetch('https://api.github.com/repos/owner/repo/issues',{method:'POST'}),
      ()=>https.request('https://api.github.com/repos/owner/repo/issues',{method:'POST'}),
      ()=>child.exec('gh pr create'),()=>child.spawn('gh',['pr','create']),()=>child.spawn('curl',['-X','POST','https://example.com'])]) {
      try { await operation(); refused.push(false); } catch(error) { refused.push(/RH01_REMOTE_(WRITE|COMMAND)_BLOCKED/.test(error.message)); }
    }
    console.log(JSON.stringify(refused));`;
  const child = spawn(process.execPath, ["--input-type=module", "-e", source], { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] });
  let output = "", error = "";
  child.stdout.on("data", chunk => { output += chunk; }); child.stderr.on("data", chunk => { error += chunk; });
  const [status] = await once(child, "close");
  assert.equal(status, 0, error);
  assert.deepEqual(JSON.parse(output), [true, true, true, true, true]);
});

test("the boundary retries only recognized read SQL after transient tunnel errors", async () => {
  const moduleUrl = new URL("../scripts/rh01-network.mjs", import.meta.url).href;
  const source = `import assert from 'node:assert/strict';
    let calls=0, mode='transient';
    globalThis.fetch=async(_input,init)=>{
      calls++;
      if(mode==='transient') {
        assert.equal(new Headers(init.headers).get('connection'),'close');
        return calls===1?new Response('upstream connect error: cloudflare_https_tunnel',{status:503}):Response.json({rows:[]});
      }
      return new Response(mode==='denied'?'access denied':'upstream connect error: cloudflare_https_tunnel',{status:mode==='denied'?403:503});
    };
    const {installMeasurementNetworkBoundary}=await import(${JSON.stringify(moduleUrl)});
    installMeasurementNetworkBoundary();
    const url='https://ep-test.c-4.us-east-2.aws.neon.tech/sql';
    const run=query=>fetch(url,{method:'POST',body:JSON.stringify({query})});
    assert.equal((await run('SELECT 1')).status,200);assert.equal(calls,2);
    calls=0;mode='denied';assert.equal((await run('SELECT 1')).status,403);assert.equal(calls,1);
    calls=0;mode='write';await assert.rejects(()=>run('UPDATE fact SET status=$1'),/only read SQL/);assert.equal(calls,0);
    console.log('read-only-retry-verified');`;
  const child = spawn(process.execPath, ["--input-type=module", "-e", source], {
    cwd: process.cwd(), env: { ...process.env, WTP_CONTROL_PLANE_DATABASE_URL: "postgresql://wtp_cp_release_readonly:fixture@ep-test.c-4.us-east-2.aws.neon.tech/neondb" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "", stderr = "";
  child.stdout.on("data", chunk => { stdout += chunk; }); child.stderr.on("data", chunk => { stderr += chunk; });
  const [status] = await once(child, "close"); assert.equal(status, 0, stderr);
  assert.match(stdout, /read-only-retry-verified/);
});

test("production byte accounting consumes one streaming body and separates reader, control and local responses", async () => {
  const directory = await mkdtemp(join(tmpdir(), "rh01-byte-test-"));
  const moduleUrl = new URL("../scripts/rh01-network.mjs", import.meta.url).href;
  const source = `import assert from'node:assert/strict';import{readFileSync}from'node:fs';
    const text=JSON.stringify({rows:[{name:'Málaga'}]});
    globalThis.fetch=async()=>{const response=new Response(text,{headers:{'content-type':'application/json'}});
      Object.defineProperty(response,'url',{value:'https://reader.example/sql'});return response;};
    globalThis.WebSocket=class extends EventTarget{constructor(){super();}};
    const{enableProductionReadAccounting,withProductionReadOwner}=await import(${JSON.stringify(moduleUrl)});enableProductionReadAccounting('fixture');
    const request=url=>fetch(url,{method:'POST',body:JSON.stringify({query:'SELECT 1'})});
    const first=await request('https://reader.example/sql');assert.equal(first.url,'https://reader.example/sql');
    assert.deepEqual(await first.json(),{rows:[{name:'Málaga'}]});
    assert.equal(await(await request('https://control.example/sql')).text(),text);
    assert.equal(await(await request('http://127.0.0.1:1234/query')).text(),text);
    const aliased=connection=>fetch('https://api.example/sql',{method:'POST',headers:{'neon-connection-string':connection},body:JSON.stringify({query:'SELECT 1'})});
    assert.equal(await(await aliased(process.env.WTP_PRODUCTION_DATABASE_URL_READONLY)).text(),text);
    assert.equal(await(await aliased(process.env.WTP_CONTROL_PLANE_DATABASE_URL)).text(),text);
    assert.equal(await(await request('https://api.example/sql')).text(),text);
    const delegated=await Promise.all([111,222].map(ownerPid=>withProductionReadOwner({ownerPid,jobId:'source:'+ownerPid},()=>request('https://reader.example/sql'))));
    for(const response of delegated)assert.equal(await response.text(),text);
    const socket=new WebSocket('wss://reader.example/v2');
    for(const data of ['Málaga',new Uint8Array([1,2]),new Blob(['abc'])])socket.dispatchEvent(new MessageEvent('message',{data}));
    const rows=readFileSync(process.env.WTP_RH01_PRODUCTION_READ_LEDGER,'utf8').trim().split('\\n').map(JSON.parse);
    assert.equal(rows.filter(row=>row.database==='reader'&&row.transport==='http-body').reduce((n,row)=>n+row.bytes,0),Buffer.byteLength(text)*4);
    for(const ownerPid of [111,222])assert.equal(rows.filter(row=>row.ownerPid===ownerPid).reduce((n,row)=>n+row.bytes,0),Buffer.byteLength(text));
    assert.equal(rows.filter(row=>row.database==='reader'&&row.transport==='websocket-message').reduce((n,row)=>n+row.bytes,0),Buffer.byteLength('Málaga')+5);
    assert.equal(rows.filter(row=>row.database==='control-plane').reduce((n,row)=>n+row.bytes,0),Buffer.byteLength(text)*2);
    assert.equal(new Set(rows.map(row=>row.requestId)).size,7);console.log('single-stream-bytes-verified');`;
  try {
    const child = spawn(process.execPath, ["--input-type=module", "-e", source], { cwd: process.cwd(), env: { ...process.env,
      WTP_RH01_PRODUCTION_READ_LEDGER: join(directory, "bytes.jsonl"),
      WTP_PRODUCTION_DATABASE_URL_READONLY: "postgresql://readonly:fixture@reader.example/db",
      WTP_CONTROL_PLANE_DATABASE_URL: "postgresql://wtp_cp_release_readonly:fixture@control.example/db" }, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = ""; child.stdout.on("data", chunk => { stdout += chunk; }); child.stderr.on("data", chunk => { stderr += chunk; });
    const [status] = await once(child, "close"); assert.equal(status, 0, stderr + stdout); assert.match(stdout, /single-stream-bytes-verified/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("physical run totals attribute delegated database bytes once and exclude other runs and preparation", async () => {
  const directory = await mkdtemp(join(tmpdir(), "rh01-owner-ledger-")), path = join(directory, "reads.jsonl");
  const row = { at: "2026-10-20T09:00:00Z", runId: "measured", pid: 99, ownerPid: 7, database: "reader", bytes: 123 };
  try {
    await writeFile(path, [row, { ...row, database: "control-plane", bytes: 10 }, { ...row, runId: "other" },
      { ...row, at: "2026-10-20T08:59:00Z" }, { ...row, ownerPid: 8, bytes: 50 }].map(value => JSON.stringify(value)).join("\n") + "\n");
    const totals = await physicalRunReads(path, "measured", Date.parse("2026-10-20T09:00:00Z"));
    assert.equal(totals.reader, 173); assert.equal(totals.control, 10);
    assert.deepEqual(totals.owners.get(7), { reader: 123, control: 10 });
    assert.deepEqual(totals.owners.get(8), { reader: 50, control: 0 }); assert.equal(totals.owners.has(99), false);
    const phase = await physicalRunReads(path, "measured", 0);
    assert.equal(phase.reader, 296); assert.equal(phase.control, 10);
    assert.equal(phase.reader - totals.reader, 123, "setup plus workload equals the phase total once");
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("production accounting reserves fresh identities and rejects reused or invalid phase IDs", async () => {
  const directory = await mkdtemp(join(tmpdir(), "rh01-phase-id-")), path = join(directory, "reads.jsonl");
  try {
    const first = await reserveProductionReadRun(path), second = await reserveProductionReadRun(path);
    assert.notEqual(first, second);
    assert.equal(await reserveProductionReadRun(path, "exact-before"), "exact-before");
    await assert.rejects(reserveProductionReadRun(path, "exact-before"), /already reserved/);
    await writeFile(path, JSON.stringify({ runId: "historical" }) + "\n");
    await assert.rejects(reserveProductionReadRun(path, "historical"), /already has recorded reads/);
    await assert.rejects(reserveProductionReadRun(path, "../invalid"), /invalid/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("the loader preserves PostgreSQL constructor identity, registered authority checks, local candidate transitions, and indexed source reads", async () => {
  const directory = await mkdtemp(join(tmpdir(), "rh01-provider-test-"));
  const source = `import assert from 'node:assert/strict';
    import {execFileSync} from 'node:child_process';
    const queries=[];
    globalThis.fetch=async(_input,init)=>{
      const body=JSON.parse(String(init.body));
      const check=query=>{const text=String(query.query);queries.push(text);assert.ok(!/^\\s*(INSERT|UPDATE|DELETE|CREATE|ALTER)\\b/i.test(text),'remote mutation');return{fields:[],rows:[],rowCount:0,command:'SELECT'};};
      return Response.json(body.queries?{results:body.queries.map(check)}:check(body));
    };
    await import('./scripts/rh01-loader.mjs');
    const sourceCatalog=await import('./data/campaign-finance/sources.json',{with:{type:'json'}});
    assert.ok(sourceCatalog.default);
    const {PostgresRoutineDataStore,MemoryRoutineDataStore}=await import('./lib/civic-data/store.ts');
    const {failedAcquisitionCandidate}=await import('./lib/civic-data/candidate-builders.ts');
    const {requiredRoutineContract}=await import('./lib/civic-data/contracts.ts');
    const {routineTaskFromContract}=await import('./lib/civic-data/runner.ts');
    const {processRegisteredRoutineCandidate}=await import('./lib/civic-data/promotion.ts');
    const store=new PostgresRoutineDataStore();assert.equal(store instanceof PostgresRoutineDataStore,true);assert.equal(store instanceof MemoryRoutineDataStore,false);
    const {routineOverlay,routineStoreIdentity}=await import('./scripts/rh01-readonly-runtime.mts');
    const identity={key:'narrow',versionId:'held'},metadata={candidate:{id:'held'}},base={current:identity,lkg:metadata};
    const never=()=>{throw Error('an untouched narrow read fetched a full publication')};
    const production={readPromotionIdentity:async()=>identity,readPublishedCandidateMetadata:async()=>metadata,
      readStatePublicationBase:async()=>base,readPromotion:never,readCandidate:never};
    const narrowed=routineOverlay(production,new MemoryRoutineDataStore());
    assert.equal(await narrowed.readPromotionIdentity('CENSUS_REFERENCE','narrow'),identity);
    assert.equal(await narrowed.readPublishedCandidateMetadata('held'),metadata);
    assert.equal(await narrowed.readStatePublicationBase('CENSUS_REFERENCE','narrow'),base);
    assert.equal(routineStoreIdentity(production),narrowed);
    const task=routineTaskFromContract(requiredRoutineContract('az-state-legislators'));
    const candidate=failedAcquisitionCandidate({sourceId:task.sourceId,recordClass:task.recordClass,scope:task.scope,requestedUrl:task.requestedUrl,
      attemptedAt:new Date().toISOString(),failureDetail:'controlled source rejection',parserVersion:task.parserVersion});
    await assert.rejects(processRegisteredRoutineCandidate(store,task.id,candidate),/staging child capability or contract/);
    process.env.WTP_RUNTIME_AUTHORITY_CAPABILITY='ROUTINE_CONTRACT';
    const result=await processRegisteredRoutineCandidate(store,task.id,candidate);assert.equal(result.candidate.state,'SOURCE_BLOCKED');
    assert.equal((await store.readCandidate(candidate.id)).state,'SOURCE_BLOCKED');assert.ok((await store.events(candidate.id)).length>0);
    const childSource="const {PostgresRoutineDataStore}=await import('./lib/civic-data/store.ts');console.log(JSON.stringify(await new PostgresRoutineDataStore().readCandidate(process.env.RH01_TEST_CANDIDATE_ID)));";
    const childRead=JSON.parse(execFileSync(process.execPath,['--experimental-strip-types','--input-type=module','-e',childSource],{
      env:{...process.env,RH01_TEST_CANDIDATE_ID:candidate.id,NODE_OPTIONS:'--import='+process.cwd()+'/scripts/rh01-loader.mjs'},encoding:'utf8'}));
    assert.equal(childRead.candidate.id,candidate.id);assert.equal(childRead.state,'SOURCE_BLOCKED');
    const beforeClock=(await store.readCandidate(candidate.id)).candidate;
    assert.ok((await store.clock(task.sourceId,task.recordClass,task.scope)).lastAttemptedAt);
    assert.deepEqual((await store.readCandidate(candidate.id)).candidate,beforeClock);
    const {createPgRepositories,readPlaceArtifacts}=await import('./lib/control-plane/repository/pg-store.ts');
    const repos=await createPgRepositories(process.env.WTP_CONTROL_PLANE_DATABASE_URL,new Date().toISOString(),{skipBootstrap:true});
    await readPlaceArtifacts(repos,'https://example.gov/one','2026-01-01T00:00:00Z','2026-02-01T00:00:00Z');
    assert.ok(queries.some(text=>text.includes("md5(record->>'canonicalUrl')=md5($1)")));
    assert.ok(!queries.some(text=>/FROM cp_log_artifacts\\s+ORDER BY/i.test(text)));
    console.log(JSON.stringify({postgresBranches:true,authorityEnforced:true,localTransitions:true,indexedReads:true}));`;
  const child = spawn(process.execPath, ["--experimental-strip-types", "--import", "./scripts/register-test-loader.mjs", "--input-type=module", "-e", source], {
    cwd: process.cwd(), env: { ...process.env, NODE_OPTIONS: "", WTP_RH01_DIRECTORY: directory, WTP_RUNTIME_MODE: "staging", WTP_DB_ROLE: "local",
      DATABASE_URL: "postgresql://readonly:fixture@ep-dry-river-axwtolzc.c-4.us-east-2.aws.neon.tech/neondb",
      WTP_PRODUCTION_DATABASE_URL_READONLY: "postgresql://readonly:fixture@ep-dry-river-axwtolzc.c-4.us-east-2.aws.neon.tech/neondb",
      WTP_CONTROL_PLANE_DATABASE_URL: "postgresql://wtp_cp_release_readonly:fixture@ep-test.c-4.us-east-2.aws.neon.tech/neondb",
      WTP_RUNTIME_AUTHORITY_REPO: process.cwd(), WTP_RUNTIME_AUTHORITY_SHA: "1".repeat(40), WTP_RUNTIME_AUTHORITY_PARENT_PID: String(process.pid),
      WTP_RUNTIME_AUTHORITY_NONCE: "a".repeat(64), WTP_RUNTIME_AUTHORITY_CONTRACT: "az-state-legislators", WTP_RUNTIME_AUTHORITY_CAPABILITY: "MANUAL_CONTRACT" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "", stderr = "";
  child.stdout.on("data", chunk => { stdout += chunk; }); child.stderr.on("data", chunk => { stderr += chunk; });
  try {
    const [status] = await once(child, "close"); assert.equal(status, 0, stderr + stdout);
    assert.deepEqual(JSON.parse(stdout.trim().split("\n").at(-1)!), { postgresBranches: true, authorityEnforced: true, localTransitions: true, indexedReads: true });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("owned child observation preserves the actual launch, completion and existing callbacks", async () => {
  const directory = await mkdtemp(join(tmpdir(), "rh01-owned-child-test-"));
  const source = `import assert from 'node:assert/strict';import{readdirSync,readFileSync}from'node:fs';
    import{join}from'node:path';import{runBoundedChildPass}from'./lib/civic-data/bounded-child-pass.ts';
    import{runRuntimeChildren}from'./scripts/pilot-runtime-child.mts';
    let started=0,settled=0;
    const command={id:'actual-source',executable:process.execPath,args:['-e','console.log("actual-child-output")']};
    const [first]=await runBoundedChildPass([command],{cwd:process.cwd(),env:process.env,
      onStarting:cmd=>{cmd.onStarted=pid=>{assert.ok(pid>0);started++;};},onSettled:row=>{assert.equal(row.status,0);settled++;}});
    assert.equal(first.stdout.trim(),'actual-child-output');assert.equal(started,1);assert.equal(settled,1);
    const [second]=await runRuntimeChildren([{...command,id:'actual-runtime'}],{cwd:process.cwd(),env:process.env,maxBufferBytes:4096,
      slots:{acquire:async()=>()=>{}},onStarted:(_id,child)=>{assert.ok(child.pid>0);started++;}});
    assert.equal(second.stdout.trim(),'actual-child-output');assert.equal(started,3);
    const root=join(process.env.WTP_RH01_DIRECTORY,'observed-children');
    const rows=readdirSync(root).filter(name=>name.endsWith('.json')).map(name=>JSON.parse(readFileSync(join(root,name),'utf8')));
    assert.deepEqual(rows.map(row=>row.id).sort(),['actual-runtime','actual-source']);
    assert.ok(rows.every(row=>row.settled&&row.status===0&&row.pid>0&&row.parentPid===process.pid));
    console.log('actual-owned-child-observation-verified');`;
  try {
    const child = spawn(process.execPath, ["--experimental-strip-types", "--import", "./scripts/register-test-loader.mjs", "--import", "./scripts/rh01-loader.mjs", "--input-type=module", "-e", source], {
      cwd: process.cwd(), env: { ...process.env, NODE_OPTIONS: "", DATABASE_URL: "", WTP_RH01_DIRECTORY: directory }, stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "", stderr = ""; child.stdout.on("data", chunk => { stdout += chunk; }); child.stderr.on("data", chunk => { stderr += chunk; });
    const [status] = await once(child, "close"); assert.equal(status, 0, stderr + stdout); assert.match(stdout, /actual-owned-child-observation-verified/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("the actual pilot staging helper restamps its native research and routine child capabilities", async () => {
  const directory = await mkdtemp(join(tmpdir(), "rh01-pilot-authority-"));
  const source = `import assert from'node:assert/strict';import{readFileSync}from'node:fs';import{stripTypeScriptTypes}from'node:module';import{pathToFileURL}from'node:url';
    import{load}from'./scripts/rh01-loader.mjs';import{admittedRuntimeChildEnvironment}from'./lib/civic-data/runtime-authority.ts';
    import{withoutBillingSecrets}from'./lib/control-plane/provider-billing.ts';
    const actual=readFileSync('scripts/pilot-runner.mts','utf8');
    assert.match(actual,/withPassDeadline\\(standingChildEnvironment\\("RESEARCH_CYCLE"\\), deadlineMs\\)/);
    assert.match(actual,/withPassDeadline\\(standingChildEnvironment\\("ROUTINE_SUPERVISOR"\\), deadlineMs\\)/);
    const transformed=await load(pathToFileURL(process.cwd()+'/scripts/pilot-runner.mts').href,{},async()=>({format:'module',source:actual}));
    const helper=/function standingChildEnvironment\\([\\s\\S]*?\\n}/.exec(transformed.source)?.[0];assert.ok(helper);
    const factory=new Function('admittedRuntimeChildEnvironment','withoutBillingSecrets','const STAGING=true;'+stripTypeScriptTypes(helper)+';return standingChildEnvironment;');
    const childEnv=factory(admittedRuntimeChildEnvironment,withoutBillingSecrets);
    for(const capability of ['RESEARCH_CYCLE','ROUTINE_SUPERVISOR']) {
      const env=childEnv(capability);assert.equal(env.WTP_RUNTIME_AUTHORITY_CAPABILITY,capability);
      assert.equal(env.WTP_RUNTIME_AUTHORITY_SHA,process.env.WTP_RUNTIME_AUTHORITY_SHA);
      assert.notEqual(env.WTP_RUNTIME_AUTHORITY_NONCE,process.env.WTP_RUNTIME_AUTHORITY_NONCE);
    }
    console.log('native-staging-authority-verified');`;
  try {
    const child = spawn(process.execPath, ["--experimental-strip-types", "--import", "./scripts/register-test-loader.mjs", "--input-type=module", "-e", source], {
      cwd: process.cwd(), env: { ...process.env, NODE_OPTIONS: "", DATABASE_URL: "postgresql://readonly:fixture@reader.example/db",
        WTP_CONTROL_PLANE_DATABASE_URL: "postgresql://wtp_cp_release_readonly:fixture@control.example/db", WTP_RH01_DIRECTORY: directory,
        WTP_RUNTIME_MODE: "staging", WTP_DB_ROLE: "local", WTP_RUNTIME_AUTHORITY_REPO: process.cwd(), WTP_RUNTIME_AUTHORITY_SHA: "1".repeat(40),
        WTP_RUNTIME_AUTHORITY_CAPABILITY: "STANDING_PARENT", WTP_RUNTIME_AUTHORITY_NONCE: "a".repeat(64), WTP_RUNTIME_AUTHORITY_PARENT_PID: String(process.pid) }, stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "", stderr = ""; child.stdout.on("data", chunk => { stdout += chunk; }); child.stderr.on("data", chunk => { stderr += chunk; });
    const [status] = await once(child, "close"); assert.equal(status, 0, stderr + stdout); assert.match(stdout, /native-staging-authority-verified/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("temporary facts transactions commit and roll back across independent HTTP statements", async () => {
  const directory = await mkdtemp(join(tmpdir(), "rh01-fact-test-"));
  const child = spawn(process.execPath, ["--experimental-strip-types", "scripts/rh01-facts-server.mts"], {
    cwd: process.cwd(), env: { ...process.env, NODE_OPTIONS: "", WTP_RH01_DIRECTORY: directory,
      WTP_CONTROL_PLANE_DATABASE_URL: "",
      WTP_PRODUCTION_DATABASE_URL_READONLY: "postgresql://readonly:fixture@ep-dry-river-axwtolzc.c-4.us-east-2.aws.neon.tech/neondb" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", chunk => { stderr += chunk; });
  try {
    const endpoint = await new Promise<string>((accept, reject) => {
      let held = "";
      child.once("error", reject); child.once("exit", code => reject(Error(`facts server ended ${code}: ${stderr}`)));
      child.stdout.on("data", chunk => { held += chunk; const match = /RH01_FACTS_READY (.+)\n/.exec(held); if (match) accept(JSON.parse(match[1]).url); });
    });
    const request = async (path: string, value: unknown) => {
      const response = await fetch(endpoint.replace(/\/query$/, path), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(value) })
        .catch(error => { throw new Error(`${path}: ${String(error)}; server=${child.exitCode}/${child.signalCode}; ${stderr}`, { cause: error }); });
      const data = await response.json(); assert.equal(response.status, 200, JSON.stringify(data)); return data;
    };
    let { token } = await request("/begin", {});
    await request("/query", { token, text: "INSERT INTO pass_cursor VALUES ('rollback','one')" });
    await request("/rollback", { token });
    let result = await request("/query", { text: "SELECT count(*)::int AS n FROM pass_cursor WHERE name='rollback'" });
    assert.equal(result.rows[0].n, 0);
    ({ token } = await request("/begin", {}));
    await request("/query", { token, text: "INSERT INTO pass_cursor VALUES ('commit','one')" });
    await request("/commit", { token });
    result = await request("/query", { text: "SELECT count(*)::int AS n FROM pass_cursor WHERE name='commit'" });
    assert.equal(result.rows[0].n, 1);
    const control = async (method: string, args: unknown[]) => (await request("/control", { method, args })).result;
    await control("put", ["measurement-only", { untouched: { retained: true }, updates: [{ id: "one", value: 1 }, { id: "two", value: 2 }] }, "2026-10-20T00:00:00Z"]);
    const item = await control("compareAndSetArrayItem", ["measurement-only", 1, "updates", ["id"], "one", { id: "one", value: 3 }, "2026-10-20T00:00:01Z"]);
    assert.equal(item.revision, 2);
    const selected = await control("readArrayPage", ["measurement-only", "updates", { match: { path: ["id"], value: "one" }, limit: 1 }]);
    assert.deepEqual(selected.values, [{ id: "one", value: 3 }]);
    const retained = await control("readNarrowed", ["measurement-only", { untouched: true }]);
    assert.deepEqual(retained.value, { untouched: { retained: true } });
    const merged = await control("compareAndSetFields", ["measurement-only", 2, { finite: "changed" }, "2026-10-20T00:00:02Z"]);
    assert.deepEqual(merged.value, { finite: "changed" });
    const unchanged = await control("readArrayPage", ["measurement-only", "updates", { match: { path: ["id"], value: "two" } }]);
    assert.deepEqual(unchanged.values, [{ id: "two", value: 2 }]);
    const pacing = async (method: string, args: unknown[]) => (await request("/pacing", { method, args })).result;
    const now = Date.parse("2026-10-20T00:00:00Z");
    assert.deepEqual(await pacing("take", ["example.gov", 1, now]), { ok: true });
    assert.deepEqual(await pacing("take", ["example.gov", 1, now]), { ok: false, until: now + 3_600_000 });
    assert.equal(await pacing("reserve", ["send:example.gov", 1500, now]), now);
    assert.equal(await pacing("reserve", ["send:example.gov", 1500, now]), now + 1500);
    await pacing("hold", ["example.gov", now + 60_000, now]);
    assert.equal(await pacing("heldUntil", ["example.gov", now]), now + 60_000);
    assert.equal(await pacing("heldUntil", ["elsewhere.gov", now]), null);
    // A publication made by one child must be visible to the actual reader SQL
    // in another child, with its original GOOD/candidate/payload coupling intact.
    const { PGlite } = await import("@electric-sql/pglite");
    const { PUBLISHED_SLICE_FIXTURE_SCHEMA, insertPublishedSliceFixture } = await import("./helpers/published-slice-fixture.ts");
    const fixture = new PGlite();
    await fixture.exec(PUBLISHED_SLICE_FIXTURE_SCHEMA);
    await insertPublishedSliceFixture(fixture, { id: "local-source", sourceId: "local-source", recordClass: "CENSUS_REFERENCE", scope: "US-NH:test-readback",
      readModel: { records: [{ state: "NH", id: "needed" }, { state: "TX", id: "foreign" }] }, at: "2026-10-20T00:00:00Z" });
    const raw = (await fixture.query("SELECT c.candidate,c.validation_receipt,p.* FROM civic_data_candidates c JOIN civic_data_promotions p ON p.current_version_id=c.id")).rows[0] as Record<string, unknown>;
    await fixture.close();
    const pointer = { key: raw.key, sourceId: raw.source_id, recordClass: raw.record_class, scope: raw.scope,
      versionId: raw.current_version_id, lastKnownGoodVersionId: raw.last_known_good_version_id, promotedAt: raw.promoted_at,
      payload: raw.payload, receipt: raw.validation_receipt };
    const sqlite = new DatabaseSync(join(directory, "routine.sqlite"));
    sqlite.exec("CREATE TABLE held(kind TEXT NOT NULL,id TEXT NOT NULL,value TEXT NOT NULL,PRIMARY KEY(kind,id))");
    const save = sqlite.prepare("INSERT OR REPLACE INTO held VALUES(?,?,?)");
    save.run("promotions", String(pointer.key), JSON.stringify(pointer));
    save.run("candidates", "local-source", JSON.stringify({ candidate: raw.candidate, state: "PROMOTED", acquisitionSucceeded: true,
      receipt: raw.validation_receipt, promotedVersion: "local-source", lastKnownGoodVersion: "local-source", failureCode: null, failureDetail: null }));
    const readback = `import assert from 'node:assert/strict';
      import {readPublishedArraySlice} from './lib/civic-data/published-array-slice.ts';
      const result=await readPublishedArraySlice({recordClass:'CENSUS_REFERENCE',scope:'US-NH:test-readback',path:['records'],statePath:['state'],statePattern:'^NH$'});
      assert.deepEqual(result.records,[{state:'NH',id:'needed'}]);console.log('actual-canonical-reader-verified');`;
    const reader = spawn(process.execPath, ["--experimental-strip-types", "--import", "./scripts/register-test-loader.mjs", "--import", "./scripts/rh01-loader.mjs", "--input-type=module", "-e", readback], {
      cwd: process.cwd(), env: { ...process.env, NODE_OPTIONS: "", WTP_RH01_DIRECTORY: directory, WTP_RH01_FACTS_URL: endpoint }, stdio: ["ignore", "pipe", "pipe"],
    });
    let readerOutput = "", readerError = "";
    reader.stdout.on("data", chunk => { readerOutput += chunk; }); reader.stderr.on("data", chunk => { readerError += chunk; });
    assert.equal((await once(reader, "close"))[0], 0, readerError + readerOutput);
    assert.match(readerOutput, /actual-canonical-reader-verified/);
    const { PUBLISHED_ARRAY_SLICE_SQL, PUBLISHED_NATIVE_STATE_LOOKUP_SQL } = await import("../lib/civic-data/published-array-slice.ts");
    const native = await request("/reader-select", { statements: [{ text: PUBLISHED_NATIVE_STATE_LOOKUP_SQL,
      params: ["CENSUS_REFERENCE", ["US-NH:test-readback"], ["records"], ["id"], "^needed$", false, [], null, false, false, null] }] });
    assert.deepEqual(native.results, [[{ state: "NH" }]]);
    save.run("promotions", String(pointer.key), JSON.stringify({ ...pointer, payload: { records: [{ state: "NH", id: "tampered" }] } }));
    const invalid = await request("/reader-select", { statements: [{ text: PUBLISHED_ARRAY_SLICE_SQL,
      params: ["CENSUS_REFERENCE", "US-NH:test-readback", ["records"], ["state"], "^NH$", false, [], null, false, false, null] }] });
    assert.equal(invalid.results[0].find((row: { row_kind: string }) => row.row_kind === "publication").value.published, false);
    assert.equal(invalid.results[0].some((row: { row_kind: string }) => row.row_kind === "record"), false);
    const mutation = await fetch(endpoint.replace(/\/query$/, "/reader-select"), { method: "POST", body: JSON.stringify({ statements: [{ text: "DELETE FROM civic_data_promotions RETURNING *", params: [] }] }) });
    assert.equal(mutation.status, 500); assert.match(await mutation.text(), /RH01_SQL_SHADOW_REQUIRES_READ/);
    sqlite.close();
    const source = `import assert from 'node:assert/strict';
      import {createPgRepositories,readPlaceWorkItems} from './lib/control-plane/repository/pg-store.ts';
      const first=await createPgRepositories(process.env.WTP_CONTROL_PLANE_DATABASE_URL,undefined,{skipBootstrap:true});
      const second=await createPgRepositories(process.env.WTP_CONTROL_PLANE_DATABASE_URL,undefined,{skipBootstrap:true});
      const at='2026-10-20T00:00:00Z';
      await first.workItems.put('measurement-work',{subject:'one',retained:'yes'},at);
      assert.deepEqual((await second.workItems.readNarrowed('measurement-work',{subject:true})).value,{subject:'one'});
      await second.workItems.compareAndSet('measurement-work',1,{subject:'two',retained:'yes'},at);
      const selected=await first.workItems.listWhereNarrowed(['subject'],'two',{retained:true});
      assert.equal(selected.length,1);assert.deepEqual(selected[0].value,{retained:'yes'});
      assert.equal((await readPlaceWorkItems(first,['two'])).length,1);
      assert.equal((await first.ownerDigests.append('pages','one',{id:'one',n:1},at)).position,0);
      assert.equal((await second.ownerDigests.append('pages','two',{id:'two',n:2},at)).position,1);
      assert.equal((await first.ownerDigests.append('pages','one',{id:'one',n:1},at)).appended,false);
      assert.deepEqual(await second.ownerDigests.read('pages'),[{id:'one',n:1},{id:'two',n:2}]);
      const revisions=await Promise.allSettled([first.workItems.compareAndSet('measurement-work',2,{subject:'three'},at),second.workItems.compareAndSet('measurement-work',2,{subject:'four'},at)]);
      assert.equal(revisions.filter(row=>row.status==='fulfilled').length,1);
      console.log('actual-pg-shared-control-verified');`;
    const repositories = spawn(process.execPath, ["--experimental-strip-types", "--import", "./scripts/register-test-loader.mjs", "--import", "./scripts/rh01-loader.mjs", "--input-type=module", "-e", source], {
      cwd: process.cwd(), env: { ...process.env, NODE_OPTIONS: "", WTP_RH01_DIRECTORY: directory, WTP_RH01_FACTS_URL: endpoint,
        WTP_CONTROL_PLANE_DATABASE_URL: "postgresql://wtp_cp_release_readonly:fixture@ep-test.c-4.us-east-2.aws.neon.tech/neondb" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "", error = "";
    repositories.stdout.on("data", chunk => { stdout += chunk; }); repositories.stderr.on("data", chunk => { error += chunk; });
    const [status] = await once(repositories, "close"); assert.equal(status, 0, error + stdout);
    assert.match(stdout, /actual-pg-shared-control-verified/);
  } catch (error) {
    throw new Error(`Local measurement database failed: ${String(error)}; server=${child.exitCode}/${child.signalCode}; ${stderr}`, { cause: error });
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      const closed = once(child, "close"); child.kill("SIGTERM"); await closed;
    }
    await rm(directory, { recursive: true, force: true });
  }
});

test("local spend holds execute native SQL, preserve production, and retain released identities", async () => {
  const [{ PGlite }, schema, { pgSpendHoldRepository }, { ReadonlySpendHoldOverlay }] = await Promise.all([
    import("@electric-sql/pglite"), import("../lib/control-plane/repository/pg-schema.ts"),
    import("../lib/control-plane/repository/pg-store.ts"), import("../scripts/rh01-spend-holds.mts"),
  ]);
  const production = new PGlite(), local = new PGlite();
  try {
    await production.exec(schema.SPEND_HOLDS_TABLE_DDL); await production.exec(schema.ADMIT_SPEND_HOLD_FUNCTION_DDL);
    const native = pgSpendHoldRepository({ query: async (text, params) => (await production.query(text, [...(params ?? [])])).rows });
    const at = "2026-10-20T10:00:00.000Z";
    const lines = { sends: [{ key: "send:pima", label: "Pima diagnostic", budgetUsd: 1, historicalUsd: 0, historyReadAt: at }], areas: [] };
    const input = (holdId: string, usd: number) => ({ holdId, jobId: holdId, obligationId: "pima", lines, usd, what: "native diagnostic" });
    await native.admit(input("prior", 0.4), at);
    await native.admit({ ...input("foreign", 0.7), lines: { sends: [{ ...lines.sends[0], key: "send:foreign" }], areas: [] } }, at);
    const remote = async (text: string, params: readonly unknown[]) => {
      assertNeededProductionRead(text);
      const rows = (await production.query<Record<string, unknown>>(text, [...params])).rows;
      assert.equal(rows.some(row => row.hold_id === "foreign"), false, "unrelated budget lines cannot enter the replay");
      return rows;
    };
    const overlay = new ReadonlySpendHoldOverlay(local, remote, schema);
    const measured = pgSpendHoldRepository({ query: (text, params) => overlay.execute(text, params ?? []) });
    assert.equal((await measured.admit(input("new", 0.5), at)).admit, true);
    assert.equal((await measured.admit(input("over", 0.2), at)).admit, false);
    await measured.settle({ jobId: "new", usd: 0.1, costRecordedAt: at }, at);
    assert.equal((await measured.liveFor(["send:pima"], at)).new.settled?.usd, 0.1);
    await measured.release("prior", at);
    assert.equal((await measured.liveFor(["send:pima"], at)).prior, undefined);
    assert.equal((await measured.admit(input("after-release", 0.8), at)).admit, true);
    assert.deepEqual(Object.keys(await native.liveFor(["send:pima"], at)), ["prior"]);
  } finally { await local.close(); await production.close(); }
});

test("native PG receipt writes with a distinct harness root reach only the local SQL overlay", async () => {
  const directory = await mkdtemp(join(tmpdir(), "rh01-local-receipt-"));
  try {
    await mkdir(join(directory, "scripts"));
    await copyFile("scripts/rh01-readonly-runtime.mts", join(directory, "scripts/rh01-readonly-runtime.mts"));
    await symlink(join(process.cwd(), "node_modules"), join(directory, "node_modules"), "dir");
    const source = `import assert from 'node:assert/strict';import {pathToFileURL} from 'node:url';import {join} from 'node:path';
      import {PGlite} from '@electric-sql/pglite';
      const code=file=>import(pathToFileURL(join(process.env.WTP_RH01_CODE_ROOT,file)).href);
      const schema=await code('lib/control-plane/repository/pg-schema.ts');const db=new PGlite();
      await db.exec(schema.CHANGED_AT_TOUCH_FUNCTION_DDL);await db.exec(schema.REJECT_REWRITE_FUNCTION_DDL);
      for(const ddl of schema.BOOTSTRAP_DDL)if(/cp_log_heads|cp_log_admin_receipts|cp_admin_action_history|CREATE TABLE IF NOT EXISTS cp_work_items\\b/.test(ddl))await db.exec(ddl);
      const seen=[];globalThis.fetch=async(url,init)=>{
        assert.equal(String(url),'http://127.0.0.1:1/control-sql','a native write escaped the local overlay');
        const request=JSON.parse(init.body);seen.push(request.text);
        return Response.json({rows:(await db.query(request.text,request.params)).rows});
      };
      await import('./scripts/rh01-loader.mjs');
      const [{createPgRepositories,readPlaceWorkItems},{buildReceipt,findReceipt},{canonicalJson}]=await Promise.all([
        code('lib/control-plane/repository/pg-store.ts'),code('lib/control-plane/gateway/receipts.ts'),code('lib/control-plane/repository/types.ts')]);
      const at='2026-10-20T10:00:00.000Z',repos=await createPgRepositories(process.env.WTP_CONTROL_PLANE_DATABASE_URL,at,{skipBootstrap:true});
      const receipt=buildReceipt({request:{type:'research.resume',subject:'fleet',input:{note:'local fixture'},stateVersion:null,
        idempotencyKey:'rh01-fixture-receipt',caller:'OPERATOR_CHAT',actorRef:'local-fixture'},label:'Resume paid research',
        authority:'REVERSIBLE_NONPRODUCTION',subjectKind:'the paid research lane',subject:'RESUME:'+at,startedAt:at,completedAt:at,
        outcome:'QUEUED',says:'Local fixture only',refusal:null,openedWork:[],readBackAt:'/admin/research',undo:null,codeSha:null});
      await repos.adminReceipts.append('admin-action',receipt.receiptId,receipt,at);
      assert.equal(canonicalJson(await findReceipt(repos,receipt.receiptId)),canonicalJson(receipt));
      assert.deepEqual(await readPlaceWorkItems(repos,['ocd-division/country:us/state:az/county:pima']),[]);
      assert.ok(seen.some(sql=>sql.includes('INSERT INTO cp_admin_action_history_projection')));
      await db.close();console.log('native receipt CTE committed locally; no production endpoint called');`;
    const child = spawn(process.execPath, ["--experimental-strip-types", "--import", "./scripts/register-test-loader.mjs", "--input-type=module", "-e", source], {
      cwd: process.cwd(), env: { ...process.env, WTP_RH01_CODE_ROOT: process.env.WTP_RH01_FIXTURE_CODE_ROOT ?? process.cwd(),
        WTP_RH01_HARNESS_ROOT: directory, WTP_RH01_DIRECTORY: directory, WTP_RH01_SHARED_STATE_DIRECTORY: directory,
        WTP_RH01_FACTS_URL: "http://127.0.0.1:1/query", DATABASE_URL: "postgresql://readonly:fixture@ep-reader.neon.invalid/fixture",
        WTP_PRODUCTION_DATABASE_URL_READONLY: "postgresql://readonly:fixture@ep-reader.neon.invalid/fixture",
        WTP_CONTROL_PLANE_DATABASE_URL: "postgresql://wtp_cp_release_readonly:local-only@127.0.0.1:1/rh01" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "", stderr = ""; child.stdout.on("data", data => { stdout += data; }); child.stderr.on("data", data => { stderr += data; });
    const [status] = await once(child, "close"); assert.equal(status, 0, stderr); assert.match(stdout, /no production endpoint called/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
