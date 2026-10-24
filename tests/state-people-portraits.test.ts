import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { publishStatePeople, statePeoplePortraits } from "../lib/civic-data/state-people-publication.ts";
import { normalize, yamlToPeople } from "../lib/sources/plural/index.ts";
import { readStatePeopleProjection } from "../lib/state-rollcalls/legislators.ts";
import { portraitHash, verifyPortraitSources, type PortraitSources } from "../lib/photos/evidence.ts";
import { storeVerifiedPortrait, type PortraitRuntime } from "../lib/photos/store.ts";
import { portraitBindingMatches } from "../lib/photos/binding.ts";
import type { KnownRelease, KnownReleaseOptions } from "../lib/sources/known-release.ts";
import { refreshPeoplePortraits } from "../scripts/people-portraits-refresh.mts";
import type { RoutineDataStore } from "../lib/civic-data/store.ts";
import type { StandingPortraitOptions } from "../lib/photos/portrait-work.ts";
import heldProfiles from "./fixtures/plural/held-native-profile-leads.json" with {type:"json"};
import { MemoryEvidenceStore } from "../lib/control-plane/evidence/store.ts";
import type { CandidateVersionRecord } from "../lib/civic-data/types.ts";

const vault = new MemoryEvidenceStore();

async function refreshStatePortraits(input:{store:RoutineDataStore;state:string;now?:string;signal?:AbortSignal},options:StandingPortraitOptions = {}) {
  return refreshPeoplePortraits({ vault, store:input.store,state:input.state,options:{...options,signal:input.signal,
    now:options.now ?? (()=>input.now ?? new Date().toISOString())}});
}

const SOURCE_DATE="2026-10-08T12:00:00.000Z",START="2026-10-09T21:00:00.000Z",CHECK="2026-10-09T21:00:05.000Z",VERIFIED="2026-10-09T21:00:06.000Z";
const sha="a".repeat(40);
async function seed(count=1) {
  const store=new MemoryRoutineDataStore();
  const acquisitions=Array.from({length:count},(_,index)=>{
    const url=`https://raw.githubusercontent.com/openstates/people/${sha}/data/az/legislature/${index}.yml`;
    return {requestedUrl:url,finalUrl:url,httpStatus:200,retrievedAt:SOURCE_DATE,
      body:`id: ocd-person/member-${index}\nname: Jane Member ${index}\nroles:\n  - type: upper\n    district: '7'\n    start_date: '2025-01-01'\nlinks:\n  - url: https://legislature.example.gov/members/${index}\n`};
  });
  const people=acquisitions.flatMap(row=>yamlToPeople(row.body,"az",row.requestedUrl,START));
  const roster=normalize(people,new Map([["az|upper|7","ocd-division/country:us/state:az/sldu:7"]]),SOURCE_DATE,"US-AZ");
  const published=await publishStatePeople({ vault, store,state:"az",roster:{...roster,currentMembershipComplete:true},acquisitions,releaseId:sha,now:START});
  assert.ok(published.outcome.promoted,JSON.stringify(published.outcome.candidate.receipt));
  return {store,roster,acquisitions};
}
function profile(options:KnownReleaseOptions):KnownRelease {
  const requestedUrl=new URL(options.url);
  const index=requestedUrl.pathname.split("/").at(-1);
  const text=`<h1>Jane Member ${index}</h1><img alt="Portrait of Jane Member ${index}" src="/portraits/${index}.png">`;
  const bytes=new TextEncoder().encode(text),sha256=portraitHash(bytes).slice(7);
  return {sourceId:options.sourceId,releaseId:options.releaseId,requestedUrl:options.url,finalUrl:options.url,
    bytes,sha256,httpStatus:200,retrievedAt:SOURCE_DATE,sourceObservedAt:SOURCE_DATE,checkedAt:CHECK,lastCheckStatus:304,
    etag:null,lastModified:null,contentType:"text/html",reused:true,vaultKey:`project/freshness/source/${options.sourceId}/releases/fixture/${sha256}.bin`};
}
async function imageStore() {
  const bytes=await sharp({create:{width:160,height:180,channels:3,background:"navy"}}).png().toBuffer();
  const writes:string[]=[];
  const io:PortraitRuntime={read:async(_url,signal)=>{signal?.throwIfAborted();return{bytes,retrievedAt:SOURCE_DATE,contentType:"image/png"};},put:async key=>{writes.push(key);}};
  return {writes,store:(id:string,sources:PortraitSources,at:string,signal:AbortSignal)=>storeVerifiedPortrait(id,sources,at,io,"officials",signal)};
}

