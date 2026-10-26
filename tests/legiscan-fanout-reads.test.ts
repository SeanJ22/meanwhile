import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { neonConfig } from "@neondatabase/serverless";
import { billScope,type Dataset } from "../lib/sources/legiscan/bills.ts";
import { publishBulkCandidate,LEGISCAN_PART_ROWS } from "../lib/sources/legiscan/publication.ts";
import { transferRead } from "../lib/db/reader-route.ts";
import { withMigratedRoutineStore } from "./helpers/migrated-routine-store.ts";

const at="2026-10-26T12:40:00.000Z",later="2026-10-26T13:40:00.000Z";
const hash=(body:string)=>createHash("sha256").update(body).digest("hex");
const ak=readFileSync(new URL("./fixtures/legiscan/bill/HB1.json",import.meta.url),"utf8");
const bill=JSON.parse(ak).bill;
const dataset:Dataset={state_id:bill.state_id,session_id:bill.session_id,session_name:bill.session.session_name,dataset_hash:hash(ak),dataset_date:"2012-12-30",access_key:"fixture-access"};
const person={id:"held:ak-gatto",nativeIds:{legiscan:["6033"]}};
const capture=(body:string,now:string,op="getDataset")=>({body,requestedUrl:`https://api.legiscan.com/?op=${op}`,finalUrl:`https://api.legiscan.com/?op=${op}`,httpStatus:200,retrievedAt:now,rawHash:hash(body)});
const bodies=Array.from({length:LEGISCAN_PART_ROWS*3+1},(_,index)=>{const raw=JSON.parse(ak);raw.bill.bill_id+=index;return JSON.stringify(raw);});
function source(now:string){
  const {access_key:_access,...publicDataset}=dataset;
  return {capture:capture(JSON.stringify({dataset:publicDataset,archiveHash:hash(bodies.join("")),memberHashes:bodies.map(hash)}),now),dataset,bodies,people:[person],archiveHash:hash(bodies.join(""))};
}
type Reads={byTable:Map<string,[number,number,number]>;sizes:{table:string;received:number}[]};
/** Counts every database round trip by the production transfer key's table part: [requests, sent bytes, received bytes]. */
async function counted<T>(run:()=>Promise<T>):Promise<{value:T;reads:Reads}> {
  const reads:Reads={byTable:new Map(),sizes:[]},prior=neonConfig.fetchFunction as (url:unknown,init:{body:string})=>Promise<Response>;
  // The local database has one session, so its statements run one request at a time.
  let queue:Promise<unknown>=Promise.resolve();
  neonConfig.fetchFunction=(async(url:unknown,init:{body:string})=>{
    const turn=queue.then(async()=>{const response=await prior(url,init);return {response,text:await response.text()};});
    queue=turn.catch(()=>undefined);
    const {response,text}=await turn,table=transferRead(init.body),row=reads.byTable.get(table)??[0,0,0];
    row[0]++;row[1]+=Buffer.byteLength(init.body);row[2]+=Buffer.byteLength(text);reads.byTable.set(table,row);reads.sizes.push({table,received:Buffer.byteLength(text)});
    return new Response(text,{status:response.status,headers:response.headers});
  }) as typeof neonConfig.fetchFunction;
  try{return {value:await run(),reads};}finally{neonConfig.fetchFunction=prior as typeof neonConfig.fetchFunction;}
}
/** A read that returns at least half of one saved part is a whole-candidate (or whole-body) read. */
function summary(reads:Reads,partBytes:number) {
  const candidates=reads.sizes.filter(row=>row.table.split(",").some(table=>table.startsWith("civic_data_candidates")));
  return {requests:reads.sizes.length,received:reads.sizes.reduce((sum,row)=>sum+row.received,0),
    candidateRequests:candidates.length,candidateReceived:candidates.reduce((sum,row)=>sum+row.received,0),
    wholeReads:reads.sizes.filter(row=>row.received>=partBytes/2).length,largestRead:Math.max(...reads.sizes.map(row=>row.received))};
}

type Session=import("../lib/sources/legiscan/bills.ts").BillSession;
const readbacks=async(store:import("../lib/civic-data/store.ts").PostgresRoutineDataStore,ids:readonly string[])=>
  (await store.latestReaderReadbacks(ids)).map(event=>/"status":"(PASS|FAIL)"/.exec(event.detail)?.[1]);

