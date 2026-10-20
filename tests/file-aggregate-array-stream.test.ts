import assert from "node:assert/strict";
import test from "node:test";
import {mkdtemp,rm,readdir,appendFile}from"node:fs/promises";
import{tmpdir}from"node:os";import{join}from"node:path";
import{fileAggregateRepository,fileAppendOnlyRepository}from"../lib/control-plane/repository/file-store.ts";
import{aggregateArrayPage,replaceAggregateArrayItem}from"../lib/control-plane/repository/aggregate-array.ts";

test("file array pages and revision merges stream legacy country arrays, preserve unrelated fields, and enforce stale CAS",async t=>{
  const root=await mkdtemp(join(tmpdir(),"file-array-stream-"));t.after(()=>rm(root,{recursive:true,force:true}));
  const repo=fileAggregateRepository<Record<string,unknown>>(root,"doc","doc");
  const big="unrelated-country-evidence".repeat(4_000),at="2026-10-20T12:00:00Z";
  const items=Array.from({length:60},(_,i)=>({id:`case-${i}`,state:i%7===0?"AZ":"NJ",status:i%2?"OPEN":"DONE",at:String(i).padStart(3,"0"),nested:{quote:big,keep:i}}));
  let expected:Record<string,unknown>={items,unrelated:{big},standing:{works:true},updatedAt:at};await repo.put("legacy",expected,at);
  assert.deepEqual((await repo.readNarrowed("legacy",{standing:true}))?.value,{standing:{works:true}});
  assert.deepEqual((await repo.readManyNarrowed!(["missing","legacy"],{standing:true})).map(row=>row.value),[{standing:{works:true}}]);
  const query={limit:3,match:{path:["state"],value:"AZ"},projection:{id:true,nested:["keep"]}} as const;
  const first=await repo.readArrayPage!("legacy","items",query);
  assert.deepEqual({values:first?.values,next:first?.next},aggregateArrayPage(expected,"items",query));
  assert.ok(!JSON.stringify(first).includes("unrelated-country-evidence"));
  const second=await repo.readArrayPage!("legacy","items",{...query,after:first!.next!});assert.deepEqual(second?.values,aggregateArrayPage(expected,"items",{...query,after:first!.next!}).values);
  const merged=await repo.compareAndSetFields!("legacy",1,{standing:{works:"improved"}},at);assert.deepEqual(merged.value,{standing:{works:"improved"}});
  expected={...expected,standing:{works:"improved"}};assert.deepEqual((await repo.read("legacy"))?.value,expected);
  await assert.rejects(repo.compareAndSetFields!("legacy",1,{unrelated:null},at),/read revision 1/);
  const next={id:"case-7",state:"AZ",status:"DONE",at:"-01",nested:{keep:7}};
  const retention={limit:40,discardPath:["status"],discardValue:"DONE",oldestPath:["at"]};
  await repo.compareAndSetArrayItem!("legacy",2,"items",["id"],next.id,next,at,retention,{finite:"carried"});
  expected={...replaceAggregateArrayItem(expected,"items",["id"],next.id,next,at,retention),finite:"carried"};
  assert.deepEqual((await repo.read("legacy"))?.value,expected);
  await repo.compareAndSetArrayItem!("legacy",3,"items",["id"],"case-9",null,at);
  expected=replaceAggregateArrayItem(expected,"items",["id"],"case-9",null,at);
  assert.deepEqual((await repo.read("legacy"))?.value,expected);
});

test("a paged file history yields a valid row before a later corrupt line, and keeps the read failure visible",async t=>{
  const root=await mkdtemp(join(tmpdir(),"file-log-stream-"));t.after(()=>rm(root,{recursive:true,force:true}));
  const log=fileAppendOnlyRepository<{id:string}>(root,"history");
  await log.append("own-place","record-1",{id:"source-1"},"2026-10-20T12:00:00Z");
  const directory=join(root,"logs","history"),[file]=await readdir(directory);await appendFile(join(directory,file),"{broken JSON\n");
  const seen:string[]=[];
  await assert.rejects(log.readChangedSince(null,undefined,{page:rows=>{seen.push(...rows.map(row=>row.record.id));}}),/could not be read/);
  assert.deepEqual(seen,["source-1"],"the page callback runs while the source streams, before later history is parsed");
});

test("file projected aggregate reads retain scalar, array, null, and empty-projection semantics",async t=>{
  const root=await mkdtemp(join(tmpdir(),"file-value-projection-"));t.after(()=>rm(root,{recursive:true,force:true}));
  const repo=fileAggregateRepository<unknown>(root,"value","value"),at="2026-10-20T12:00:00Z";
  for(const[id,value]of Object.entries({scalar:"a source label",nil:null,array:[{state:"AZ"}]})){
    await repo.put(id,value,at);
    assert.deepEqual((await repo.readNarrowed(id,{state:true}))?.value,value);
    assert.deepEqual((await repo.readNarrowed(id,{}))?.value,{});
  }
});
