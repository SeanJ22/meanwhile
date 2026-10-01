import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { attemptBatchJournal, backgroundBatchTransport, MESSAGE_BATCHES_ENDPOINT, type BatchJournal } from "../lib/control-plane/model-batch.ts";
import { ZERO_COST, type Attempt, type AttemptProviderBatch } from "../lib/control-plane/attempt.ts";
import { createFileRepositories } from "../lib/control-plane/repository/file-store.ts";
import { MODELS } from "../lib/models.ts";
const request = { model: MODELS.haiku.model,max_tokens:20,system:[],tools:[],messages:[] };
const json = (body:unknown)=>new Response(JSON.stringify(body));
const ended={id:"provider-batch",created_at:new Date().toISOString(),processing_status:"ended",results_url:"https://provider/results"};
const result=(id:string)=>new Response(JSON.stringify({custom_id:id,result:{type:"succeeded",message:{model:MODELS.haiku.model,content:[],usage:{input_tokens:100,output_tokens:10}}}}));

test("lost provider-id persistence resumes a prewritten custom ID, with no second POST", async()=>{
  let saved:AttemptProviderBatch|null=null, posts=0;
  const journal:BatchJournal={read:async()=>saved,write:async r=>{
    if(r.batchId) throw new Error("crash after provider accepted"); saved=r;
  }};
  const initial=backgroundBatchTransport({apiKey:"test",journal,fetchImpl:async()=>{posts++;return json(ended);}});
  await assert.rejects(initial(request),/crash after provider accepted/);
  assert.equal(posts,1);assert.equal(saved!.batchId,null);
  let lists=0;
  const recovered=backgroundBatchTransport({apiKey:"test",journal:{read:async()=>saved,write:async r=>{saved=r;}},fetchImpl:async(url,init)=>{
    assert.notEqual(init?.method,"POST");
    if(String(url).startsWith(MESSAGE_BATCHES_ENDPOINT)){lists++;return json({data:[ended],has_more:false,last_id:ended.id});}
    return result(saved!.customId);
  }});
  assert.equal((await recovered(request)).batch,true);assert.equal(posts,1);assert.equal(lists,1);assert.equal(saved!.batchId,ended.id);
});
test("known batch resumes GET polling after a crash and refuses its unchanged errored result",async()=>{
  let saved:AttemptProviderBatch|null=null,posts=0;
  const journal:BatchJournal={read:async()=>saved,write:async r=>{saved=r;}};
  await assert.rejects(backgroundBatchTransport({apiKey:"test",journal,fetchImpl:async(url)=>{
    if(String(url)===MESSAGE_BATCHES_ENDPOINT){posts++;return json(ended);}throw new Error("process lost reading results");
  }})(request),/process lost/);
  assert.equal(saved!.batchId,ended.id);
  const resume=backgroundBatchTransport({apiKey:"test",journal,fetchImpl:async(url,init)=>{
    assert.notEqual(init?.method,"POST");
    return String(url).endsWith(ended.id)?json(ended):new Response(JSON.stringify({custom_id:saved!.customId,result:{type:"errored",error:{type:"overloaded_error"}}}));
  }});
  await assert.rejects(resume(request),/BACKGROUND_BATCH_errored:overloaded_error/);
  await assert.rejects(resume(request),/BACKGROUND_BATCH_errored:overloaded_error/);
  assert.equal(posts,1);
});
test("ambiguous POST with no provider result stays unknown and is never resubmitted",async()=>{
  let saved:AttemptProviderBatch|null=null,posts=0;
  const journal:BatchJournal={read:async()=>saved,write:async r=>{saved=r;}};
  await assert.rejects(backgroundBatchTransport({apiKey:"test",journal,fetchImpl:async()=>{posts++;throw new Error("lost POST");}})(request),/lost POST/);
  await assert.rejects(backgroundBatchTransport({apiKey:"test",journal,fetchImpl:async(_url,init)=>{
    assert.notEqual(init?.method,"POST");return json({data:[],has_more:false,last_id:null});
  }})(request),/BATCH_SUBMISSION_UNRESOLVED/);
  assert.equal(posts,1);
});
test("existing Attempt metadata survives repository reopen and reclaim; stale lease cannot write",async()=>{
  const root=await mkdtemp(join(tmpdir(),"s7-batch-"));
  try {
    const now=new Date().toISOString(),expires=new Date(Date.now()+60000).toISOString();
    let repos=await createFileRepositories(root);
    const base:Attempt={id:"attempt-old",routeTaskId:"task",workItemId:"work",worker:{role:"ADVERSARIAL_AUDITOR",provider:"anthropic",version:MODELS.haiku.model,instance:"worker"},leaseId:"lease-old",startedAt:now,endedAt:null,outcome:null,abortReason:null,artifactIds:[],cost:ZERO_COST,methodVersion:1,policyVersion:"test"};
    await repos.attempts.put(base.id,base,now);
    await repos.leases.put("task",{id:base.leaseId,routeTaskId:"task",holder:"worker",claimedAt:now,heartbeatAt:now,expiresAt:expires,released:false},now);
    const record={requestHash:"hash",customId:"custom",batchId:"provider",submittedAt:now};
    await attemptBatchJournal(repos,"task",()=>now).write(record);
    const old=await repos.attempts.mustRead(base.id);
    await repos.attempts.compareAndSet(base.id,old.revision,{...old.value,outcome:"CRASHED",endedAt:now},now);
    const lease=await repos.leases.mustRead("task");
    await repos.leases.compareAndSet("task",lease.revision,{...lease.value,id:"lease-new"},now);
    await repos.attempts.put("attempt-new",{...base,id:"attempt-new",leaseId:"lease-new"},now);
    repos=await createFileRepositories(root);
    const journal=attemptBatchJournal(repos,"task",()=>now);
    assert.deepEqual(await journal.read("hash"),record);
    await journal.write(record);
    assert.deepEqual((await repos.attempts.mustRead("attempt-new")).value.providerBatches,[record]);
    await assert.rejects(attemptBatchJournal(repos,"task",()=>new Date(Date.parse(expires)+1).toISOString()).write(record),/LEASE_NOT_HELD/);
  } finally {await rm(root,{recursive:true,force:true});}
});
