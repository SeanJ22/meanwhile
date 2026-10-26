import assert from "node:assert/strict";
import test from "node:test";
import { openDataCaptures,openDataSourceContentHash,type OpenDataCapture } from "../lib/sources/open-data/publication.ts";
import { openDataProbeContentHash,openDataSourceProbe } from "../lib/sources/open-data/source-probe.ts";
import { confirmSocrataSource } from "../lib/sources/open-data/socrata-source-probe.ts";
import type { RoutineDataStore,SourceHead } from "../lib/civic-data/store.ts";
import { CivicReadCache } from "../lib/db/civic-read-cache.ts";
import type { acquireKnownRelease,KnownRelease } from "../lib/sources/known-release.ts";
import { socrataDiscoveryProgress } from "../lib/sources/open-data/socrata-discovery-progress.ts";

const at="2026-10-01T00:00:00.000Z",later="2026-10-02T00:00:00.000Z",url="https://echo.epa.gov/files/echodownloads/echo_exporter.zip";
const first:OpenDataCapture={url,retrievedAt:at,rawHash:"a".repeat(64),sourceRows:[{id:"one",name:"One"}],archive:{sha256:"a".repeat(64),member:"ECHO_EXPORTER.csv",publishedAt:null}};

test("identical source checks stay one capture and one source digest while retaining every referenced excerpt",()=>{
  const next={...first,retrievedAt:later,sourceRows:[{id:"two",name:"Two"}],
    sourceCheck:{requestedUrl:url,finalUrl:url,httpStatus:304 as const,rawHash:first.rawHash,checkedAt:later}};
  const held=openDataCaptures([first,next,next]);
  assert.equal(held.length,1);assert.equal(held[0].retrievedAt,later);assert.equal(held[0].sourceCheck?.checkedAt,later);
  assert.deepEqual(held[0].sourceRows.map(row=>row.id).sort(),["one","two"]);
  assert.deepEqual(held[0].captureDates,[at,later],"old immutable rows keep their exact acquisition binding");
  assert.equal(openDataSourceContentHash([first]),openDataSourceContentHash([first,next,next]));
});

test("changed source bytes and different native archive members remain independently held",()=>{
  const changed={...first,rawHash:"b".repeat(64)},member={...first,archive:{...first.archive!,member:"OTHER.csv"}};
  assert.equal(openDataCaptures([first,changed,member]).length,3);
  assert.notEqual(openDataSourceContentHash([first]),openDataSourceContentHash([changed]));
  assert.notEqual(openDataSourceContentHash([first]),openDataSourceContentHash([member]));
  assert.equal(openDataSourceContentHash([first,changed,member]),openDataSourceContentHash([member,first,changed]));
});

const catalogUrl="https://api.us.socrata.com/api/catalog/v1?limit=1000&scroll_id=",governmentUrl="https://www.usa.gov/state-governments";
const native:OpenDataCapture={url:catalogUrl,rawHash:"c".repeat(64),retrievedAt:at,sourceRows:[],
  sourceCheck:{requestedUrl:catalogUrl,finalUrl:catalogUrl,httpStatus:200,checkedAt:at,rawHash:"c".repeat(64)}};
const discovery:KnownRelease={sourceId:"socrata-state-links",releaseId:governmentUrl,requestedUrl:governmentUrl,finalUrl:governmentUrl,
  sha256:"d".repeat(64),bytes:new Uint8Array([1]),httpStatus:200,retrievedAt:at,sourceObservedAt:at,checkedAt:at,lastCheckStatus:200,
  etag:null,lastModified:null,contentType:"text/html",reused:false};
function memoryProgress(){const values=new Map<string,string>();return new CivicReadCache({read:async key=>values.get(key)??null,
  write:async(key,value)=>{values.set(key,value);}});}
