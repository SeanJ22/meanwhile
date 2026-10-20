import assert from "node:assert/strict";
import {AsyncLocalStorage} from "node:async_hooks";
import {spawnSync} from "node:child_process";
import {readFile,writeFile} from "node:fs/promises";
import {appendFileSync} from "node:fs";
import {neon,neonConfig,Pool} from "@neondatabase/serverless";
import {CAMPAIGN_FINANCE_SOURCES} from "../lib/funding/state-sources.ts";
import {US_JURISDICTIONS} from "../lib/coverage/states.ts";
import {CAMPAIGN_PEOPLE_SQL,readCampaignMoneyPeople} from "../lib/funding/state-people.ts";
import {readCampaignFinanceForPlace} from "../lib/funding/state-reader.ts";
import {refreshCampaignMoneyState} from "../lib/funding/state-publication.ts";
import {stateCampaignEvidence} from "../lib/ask/state-campaign.ts";
import {DurableEvidenceStore} from "../lib/control-plane/evidence/durable-store.ts";
import {installFactReader} from "../lib/facts/db.ts";
import {PUBLIC_SITE_ORIGIN} from "../lib/ops/origins.ts";
import type {Query} from "../lib/facts/publish.ts";

const state=process.argv.find(arg=>arg.startsWith("--state="))?.slice(8);
const production=process.env.WTP_PRODUCTION_DATABASE_URL_READONLY,test=process.env.SRC_MN_TEST_DATABASE_URL,control=process.env.SRC_MN_TEST_CONTROL_PLANE_DATABASE_URL;
if(!production)throw new Error("The readonly production handle is required");
if(process.argv.includes("--retirement")){
  let bytesRead=0;
  neonConfig.fetchFunction=async(input:RequestInfo|URL,init?:RequestInit)=>{const response=await fetch(input,init);return new Response(response.body!.pipeThrough(new TransformStream({transform(bytes,out){bytesRead+=bytes.byteLength;out.enqueue(bytes);}})),{status:response.status,headers:response.headers});};
  const q=neon(production),rows=[];
  const [role]=await q.query("SELECT current_user,has_table_privilege(current_user,'fact','INSERT,UPDATE,DELETE') AS can_write");
  assert.equal(role.current_user,"readonly");assert.equal(role.can_write,false);
  for(const {state} of CAMPAIGN_FINANCE_SOURCES){
    const [facts]=await q.query(`SELECT count(*) AS records,count(*) FILTER(WHERE f.status='live') AS live FROM entity e JOIN fact f ON f.entity_id=e.id
      WHERE e.state=$1 AND f.produced_by LIKE $2 AND f.field LIKE 'campaign-money:%'`,[state,`campaign-finance:${state}:%`]);
    const [publications]=await q.query("SELECT count(*) AS records FROM civic_data_promotions WHERE source_id=$1 AND record_class='CAMPAIGN_FINANCE'",[`US-${state}:campaign-finance-source`]);
    const [copies]=await q.query("SELECT count(*) AS records FROM civic_data_candidates WHERE source_id=$1 AND record_class='CAMPAIGN_FINANCE'",[`US-${state}:campaign-finance-source`]);
    const [dependent]=await q.query(`SELECT
      (SELECT count(*) FROM civic_data_candidate_events e JOIN civic_data_candidates c ON c.id=e.candidate_id WHERE c.source_id=$1 AND c.record_class='CAMPAIGN_FINANCE') AS events,
      (SELECT count(*) FROM owner_flag o JOIN fact f ON f.id=o.fact_id JOIN entity e ON e.id=f.entity_id
        WHERE e.state=$2 AND f.produced_by LIKE $3 AND f.field LIKE 'campaign-money:%') AS flags,
      (SELECT count(*) FROM pass_cursor WHERE name LIKE $3) AS checkpoints`,[`US-${state}:campaign-finance-source`,state,`campaign-finance:${state}:%`]);
    rows.push({state,facts:Number(facts.records),liveFacts:Number(facts.live),publications:Number(publications.records),candidateCopies:Number(copies.records),candidateEvents:Number(dependent.events),flags:Number(dependent.flags),checkpoints:Number(dependent.checkpoints)});
  }
  const result={at:new Date().toISOString(),bytesRead,rows};
  await writeFile("/tmp/src-mn-campaign-retirement-check.json",JSON.stringify(result,null,2));console.log(JSON.stringify(result));
  assert.ok(rows.every(row=>row.facts===0 && row.publications===0 && row.candidateCopies===0 && row.candidateEvents===0 && row.flags===0 && row.checkpoints===0),"The replaced campaign load still has stored facts or publications");
  process.exit(0);
}
if(!test || !control)throw new Error("Separate reader and control-plane production copies are required");
assert.notEqual(new URL(test).hostname.replace("-pooler",""),new URL(production).hostname.replace("-pooler",""));
process.env.SRC_MN_TEST_DATABASE_URL=test;
process.env.DATABASE_URL=production;process.env.WTP_DB_ROLE="production";process.env.WTP_VITAL_SIGNS_REPORT="1";
const reportPath=process.env.SRC_MN_CHECK_REPORT??"/tmp/src-mn-ready2-publisher-results.json";
let productionResponseBytes=0;
const databaseScope=new AsyncLocalStorage<"reader"|"control">();
const traffic={reader:{read:0,sent:0},control:{read:0,sent:0}};
process.on("exit",code=>{if(state)appendFileSync("/tmp/src-mn-state-check-exit-bytes.jsonl",JSON.stringify({state,pid:process.pid,code,productionBytesRead:productionResponseBytes,readerPrivate:traffic.reader,control:traffic.control})+"\n");});
neonConfig.fetchFunction=async(input:RequestInfo|URL,init?:RequestInit)=>{
  const response=await fetch(input,init);if(!response.body)return response;
  return new Response(response.body.pipeThrough(new TransformStream({transform(bytes,controller){productionResponseBytes+=bytes.byteLength;controller.enqueue(bytes);}})),{status:response.status,statusText:response.statusText,headers:response.headers});
};
class MeasuredSocket extends WebSocket{
  readonly database:"reader"|"control";
  constructor(url:string|URL,protocols?:string|string[]){
    super(url,protocols);
    this.database=databaseScope.getStore()??"reader";
    this.addEventListener("message",event=>{const value=event.data;traffic[this.database].read+=typeof value==="string"?Buffer.byteLength(value):value.byteLength??value.size??0;});
  }
  override send(value:Parameters<WebSocket["send"]>[0]){traffic[this.database].sent+=typeof value==="string"?Buffer.byteLength(value):value instanceof Blob?value.size:value.byteLength;super.send(value);}
}
neonConfig.webSocketConstructor=MeasuredSocket;
const selectedPeople=process.env.SRC_MN_CHECK_PERSON_IDS?.split(",");
const prod=neon(production),productionQuery:Query=async(text,params=[])=>await prod.query(
  selectedPeople && text===CAMPAIGN_PEOPLE_SQL?`SELECT * FROM (${text}) p WHERE id=ANY($3::text[])`:text,
  selectedPeople && text===CAMPAIGN_PEOPLE_SQL?[...params,selectedPeople]:[...params]);
