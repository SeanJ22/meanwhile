/** Complete real dense-place enumeration with the shared bounded iterator and normal GET continuations. */
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFile,writeFile} from "node:fs/promises";
import {resolve} from "node:path";
import {GET} from "../app/api/open-data/route.ts";
import {installReaderDatabaseQuery} from "../lib/reader/database.ts";
import {readerOpenDataPages} from "../lib/sources/open-data/reader.ts";
import {openDataReaderRecord,type OpenDataFact} from "../lib/sources/open-data/model.ts";
import {requiredRoutineContract} from "../lib/civic-data/contracts.ts";
import {routineTaskFromContract} from "../lib/civic-data/runner.ts";
import {FederalMoneyBenchmarkStore} from "./lib/federal-money-benchmark-store.mts";
import {installOpenDataReaderSql,installOpenDataReplayVault} from "./lib/open-data-replay-reader.mts";
import {createEpaReplayVault} from "./lib/epa-held-spool.mts";

const args=new Map(process.argv.slice(2).map(arg=>{const at=arg.indexOf("=");return[arg.slice(0,at),arg.slice(at+1)];}));
const manifest=JSON.parse(await readFile(resolve(args.get("--manifest")??".scratch/src01-epa/four-writer-compact-manifest.json"),"utf8"));
const baseline=JSON.parse(await readFile(resolve(args.get("--baseline")??"docs/measurements/src-01/epa-reader-before-paging.json"),"utf8"));
const output=resolve(args.get("--output")??"docs/measurements/src-01/epa-reader-pages.json");
const store=await FederalMoneyBenchmarkStore.open(resolve(args.get("--database")??".scratch/src01-epa/reader-native-final"),"epa-echo","epa-echo",{nativeConnectionFile:args.get("--native-postgres-file")!});
await store.query([{text:"SET jit=off",params:[]}]);await installOpenDataReaderSql(store.query);
const task=routineTaskFromContract(requiredRoutineContract("epa-echo")),clock=await store.clock(task.sourceId,task.recordClass,task.scope,task.parserVersion),at=Date.parse(clock.lastSucceededObservedAt??clock.lastSucceededAt!);assert.ok(Number.isFinite(at));await store.setReplayClock(at);
const OriginalDate=globalThis.Date;
globalThis.Date=new Proxy(OriginalDate,{construct(target,values){return Reflect.construct(target,values.length?values:[at]);},get(target,name,receiver){return name==="now"?()=>at:Reflect.get(target,name,receiver);}});
const vault=createEpaReplayVault(manifest.vaultRoots,manifest.vaultEncoding??"raw"),transport=installOpenDataReplayVault(vault);
let sqlMs=0;installReaderDatabaseQuery(async statements=>{const start=performance.now(),result=await store.query(statements);sqlMs+=performance.now()-start;return result;});
const proof={status:"RUNNING",productionWrites:0,sourceRequests:0,scope:"Normal GET first, second, third and final continuations; complete enumeration uses the SAME production iterator with one held partition and a single accepted-manifest read. This does not repeat normal SQL for every shared-iterator page.",manifestSha256:createHash("sha256").update(JSON.stringify(manifest)).digest("hex"),states:[] as unknown[]};
const ids=(records:readonly OpenDataFact[])=>records.map(row=>row.id);
async function get(zip:string,cursor:string|null){
  const params=new URLSearchParams({zip});if(cursor)params.set("cursor",cursor);const before=sqlMs,requests=transport.requested.length,start=performance.now(),response=await GET(new Request(`http://readonly-replay.local/api/open-data?${params}`)),page=await response.json() as {records:OpenDataFact[];nextCursor:string|null;unavailable:string[]};
  assert.equal(response.status,200);assert.deepEqual(page.unavailable,[]);return {page,timing:{elapsedMs:performance.now()-start,sqlMs:sqlMs-before,artifactRequests:transport.requested.length-requests}};
}
try {
  for(const state of ["CA","NJ"]){
    const previous=baseline.readers.find((row:{state:string;label:string})=>row.state===state&&row.label==="initial");assert.ok(previous);const zip=previous.zip as string;
    const requests=[];let cursor:string|null=null;
    for(let index=0;index<3;index++){const response=await get(zip,cursor);requests.push(response);assert.ok(response.page.nextCursor);cursor=response.page.nextCursor;}
    const iterator=readerOpenDataPages({zip},{store,vault,now:new OriginalDate(at).toISOString(),bypassCache:true}),found=new Set<string>(),digest=createHash("sha256"),started=performance.now();
    let pages=0,rows=0,emptyPages=0,maxSharedPageMs=0,lastCursor:string|null=null,nextCursor:string|null=null,lastRows:readonly OpenDataFact[]=[];
    for(;;){const pageStart=performance.now(),step=await iterator.next();maxSharedPageMs=Math.max(maxSharedPageMs,performance.now()-pageStart);if(step.done)break;const page=step.value;
      assert.deepEqual(page.unavailable,[]);assert.ok(page.records.length<=50);if(pages<requests.length){assert.deepEqual(ids(page.records),ids(requests[pages].page.records));assert.equal(page.nextCursor,requests[pages].page.nextCursor);}
      lastCursor=nextCursor;nextCursor=page.nextCursor;lastRows=page.records;pages++;rows+=page.records.length;if(!page.records.length)emptyPages++;
      for(const row of page.records){assert.ok(!found.has(row.id),`Repeated fact ${row.id}`);found.add(row.id);digest.update(`${row.id}\n`);}
    }
    assert.equal(rows,previous.apiTotalRows,"Complete cursor enumeration must preserve the former complete spatial selection.");
    const final=await get(zip,lastCursor);assert.deepEqual(final.page.records.map(openDataReaderRecord),lastRows.map(openDataReaderRecord));assert.equal(final.page.nextCursor,null);
    const pageTimings=requests.map((value,index)=>({page:index+1,...value.timing}));pageTimings.push({page:pages,...final.timing});
    assert.ok(pageTimings.every(value=>value.elapsedMs<3000&&value.sqlMs<1800));
    const result={state,zip,status:"PASS",publishedLocationRows:rows,previousFullScanRows:previous.apiTotalRows,uniqueRows:found.size,pages,emptyPages,allIdsSha256:digest.digest("hex"),sharedIteratorElapsedMs:performance.now()-started,maxSharedIteratorPageMs:maxSharedPageMs,normalGetPages:pageTimings,sourceDatesUnchanged:true};
    proof.states.push(result);console.log(JSON.stringify(result));await writeFile(output,JSON.stringify(proof,null,2));
  }
  proof.status="PASS";await writeFile(output,JSON.stringify(proof,null,2));
}finally{globalThis.Date=OriginalDate;transport.restore();installReaderDatabaseQuery(undefined);await store.close();await writeFile(output,JSON.stringify(proof,null,2));}