test("a multi-part LegiScan session publish never reads a part back whole, and a resumed publish reads no saved part body",async()=>{
  await withMigratedRoutineStore("legiscan-bulk",async store=>{
    const index=[(({access_key:_access,...row})=>row)(dataset)];
    await publishBulkCandidate(store,{capture:capture(JSON.stringify({status:"OK",datasetlist:index}),at,"getDatasetList"),datasets:[dataset]},at);
    // A pass wall stops the first publish after two of its four parts.
    const create=store.create.bind(store);let interrupt=true;
    store.create=async(record,event)=>{
      if(interrupt&&(record.candidate.normalizedPayload as {partIndex?:number}).partIndex===2)throw Error("controlled pass interruption");
      return create(record,event);
    };
    const first=await counted(()=>publishBulkCandidate(store,source(at),at).catch(error=>error as Error));
    assert.match(String(first.value),/controlled pass interruption/);
    const scopes=(await store.listPromotionScopes(["STATE_BILL"])).map(row=>row.scope).filter(scope=>scope.includes(":part:")).sort();
    assert.ok(scopes.length>=2&&scopes.length<4,"the interrupted pass saved some parts");
    const saved=await store.readPromotionIdentities("STATE_BILL",scopes);
    let partBytes=0;
    for(const row of saved)partBytes=Math.max(partBytes,Buffer.byteLength(JSON.stringify((await store.readCandidate(row.versionId))!.candidate)));
    const interrupted=summary(first.reads,partBytes);
    console.log(`LEGISCAN_FANOUT_READS=${JSON.stringify({pass:"interrupted",partBytes,writes:first.reads.byTable.get("query:FETCHED,query:STATE_BILL"),...interrupted})}`);
    assert.equal(interrupted.wholeReads,0,"no part crosses back after it is written");
    assert.deepEqual(await readbacks(store,saved.map(row=>row.versionId)),saved.map(()=>"PASS"),"each part's reader readback still passes");

    // The next pass resumes over the same archive: saved parts are reused without reading their bodies.
    interrupt=false;
    const resumed=await counted(()=>publishBulkCandidate(store,source(later),later));
    assert.ok(resumed.value.outcome.promoted&&!resumed.value.outcome.confirmed,"the session marker promotes");
    assert.equal(resumed.value.outcome.readerReadback?.status,"PASS");
    const session=resumed.value.candidate.readModel as Session;
    assert.equal(session.parts.length,4);assert.equal(session.counts.rows,bodies.length);
    const fresh=session.parts.filter(part=>!saved.some(row=>row.versionId===part.versionId));
    assert.equal(fresh.length,4-saved.length,"every saved part is reused");
    const resume=summary(resumed.reads,partBytes);
    console.log(`LEGISCAN_FANOUT_READS=${JSON.stringify({pass:"resume",writes:resumed.reads.byTable.get("query:FETCHED,query:STATE_BILL"),...resume})}`);
    assert.equal(resumed.reads.byTable.get("query:FETCHED,query:STATE_BILL")?.[0],fresh.length+1,"only the unfinished parts and the session marker are written");
    assert.equal(resume.wholeReads,0,"no saved or new part body is read");
    assert.ok(resume.received<partBytes,`the resumed publish read ${resume.received} bytes; one part is ${partBytes}`);
    assert.deepEqual(await readbacks(store,fresh.map(part=>part.versionId)),fresh.map(()=>"PASS"));
    assert.equal((await store.readPromotion("STATE_BILL",billScope(dataset.session_id)))?.versionId,resumed.value.candidate.id);

    // A changed roster recomputes every join: all four parts publish anew, still without a read-back.
    const changed=await counted(()=>publishBulkCandidate(store,{...source(later),people:[]},later));
    assert.ok(changed.value.outcome.promoted&&!changed.value.outcome.confirmed);
    const republished=summary(changed.reads,partBytes);
    console.log(`LEGISCAN_FANOUT_READS=${JSON.stringify({pass:"changed-roster",writes:changed.reads.byTable.get("query:FETCHED,query:STATE_BILL"),...republished})}`);
    assert.equal(changed.reads.byTable.get("query:FETCHED,query:STATE_BILL")?.[0],5);
    assert.equal(republished.wholeReads,0);
  });
});
