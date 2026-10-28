import "./helpers/linking-copies.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { MemoryEvidenceStore } from "../lib/control-plane/evidence/store.ts";
import { CivicReadCache } from "../lib/db/civic-read-cache.ts";
import { refreshGoogleCivic } from "../lib/sources/google-civic/refresh.ts";
import { civicBytesHash,civicInputHash } from "../lib/sources/google-civic/source-hash.ts";
import { countyCivicProgress,nationalCivicProgress } from "../lib/sources/google-civic/county-progress.ts";
import type { readRegistrationProjection } from "../lib/registration/reader.ts";
import { readCivicApi } from "../lib/sources/google-civic/acquisition.ts";

const at="2026-10-12T23:13:00.000Z",later="2026-10-13T00:13:00.000Z";
const fixture=(name:string)=>readFileSync(new URL(`./fixtures/google-civic/${name}.json`,import.meta.url),"utf8");
function cache(){const values=new Map<string,string>(),writes:string[]=[];return {writes,value:new CivicReadCache({read:async key=>values.get(key)??null,
  write:async(key,value)=>{values.set(key,value);writes.push(value);}})};}

test("Google Civic remeasures county sources at the next pass and confirms equal bytes with no held payload read",async()=>{
  const store=new MemoryRoutineDataStore(),vault=new MemoryEvidenceStore(),progress=cache(),address="Protocol public election office that is not saved";
  const division="ocd-division/country:us/state:mi/county:protocol";
  const registration=(async(state:string)=>({kind:"PROMOTED",value:{divisions:state==="MI"?[{ocdId:division,divisionType:"county",geoid:"26065"}]:[],
    bodies:state==="MI"?[{ocdId:division,name:"Board of Elections",officeAddress:address}]:[],governments:[]}})) as unknown as typeof readRegistrationProjection;
  const raw=fixture("mi-voterinfo"),key="never-save-this-api-key";
  let now=at,body=raw,countyCalls=0;
  const readOptions={apiKey:key,now:()=>now,fetchImpl:(async(url:URL)=>{
    assert.equal(url.searchParams.get("key"),key);
    if(url.pathname.endsWith("elections"))return new Response(fixture("elections"));
    countyCalls++;assert.equal(url.searchParams.get("address"),address);return new Response(body);
  }) as unknown as typeof fetch};
  const input={store,vault,registration,votingSites:async()=>null,reviewedRegistry:async()=>null,readOptions,cache:progress.value};
  const first=await refreshGoogleCivic(input);assert.ok(first.candidate&&first.outcome&&first.coverage);
  const readPromotion=store.readPromotion.bind(store),readCandidate=store.readCandidate.bind(store),readPath=store.readCandidatePath.bind(store);
  store.readPromotion=async()=>{throw Error("an unchanged Civic source must not read a held projection");};
  store.readCandidate=async()=>{throw Error("an unchanged Civic source must not read a held candidate");};
  store.readCandidatePath=async<T>(id:string,path:readonly string[])=>{
    assert.deepEqual(path,["normalizedPayload","sourceProbe"],"equal complete sources need only their compact input metadata");return readPath<T>(id,path);
  };
  now=later;
  const second=await refreshGoogleCivic(input);assert.ok(second.confirmation);assert.equal(second.coverage,null,"no invented count summary accompanies a scalar confirmation");
  assert.equal(countyCalls,2,"equal catalog bytes never skip the independent county source pace");
  store.readPromotion=readPromotion;store.readCandidate=readCandidate;store.readCandidatePath=readPath;
  body=JSON.stringify({...JSON.parse(raw),providerMetadata:"a source change outside admitted availability facts"});
  now="2026-10-13T01:13:00.000Z";
  const third=await refreshGoogleCivic(input);assert.ok(third.candidate&&third.outcome&&third.coverage);
  assert.ok(third.outcome.promoted,"a changed response hash publishes its new source binding");
  assert.equal(third.outcome.candidate.candidate.changeSet?.changed.length??0,0,"source hash/probe changes do not manufacture new civic facts");
  const serialized=JSON.stringify([first.candidate,third.candidate,progress.writes]);
  for(const value of [key,address,JSON.parse(raw).normalizedInput.line1,JSON.parse(raw).pollingLocations[0].address.locationName])
    assert.equal(serialized.includes(value),false,"only hashes and allowed counts survive the transient lookup");
  assert.equal((await vault.list("")).length,1,"only the unchanged public elections catalog is vaulted");
});

test("Civic deadline continuations keep actual check times and restart on changed inputs",async()=>{
  const progress=cache(),catalogHash=civicBytesHash(fixture("elections")),addressHash=civicInputHash("public office address");
  const input={state:"MI",context:"exact-catalog-and-parent-inputs",catalogHash,checkedAt:at,maxAgeMs:12*3_600_000,progress:progress.value};
  const first=await countyCivicProgress(input);
  first.put({addressHash,responseHash:"a".repeat(64),status:200,checkedAt:at,
    coverage:{countyFips:"26065",available:true,pollingLocations:1,earlyVoteSites:0,dropOffLocations:0}});await first.save();
  const resumed=await countyCivicProgress({...input,checkedAt:later});
  assert.ok(resumed.get("26065",addressHash));assert.equal(resumed.basis.checkedAt,at);
  assert.equal(resumed.get("26161",addressHash),undefined,"the next county remains owed");
  assert.equal((await countyCivicProgress({...input,context:"new-parent-input"})).get("26065",addressHash),undefined);
  const national=await nationalCivicProgress({context:"same-national-inputs",checkedAt:at,maxAgeMs:12*3_600_000,progress:progress.value});
  await national.put({state:"MI",inputHash:input.context,hash:"b".repeat(64),versionId:"checked-state-version",complete:true,basis:first.basis});
  const continued=await nationalCivicProgress({context:"same-national-inputs",checkedAt:later,maxAgeMs:12*3_600_000,progress:progress.value});
  assert.equal(continued.get("MI")?.basis.checkedAt,at,"completed states resume within the same pass without inventing completion-time freshness");
  assert.equal((await nationalCivicProgress({context:"changed-catalog",checkedAt:later,maxAgeMs:12*3_600_000,progress:progress.value})).get("MI"),undefined);
});
test("an HTTP partial voterinfo response stays unmeasured",async t=>{
  t.mock.method(console,"error",()=>{});
  await assert.rejects(readCivicApi("voterinfo",{address:"public office",electionId:"12000"},{apiKey:"runtime-key",
    fetchImpl:(async()=>new Response(fixture("mi-voterinfo"),{status:206})) as typeof fetch}),/incomplete response/);
});
