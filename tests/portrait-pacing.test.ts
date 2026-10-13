import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate } from "node:timers/promises";
import { pacedPortraitAcquire } from "../lib/photos/portrait-work.ts";
import { MemoryEvidenceStore } from "../lib/control-plane/evidence/store.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { PER_HOST_SPACING_MS } from "../lib/control-plane/scheduler/http-executor.ts";
import type { KnownReleaseOptions } from "../lib/sources/known-release.ts";

test("standing profile and image readers share one host reader, spacing, holds and cached captures",async()=>{
  const repos=createMemoryRepositories(),store=new MemoryEvidenceStore();
  let clock=Date.parse("2026-10-12T12:00:00.000Z"),largest=0;
  const active=new Map<string,number>(),starts:{host:string;at:number}[]=[];
  const runtime={repositories:async()=>repos,clock:()=>clock,sleep:async(ms:number)=>{clock+=ms;await setImmediate();}};
  const request=(sourceId:string,url:string):KnownReleaseOptions=>({sourceId,url,releaseId:url,parserVersion:"fixture/1",signal:new AbortController().signal,
    maxBytes:1024,checkAfterMs:7*86_400_000,now:()=>new Date(clock).toISOString(),store,locks:repos.locks,
    fetchImpl:async resource=>{
      const host=new URL(String(resource)).hostname.replace(/^www\./,"");
      starts.push({host,at:clock});active.set(host,(active.get(host) ?? 0)+1);largest=Math.max(largest,active.get(host)!);
      await setImmediate();active.set(host,active.get(host)!-1);
      return new Response("named official page",{headers:{"content-type":"text/html"}});
    }});
  const first=request("official-person-profile","https://legislature.example.gov/jane");
  await Promise.all([
    pacedPortraitAcquire(first,runtime),
    pacedPortraitAcquire(request("person-portrait","https://www.legislature.example.gov/jane.png"),runtime),
    pacedPortraitAcquire(request("official-person-profile","https://another.example.gov/jane"),runtime),
  ]);
  assert.equal(largest,1);
  const same=starts.filter(row=>row.host === "legislature.example.gov");
  assert.equal(same.length,2);assert.ok(same[1].at-same[0].at>=PER_HOST_SPACING_MS);
  const held=await pacedPortraitAcquire(first,runtime);
  assert.ok(held.reused);assert.equal(starts.length,3,"held bytes make no publisher request");
  const refused=request("official-person-profile","https://refused.example.gov/jane");
  await assert.rejects(pacedPortraitAcquire({...refused,fetchImpl:async()=>new Response("wait",{status:429,headers:{"retry-after":"120"}})},runtime),/KNOWN_SOURCE_HTTP_429/);
  let sent=false;
  await assert.rejects(pacedPortraitAcquire({...request("person-portrait","https://refused.example.gov/jane.png"),fetchImpl:async()=>{sent=true;return new Response("image");}},runtime),/PORTRAIT_WEBSITE_WAIT/);
  assert.equal(sent,false,"a publisher hold is shared by page and image source identities");
  const small={...runtime,sizeFor:()=>({kind:"local-government" as const,population:2000})};
  for(let i=0;i<10;i++)await pacedPortraitAcquire(request(i % 2 ? "person-portrait" : "official-person-profile",`https://small.example.gov/${i}`),small);
  await assert.rejects(pacedPortraitAcquire(request("person-portrait","https://small.example.gov/eleven"),small),/HOURLY_ALLOWANCE/);
});
