import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFile, writeFile } from "node:fs/promises";
import { DiagnosticModelBudget, RH01_DIAGNOSTIC_LIMITS } from "../scripts/rh01-model-budget.mts";
import type { ModelRequest, ModelResponse } from "../lib/control-plane/scheduler/scout-executor.ts";
import { diagnosticModelCalls } from "../scripts/rh01-read-accounting.mts";

const request = (text = "actual source context"): ModelRequest => ({ model: RH01_DIAGNOSTIC_LIMITS.model,max_tokens:8192,
  system:[],tools:[],messages:[{role:"user",content:text}] });
const response: ModelResponse = { model: RH01_DIAGNOSTIC_LIMITS.model,content:[],stop_reason:"end_turn",
  usage:{input_tokens:100,output_tokens:10,cache_read_input_tokens:0,cache_creation_input_tokens:0} };
test("diagnostic transport blocks before authorization, refuses other models, and never retries",async()=>{
  const directory=await mkdtemp(join(tmpdir(),"rh01-model-guard-")),budget=new DiagnosticModelBudget(join(directory,"budget.sqlite"));
  let sent=0;
  const send=async()=>{sent++;return response;};
  try{
    await assert.rejects(budget.transport({phase:"before",role:"SCOUT",authorized:false,transport:send})(request()),/authorization is absent/);
    await assert.rejects(budget.transport({phase:"before",role:"SCOUT",authorized:true,transport:send})({...request(),model:"claude-opus-5-5"}),/only the native Haiku/);
    assert.equal(sent,0);assert.equal(budget.snapshot().calls.length,0);
    await assert.rejects(budget.transport({phase:"before",role:"SCOUT",authorized:true,transport:async()=>{sent++;throw Error("provider unavailable");}})(request()),/provider unavailable/);
    assert.equal(sent,1);assert.equal(budget.snapshot().calls.length,1);
  }finally{budget.close();await rm(directory,{recursive:true,force:true});}
});
test("one shared SQLite ledger enforces both phases, native calls and the five dollar cap",async()=>{
  const directory=await mkdtemp(join(tmpdir(),"rh01-model-cap-")),file=join(directory,"budget.sqlite");
  const first=new DiagnosticModelBudget(file),second=new DiagnosticModelBudget(file);let sent=0;
  const send=async()=>{sent++;return response;};
  try{
    const before=first.transport({phase:"before",role:"SCOUT",authorized:true,transport:send});
    const same=second.transport({phase:"before",role:"SCOUT",authorized:true,transport:send});
    await before(request("x".repeat(2_100_000)));
    await assert.rejects(same(request("x".repeat(2_100_000))),/dollar cap/);
    const after=second.transport({phase:"after",role:"SCOUT",authorized:true,transport:send});
    await after(request("x".repeat(2_100_000)));
    for(const phase of ["before","after"]as const){
      const audit=first.transport({phase,role:"ADVERSARIAL_AUDITOR",authorized:true,transport:send});
      await audit({...request(),max_tokens:2048});
      await assert.rejects(audit({...request(),max_tokens:2048}),/call limit/);
    }
    const rows=first.snapshot().calls;
    assert.equal(sent,4);assert.equal(rows.length,4);
    assert.ok(rows.reduce((sum,row)=>sum+Number(row.reservedUsd),0)<=5);
    assert.ok(rows.every(row=>row.actualUsd!==null&&row.usageJson!==null));
    const descriptor=join(directory,"broker.json");await writeFile(descriptor,JSON.stringify({budgetPath:file}));
    const beforeReport=await diagnosticModelCalls(descriptor,"before",0),afterReport=await diagnosticModelCalls(descriptor,"after",0);
    assert.deepEqual(beforeReport.map(row=>row.role),["SCOUT","ADVERSARIAL_AUDITOR"]);
    assert.deepEqual(afterReport.map(row=>row.role),["SCOUT","ADVERSARIAL_AUDITOR"]);
    assert.ok([...beforeReport,...afterReport].every(row=>row.usd!==null&&row.usd>0&&row.usage!==null));
    assert.deepEqual(await diagnosticModelCalls(descriptor,"before",Date.now()+1000),[]);
    assert.deepEqual(await diagnosticModelCalls(undefined,"before",0),[]);
    assert.equal(first.snapshot().calls.length,4,"read-only component reporting must not reset the shared cap");
  }finally{first.close();second.close();await rm(directory,{recursive:true,force:true});}
});

test("the native eighty-turn Scout limit is shared across reopened budget clients",async()=>{
  const directory=await mkdtemp(join(tmpdir(),"rh01-model-turns-")),file=join(directory,"budget.sqlite");
  const first=new DiagnosticModelBudget(file),second=new DiagnosticModelBudget(file);let sent=0;
  const transport=async()=>{sent++;return response;};
  try{
    const a=first.transport({phase:"after",role:"SCOUT",authorized:true,transport});
    const b=second.transport({phase:"after",role:"SCOUT",authorized:true,transport});
    await Promise.all(Array.from({length:80},(_,index)=>(index%2?a:b)(request())));
    await assert.rejects(b(request()),/call limit/);assert.equal(sent,80);
  }finally{first.close();second.close();await rm(directory,{recursive:true,force:true});}
});
test("the real local broker blocks an otherwise eligible request without spending authorization",async()=>{
  const directory=await mkdtemp(join(tmpdir(),"rh01-model-broker-")),descriptor=join(directory,"broker.json");
  const child=spawn(process.execPath,["--experimental-strip-types","--import","./scripts/register-test-loader.mjs","scripts/rh01-model-broker.mts",
    `--descriptor=${descriptor}`,`--budget=${join(directory,"budget.sqlite")}`],{cwd:process.cwd(),stdio:["ignore","pipe","pipe"]});
  let output="",errors="";child.stderr.on("data",chunk=>{errors+=chunk;});
  try{
    await new Promise<void>((accept,reject)=>{
      child.stdout.on("data",chunk=>{output+=chunk;if(output.includes("RH01_MODEL_BROKER "))accept();});
      child.once("exit",code=>reject(Error(`broker ended before readiness:${code}:${errors}`)));
    });
    const broker=JSON.parse(await readFile(descriptor,"utf8"));
    const response=await fetch(broker.url,{method:"POST",headers:{authorization:broker.auth,"content-type":"application/json"},
      body:JSON.stringify({phase:"before",request:{...request(),batchContext:{priority:{subjectId:"ocd-division/country:us/state:az/county:pima"}},tools:[{name:"finish"}]}})});
    assert.equal(response.status,403);const body=await response.json();assert.equal(body.notSent,true);assert.match(body.error,/authorization is absent/);
    const ledger=new DiagnosticModelBudget(join(directory,"budget.sqlite"));try{assert.equal(ledger.snapshot().calls.length,0);}finally{ledger.close();}
  }finally{child.kill("SIGTERM");await once(child,"close");await rm(directory,{recursive:true,force:true});}
});
