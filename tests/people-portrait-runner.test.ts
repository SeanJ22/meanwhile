import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { parsePeoplePortraitArguments, refreshPeoplePortraits } from "../scripts/people-portraits-refresh.mts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { MemoryEvidenceStore } from "../lib/control-plane/evidence/store.ts";
import { publishStatePeople } from "../lib/civic-data/state-people-publication.ts";
import { readPeopleSourceProjection } from "../lib/civic-data/people-source-publication.ts";
import { readStatePeopleProjection } from "../lib/state-rollcalls/legislators.ts";
import { normalize, yamlToPeople } from "../lib/sources/plural/index.ts";
import { normalizeCongressDirectory } from "../lib/officials/congress-normalize.ts";
import { federalDirectoryCandidate, federalDirectoryContractId, federalDirectoryForState } from "../lib/officials/federal-directory-data-plane.ts";
import { readFederalDirectoryProjection } from "../lib/officials/federal-directory-read-model.ts";
import { processRegisteredManualCandidate } from "../lib/civic-data/promotion.ts";
import { portraitHash, type PortraitSources } from "../lib/photos/evidence.ts";
import { storeVerifiedPortrait } from "../lib/photos/store.ts";
import type { KnownReleaseOptions, KnownRelease } from "../lib/sources/known-release.ts";
import { verifiedPresident, ADMINISTRATION_URL } from "../lib/sources/white-house/president.ts";
import { publishPeopleSource } from "../lib/civic-data/people-source-publication.ts";
import { liveNationalExecutiveRoster, readNationalPresident } from "../lib/reader/national.ts";
import { routineTaskDue, routineTaskFromContract } from "../lib/civic-data/runner.ts";
import { PEOPLE_SOURCE_CONTRACTS } from "../lib/civic-data/people-source-contracts.ts";

const vault = new MemoryEvidenceStore();

const NOW="2026-10-12T12:00:00.000Z",SHA="a".repeat(40);
function page(options:KnownReleaseOptions,body:string):KnownRelease {
  const bytes=new TextEncoder().encode(body),sha256=portraitHash(bytes).slice(7);
  return {sourceId:options.sourceId,releaseId:options.releaseId,requestedUrl:options.url,finalUrl:options.url,
    bytes,sha256,httpStatus:200,retrievedAt:NOW,sourceObservedAt:NOW,checkedAt:NOW,lastCheckStatus:200,
    etag:null,lastModified:null,contentType:"text/html",reused:false,vaultKey:`project/freshness/source/${options.sourceId}/releases/test/${sha256}.bin`};
}
async function images(){
  const bytes=await sharp({create:{width:160,height:180,channels:3,background:"navy"}}).png().toBuffer();
  return (id:string,sources:PortraitSources,at:string,signal:AbortSignal)=>storeVerifiedPortrait(id,sources,at,
    {read:async()=>({bytes,retrievedAt:NOW,contentType:"image/png"}),put:async()=>{}},"officials",signal);
}
test("standing portrait commands require exactly one data-backed state",()=>{
  assert.equal(parsePeoplePortraitArguments(["--promote","--state=az"]),"az");
  assert.equal(parsePeoplePortraitArguments(["--promote","--state=us"]),"us");
  for(const args of [["--state=az"],["--promote","--state=zz"],["--promote","--federal"],["--promote","--federal","--state=az"]])
    assert.throws(()=>parsePeoplePortraitArguments(args),/PEOPLE_PORTRAITS_EXACT_SCOPE_REQUIRED/);
});

test("a scheduled portrait pass reads held people without refreshing their roster and publishes through the composite reader",async t=>{
  const store=new MemoryRoutineDataStore(),sourceUrl=`https://raw.githubusercontent.com/openstates/people/${SHA}/data/az/legislature/jane.yml`;
  const body="id: ocd-person/jane\nname: Jane Example\nroles:\n- type: upper\n  district: '7'\nlinks:\n- url: https://legislature.example.gov/jane\n";
  const roster=normalize(yamlToPeople(body,"az",sourceUrl,NOW),new Map(),NOW,"US-AZ");
  const seed=await publishStatePeople({ vault, store,state:"az",roster,acquisitions:[{requestedUrl:sourceUrl,finalUrl:sourceUrl,httpStatus:200,retrievedAt:NOW,body}],releaseId:SHA,now:NOW});
  assert.ok(seed.outcome.promoted);
  const logs:string[]=[];t.mock.method(console,"log",(line:string)=>logs.push(line));
  let acquired=0;
  const result=await refreshPeoplePortraits({ vault, store,state:"az",options:{now:()=>NOW,storePortrait:await images(),
    acquire:async options=>{acquired++;assert.equal(options.sourceId,"official-person-profile");
      return page(options,'<h1>Jane Example</h1><img alt="Portrait of Jane Example" src="/jane.png">');}}});
  assert.ok(result.outcome.promoted);assert.equal(acquired,1);assert.equal(logs.length,1);
  const reader=await readStatePeopleProjection("US-AZ",{store,now:NOW,bypassCache:true});
  assert.equal(reader.kind,"PROMOTED");if(reader.kind!=="PROMOTED")return;
  assert.equal(reader.value.roster.officeholders.length,1);
  assert.ok(reader.value.roster.officeholders[0].photo);
  const source=await store.readPromotion("STATE_LEGISLATOR","US-AZ:openstates-people:v1");
  assert.equal(source?.versionId,seed.candidate.id,"the independent photo holding does not fake a source roster refresh");
  const again=await refreshPeoplePortraits({ vault, store,state:"az",options:{now:()=>NOW,
    acquire:async()=>{throw Error("A current accepted photo is not due");}}});
  assert.ok(again.outcome.promoted || again.outcome.confirmed);
  assert.equal(acquired,1);
});

