import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp,rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { memoryAggregateRepository,memoryAppendOnlyRepository } from "../lib/control-plane/repository/memory.ts";
import { fileAggregateRepository,fileAppendOnlyRepository } from "../lib/control-plane/repository/file-store.ts";
import { AGGREGATE_LIST_READ_PAGE,APPEND_ONLY_LOG_READ_PAGE,pgAggregateRepository,pgAppendOnlyRepository } from "../lib/control-plane/repository/pg-store.ts";

test("payload time selection preserves a backfilled record independently of both repository clocks",async()=>{
  const directory=await mkdtemp(join(tmpdir(),"rh01-payload-time-"));
  try{
    for(const repo of [memoryAppendOnlyRepository<{recordedAt:string;body:string}>("time"),fileAppendOnlyRepository<{recordedAt:string;body:string}>(directory,"time")]){
      await repo.append("own","old-value-new-append",{recordedAt:"2026-10-01T00:00:00Z",body:"old"},"2026-10-20T12:00:00Z");
      await repo.append("own","new-value-old-append",{recordedAt:"2026-10-20T12:00:00Z",body:"backfilled"},"2026-10-01T00:00:00Z");
      const page=await repo.readChangedSince(null,undefined,{recordTimeAtOrAfter:{path:["recordedAt"],at:"2026-10-19T06:00:00Z"},projection:{body:true}});
      assert.deepEqual(page.records.map(row=>({id:row.recordId,record:row.record})),[{id:"new-value-old-append",record:{body:"backfilled"}}]);
    }
  }finally{await rm(directory,{recursive:true,force:true});}
});

test("selected log pages preserve exact append coordinates while excluding unrelated payloads",async()=>{
  const directory=await mkdtemp(join(tmpdir(),"rh01-scoped-log-"));
  try{
    for(const repo of [memoryAppendOnlyRepository<{n:number;body:string}>("scoped"),fileAppendOnlyRepository<{n:number;body:string}>(directory,"scoped")]){
      const now="2026-10-20T12:00:00Z";
      await repo.append("unrelated","different-id",{n:-1,body:"unrelated country payload"},now);
      await repo.append("selected","arbitrary-first-append-id",{n:1,body:"first"},now);
      await repo.append("selected","arbitrary-second-append-id",{n:2,body:"second"},now);
      const pages:unknown[]=[];
      const result=await repo.readChangedSince(null,[["selected",0]],{keys:["selected"],projection:{n:true},page:rows=>{pages.push(...rows);}});
      assert.deepEqual(result.records,[]);assert.ok(result.through);
      assert.equal(pages.length,1);
      const row=pages[0] as {key:string;recordId:string;position:number;record:unknown;changedAt:string;stampedAt:string};
      assert.deepEqual({key:row.key,recordId:row.recordId,position:row.position,record:row.record},
        {key:"selected",recordId:"arbitrary-second-append-id",position:1,record:{n:2}});
      assert.ok(row.changedAt);assert.equal(Date.parse(row.stampedAt),Date.parse(now));
      assert.deepEqual((await repo.readChangedSince(null,undefined,{keys:[]})).records,[]);
    }
  }finally{await rm(directory,{recursive:true,force:true});}
});

test("Postgres filters selected partitions before transfer and keeps every page's original coordinates",async()=>{
  let reads=0;
  const sql={async query(statement:string,params:readonly unknown[]=[]){
    if(statement==="SELECT now() AS read_at")return [{read_at:"2026-10-20T12:00:00Z"}];
    assert.match(statement,/WHERE log_key = ANY\(\$1::text\[\]\)/);
    assert.match(statement,new RegExp(`LIMIT ${APPEND_ONLY_LOG_READ_PAGE}`));
    assert.deepEqual(params[0],["selected"]);
    const after=params.length===1?-1:Number(params[2]);
    reads++;
    return Array.from({length:APPEND_ONLY_LOG_READ_PAGE+1},(_,position)=>position).filter(position=>position>after).slice(0,APPEND_ONLY_LOG_READ_PAGE)
      .map(position=>({log_key:"selected",record_id:`actual-append-${position}`,position,record:{n:position},changed_at:"2026-10-20T11:00:00Z",recorded_at:"2026-10-20T10:00:00Z"}));
  }};
  const seen:number[]=[];
  const result=await pgAppendOnlyRepository<{n:number}>(sql,"worker_results").readChangedSince(null,undefined,{keys:["selected"],page:rows=>{
    for(const row of rows){assert.equal(row.recordId,`actual-append-${row.position}`);assert.equal(row.key,"selected");seen.push(row.record.n);}
  }});
  assert.deepEqual(result.records,[]);assert.equal(reads,2);assert.equal(seen.length,APPEND_ONLY_LOG_READ_PAGE+1);
  assert.equal(result.through,"2026-10-20T12:00:00.000Z");
});

