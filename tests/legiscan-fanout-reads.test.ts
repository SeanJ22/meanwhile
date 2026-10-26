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

test("a session the pass deadline cuts resumes on later passes, survives a held-card edit, and publishes without reading a part back",async()=>{
  const {zip}=await import("../scripts/xlsx.mjs");
  const {refreshLegiscan,LEGISCAN_PART_WRITE_RESERVE_MS,LEGISCAN_SESSION_START_RESERVE_MS}=await import("../scripts/legiscan-bulk.mts");
  const {readBillsForState}=await import("../lib/sources/legiscan/reader.ts");
  await withMigratedRoutineStore("legiscan-bulk",async store=>{
    const current={...dataset,year_start:2026,year_end:2026},members=Array.from({length:LEGISCAN_PART_ROWS*4+1},(_,index)=>{const raw=JSON.parse(ak);raw.bill.bill_id+=index;return JSON.stringify(raw);});
    const fetchImpl:typeof fetch=async value=>{
      const op=new URL(String(value)).searchParams.get("op");
      if(op==="getDatasetList")return Response.json({status:"OK",datasetlist:[current]});
      const archive=zip(members.map((data,index)=>({name:`${dataset.session_id}/bill/${index}.json`,data:Buffer.from(data)})),"2026-10-26");
      return Response.json({status:"OK",dataset:{...dataset,mime_type:"application/zip",zip:archive.toString("base64")}});
    };
    // A held card carries far more than its identity: production parts embedded every office and source copy.
    let card={...person,level:"STATE" as const,state:"AK",offices:[{name:"capitol",address:"Room 410, State Capitol, Juneau"}]};
    // Each part write takes a minute of the pass; the standing pass stops the child at its deadline.
    let clock=Date.parse("2026-10-26T19:36:00.000Z");const written:number[]=[],partIds=new Set<string>();
    const create=store.create.bind(store);
    store.create=async(record,event)=>{
      const created=await create(record,event);
      if((record.candidate.readModel as {kind:string}).kind==="PART"){written.push((record.candidate.normalizedPayload as {partIndex:number}).partIndex);partIds.add(record.candidate.id);clock+=60_000;}
      return created;
    };
    // Production's whole part reads (11-24 MB) ran past the 30 s Neon request deadline: the 21:16Z Georgia session check
    // failed "Saved session archive parts cannot be verified". Here any whole read of a part fails the same way.
    const whole={readCandidate:store.readCandidate.bind(store),readCandidateProof:store.readCandidateProof.bind(store)};
    const refuse=(id:string)=>{if(partIds.has(id))throw Error("NEON_REQUEST_DEADLINE: whole bill part read");};
    store.readCandidate=async id=>{refuse(id);return whole.readCandidate(id);};
    store.readCandidateProof=async id=>{refuse(id);return whole.readCandidateProof(id);};
    const passes:{written:number[];deferred:number[]}[]=[];
    const all=await counted(async()=>{
      for(let pass=0;pass<6&&!(await store.readPromotion("STATE_BILL",billScope(dataset.session_id)));pass++){
        const start=written.length,now=new Date(clock).toISOString();
        const result=await refreshLegiscan(store,AbortSignal.timeout(60_000),{key:"fixture",fetchImpl,now:()=>now,peopleForState:async()=>[card],
          clock:()=>clock,deadlineMs:clock+LEGISCAN_PART_WRITE_RESERVE_MS+2*60_000});
        assert.deepEqual(result.counts.AK.failures,[]);
        passes.push({written:written.slice(start),deferred:result.counts.AK.deferred});
        // Between passes the held card's office moves; no identity field changes.
        card={...card,offices:[{name:"capitol",address:`Room ${500+pass}, State Capitol, Juneau`}]};
      }
    });
    console.log(`LEGISCAN_PASSES=${JSON.stringify(passes)}`);
    assert.ok(passes.length>=2,"the deadline cut the session at least once");
    for(const pass of passes.slice(0,-1)){assert.ok(pass.written.length>0,"each cut pass still saved parts");assert.deepEqual(pass.deferred,[dataset.session_id]);}
    assert.deepEqual(passes.at(-1)!.deferred,[]);
    assert.deepEqual([...written].sort((a,b)=>a-b),[0,1,2,3,4],"each part was written exactly once: every pass resumed after the saved parts");
    assert.equal(summary(all.reads,1_000_000).wholeReads,0,"no pass read a saved part back whole");
    const session=(await store.readPromotion<Session>("STATE_BILL",billScope(dataset.session_id)))!;
    assert.equal(session.payload.parts.length,5);assert.equal(session.payload.counts.rows,members.length);
    store.readCandidate=whole.readCandidate;store.readCandidateProof=whole.readCandidateProof;
    const read=await readBillsForState("AK",{store,now:new Date(clock).toISOString()});
    assert.equal(read.complete,true);assert.equal(read.bills.length,members.length);
    const part=(await store.readCandidate(session.payload.parts[0].versionId))!.candidate.normalizedPayload as {people:Record<string,unknown>[]};
    assert.deepEqual(part.people.map(row=>Object.keys(row).sort()),[["id","level","nativeIds","state"]],"bill evidence keeps only the join's identity fields");
    assert.ok(LEGISCAN_SESSION_START_RESERVE_MS<LEGISCAN_PART_WRITE_RESERVE_MS+2*60_000);
  });
});

test("an edited held card between passes cannot strand a session behind whole part reads",async()=>{
  // Production 21:16Z: a resumed session's check read its saved parts whole, ran past the Neon request deadline and
  // failed "Saved session archive parts cannot be verified"; Hawaii's held cards had changed between its passes.
  await withMigratedRoutineStore("legiscan-bulk",async store=>{
    const index=[(({access_key:_access,...row})=>row)(dataset)];
    await publishBulkCandidate(store,{capture:capture(JSON.stringify({status:"OK",datasetlist:index}),at,"getDatasetList"),datasets:[dataset]},at);
    const partIds=new Set<string>(),create=store.create.bind(store);let interrupt=true;
    store.create=async(record,event)=>{
      if(interrupt&&(record.candidate.normalizedPayload as {partIndex?:number}).partIndex===2)throw Error("pass deadline");
      const created=await create(record,event);
      if((record.candidate.readModel as {kind:string}).kind==="PART")partIds.add(record.candidate.id);
      return created;
    };
    const card={...person,level:"STATE" as const,offices:[{name:"capitol",address:"Room 410"}]};
    await assert.rejects(publishBulkCandidate(store,{...source(at),people:[card]},at),/pass deadline/);
    const saved=new Set(partIds),whole={readCandidate:store.readCandidate.bind(store),readCandidateProof:store.readCandidateProof.bind(store)};
    store.readCandidate=async id=>{if(partIds.has(id))throw Error("NEON_REQUEST_DEADLINE: whole bill part read");return whole.readCandidate(id);};
    store.readCandidateProof=async id=>{if(partIds.has(id))throw Error("NEON_REQUEST_DEADLINE: whole bill part read");return whole.readCandidateProof(id);};
    interrupt=false;partIds.clear();for(const id of saved)partIds.add(id);
    const moved={...card,offices:[{name:"capitol",address:"Room 500"}]};
    const resumed=await publishBulkCandidate(store,{...source(later),people:[moved]},later);
    assert.ok(resumed.outcome.promoted,JSON.stringify(resumed.outcome.candidate.receipt?.checks.filter(check=>check.verdict!=="PASS")));
    const session=resumed.candidate.readModel as Session;
    assert.equal(session.parts.filter(part=>saved.has(part.versionId)).length,saved.size,"the parts saved before the edit are kept");
  });
});
