import assert from "node:assert/strict";
import test,{after} from "node:test";
import {PGlite} from "@electric-sql/pglite";
import {CivicReadCache} from "../lib/db/civic-read-cache.ts";
import {pgAggregateRepository,pgAppendOnlyRepository,type Sql} from "../lib/control-plane/repository/pg-store.ts";
import {shareRevisionReads} from "../lib/control-plane/repository/revision-reads.ts";
import {shareRetainedLogReads} from "../lib/control-plane/repository/retained-log-reads.ts";

const db=new PGlite();after(()=>db.close());
async function fixture(){
  await db.exec(`DROP SCHEMA public CASCADE;CREATE SCHEMA public;
    CREATE TABLE cp_log_worker_results(log_key text,position bigint,changed_at timestamptz DEFAULT clock_timestamp(),record jsonb,PRIMARY KEY(log_key,position));
    CREATE TABLE cp_owner_snapshots(id text PRIMARY KEY,revision bigint,updated_at timestamptz,changed_at timestamptz DEFAULT now(),value jsonb);`);
  const held=new Map<string,string>(),returned:{text:string;rows:Record<string,unknown>[]}[]=[];
  let fail=false;
  const connection=()=>{
    const sql:Sql={query:async(text,params=[])=>{
      if(fail&&text.includes("SELECT l.log_key"))throw Error("pass deadline");
      const result=await db.query<Record<string,unknown>>(text,[...params]);returned.push({text,rows:result.rows});return result.rows;
    }};
    const cache=new CivicReadCache({read:async key=>held.get(key)??null,write:async(key,value)=>{held.set(key,value);}});
    shareRevisionReads(sql,"postgres://fixture:fixture@owner.invalid/neondb",cache);
    shareRetainedLogReads(sql,"postgres://fixture:fixture@owner.invalid/neondb",cache);
    return sql;
  };
  const put=async(position:number,text="source ".repeat(8000))=>db.query("INSERT INTO cp_log_worker_results(log_key,position,record)VALUES('work',$1,$2)",[position,{id:`result-${position}`,text}]);
  return {connection,put,returned,fail:()=>{fail=true;},resume:()=>{fail=false;}};
}

test("a fresh snapshot invocation reads only newly committed log slots, including a late lower position",async()=>{
  const f=await fixture();await f.put(0);await f.put(2);
  const first=pgAppendOnlyRepository<{id:string}>(f.connection(),"worker_results");
  assert.equal((await first.readKeys!(["work"])).get("work")!.length,2);
  f.returned.length=0;
  const next=pgAppendOnlyRepository<{id:string}>(f.connection(),"worker_results");
  assert.equal((await next.readKeys!(["work"])).get("work")!.length,2);
  assert.equal(f.returned.filter(row=>row.rows.some(value=>"record" in value)).length,0);
  await f.put(1,"late lower slot");await f.put(3,"new slot");f.returned.length=0;
  assert.deepEqual((await next.readKeys!(["work"])).get("work")!.map(row=>row.id),["result-0","result-1","result-2","result-3"]);
  assert.deepEqual(f.returned.flatMap(row=>row.rows.filter(value=>"record" in value).map(value=>Number(value.position))),[1,3]);
});

test("a deadline after a completed log page resumes without rereading its historical records",async()=>{
  const f=await fixture();for(let i=0;i<125;i++)await f.put(i,"saved");
  const sql=f.connection(),query=sql.query.bind(sql);
  sql.query=async(text,params)=>{const result=await query(text,params);if(text.includes("SELECT l.log_key"))f.fail();return result;};
  await assert.rejects(pgAppendOnlyRepository(sql,"worker_results").readKeys!(["work"]),/pass deadline/);
  f.resume();f.returned.length=0;
  assert.equal((await pgAppendOnlyRepository(f.connection(),"worker_results").readKeys!(["work"])).get("work")!.length,125);
  const transferred=f.returned.flatMap(row=>row.rows.filter(value=>"record" in value).map(value=>Number(value.position)));
  assert.equal(transferred.length,25);assert.equal(Math.min(...transferred),100);
});

test("confirmed snapshot writes supply later full and narrowed reads after a fresh database revision check",async()=>{
  const f=await fixture(),value={builtAt:"2026-10-25T21:00:00Z",groups:{held:"saved totals ".repeat(10000)},count:5};
  const repo=()=>pgAggregateRepository<typeof value>(f.connection(),"OwnerSnapshot","cp_owner_snapshots");
  const inserted=await repo().put("totals",value,value.builtAt);assert.equal(inserted.persisted.value.count,5);
  const updated=await repo().compareAndSet("totals",1,{...value,count:6},value.builtAt);
  f.returned.length=0;
  assert.deepEqual((await repo().mustRead("totals")).value,updated.value);
  assert.deepEqual((await repo().readNarrowed("totals",{builtAt:true,count:true}))!.value,{builtAt:value.builtAt,count:6});
  assert.ok(f.returned.every(row=>row.rows.every(value=>!("value" in value)||value.value===null)),"already-confirmed snapshot totals never transfer back from SQL");
  await db.query("UPDATE cp_owner_snapshots SET revision=3,value=jsonb_set(value,'{count}','7')WHERE id='totals'");
  assert.equal((await repo().mustRead("totals")).value.count,7,"an external writer still invalidates the retained totals");
});
