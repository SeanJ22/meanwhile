import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
import {createSourceFile,isFunctionDeclaration,ModuleKind,ScriptTarget,transpileModule} from "typescript";
import {MemoryRoutineDataStore} from "../lib/civic-data/store.ts";
import {derivedMeetingBodyContract,requiredMeetingPartitionContract} from "../lib/civic-data/meeting-partitions.ts";
import {routineTaskFromContract,routineTaskNextDueMs} from "../lib/civic-data/runner.ts";

const FIRST="ocd-division/country:us/state:az/place:first#governing",SECOND="ocd-division/country:us/state:az/place:second#governing";
const family=requiredMeetingPartitionContract("meetings:derived:US-AZ");
function controller(context:Record<string,unknown>){
  const source=readFileSync("scripts/ingest.ts","utf8"),tree=createSourceFile("ingest.ts",source,ScriptTarget.ESNext,true);
  const declaration=tree.statements.find(node=>isFunctionDeclaration(node)&&node.name?.text==="promoteDerivedMeetingFamily");
  assert.ok(declaration);
  return runInNewContext(transpileModule(declaration.getText(tree).replace(/^export /,""),{compilerOptions:{target:ScriptTarget.ES2022,module:ModuleKind.CommonJS}}).outputText+"\npromoteDerivedMeetingFamily",context);
}

test("derived body publication is independent and a restart after pointer movement skips the already completed body",async t=>{
  const at=Date.parse("2026-10-26T19:00:00Z");t.mock.timers.enable({apis:["Date"],now:at});
  const store=new MemoryRoutineDataStore(),originalClock=store.clock.bind(store),originalProgress=store.writeDerivedMeetingProgress.bind(store);
  const completed=new Set<string>(),published:string[]=[];let crash=true;
  Object.assign(store,{readSourceHead:async(_kind:unknown,scope:string)=>completed.has(scope)?{versionId:scope,acquisitionComplete:true}:null,clock:async(source:string,kind:Parameters<typeof store.clock>[1],scope:string,parser?:string)=>completed.has(scope)?{
    lastAttemptedAt:new Date().toISOString(),lastSucceededAt:new Date().toISOString(),lastSucceededObservedAt:new Date().toISOString(),lastSucceededParserVersion:parser,
  }:originalClock(source,kind,scope,parser),writeDerivedMeetingProgress:async(scope:string,progress:Parameters<typeof store.writeDerivedMeetingProgress>[1])=>{
    if(crash&&published.length===1&&progress.pending.length===1){crash=false;throw new Error("PROCESS_EXIT_AFTER_BODY_POINTER");}
    await originalProgress(scope,progress);
  }});
  const run=controller({Date,console:{log:()=>{}},factReader:()=>null,readStateWiringBodyIds:async()=>[FIRST,SECOND],derivedMeetingBodyContract,routineTaskFromContract,routineTaskNextDueMs,
    meetingSourceBudgetAvailable:()=>true,meetingSourceContinuationPending:async()=>false,ZERO_RELEASE_EVENTS:{},
    promoteDerivedMeetingBody:async(_store:unknown,body:{scope:string;bodyId:string})=>{published.push(body.bodyId);completed.add(body.scope);return {head:{scope:body.scope},at:new Date().toISOString()};},
    readStateWiringRows:()=>{throw new Error("UNCHANGED_BODY_MUST_NOT_LOAD_WIRING");}});
  const facts={db:{query:async()=>[]},vault:{}};
  await assert.rejects(run(store,family,async()=>{},facts),/PROCESS_EXIT_AFTER_BODY_POINTER/);
  assert.deepEqual(published,[FIRST]);
  assert.deepEqual((await store.readDerivedMeetingProgress(family.scope)).pending,[FIRST,SECOND],"checkpoint can lag an already accepted body pointer safely");
  const next=await run(store,family,async()=>{},facts);
  assert.equal(next.succeeded,true);assert.deepEqual(published,[FIRST,SECOND],"the first body's own completed clock prevents a repeated source/held read");
  assert.deepEqual((await store.readDerivedMeetingProgress(family.scope)).pending,[]);
});

test("cutoff saves the unstarted body's place while the completed body's facts stay accepted",async t=>{
  t.mock.timers.enable({apis:["Date"],now:Date.parse("2026-10-26T19:00:00Z")});
  const store=new MemoryRoutineDataStore(),published:string[]=[];let budget=true;
  const run=controller({Date,console:{log:()=>{}},factReader:()=>null,readStateWiringBodyIds:async()=>[FIRST,SECOND],derivedMeetingBodyContract,routineTaskFromContract,routineTaskNextDueMs,
    meetingSourceBudgetAvailable:()=>budget,meetingSourceContinuationPending:async()=>false,ZERO_RELEASE_EVENTS:{},
    promoteDerivedMeetingBody:async(_store:unknown,body:{scope:string;bodyId:string})=>{published.push(body.bodyId);budget=false;return {head:{scope:body.scope},at:new Date().toISOString()};},
    readStateWiringRows:()=>{throw new Error("UNCHANGED_BODY_MUST_NOT_LOAD_WIRING");}});
  const result=await run(store,family,async()=>{},{db:{query:async()=>[]},vault:{}});
  assert.equal(result.succeeded,false);assert.deepEqual(published,[FIRST]);
  const saved=await store.readDerivedMeetingProgress(family.scope);assert.deepEqual(saved.pending,[SECOND]);
  assert.equal((await store.clock(family.sourceId,"MEETING",family.scope,"meetings-composite/2")).continuationPending,true);
});