test("a fresh state profile verifies after capture and its stored portrait reaches the people reader",async()=>{
  const {store}=await seed(),images=await imageStore();
  let clock=START;
  const result=await refreshStatePortraits({state:"az",store,now:START},{now:()=>clock,
    acquire:async options=>{const page=profile(options);clock=VERIFIED;return page;},
    storePortrait:async(id,sources,at,signal)=>{
      assert.throws(()=>verifyPortraitSources(id,sources,START),/PORTRAIT_SECOND_SOURCE_MISSING/,
        "the old pre-capture clock rejected a valid response completed later");
      assert.equal(at,VERIFIED);return images.store(id,sources,at,signal);
    }});
  assert.ok(result?.outcome.promoted,JSON.stringify(result?.outcome.candidate.receipt));
  const read=await readStatePeopleProjection("US-AZ",{store,now:VERIFIED,bypassCache:true});
  assert.equal(read.kind,"PROMOTED");if(read.kind!=="PROMOTED")return;
  const person=read.value.roster.officeholders[0],photo=person.photo!;
  assert.ok(photo,JSON.stringify(result!.candidate.excludedFacts));
  assert.ok(portraitBindingMatches(person.personId!,photo));
  assert.equal(photo.verification!.checkedAt,VERIFIED);assert.equal(photo.collectedAt,SOURCE_DATE);
  assert.equal(photo.verification!.sources[0].retrievedAt,SOURCE_DATE);assert.equal(person.provenance.collectedAt,SOURCE_DATE);
  assert.equal(images.writes.length,1);assert.deepEqual(result!.candidate.excludedFacts,[]);
});
test("a state portrait failure advances durable attempt metadata without withholding the accepted person",async()=>{
  const {store}=await seed();let previousId="";
  for(const now of [VERIFIED,"2026-10-09T21:00:07.000Z"]){
    const result=await refreshStatePortraits({state:"az",store,now},{now:()=>now,acquire:async()=>{throw Error("Known profile temporarily unavailable");}});
    assert.ok(result?.outcome.promoted);assert.notEqual(result!.candidate.id,previousId);previousId=result!.candidate.id;
    const saved=await store.readCandidate(previousId),gap=saved?.candidate.excludedFacts?.find(row=>row.code==="STATE_PORTRAIT_PROCESSING_FAILED");
    assert.equal((gap?.record as {attemptedAt:string}).attemptedAt,now);
    const read=await readStatePeopleProjection("US-AZ",{store,now,bypassCache:true});
    assert.equal(read.kind,"PROMOTED");if(read.kind!=="PROMOTED")return;
    assert.equal(read.value.roster.officeholders.length,1);assert.equal(read.value.roster.officeholders[0].photo,null);
    assert.equal(read.value.roster.officeholders[0].provenance.collectedAt,SOURCE_DATE);
  }
});
test("a state's portrait run publishes finished photos promptly and reads its sources once",async()=>{
  const {store}=await seed(25),images=await imageStore();
  const before=(store as unknown as {candidates:Map<string,CandidateVersionRecord>}).candidates.size;
  let sourceReads=0;const readPromotion=store.readPromotion.bind(store);
  store.readPromotion=(async(recordClass,scope)=>{if(recordClass === "STATE_LEGISLATOR" && !scope.includes(":portraits:"))sourceReads++;return readPromotion(recordClass,scope);}) as typeof store.readPromotion;
  const result=await refreshStatePortraits({state:"az",store,now:START},{now:()=>VERIFIED,storePortrait:images.store,acquire:async options=>profile(options)});
  assert.ok(result?.outcome.promoted);
  const written=[...(store as unknown as {candidates:Map<string,CandidateVersionRecord>}).candidates.values()].slice(before);
  assert.ok(written.length>1,"finished photos publish while the rest of the roster is still being read");
  assert.ok(written.every(row=>row.candidate.sourceId === "people-portraits"));
  const sourceContracts=sourceReads;
  sourceReads=0;
  await refreshStatePortraits({state:"az",store,now:START},{now:()=>VERIFIED,acquire:async()=>{throw Error("not due");}});
  assert.equal(sourceReads,sourceContracts,"the state's source promotions are read once per run, not once per person");
});
test("state portrait work finishes every known profile",async()=>{
  const {store}=await seed(25),images=await imageStore();let requests=0;
  const result=await refreshStatePortraits({state:"az",store,now:START},{now:()=>VERIFIED,storePortrait:images.store,
    acquire:async options=>{requests++;return profile(options);}});
  assert.ok(result?.outcome.promoted);assert.equal(requests,25);
  const read=await readStatePeopleProjection("US-AZ",{store,now:VERIFIED,bypassCache:true});
  assert.equal(read.kind,"PROMOTED");if(read.kind!=="PROMOTED")return;
  assert.equal(read.value.roster.officeholders.filter(row=>row.photo?.verification).length,25,JSON.stringify(result!.candidate.excludedFacts));
});
test("the standing portrait run passes five minutes and 64 people with a fake clock, publishing each finished fact",async t=>{
  const {roster}=await seed(70),images=await imageStore();
  t.mock.timers.enable({apis:["setTimeout","Date"],now:Date.parse(START)});
  let acquired=0,recorded=0;
  const result=await statePeoplePortraits({state:"az",roster,now:START},{now:()=>new Date().toISOString(),storePortrait:images.store,
    acquire:async options=>{
      acquired++;t.mock.timers.tick(6000);
      return {...profile(options),checkedAt:new Date().toISOString()};
    },onPerson:async(person,facts)=>{
      assert.ok(portraitBindingMatches(person.personId ?? person.id,person.photo!));
      assert.deepEqual(facts,[]);recorded++;
      if(recorded === 1)assert.ok(acquired < 70,"the first verified portrait publishes before the entire roster is done");
    }});
  assert.ok(Date.now()-Date.parse(START)>5*60_000);
  assert.equal(result.attempted,70);assert.equal(acquired,70);assert.equal(recorded,70);
  assert.equal(result.roster.officeholders.filter(person=>portraitBindingMatches(person.personId ?? person.id,person.photo!)).length,70);
  assert.deepEqual(result.excludedFacts,[]);
});

