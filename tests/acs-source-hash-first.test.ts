import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseCsv } from "../lib/reference/csv.ts";
import { ACS_GEOGRAPHIES,fetch as fetchAcs } from "../lib/sources/census-acs-population/index.ts";
import { acquireNationalAcsSources } from "../lib/sources/census-acs-population/national.ts";
import { acsSourceProbe,acsSourceContentHash } from "../lib/sources/census-acs-population/source-hash.ts";
import { refreshNationalAcs } from "../lib/sources/census-acs-population/refresh.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { CivicReadCache } from "../lib/db/civic-read-cache.ts";
import { MemoryEvidenceStore } from "../lib/control-plane/evidence/store.ts";
import type { SourceHead } from "../lib/civic-data/store.ts";
import type { RoutineDataStore } from "../lib/civic-data/store.ts";

function cache(){const data=new Map<string,string>();return{data,cache:new CivicReadCache({read:async key=>data.get(key)??null,write:async(key,value)=>{data.set(key,value);}})};}
const [, ...states]=parseCsv(readFileSync(new URL("./fixtures/census-acs/state.csv",import.meta.url),"utf8"));
const zctas=Array.from({length:30_000},(_,index)=>["Synthetic ZCTA", "1", "1",String(index+1).padStart(5,"0")]);
const fetcher:typeof fetch=async input=>{
  const url=new URL(String(input));
  if(url.pathname==="/data.json")return Response.json({dataset:[{c_dataset:["acs","acs5"],c_vintage:2024}]});
  if(url.pathname.endsWith("release-schedule.html"))return new Response("<tr><td>January 29, 2026</td><td>5-Year Data Release</td></tr>");
  const scope=Object.entries(ACS_GEOGRAPHIES).find(([,name])=>url.searchParams.get("for")===`${name}:*`)?.[0];
  if(scope==="state")return Response.json([["NAME","B01003_001E","B01003_001M","state"],...states.map(([code,name,pop,margin])=>[name,pop,margin||null,code])]);
  if(scope==="zcta")return Response.json([["NAME","B01003_001E","B01003_001M","zip code tabulation area"],...zctas]);
  if(scope==="nation")return Response.json([["NAME","B01003_001E","B01003_001M","us"],["Synthetic nation","1","1","1"]]);
  return new Response(null,{status:204});
};

test("ACS compares exact complete table bytes and all join inputs before held joins, payloads or history",async()=>{
  const sources=await acquireNationalAcsSources({key:"never-persist-this-key",fetcher});
  const inputs={dependencies:{},referenceHashes:{AZ:"a".repeat(64)}},probe=acsSourceProbe(sources,inputs.dependencies,inputs.referenceHashes),rawHash=acsSourceContentHash(probe);
  const head:SourceHead={sourceId:"census-data-api",recordClass:"CENSUS_REFERENCE",scope:"acs-population",versionId:"held-acs",lastKnownGoodVersionId:"held-acs",
    rawHash,rawHashBasis:"SOURCE_CONTENT_V1",normalizedHash:"b".repeat(64),parserVersion:"census-data-api/3",promotedAt:new Date().toISOString(),candidateState:"PROMOTED",acquisitionSucceeded:true,imported:false};
  const confirmations:unknown[]=[];
  const store={readSourceHead:async()=>head,confirmUnchanged:async(input:unknown,at:string)=>{confirmations.push(input);return{kind:"CONFIRMED",versionId:head.versionId,at};},
    readPromotion:async()=>{throw Error("held full table read");},readCandidate:async()=>{throw Error("held candidate/history read");}} as unknown as RoutineDataStore;
  const copies=cache();
  const result=await refreshNationalAcs({key:"never-persist-this-key",store,cache:copies.cache,readSources:async()=>sources,inputs:async()=>inputs,
    targets:async()=>{throw Error("unchanged source must not load held geography joins");}});
  assert.equal(result.publication,null);assert.equal(result.confirmation?.head.versionId,head.versionId);
  assert.equal(confirmations.length,1);assert.ok(!JSON.stringify(probe).includes("never-persist-this-key"));
  assert.equal(await copies.cache.readCheckpoint("source-probe-progress:v1","census-acs-population"),null,"completed work makes the next due check acquire current bytes");
  const later={...sources,captures:[...sources.captures].reverse().map(capture=>({...capture,fetchedAt:"2026-10-26T23:59:00.000Z"}))};
  assert.equal(rawHash,acsSourceContentHash(acsSourceProbe(later,inputs.dependencies,inputs.referenceHashes)));
  assert.notEqual(rawHash,acsSourceContentHash(acsSourceProbe(sources,inputs.dependencies,{AZ:"c".repeat(64)})));
  assert.notEqual(rawHash,acsSourceContentHash(acsSourceProbe(sources,{"REGISTRATION:AZ":["new-pointer",null,null,"parser"]},inputs.referenceHashes)));
  assert.notEqual(rawHash,acsSourceContentHash(acsSourceProbe({...sources,captures:sources.captures.slice(1)},inputs.dependencies,inputs.referenceHashes)));
});

test("ACS interrupted source acquisition resumes exact successful 204 responses without persisting credentials or advancing their date",async()=>{
  const copies=cache(),vault=new MemoryEvidenceStore(),store=new MemoryRoutineDataStore();
  let observedAt="",requests=0;
  const readSources:typeof acquireNationalAcsSources=async input=>{
    const table=await fetchAcs("county","never-persist-this-key",async()=>{requests++;return new Response(null,{status:204});},input.signal,
      {vintage:2024,stateFips:"04",sourceDocument:input.sourceDocument});
    if(!observedAt)observedAt=table.fetchedAt;else assert.equal(table.fetchedAt,observedAt);
    throw Error("controlled cutoff after a completed source");
  };
  for(let attempt=0;attempt<2;attempt++)await assert.rejects(refreshNationalAcs({key:"never-persist-this-key",store,cache:copies.cache,vault,readSources}),/controlled cutoff/);
  assert.equal(requests,1,"only the interrupted pass reuses its completed exact source response");
  assert.ok(![...copies.data.values()].join("\n").includes("never-persist-this-key"));
  for(const key of await vault.list(""))assert.ok(!new TextDecoder().decode((await vault.get(key))!.bytes).includes("never-persist-this-key"));
});
