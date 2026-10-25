/** Replay the normal bill refresh on an explicit, isolated production branch. */
import assert from "node:assert/strict";
import { readFile,writeFile,mkdir } from "node:fs/promises";
import { resolve,join } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import type { Officeholder } from "../lib/officials/types.ts";
import type { BillIndex,BillSession,BillPart } from "../lib/sources/legiscan/bills.ts";

const arg=(name:string)=>process.argv.find(value=>value.startsWith(`--${name}=`))?.slice(name.length+3);
const mode=arg("mode"),connectionFile=arg("copy-connection-file"),directory=resolve(arg("directory")??".scratch/bl02-bills");
assert.ok(connectionFile,"An explicit production-copy connection file is required");
const connection=(await readFile(connectionFile,"utf8")).trim(),host=new URL(connection).hostname;
assert.ok(host.startsWith("ep-")&&!host.startsWith("ep-dry-river-"),"Refuse the production endpoint");
assert.equal(host,arg("copy-host"),"Pin the exact isolated copy endpoint");
process.env.DATABASE_URL=connection;process.env.WTP_DB_ROLE="local";process.env.WTP_RUNTIME_MODE="staging";
if(arg("control-copy-connection-file")) {
  const control=(await readFile(arg("control-copy-connection-file")!,"utf8")).trim();
  assert.equal(new URL(control).hostname,arg("control-copy-host"),"Pin the control-plane copy endpoint");
  process.env.WTP_CONTROL_PLANE_DATABASE_URL=control;
}
delete process.env.WTP_CIVIC_READ_CACHE_URL;delete process.env.WTP_CIVIC_READ_CACHE_TOKEN;
await mkdir(directory,{recursive:true});
const root=resolve(arg("implementation")??process.cwd());
const moduleAt=<T,>(path:string)=>import(pathToFileURL(join(root,path)).href) as Promise<T>;
const [{PostgresRoutineDataStore},{readStatePeopleProjection},{readBillsForState,billsForPerson},{stateOfDataset,LEGISCAN_BULK_SCOPE,LEGISCAN_SPONSOR_MATCH}]=await Promise.all([
  moduleAt<typeof import("../lib/civic-data/store.ts")>("lib/civic-data/store.ts"),
  moduleAt<typeof import("../lib/state-rollcalls/legislators.ts")>("lib/state-rollcalls/legislators.ts"),
  moduleAt<typeof import("../lib/sources/legiscan/reader.ts")>("lib/sources/legiscan/reader.ts"),
  moduleAt<typeof import("../lib/sources/legiscan/bills.ts")>("lib/sources/legiscan/bills.ts"),
]);
const store=new PostgresRoutineDataStore({purge:async()=>({purged:false,detail:"isolated production copy"})});
const {installNeonRequestDeadline}=await moduleAt<typeof import("../lib/ops/neon-request-deadline.ts")>("lib/ops/neon-request-deadline.ts");installNeonRequestDeadline();
const sha=(value:unknown)=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
const save=(path:string,value:unknown)=>writeFile(join(directory,path),JSON.stringify(value,null,2)+"\n");
const states="AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC".split(" ");
interface Snapshot {
  state:string;recordedAt:string;bills:number;canonicalBills:number;canonicalIds:string[];ids:string[];billIdHash:string;
  legislatorsWithBills:number;sponsoredBillLinks:number;readerFailure:string|null;removed:string[];
  people:Officeholder[];legislators:{id:string;name:string;chamber?:string;districts:string[];bills:number}[];
}
if(mode==="report") {
  const output=resolve(arg("output-directory")??"docs/measurements/bl-02-bills");await mkdir(output,{recursive:true});
  const rows=[],legislators=[];
  for(const state of states){
    const before:Snapshot=JSON.parse(await readFile(join(directory,`before-${state}.json`),"utf8"));
    const after:Snapshot=JSON.parse(await readFile(join(directory,`after-${state}.json`),"utf8"));
    if(state!=="AL"){
      assert.equal(after.readerFailure,null,`${state}: bill reader must work`);
      assert.ok(after.bills>0&&after.legislatorsWithBills>0,`${state}: current bills must reach held legislator cards`);
    }
    const members=after.legislators.map(person=>({...person,state,nativeIds:after.people.find(row=>row.id===person.id)?.nativeIds??{},before:before.legislators.find(row=>row.id===person.id)?.bills??0,after:person.bills}));
    const lost=members.filter(row=>row.after<row.before),held=new Set(after.canonicalIds),visible=new Set(after.ids);
    assert.equal(before.canonicalIds.filter(id=>!held.has(id)).length,0,`${state}: canonical bill preservation`);
    assert.equal(before.ids.filter(id=>!visible.has(id)).length,0,`${state}: visible bill preservation`);
    assert.equal(lost.length,0,`${state}: legislator bill counts cannot decrease`);
    rows.push({state,before:{bills:before.bills,canonicalBills:before.canonicalBills,legislatorsWithBills:before.legislatorsWithBills,sponsoredBillLinks:before.sponsoredBillLinks,readerFailure:before.readerFailure},
      after:{bills:after.bills,canonicalBills:after.canonicalBills,legislatorsWithBills:after.legislatorsWithBills,sponsoredBillLinks:after.sponsoredBillLinks,readerFailure:after.readerFailure},
      priorCanonicalBillsPreserved:before.canonicalBills,priorVisibleBillsPreserved:before.bills,afterBillIdHash:after.billIdHash});
    legislators.push(...members.map(({bills:_bills,...row})=>row));
  }
  const refresh=JSON.parse(await readFile(join(directory,"refresh.json"),"utf8"));
  const memory=JSON.parse(await readFile(join(directory,"memory.json"),"utf8"));
  const api=JSON.parse(await readFile(join(directory,"api.json"),"utf8"));
  const scheduler={incomplete:JSON.parse(await readFile(join(directory,"scheduler-incomplete.json"),"utf8")),
    complete:JSON.parse(await readFile(join(directory,"scheduler-complete.json"),"utf8"))};
  assert.equal(scheduler.incomplete.clock.continuationPending,true);assert.equal(scheduler.incomplete.nextCycleDue,true);
  assert.equal(scheduler.complete.clock.continuationPending,false);assert.equal(scheduler.complete.nextCycleDue,false);
  const gonzales=legislators.find(row=>row.id==="az-legislature:2381"),alma=legislators.find(row=>row.state==="AZ"&&row.nativeIds["az-legislature"]?.includes("2312"));
  assert.equal(gonzales?.after,119);assert.ok(alma);assert.equal(alma.after,alma.before);
  const report={copyHost:host,branchId:arg("branch-id"),baselineSha:"4040fb2273b7a3135b86717d4cf7c9ba9dbd45e1",node:process.versions.node,recordedAt:new Date().toISOString(),productionWrites:0,
    method:"Normal source refresh and canonical reader on a full Neon branch of production; baseline uses the river checkout. Resumed verified source publications from interrupted copy attempts; historical sessions remain held. The final refresh duration is not a first-fill timing.",
    refresh,memory,api,scheduler,gonzales,alma,states:rows,legislatorRows:legislators.length,legislatorsCsv:"bills-per-legislator.csv",
    preservation:{priorVisibleBills:rows.reduce((n,row)=>n+row.before.bills,0),priorCanonicalBills:rows.reduce((n,row)=>n+row.before.canonicalBills,0),removedBillIds:0,legislatorCountsReduced:0}};
  await writeFile(join(output,"replay.json"),JSON.stringify(report,null,2)+"\n");
  const cell=(value:unknown)=>`"${String(value??"").replaceAll('"','""')}"`;
  const aliases=(ids:Readonly<Record<string,readonly string[]>>)=>[...new Set(Object.entries(ids).flatMap(([source,values])=>values.map(id=>source==="reader"?id:`${source}:${id}`)))].sort().join(";");
  const csv=["state,id,name,chamber,districts,before,after,reader_aliases",...legislators.map(row=>[row.state,row.id,row.name,row.chamber,row.districts.join(";"),row.before,row.after,aliases(row.nativeIds)].map(cell).join(","))].join("\n")+"\n";
  await writeFile(join(output,"bills-per-legislator.csv"),csv);
  console.log(JSON.stringify({states:rows.length,gonzales,alma,elapsedMs:refresh.elapsedMs,priorBillsRemoved:0,legislatorCountsReduced:0}));
} else if(mode==="api") {
  const {neon}=await import("@neondatabase/serverless");
  const sql=neon(connection);
  const {installReaderDatabaseQuery}=await moduleAt<typeof import("../lib/reader/database.ts")>("lib/reader/database.ts");
  installReaderDatabaseQuery(statements=>sql.transaction(statements.map(row=>sql.query(row.text,[...row.params])),{readOnly:true}));
  const {GET}=await moduleAt<typeof import("../app/api/bills/route.ts")>("app/api/bills/route.ts");
  const results=[];
  for(const [member,expected] of [["az-legislature:2381",119],["az-legislature:2312",66]] as const){
    const path=`/api/bills?state=AZ&member=${member}`,started=performance.now();
    const response=await GET(new Request(`https://copy.invalid${path}`));
    const value=await response.json();
    assert.equal(response.status,200);assert.equal(value.bills.length,expected);
    assert.equal(new Set(value.bills.map((row:{id:string})=>row.id)).size,expected);
    results.push({path,status:response.status,bills:value.bills.length,complete:value.complete,elapsedMs:Math.round(performance.now()-started)});
  }
  const report={copyHost:host,recordedAt:new Date().toISOString(),transport:"Real route and SQL on the production copy through a read-only Neon HTTP transaction; not a live browser timing",results};
  await save("api.json",report);console.log(JSON.stringify(report));
} else if(mode==="refresh") {
  const {admittedRuntimeChildEnvironment}=await moduleAt<typeof import("../lib/civic-data/runtime-authority.ts")>("lib/civic-data/runtime-authority.ts");
  Object.assign(process.env,admittedRuntimeChildEnvironment({capability:"ROUTINE_CONTRACT",contract:"legiscan-bulk"}));
  const {refreshLegiscan}=await moduleAt<typeof import("./legiscan-bulk.mts")>("scripts/legiscan-bulk.mts");
  const {routineTaskFromContract,routineTaskDue}=await moduleAt<typeof import("../lib/civic-data/runner.ts")>("lib/civic-data/runner.ts");
  const {requiredRoutineContract}=await moduleAt<typeof import("../lib/civic-data/contracts.ts")>("lib/civic-data/contracts.ts");
  const task=routineTaskFromContract(requiredRoutineContract("legiscan-bulk"));
  const beforeClock=await store.clock(task.sourceId,task.recordClass,task.scope,task.parserVersion);
  const started=performance.now();
  const result=await refreshLegiscan(store,new AbortController().signal,{peopleForState:async(state:string)=>{
    if(state==="US")return [];
    const before=JSON.parse(await readFile(join(directory,`before-${state}.json`),"utf8"));return before.people;
  }});
  const afterClock=await store.clock(task.sourceId,task.recordClass,task.scope,task.parserVersion);
  const report={copyHost:host,branchId:arg("branch-id"),elapsedMs:Math.round(performance.now()-started),beforeClock,afterClock,nextCycleDue:routineTaskDue(task,afterClock,Date.now()+5*60_000),counts:result.counts};
  await save("refresh.json",report);console.log(JSON.stringify(report));
  assert.ok(states.every(state=>result.counts[state]?.datasets>=1),"Every state and DC must finish in the same cycle");
  assert.deepEqual(Object.values(result.counts).flatMap(row=>row.failures),[]);
  assert.equal(afterClock.continuationPending,false);assert.equal(report.nextCycleDue,false);
} else if(mode==="before"||mode==="after") {
  const selected=arg("states")?.split(",")??states;
  assert.ok(selected.every(state=>states.includes(state)),"Snapshot states must be US states or DC");
  const index=await store.readPromotion<BillIndex>("STATE_BILL",LEGISCAN_BULK_SCOPE);
  const {bulkDatasetOrder}=await moduleAt<typeof import("./legiscan-bulk.mts")>("scripts/legiscan-bulk.mts");
  const plan=mode==="after"?bulkDatasetOrder(index?.payload.datasets??[]):[];
  const refresh:{counts:Record<string,{emptySessions:number[]}>}|null=mode==="after"?await readFile(join(directory,"refresh.json"),"utf8").then(value=>JSON.parse(value)).catch(()=>null):null;
  if(mode==="after")assert.ok(index?.payload.datasets.some(row=>row.year_start!==undefined),"The publisher's session years must be loaded before the after comparison");
  for(const state of selected) {
    if(mode==="after"){
      const saved=await readFile(join(directory,`after-${state}.json`),"utf8").catch(()=>null);
      if(saved)continue;
      const planned=plan.filter(row=>stateOfDataset(row)===state),empty=new Set(refresh?.counts[state]?.emptySessions??[]);
      const sessions=await store.readPromotions<BillSession>("STATE_BILL",planned.map(d=>`legiscan-bills:session:${d.session_id}`));
      if(!planned.length||!planned.every(dataset=>empty.has(dataset.session_id)||sessions.some(row=>row.payload.dataset.session_id===dataset.session_id&&row.payload.dataset.dataset_hash===dataset.dataset_hash&&row.payload.sponsorMatchVersion===LEGISCAN_SPONSOR_MATCH))){
        if(arg("available-only")==="true")continue;
        throw Error(`${state}: current-session publication is still pending`);
      }
    }
    const started=performance.now(),now=new Date().toISOString();
    const previous:Snapshot|null=mode==="after"?JSON.parse(await readFile(join(directory,`before-${state}.json`),"utf8")):null;
    // This refresh writes only bills. Reuse the exact roster snapshot it consumed.
    const held=previous?null:await readStatePeopleProjection(`US-${state}`,{store,now,bypassCache:true});
    const people:Officeholder[]=previous?.people??(held?.kind==="PROMOTED"?held.value.roster.officeholders.filter(p=>p.level==="STATE"&&p.chamber):[]);
    let read:Awaited<ReturnType<typeof readBillsForState>>,readerFailure:string|null=null;
    try {read=await readBillsForState(state,{store,now,bypassCache:true});}
    catch(error){readerFailure=String(error);read={bills:[],complete:false,checkedAt:null};}
    // Preserve canonical held IDs even when the existing route errors (River owns Alabama).
    const heldIds=new Set<string>(read.bills.map(bill=>bill.id));
    for(const dataset of readerFailure?index?.payload.datasets.filter(d=>stateOfDataset(d)===state)??[]:[]) {
      const session=await store.readPromotion<BillSession>("STATE_BILL",`legiscan-bills:session:${dataset.session_id}`);
      if(!session)continue;
      for(const pointer of session.payload.parts??[]) {
        const part=await store.readPromotion<BillPart>("STATE_BILL",pointer.scope);
        for(const bill of part?.payload.bills??[])heldIds.add(bill.id);
      }
    }
    const legislators=people.map(person=>({id:person.id,name:person.name,chamber:person.chamber,
      districts:(person.memberships??[]).filter(row=>row.current!==false).map(row=>row.district).filter(Boolean),bills:billsForPerson(read.bills,person).length}));
    const ids=read.bills.map(bill=>bill.id).sort(),canonicalIds=[...heldIds].sort();
    const removed:string[]=previous?.canonicalIds.filter(id=>!heldIds.has(id))??[];
    const report={state,copyHost:host,branchId:arg("branch-id"),recordedAt:now,implementation:root,people,
      legislators,bills:ids.length,canonicalBills:canonicalIds.length,ids,canonicalIds,billIdHash:sha(ids),canonicalBillIdHash:sha(canonicalIds),
      legislatorsWithBills:legislators.filter(row=>row.bills>0).length,sponsoredBillLinks:legislators.reduce((sum,row)=>sum+row.bills,0),
      readerFailure,removed,elapsedMs:Math.round(performance.now()-started)};
    await save(`${mode}-${state}.json`,report);
    console.log(JSON.stringify({mode,state,bills:report.bills,legislators:people.length,withBills:report.legislatorsWithBills,removed:removed.length,readerFailure,elapsedMs:report.elapsedMs}));
    assert.equal(removed.length,0,`${state}: preserve every previously held bill`);
  }
} else throw Error("Use --mode=before, refresh, after, api or report");