test("per-person portrait publication preserves a concurrently refreshed phone and newly added person",async()=>{
  const {store,roster,acquisitions}=await seed(),images=await imageStore();
  const extra={...roster.officeholders[0],id:"plural:az:ocd-person/new",personId:"ocd-person/new",name:"New Member",nativeIds:{openstates:["ocd-person/new"]},phone:"202-225-9000"};
  let changed=false;
  const result=await refreshStatePortraits({state:"az",store,now:START},{now:()=>VERIFIED,storePortrait:images.store,
    acquire:async options=>{
      if(!changed){
        changed=true;
        const publication=await publishStatePeople({ vault, store,state:"az",roster:{...roster,officeholders:[{...roster.officeholders[0],phone:"202-225-2222"},extra]},
          acquisitions,releaseId:sha,now:VERIFIED});
        assert.ok(publication.outcome.promoted);
      }
      return profile(options);
    }});
  assert.ok(result?.outcome.promoted);
  const read=await readStatePeopleProjection("US-AZ",{store,now:VERIFIED,bypassCache:true});
  assert.equal(read.kind,"PROMOTED");if(read.kind!=="PROMOTED")return;
  assert.equal(read.value.roster.officeholders.length,2);
  assert.equal(read.value.roster.officeholders.find(person=>person.id===roster.officeholders[0].id)?.phone,"202-225-2222");
  assert.ok(read.value.roster.officeholders.find(person=>person.id===roster.officeholders[0].id)?.photo);
});
test("a saved government endorsement verifies a named portrait on an official .us publisher",async()=>{
  const {roster}=await seed(),images=await imageStore();
  const url="https://legislature.example.us/members/0",text=`<a href="${url}">Official legislature member</a>`;
  const person={...roster.officeholders[0],websiteUrl:url,profileUrls:[url]};
  let requested=0;
  const unendorsed=await statePeoplePortraits({state:"az",roster:{...roster,officeholders:[person]},now:START},{now:()=>VERIFIED,
    acquire:async options=>{requested++;return profile(options);},storePortrait:images.store});
  assert.equal(requested,0);assert.equal(unendorsed.roster.officeholders[0].photo,null);
  const endorsed=await statePeoplePortraits({state:"az",roster:{...roster,officeholders:[person]},now:START},{now:()=>VERIFIED,
    acquire:async options=>{requested++;return profile(options);},storePortrait:images.store,
    linkingCaptures:[{transport:"REACHABLE",partial:false,httpStatus:200,observedAt:CHECK,evidence:{canonicalUrl:"https://state.example.gov/legislature",
      sourceId:"official-government",contentHash:portraitHash(new TextEncoder().encode(text)),text,retrievedAt:SOURCE_DATE,
      vaultKey:"project/freshness/source/official-government/releases/fixture/endorsement.bin"}}]});
  assert.equal(requested,1);
  const photo=endorsed.roster.officeholders[0].photo!;
  assert.ok(portraitBindingMatches(person.personId!,photo));
  assert.equal(photo.verification!.basis,"OWN_PAGE");assert.equal(photo.verification!.ownPageUrl,url);
});
test("state portrait cancellation retains work and prioritizes untouched native people next",async()=>{
  const {store}=await seed(5);
  const run=async()=>{
    const controller=new AbortController(),requested:string[]=[];
    const result=await refreshStatePortraits({state:"az",store,now:START,signal:controller.signal},{now:()=>VERIFIED,
      acquire:async options=>{
        requested.push(options.url);if(requested.length===3)controller.abort(new Error("Existing continuation deadline"));
        await new Promise<void>((_resolve,reject)=>{
          if(options.signal.aborted)reject(options.signal.reason);
          else options.signal.addEventListener("abort",()=>reject(options.signal.reason),{once:true});
        });throw Error("unreachable");
      }});
    assert.ok(result?.outcome.promoted);return{requested,result};
  };
  const first=await run();assert.equal(first.requested.length,3);
  assert.ok(first.result!.candidate.excludedFacts?.some(row=>row.code==="STATE_PORTRAIT_WORK_REMAINS"));
  const second=await run();assert.deepEqual(second.requested.slice(0,2),["https://legislature.example.gov/members/3","https://legislature.example.gov/members/4"]);
});