test("literal prefix selection preserves body boundaries, wildcards and projection in every store",async()=>{
  const directory=await mkdtemp(join(tmpdir(),"rh01-scoped-prefix-"));
  try{
    for(const repo of [memoryAggregateRepository<{bodyId:string;large:string}>("prefix"),fileAggregateRepository<{bodyId:string;large:string}>(directory,"prefix","prefix")]){
      for(const [id,bodyId]of [["a","government_%!#board"],["b","government_X!#board"],["c","government_%!neighbor#board"]]as const)await repo.put(id,{bodyId,large:"not needed"},"2026-10-20T12:00:00Z");
      const read=await repo.listWherePrefix(["bodyId"],"government_%!#",{bodyId:true});
      assert.deepEqual(read.map(row=>({id:row.id,value:row.value})),[{id:"a",value:{bodyId:"government_%!#board"}}]);
    }
  }finally{await rm(directory,{recursive:true,force:true});}
  let pages=0;
  const sql={async query(statement:string,params:readonly unknown[]=[]){
    assert.match(statement,/WHERE value #>> '\{bodyId\}' LIKE \$1 ESCAPE '!'/);
    assert.match(statement,new RegExp(`LIMIT ${AGGREGATE_LIST_READ_PAGE}`));
    assert.equal(params[0],"government!_!%!!#%");pages++;
    const after=params.length===1?-1:Number(String(params[1]).slice(1));
    return Array.from({length:AGGREGATE_LIST_READ_PAGE+1},(_,n)=>n).filter(n=>n>after).slice(0,AGGREGATE_LIST_READ_PAGE).map(n=>
      ({id:`r${String(n).padStart(5,"0")}`,revision:1,updated_at:"2026-10-20T12:00:00Z",value:{bodyId:`government_%!#board${n}`}}));
  }};
  const read=await pgAggregateRepository(sql,"prefix","prefix").listWherePrefix(["bodyId"],"government_%!#",{bodyId:true});
  assert.equal(read.length,AGGREGATE_LIST_READ_PAGE+1);assert.equal(pages,2);
});

test("memory and streamed file projections select nested identity without the enclosing task narrative",async()=>{
  const directory=await mkdtemp(join(tmpdir(),"rh01-deep-projection-"));
  const value={completion:{completedTask:{workerTask:{contract:{schemaVersion:2,sourceScope:{publisher:"one.gov",canonicalUrls:["https://one.gov/"],unused:"not transferred"},unused:"not transferred"}},disposition:{note:"not transferred"}}},unused:"not transferred"};
  const projection={completion:{completedTask:{workerTask:{contract:{schemaVersion:true,sourceScope:["publisher","canonicalUrls"]}}}}}as const;
  try{
    for(const repo of [memoryAggregateRepository<typeof value>("deep"),fileAggregateRepository<typeof value>(directory,"deep","deep")]){
      await repo.put("one",value,"2026-10-20T12:00:00Z");
      assert.deepEqual((await repo.readNarrowed("one",projection))?.value,{completion:{completedTask:{workerTask:{contract:{schemaVersion:2,sourceScope:{publisher:"one.gov",canonicalUrls:["https://one.gov/"]}}}}}});
    }
  }finally{await rm(directory,{recursive:true,force:true});}
});
