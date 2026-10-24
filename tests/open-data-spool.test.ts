import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { OpenDataSpool } from "../lib/sources/open-data/spool.ts";
import { normalizeEcho, normalizeSocrata } from "../lib/sources/open-data/normalize.ts";
import type { OpenDataCapture } from "../lib/sources/open-data/publication.ts";

const at="2026-10-23T09:06:56.174Z";
const native=JSON.parse(readFileSync(new URL("./fixtures/src-so/echo-program-identities.json",import.meta.url),"utf8"))[0];
const capture:OpenDataCapture={url:"https://echo.epa.gov/files/echodownloads/echo_exporter.zip",retrievedAt:at,rawHash:"a".repeat(64),sourceRows:[],archive:{sha256:"a".repeat(64),member:"ECHO_EXPORTER.csv",publishedAt:null}};
const fact=(id:number,state="CA")=>normalizeEcho({...native,REGISTRY_ID:String(id),FAC_NAME:`Facility ${id}\u2028source\u2029text`,FAC_STATE:state},at,null);

test("temporary spool preserves exact source rows and capture identity on repeatable ordered reads",async()=>{
  const spool=await OpenDataSpool.create(),california=fact(1),alaska=fact(2,"AK");
  try {
    await spool.append("zip:90001:state:CA",california,capture);
    await spool.append("cell:1:2:state:CA",california,capture);
    await spool.append("zip:99501:state:AK",alaska,{...capture,rawHash:"b".repeat(64)});
    const read=async()=>{const result=[];for await(const part of spool.partitions())result.push(part);return result;};
    const first=await read();assert.deepEqual(await read(),first);
    assert.deepEqual(first.map(part=>part.partition),["zip:99501:state:AK","cell:1:2:state:CA","zip:90001:state:CA"]);
    assert.deepEqual(first[1].rows,[california]);assert.deepEqual(first[2].rows,[california]);
    assert.deepEqual(first[1].captures,[{...capture,sourceRows:[california.sourceRow]}]);
    assert.equal(first[1].captures[0].sourceRows[0],first[1].rows[0].sourceRow);
    assert.ok(first[1].rows[0].title.includes("\u2028")&&first[1].rows[0].title.includes("\u2029"));
  } finally {await spool.dispose();}
});

test("consuming chunks retain every shared location row with independent capture excerpts",async()=>{
  const spool=await OpenDataSpool.create(),rows=Array.from({length:7},(_,i)=>fact(i+1));
  try {
    for(const row of rows){await spool.append("zip:90001:state:CA",row,capture);await spool.append("cell:1:2:state:CA",row,capture);}
    const observed=new Map<string,string[]>();
    for await(const part of spool.partitions({consume:true,maxRows:2,maxBytes:1024*1024})){
      assert.ok(part.rows.length<=2);assert.equal(part.state,"CA");
      assert.deepEqual(part.captures.flatMap(value=>value.sourceRows),part.rows.map(row=>row.sourceRow));
      const base=part.partition.replace(/:part:\d+$/,"");
      observed.set(base,[...observed.get(base)??[],...part.rows.map(row=>row.id)]);
      assert.deepEqual(part.rows,rows.filter(row=>part.rows.some(member=>row.id===member.id)));
    }
    assert.deepEqual([...observed.values()],[rows.map(row=>row.id),rows.map(row=>row.id)]);
    const remaining=[];for await(const part of spool.partitions())remaining.push(part);assert.deepEqual(remaining,[]);
    await assert.rejects(spool.append("zip:90001:state:CA",rows[0],capture),/already consuming/);
  } finally {await spool.dispose();}
});

test("duplicate native identities are refused across chunk boundaries and distinct source objects",async()=>{
  for(const sameObject of [true,false]){
    const spool=await OpenDataSpool.create(),first=fact(1);
    try {
      await spool.append("a-valid-first",fact(3),capture);
      await spool.append("zip:90001:state:CA",first,capture);
      await spool.append("zip:90001:state:CA",fact(2),capture);
      await spool.append("zip:90001:state:CA",sameObject?first:{...first,title:"Different source observation"},capture);
      let emitted=0;
      await assert.rejects(async()=>{for await(const part of spool.partitions({consume:true,maxRows:1})){void part;emitted++;}},/Repeated native source ID/);
      assert.equal(emitted,0,"a duplicate in a later location must be refused before any reader slice is emitted");
    } finally {await spool.dispose();}
  }
});

test("byte limits split work without discarding an indivisible source row",async()=>{
  const spool=await OpenDataSpool.create(),rows=[fact(1),fact(2)];
  try {
    for(const row of rows)await spool.append("unlocated:CA",row,capture);
    const parts=[];for await(const part of spool.partitions({consume:true,maxRows:1000,maxBytes:1}))parts.push(part);
    assert.deepEqual(parts.map(part=>part.partition),["unlocated:CA:part:0","unlocated:CA:part:1"]);
    assert.deepEqual(parts.flatMap(part=>part.rows),rows);
  } finally {await spool.dispose();}
});

test("schema changes preserve the real Socrata nested row and EPA rows on repeated reads",async()=>{
  const catalog=JSON.parse(readFileSync(new URL("./fixtures/src-so/socrata-texas-line-separator.json",import.meta.url),"utf8"));
  const dataset=normalizeSocrata(catalog.results[0],at),epa=fact(1),spool=await OpenDataSpool.create();
  try {
    await spool.append("a",epa,capture);await spool.append("b",dataset,capture);await spool.append("c",fact(2),capture);
    for(let pass=0;pass<2;pass++){
      const rows=[];for await(const part of spool.partitions())rows.push(...part.rows);
      assert.deepEqual(rows,[dataset,epa,fact(2)]);
    }
  } finally {await spool.dispose();}
});

test("full serialized bytes govern chunks and a drain spans SQLite read batches exactly",async()=>{
  const spool=await OpenDataSpool.create(),rows=Array.from({length:1005},(_,i)=>fact(i+1));
  const maxBytes=rows.slice(0,2).reduce((sum,row)=>sum+Buffer.byteLength(JSON.stringify(row)),0);
  try {
    for(const row of rows)await spool.append("unlocated:CA",row,capture);
    const ids=[];let chunks=0;
    for await(const part of spool.partitions({consume:true,maxRows:257,maxBytes})){
      chunks++;ids.push(...part.rows.map(row=>row.id));
      assert.ok(part.rows.length===1||part.rows.reduce((sum,row)=>sum+Buffer.byteLength(JSON.stringify(row)),0)<=maxBytes);
    }
    assert.ok(chunks>500);assert.deepEqual(ids,rows.map(row=>row.id));
  } finally {await spool.dispose();}
});
