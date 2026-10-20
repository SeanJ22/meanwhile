import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp,rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { createFileRepositories } from "../lib/control-plane/repository/file-store.ts";
import { AGGREGATE_LIST_READ_PAGE,pgFieldManualRepository,type Sql } from "../lib/control-plane/repository/pg-store.ts";
import { normalizeEntry,newFieldManualEntry,saveFieldManualEntries,type FieldManualEntry } from "../lib/control-plane/field-manual.ts";
import { savedJobCostProfiles } from "../lib/control-plane/bank-job-cost.ts";
import { MANUAL_MERGE_NOW,verifyFieldManualMerge } from "./helpers/field-manual-merge-cases.ts";

test("native manual merges preserve existing pure observation rules, including scopes, payload unions, partial legacy places, ties and supersedes",async()=>{
  await verifyFieldManualMerge(createMemoryRepositories().fieldManual);
  const directory=await mkdtemp(join(tmpdir(),"manual-merge-parity-"));
  try{await verifyFieldManualMerge((await createFileRepositories(directory)).fieldManual);}
  finally{await rm(directory,{recursive:true,force:true});}
  const pg=new PGlite();
  try{
    await pg.exec("CREATE TABLE cp_field_manual_entries(id text PRIMARY KEY,revision bigint,updated_at timestamptz,value jsonb,changed_at timestamptz DEFAULT now())");
    const sql:Sql={query:async(text,params)=>(await pg.query(text,params?[...params]:[])).rows};
    await verifyFieldManualMerge(pgFieldManualRepository(sql));
  }finally{await pg.close();}
});

test("a saved cost profile reads bounded projected pages with original scope predicates and no per-attempt point query",async()=>{
  const pg=new PGlite();
  try{
    await pg.exec("CREATE TABLE cp_field_manual_entries(id text PRIMARY KEY,revision bigint,updated_at timestamptz,value jsonb,changed_at timestamptz DEFAULT now())");
    const cost=normalizeEntry(newFieldManualEntry("job-cost","one",{role:"SHARED",kind:"JOB_COST",title:"Cost",summary:"Observation",outcome:"REFERENCE",platforms:["legistar"],recordClasses:["meetings"],
      payload:{platform:"legistar",recordClass:"meetings",attemptId:"one",durationMs:1000,usd:0.1,requestCount:2,success:true,opaque:"UNNEEDED_COST_EVIDENCE".repeat(1000)}}));
    await pg.query("INSERT INTO cp_field_manual_entries SELECT 'cost-'||n,1,$2::timestamptz,$1::jsonb||jsonb_build_object('id','cost-'||n) FROM generate_series(1,301) n",[JSON.stringify(cost),MANUAL_MERGE_NOW]);
    await pg.query("INSERT INTO cp_field_manual_entries SELECT 'other-'||n,1,$2::timestamptz,$1::jsonb||jsonb_build_object('id','other-'||n,'platforms',jsonb_build_array('civicplus')) FROM generate_series(1,20) n",[JSON.stringify(cost),MANUAL_MERGE_NOW]);
    let calls=0,maxRows=0;
    const sql:Sql={query:async(text,params)=>{
      calls++;const rows=(await pg.query(text,params?[...params]:[])).rows;
      maxRows=Math.max(maxRows,rows.length);
      assert.ok(!JSON.stringify(rows).includes("UNNEEDED_COST_EVIDENCE"));
      return rows;
    }};
    const [profile]=await savedJobCostProfiles(pgFieldManualRepository(sql),[cost],MANUAL_MERGE_NOW);
    assert.equal((profile.payload as {attempts:number}).attempts,301);
    assert.equal(calls,Math.floor(301/AGGREGATE_LIST_READ_PAGE)+1);
    assert.ok(maxRows<=AGGREGATE_LIST_READ_PAGE);
  }finally{await pg.close();}
});

test("a one-place observation merges into a country's saved method without transferring or rewriting its stored histories through the job",async()=>{
  const pg=new PGlite(),transferred:unknown[]=[];
  try{
    await pg.exec("CREATE TABLE cp_field_manual_entries(id text PRIMARY KEY,revision bigint,updated_at timestamptz,value jsonb,changed_at timestamptz DEFAULT now())");
    const sql:Sql={query:async(text,params)=>{const rows=(await pg.query(text,params?[...params]:[])).rows;transferred.push(rows);return rows;}};
    const repo=pgFieldManualRepository(sql);
    const prior=normalizeEntry(newFieldManualEntry("merge-country","method",{role:"SHARED",kind:"METHOD",title:"Saved method",summary:"Read the official directory",outcome:"YIELDED",observedAt:"2026-10-18",
      placeResults:Array.from({length:5000},(_,n)=>({place:`body:country-${n}`,outcome:"YIELDED",observedAt:"2026-10-18"})),
      reach:{places:Array.from({length:5000},(_,n)=>`body:country-${n}`),states:[],platforms:[],everywhere:false},
      payload:{places:Array.from({length:5000},(_,n)=>`country-${n}`),doorEntryIds:["door-old"],outcomes:[{jurisdiction:"other",detail:"UNRELATED_COUNTRY_HISTORY".repeat(1000)}]}}));
    await repo.put(prior.id,prior,MANUAL_MERGE_NOW);transferred.length=0;
    repo.read=async()=>{throw new Error("Full manual read forbidden");};
    repo.readMany=async()=>{throw new Error("Full manual readMany forbidden");};
    repo.compareAndSet=async()=>{throw new Error("Full manual rewrite forbidden");};
    const observation:FieldManualEntry={...newFieldManualEntry("merge-country","method",{role:"SHARED",kind:"METHOD",title:"A stale local observation",summary:"The old route still works",outcome:"FAILED",observedAt:"2026-10-17",
      bodyIds:["own-board"],payload:{places:["own-place"],doorEntryIds:["door-own"]}}),id:prior.id};
    assert.deepEqual(await saveFieldManualEntries({fieldManual:repo},[observation],MANUAL_MERGE_NOW),{written:1});
    assert.ok(!JSON.stringify(transferred).includes("UNRELATED_COUNTRY_HISTORY"));
    assert.ok(JSON.stringify(transferred).length<1000);
    const saved=(await pg.query<{value:FieldManualEntry}>("SELECT value FROM cp_field_manual_entries WHERE id=$1",[prior.id])).rows[0].value;
    assert.equal(saved.placeResults?.length,5001);assert.equal(saved.reach?.places.length,5001);
    assert.equal((saved.payload as {places:string[]}).places.length,5001);
    assert.match(JSON.stringify(saved.payload),/UNRELATED_COUNTRY_HISTORY/);
  }finally{await pg.close();}
});