const [role]=await productionQuery("SELECT current_user,current_setting('neon.branch_id',true) AS branch,has_table_privilege(current_user,'fact','INSERT,UPDATE,DELETE') AS can_write");
assert.equal(role.current_user,"readonly");assert.equal(role.can_write,false);
const url=new URL(test);url.hostname=url.hostname.replace("-pooler.",".");
const pool=new Pool({connectionString:url.href,max:1,connectionTimeoutMillis:15000});
pool.on("error",()=>console.warn("An idle private test connection closed; the pool will replace it."));
const query:Query=(text,params=[])=>databaseScope.run("reader",async()=>{const result=await pool.query(text,[...params]);return result.rows;});
const [identity]=await query("SELECT current_setting('neon.branch_id',true) AS branch,current_user");
assert.ok(identity.branch && identity.branch!==role.branch);assert.notEqual(identity.current_user,"readonly");
assert.equal(identity.branch,process.env.SRC_MN_READER_COPY_BRANCH,"The reader copy must match its declared branch");
if(!state){
  try{
    const from=process.argv.find(arg=>arg.startsWith("--from="))?.slice(7);
    const rows:Record<string,unknown>[]=from?await readFile(reportPath,"utf8").then(text=>JSON.parse(text).rows).catch(error=>{if(error.code==="ENOENT")return [];throw error;}):[];
    for(const source of CAMPAIGN_FINANCE_SOURCES.slice(from?CAMPAIGN_FINANCE_SOURCES.findIndex(source=>source.state===from):0)){
      const child=spawnSync(process.execPath,["--max-old-space-size=112","--max-semi-space-size=4","--experimental-strip-types","--import","./scripts/register-test-loader.mjs",import.meta.filename,`--state=${source.state}`],{encoding:"utf8",env:process.env});
      if(child.status!==0){const path=`/tmp/src-mn-${source.state}-check-failure.log`;await writeFile(path,child.stderr);throw new Error(`${source.state} worker failed (${child.status}); details saved in ${path}`);}
      rows.push(JSON.parse(child.stdout.trim().split("\n").at(-1)!));
      await writeFile(reportPath,JSON.stringify({at:new Date().toISOString(),readerCopy:identity.branch,controllerProductionBytesRead:productionResponseBytes,controllerTestResponseBytes:traffic.reader.read,controllerTestRequestBytes:traffic.reader.sent,rows},null,2));
      console.log(JSON.stringify(rows.at(-1)));
    }
  }finally{await pool.end();}
}else{
  const controlUrl=new URL(control);controlUrl.hostname=controlUrl.hostname.replace("-pooler.",".");
  const controlPool=new Pool({connectionString:controlUrl.href,max:1,connectionTimeoutMillis:15000});
  controlPool.on("error",()=>console.warn("An idle private control connection closed; the pool will replace it."));
  const controlQuery:Query=(text,params=[])=>databaseScope.run("control",async()=>{const result=await controlPool.query(text,[...params]);return result.rows;});
  const [controlIdentity]=await controlQuery("SELECT current_setting('neon.branch_id',true) AS branch,current_user");
  assert.ok(controlIdentity.branch && controlIdentity.branch!==identity.branch && controlIdentity.branch!==role.branch);assert.notEqual(controlIdentity.current_user,"readonly");
  assert.equal(controlIdentity.branch,process.env.SRC_MN_CONTROL_COPY_BRANCH,"The control-plane copy must match its declared branch");
  const {pgAggregateRepository}=await import("../lib/control-plane/repository/pg-store.ts");
  const doors=pgAggregateRepository<import("../lib/doors/registry.ts").DoorRecord>({query:controlQuery},"Door","cp_doors");
  const started=performance.now(),people=await readCampaignMoneyPeople(productionQuery,state);
  const size=async()=>Number((await query("SELECT pg_database_size(current_database()) AS bytes"))[0].bytes);
  try{
    const before=await size(),place=US_JURISDICTIONS.find(place=>place.usps===state)!;
    const division=`ocd-division/country:us/${place.prefix}:${place.slug}`;
    const facts={query,transaction:async<T,>(work:(query:Query)=>Promise<T>)=>{
      const client=await pool.connect();
      try{await client.query("BEGIN");const value=await work(async(text,params=[])=>{const result=await client.query(text,[...params]);return result.rows;});await client.query("COMMIT");return value;}
      catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
    }};
    let bulkDownloads=0;
    const result=await refreshCampaignMoneyState({state,query:productionQuery,facts,doors,vault:new DurableEvidenceStore("/tmp/src-mn-ready2-source-evidence",{remote:null}),directory:"/tmp/src-mn-ready2-source-cache",purge:async()=>({purged:true}),
      ...(process.env.SRC_MN_CHECK_AT?{now:()=>process.env.SRC_MN_CHECK_AT!}:{}),
      fetch:async(input,init)=>{if(new URL(String(input)).pathname.includes("/resource/"))bulkDownloads++;return fetch(input,init);}});
    installFactReader(query);
    const readStart=performance.now(),read=await readCampaignFinanceForPlace(division,{query}),readerMs=performance.now()-readStart;
    const ask=await stateCampaignEvidence([division],undefined,{query});
    assert.equal(ask.records.length,read.records.reduce((sum,row)=>sum+row.sources.length,0));
    assert.ok(read.records.every(row=>row.cycle>=2020 && row.person.id && row.person.seat));
    let apiMs:number|null=null,personApiMs:number|null=null;
    if(["DC","FL","CO","AZ"].includes(state)){
      const {GET}=await import("../app/api/campaign-finance/route.ts");
      const begin=performance.now(),response=await GET(new Request(`${PUBLIC_SITE_ORIGIN}/api/campaign-finance?division=${encodeURIComponent(division)}`));
      const value=await response.json();apiMs=performance.now()-begin;assert.equal(response.status,200);assert.deepEqual(value.records,read.records);
      const person=read.records[0]?.person.id??people[0]?.id;
      if(person){const {GET:personGET}=await import("../app/api/funding/[target]/route.ts");const begin=performance.now();const response=await personGET(new Request(`${PUBLIC_SITE_ORIGIN}/api/funding/${encodeURIComponent(person)}?division=${encodeURIComponent(division)}`),{params:Promise.resolve({target:person})});const value=await response.json();personApiMs=performance.now()-begin;assert.equal(response.status,200);assert.equal(value.kind,"state-cycle");}
      assert.ok(apiMs<3000 && readerMs<3000 && (personApiMs??0)<3000,`${state} money reads exceeded three seconds`);
    }
    const [counts]=await query(`SELECT count(*) FILTER(WHERE f.field LIKE 'campaign-money:%') AS rows,count(*) FILTER(WHERE f.field LIKE 'campaign-cycle:%') AS cycles
      FROM fact f JOIN entity e ON e.id=f.entity_id WHERE e.state=$1 AND f.status='live' AND (e.id=ANY($2::text[]) OR e.parent_id=ANY($2::text[]))`,[state,people.map(person=>person.id)]);
    const after=await size();
    assert.ok(traffic.control.read>0 && traffic.reader.read>0,"Both private database connections must be measured");
    console.log(JSON.stringify({...result.report.records[0],privateRawRows:Number(counts.rows),privateCycleSummaries:Number(counts.cycles),productionBytesRead:productionResponseBytes,productionBytesWritten:0,testRequestBytes:traffic.reader.sent+traffic.control.sent,testResponseBytes:traffic.reader.read+traffic.control.read,
      readerResponseBytes:productionResponseBytes+traffic.reader.read,readerRequestBytes:traffic.reader.sent,controlResponseBytes:traffic.control.read,controlRequestBytes:traffic.control.sent,testDatabaseGrowthBytes:after-before,readerMs,apiMs,personApiMs,bulkDownloads,
      readerDescription:read.records.length?`${read.records[0].person.name}: ${read.records[0].cycle} cycle totals and ${read.records[0].donors?.length??0} named contributors on this page`:'We\'re working on getting this info',elapsedMs:performance.now()-started,peakRssBytes:process.resourceUsage().maxRSS*1024}));
  }finally{installFactReader(undefined);await controlPool.end();await pool.end();}
}
