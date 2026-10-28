import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { mkdtemp,rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zip } from "../scripts/xlsx.mjs";
import { refreshPrl } from "../scripts/prl-refresh.mts";
import { LocalFileArchiveStore } from "../lib/sources/prl/archive-store-local.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { parseRoutineRunnerReceipt } from "../lib/civic-data/runner-receipt.ts";
import { prlSourceContentHash,type PrlSourceProbe } from "../lib/sources/prl/source-hash.ts";
import { requiredPrlDataset } from "../lib/sources/prl/inventory.ts";

test("PRL confirms equal profile bytes before loading a held candidate, snapshot or normalized profile copy",async()=>{
  const root=await mkdtemp(join(tmpdir(),"prl-hash-first-")),archive=new LocalFileArchiveStore(root),store=new MemoryRoutineDataStore(),lines:string[]=[];
  const body=zip([{name:"profiles.csv",data:await readFile(new URL("./fixtures/prl/profiles-national.csv",import.meta.url))}],"2026-10-01");
  let requests=0;
  const fetchImpl=(async()=>++requests===1?new Response(body,{headers:{etag:'"profiles"'}}):new Response(null,{status:304})) as typeof fetch;
  const original=console.log;
  try {
    console.log=line=>{lines.push(String(line));};
    assert.equal(await refreshPrl({archives:false,store,archive,fetchImpl}),0);
    store.readCandidate=async()=>{throw Error("held profile candidate must not be read");};
    store.readPromotion=async()=>{throw Error("held profile snapshot must not be read");};
    const get=archive.get.bind(archive);
    archive.get=async key=>{assert.notEqual(key,"profiles-national/state.json","matching source bytes need no normalized profiles copy");return get(key);};
    lines.length=0;
    assert.equal(await refreshPrl({archives:false,store,archive,fetchImpl}),0);
    const receipt=parseRoutineRunnerReceipt(lines.join("\n"));assert.equal(receipt.ok,true);
    if(receipt.ok)assert.ok(receipt.receipt.confirmedAt);
    assert.equal(requests,2);
  } finally {console.log=original;await rm(root,{recursive:true,force:true});}
});
test("PRL source digests retain every dataset while ignoring conditional ZIP member placeholders",()=>{
  const row=(datasetId:string,rawHash:string)=>({datasetId,requestedUrl:requiredPrlDataset(datasetId).url,finalUrl:requiredPrlDataset(datasetId).url,rawHash,member:"native.json"});
  const plan:PrlSourceProbe={formatVersion:1,parserVersion:"prl-ingest/2",complete:true,
    requests:[row("press-releases","a".repeat(64)),row("newsletters","b".repeat(64))]};
  assert.equal(prlSourceContentHash(plan),prlSourceContentHash({...plan,requests:[...plan.requests].reverse().map(request=>({...request,member:"download.zip"}))}));
  assert.notEqual(prlSourceContentHash(plan),prlSourceContentHash({...plan,requests:plan.requests.slice(0,1)}),"a selected subset cannot refresh a retained package");
});