const HELD_NOW="2026-10-10T01:00:00.000Z";
async function seedHeldProfile(row:typeof heldProfiles[number],extraLinks=""){
  const store=new MemoryRoutineDataStore(),state=row.scope.slice(3,5).toLowerCase();
  const releaseId=row.source_url.split("/").at(-1)!;
  const url=`https://raw.githubusercontent.com/openstates/people/${releaseId}/${row.member}`;
  const body=row.body+extraLinks;
  const roster=normalize(yamlToPeople(body,state,url,HELD_NOW),new Map(),row.retrieved_at,`US-${state.toUpperCase()}`);
  const published=await publishStatePeople({ vault, store,state,roster,acquisitions:[{requestedUrl:url,finalUrl:url,httpStatus:200,
    retrievedAt:row.retrieved_at,body}],releaseId,now:HELD_NOW});
  assert.ok(published.outcome.promoted,JSON.stringify(published.outcome.candidate.receipt));
  return {store,state,person:roster.officeholders[0]};
}
function heldPage(options:KnownReleaseOptions,text:string):KnownRelease{
  const bytes=new TextEncoder().encode(text);
  return {...profile(options),bytes,sha256:portraitHash(bytes).slice(7),retrievedAt:HELD_NOW,sourceObservedAt:HELD_NOW,checkedAt:HELD_NOW};
}
test("exact held links and sources supply profiles when a native person's selected website is empty or old",async()=>{
  for(const row of heldProfiles){
    const {store,state,person}=await seedHeldProfile(row),images=await imageStore(),requests:string[]=[];
    assert.ok(person.profileUrls?.length);
    const result=await refreshStatePortraits({store,state,now:HELD_NOW},{now:()=>HELD_NOW,storePortrait:images.store,
      acquire:async options=>{
        requests.push(options.url);
        return heldPage(options,`<h1>${person.name}</h1><img alt="Portrait of ${person.name}" src="/verified-person.png">`);
      }});
    assert.ok(result?.outcome.promoted,JSON.stringify(result?.outcome.candidate.receipt));
    assert.ok(requests.length<=1,"the captured Open States photo can publish without another profile read");
    if(requests.length)assert.ok(person.profileUrls!.includes(requests[0]));
    const read=await readStatePeopleProjection(`US-${state.toUpperCase()}`,{store,now:HELD_NOW,bypassCache:true});
    assert.equal(read.kind,"PROMOTED");if(read.kind!=="PROMOTED")continue;
    const shown=read.value.roster.officeholders[0];
    assert.ok(shown.photo,JSON.stringify(result!.candidate.excludedFacts));
    assert.ok(portraitBindingMatches(person.personId!,shown.photo));
    assert.equal(shown.personId,person.personId);assert.equal(shown.provenance.collectedAt,row.retrieved_at);
    assert.equal(shown.photo.verification?.ownPageUrl,requests[0]);
  }
});
test("failed held profiles advance to the next exact native link without accepting a different person's image",async()=>{
  const row=heldProfiles.find(row=>row.member.includes("Corey-"))!;
  const first="https://www.tempe.gov/retired-profile";
  const {store,state,person}=await seedHeldProfile(row,`\nlinks:\n- url: ${first}\n`),images=await imageStore();
  const requests:string[]=[];
  const fail=await refreshStatePortraits({store,state,now:HELD_NOW},{now:()=>HELD_NOW,storePortrait:images.store,
    acquire:async options=>{
      requests.push(options.url);
      return heldPage(options,'<h1>Different Person</h1><img alt="Portrait of Different Person" src="/different.png">');
    }});
  assert.ok(fail?.outcome.promoted);assert.equal(images.writes.length,0);
  assert.deepEqual(requests,[first,"https://www.tempe.gov/government/mayor-and-city-council/corey-d-woods-mayor"]);
  const failure=fail!.candidate.excludedFacts?.find(fact=>fact.code==="STATE_PORTRAIT_IMAGE_NOT_FOUND");
  assert.deepEqual((failure?.record as {profileAttempts:{sourceUrl:string}[]}).profileAttempts.map(attempt=>attempt.sourceUrl),requests);
  requests.length=0;
  const success=await refreshStatePortraits({store,state,now:HELD_NOW},{now:()=>HELD_NOW,storePortrait:images.store,
    acquire:async options=>{
      requests.push(options.url);
      if(options.url===first)throw Error("Held old profile is no longer available");
      return heldPage(options,`<h1>${person.name}</h1><img alt="Portrait of ${person.name}" src="/correct.png">`);
    }});
  assert.ok(success?.outcome.promoted);assert.equal(requests.length,2);assert.equal(images.writes.length,1);
  const read=await readStatePeopleProjection("US-AZ",{store,now:HELD_NOW,bypassCache:true});
  assert.equal(read.kind,"PROMOTED");if(read.kind!=="PROMOTED")return;
  assert.ok(portraitBindingMatches(person.personId!,read.value.roster.officeholders[0].photo!));
  assert.deepEqual(success!.candidate.excludedFacts,[]);
});