test("a place's portrait run also enriches its members of Congress, on the place's own portrait clock",async t=>{
  const store=new MemoryRoutineDataStore(),sourceUrl=`https://raw.githubusercontent.com/unitedstates/congress-legislators/${SHA}/legislators-current.yaml`;
  const raw={"legislators-current":[{id:{bioguide:"A000001"},name:{first:"Jane",last:"Example"},terms:[{type:"rep",state:"AZ",district:1,start:"2025-01-03",end:"2027-01-03",url:"https://jane.house.gov/",phone:"202-225-1000"}]}]};
  const projection=federalDirectoryForState(normalizeCongressDirectory(raw,SHA,NOW,null,{},NOW),"AZ");
  const candidate=await federalDirectoryCandidate({state:"AZ",vault:new MemoryEvidenceStore(),projection,retrievedAt:NOW,acquisitions:[{requestedUrl:sourceUrl,finalUrl:sourceUrl,httpStatus:200,retrievedAt:NOW,body:JSON.stringify(raw["legislators-current"])}]});
  assert.ok((await processRegisteredManualCandidate(store,federalDirectoryContractId("AZ"),candidate,NOW)).promoted);
  t.mock.method(console,"log",()=>{});
  const result=await refreshPeoplePortraits({ vault, store,state:"az",options:{now:()=>NOW,storePortrait:await images(),
    acquire:async options=>page(options,JSON.stringify({member:{bioguideId:"A000001",depiction:{imageUrl:"https://congress.gov/jane.png"}}}))}});
  assert.ok(result.outcome.promoted);
  const reader=await readFederalDirectoryProjection(["AZ"],{store,now:NOW,bypassCache:true});
  assert.equal(reader.kind,"PROMOTED");if(reader.kind!=="PROMOTED")return;
  assert.ok(reader.value.roster.officeholders[0].photo);
  assert.equal(reader.value.roster.officeholders[0].phone,"202-225-1000");
  const marker=await readPeopleSourceProjection("US-AZ","people-portraits",{store,now:NOW,bypassCache:true});
  assert.equal(marker.kind,"PROMOTED");
  const portrait=reader.value.roster.officeholders[0].photo;
  let reacquired=0;
  const nextAt=new Date(Date.parse(NOW)+60*60*1000).toISOString();
  await refreshPeoplePortraits({vault,store,state:"az",options:{now:()=>nextAt,
    acquire:async()=>{reacquired++;throw Error("A current congressional portrait is not due");}}});
  assert.equal(reacquired,0,"the independent portrait holding supplies the next run's freshness clock");
  const next=await readFederalDirectoryProjection(["AZ"],{store,now:nextAt,bypassCache:true});
  assert.equal(next.kind,"PROMOTED");
  if(next.kind==="PROMOTED")assert.equal(next.value.roster.officeholders[0].photo?.url,portrait?.url);
});

test("the national hourly portrait job reaches National cards and the next run retains its photo",async t=>{
  const store=new MemoryRoutineDataStore(),sourceUrl=`${ADMINISTRATION_URL}jordan-example/`;
  const index=`<a href="${sourceUrl}">President Jordan Example</a>`;
  const body='<main><h1>Jordan Example</h1><p>President of the United States</p></main>';
  const roster=verifiedPresident({url:ADMINISTRATION_URL,html:index},{url:sourceUrl,html:body,retrievedAt:NOW});
  const seed=await publishPeopleSource({store,vault,state:"us",sourceId:"statewide-executive-sources",roster,
    acquisitions:[{requestedUrl:ADMINISTRATION_URL,finalUrl:ADMINISTRATION_URL,httpStatus:200,body:index,retrievedAt:NOW},
      {requestedUrl:sourceUrl,finalUrl:sourceUrl,httpStatus:200,body,retrievedAt:NOW}],releaseId:SHA,now:NOW});
  assert.ok(seed.outcome.promoted,seed.outcome.candidate.failureDetail ?? undefined);
  t.mock.method(console,"log",()=>{});
  let acquired=0;
  const first=await refreshPeoplePortraits({store,vault,state:"us",options:{now:()=>NOW,storePortrait:await images(),
    acquire:async options=>{acquired++;return page(options,'<h1>Jordan Example</h1><img alt="Jordan Example" src="/jordan.png">');}}});
  assert.ok(first.outcome.promoted);
  const shown=liveNationalExecutiveRoster(await readNationalPresident(async()=>store));
  const portrait=shown?.officeholders[0].photo;
  assert.ok(portrait);
  assert.ok(portrait.url.startsWith('/api/portraits/officials/'));
  assert.equal(acquired,1);
  const task=routineTaskFromContract(PEOPLE_SOURCE_CONTRACTS.find(contract=>contract.id === 'people-portraits-us')!);
  const clock={lastAttemptedAt:NOW,lastSucceededAt:NOW,lastSucceededObservedAt:NOW,lastSucceededParserVersion:task.parserVersion};
  assert.equal(routineTaskDue(task,clock,Date.parse(NOW)),false);
  const nextAt=new Date(Date.parse(NOW)+task.cadenceMs).toISOString();
  assert.equal(routineTaskDue(task,clock,Date.parse(nextAt)),true);
  await refreshPeoplePortraits({store,vault,state:"us",options:{now:()=>nextAt,acquire:async()=>{throw Error("A fresh portrait is not due");}}});
  const next=await readPeopleSourceProjection("US","people-portraits",{store,now:nextAt,bypassCache:true});
  assert.equal(next.kind,'PROMOTED');
  if(next.kind==='PROMOTED')assert.equal(next.value.roster.officeholders[0].photo?.url,portrait.url);
});