function sourceStore(rawHash:string) {
  let confirmations=0;
  const head:SourceHead={sourceId:"socrata-discovery",recordClass:"CURATED_READER_RECORD",scope:"socrata-discovery:national",
    versionId:"source-version",lastKnownGoodVersionId:"source-version",rawHash,rawHashBasis:"SOURCE_CONTENT_V1",normalizedHash:"f".repeat(64),
    parserVersion:"src-so/1",promotedAt:at,candidateState:"PROMOTED",acquisitionSucceeded:true,imported:false};
  return {confirmations:()=>confirmations,store:{readSourceHead:async()=>head,
    readCandidate:async()=>{throw Error("held candidate payload is forbidden");},readPromotion:async()=>{throw Error("held national manifest is forbidden");},
    confirmUnchanged:async(input:{retrieval:{rawHash:string}})=>{assert.equal(input.retrieval.rawHash,rawHash);confirmations++;return {kind:"CONFIRMED",versionId:head.versionId,at:later};},
  } as unknown as RoutineDataStore};
}
test("Socrata compares every catalog page and independent discovery root before any held payload",async()=>{
  const plan=openDataSourceProbe({sourceId:"socrata-discovery",captures:[native],dependencies:{},observations:[discovery],complete:true});
  const held=sourceStore(openDataProbeContentHash(plan));let requests=0;
  const acquire:typeof acquireKnownRelease=async options=>{requests++;assert.equal(options.url,governmentUrl);
    assert.equal(options.refresh,true);assert.equal(new Headers(options.headers).has("X-App-Token"),false);return {...discovery,checkedAt:later};};
  const input={store:held.store,plan,versionId:"source-version",captures:[native],dependencies:{},signal:new AbortController().signal,
    now:later,maxAgeMs:30*86_400_000,acquire,progress:memoryProgress()};
  assert.ok(await confirmSocrataSource(input));assert.equal(held.confirmations(),1);assert.equal(requests,1);
  const moved=sourceStore(openDataProbeContentHash(plan));
  assert.equal(await confirmSocrataSource({...input,store:moved.store,progress:memoryProgress(),
    acquire:async()=>({...discovery,sha256:"e".repeat(64),checkedAt:later})}),null,"a changed directory may reveal new government links");
  assert.equal(moved.confirmations(),0);
  assert.equal(await confirmSocrataSource({...input,dependencies:{"REGISTRATION:US-AZ:registration:v1":null},progress:memoryProgress()}),null,
    "new or changed upstream registrations must revisit independent discovery");
  const firstPage={...native,url:catalogUrl+"aaaa-aaaa",rawHash:"1".repeat(64)};
  assert.notEqual(openDataProbeContentHash(openDataSourceProbe({sourceId:"socrata-discovery",captures:[firstPage,native],dependencies:{},observations:[discovery],complete:true})),
    openDataProbeContentHash(openDataSourceProbe({sourceId:"socrata-discovery",captures:[{...firstPage,rawHash:"2".repeat(64)},native],dependencies:{},observations:[discovery],complete:true})),
    "a changed earlier page cannot hide behind an equal final page");
});
test("incomplete discovery and credential-bearing URLs never qualify for a saved complete probe",()=>{
  const plan=openDataSourceProbe({sourceId:"socrata-discovery",captures:[native],dependencies:{},complete:true,
    observations:[{...discovery,requestedUrl:governmentUrl+"?api_key=never-save-this"}]});
  assert.equal(plan.complete,false);assert.equal(plan.discoveryRequests?.length,0);
  assert.equal(JSON.stringify(plan).includes("never-save-this"),false);
});
test("normal Socrata discovery resumes completed states and keeps the original provider dates",async()=>{
  const progress=memoryProgress();let checkedAfter:string|undefined;
  const acquire:typeof acquireKnownRelease=async options=>{checkedAfter=options.checkedAfter;return discovery;};
  const input={context:"native-catalog-and-registration-inputs",captures:[native],now:later,maxAgeMs:30*86_400_000,progress,acquire};
  const work=await socrataDiscoveryProgress(input);
  await work.saveState({state:"AZ",bindings:[],observations:[discovery],complete:true});
  const resumed=await socrataDiscoveryProgress(input);
  assert.ok(resumed.completed("AZ"));assert.equal(resumed.basis.sourceCheck?.checkedAt,at);
  await resumed.acquire({sourceId:discovery.sourceId,releaseId:discovery.releaseId,url:governmentUrl,parserVersion:"src-so/1",
    maxBytes:1000,signal:new AbortController().signal,checkAfterMs:0});
  assert.equal(checkedAfter,at,"unfinished roots may reuse only real provider checks from the same work slice");
  const changed=await socrataDiscoveryProgress({...input,context:"changed-native-page"});
  assert.equal(changed.completed("AZ"),null,"changed source/input content restarts independent discovery");
});
