import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { zip } from "../scripts/xlsx.mjs";
import { acquireDataset } from "../lib/sources/legiscan/acquisition.ts";
import { MemoryEvidenceStore } from "../lib/control-plane/evidence/store.ts";
import { CivicReadCache } from "../lib/db/civic-read-cache.ts";
import type { Dataset } from "../lib/sources/legiscan/bills.ts";

const at="2026-10-12T12:00:00.000Z",later="2026-10-12T12:01:00.000Z";
const hash=(body:string)=>createHash("sha256").update(body).digest("hex");
const bodies=["HB1","HB2"].map(name=>readFileSync(new URL(`./fixtures/legiscan/bill/${name}.json`,import.meta.url),"utf8"));
const native=JSON.parse(bodies[0]).bill;
const dataset:Dataset={state_id:native.state_id,session_id:native.session_id,session_name:native.session.session_name,dataset_hash:hash(bodies.join("")),dataset_date:"2012-12-30",access_key:"fixture-private-token"};

test("a per-bill cutoff resumes immutable native members and keeps their actual source observation",async()=>{
  const stop=new AbortController(),saved=new Map<string,string>(),vault=new MemoryEvidenceStore();let interrupt=true,calls=0,now=at;
  class InterruptingCache extends CivicReadCache{
    override jobState(){return this;}
    override async checkpoint<T>(namespace:string,key:string,value:T,etag?:string){
      await super.checkpoint(namespace,key,value,etag);
      if(namespace==="legiscan-bulk-bill"&&interrupt){interrupt=false;stop.abort(Error("controlled source cutoff"));}
    }
  }
  const cache=new InterruptingCache({read:async key=>saved.get(key)??null,write:async(key,value)=>{saved.set(key,value);}});
  const fetchImpl:typeof fetch=async value=>{
    calls++;const url=new URL(String(value));assert.equal(url.searchParams.get("access_key"),dataset.access_key);
    const archive=zip(bodies.map((body,index)=>({name:`${dataset.session_id}/bill/${index}.json`,data:Buffer.from(body)})),"2026-10-12");
    return Response.json({status:"OK",dataset:{...dataset,mime_type:"application/zip",zip:archive.toString("base64")}});
  };
  const options={key:"private-api-key",vault,cache,fetchImpl,now:()=>now};
  await assert.rejects(acquireDataset(dataset,{...options,signal:stop.signal}),/controlled source cutoff/);
  assert.equal(calls,1);
  now=later;
  const resumed=await acquireDataset(dataset,{...options,signal:new AbortController().signal});
  assert.equal(calls,1,"a confirmed exact dataset continues from its captured ZIP instead of requesting it again");
  assert.deepEqual(resumed.bodies,bodies);assert.equal(resumed.capture.retrievedAt,at);
  assert.equal(JSON.parse(resumed.capture.body).memberHashes.length,2,"both completed and unfinished native bills remain in the exact archive inventory");
  const checkpoints=[...saved.values()].join("");
  assert.ok(!checkpoints.includes("private-api-key")&&!checkpoints.includes("fixture-private-token"));
});
