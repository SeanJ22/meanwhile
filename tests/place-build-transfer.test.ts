import assert from "node:assert/strict";
import test from "node:test";
import {randomUUID} from "node:crypto";
import {migratedReaderDb} from "./helpers/migrated-reader-db.ts";
import {sharedPlaceBuildRead} from "../lib/reader/place-build-transfer.ts";
import type {Query} from "../lib/facts/publish.ts";

test("different ZIPs share unchanged input chunks after checking fingerprints, retaining exact order, fields and source text",async()=>{
  const {pg}=await migratedReaderDb();
  const retention={rows:new Map<string,string>(),bytes:0};
  const read=sharedPlaceBuildRead(randomUUID(),retention);
  const statement="SELECT $2::text AS fingerprint,NULL::text AS reused_page_id,$1::jsonb AS row";
  const first={rosters:Array.from({length:96},(_,id)=>({id,body_id:`body:${id%6}`,quote:`${id%6}: é 予算 `+"Source text. ".repeat(1000)})),entities:[{id:"body:0",division:"first ZIP"}],parts:{a:{text:"saved A"},b:{text:"saved B"}},empty:[],registry:null,count:0,reserved:{"$placeBuildText":"original"},nested:{"$placeBuildText":[{"$placeBuildText":"nested"}], ["long key ".repeat(64)]:[null,true,false,-1,3.5,{},[]]},sharedText:["Same text. ".repeat(1000),"Same text. ".repeat(1000)]};
  const bytes:number[]=[];let oldCalls=0,newCalls=0;
  const query=(called:()=>void):Query=>async(t,p=[])=>{called();const rows=(await pg.query<Record<string,unknown>>(t,[...p])).rows;bytes.push(Buffer.byteLength(JSON.stringify(rows)));return rows;};
  try{
    assert.deepEqual((await read(query(()=>oldCalls++),statement,[JSON.stringify(first),"one"]))[0]?.row,first);
    const second={...first,entities:[{id:"body:0",division:"second ZIP"}],rosters:first.rosters.map((r,i)=>i===95?{...r,quote:"changed"}:r),parts:{a:first.parts.a,b:{text:"changed B"}}};
    assert.deepEqual((await read(query(()=>newCalls++),statement,[JSON.stringify(second),"two"]))[0]?.row,second);
    assert.ok(bytes[0]!<Buffer.byteLength(JSON.stringify(first))*.7,"identical long text transfers once without dropping source text");
    assert.equal(oldCalls,1,"the next build uses its own transaction's query");assert.equal(newCalls,1);
    assert.ok(bytes[1]!<bytes[0]!*.4,`only the changed last chunk and part transfer: ${bytes}`);
    const third={rosters:second.rosters.slice(2).reverse(),parts:{},empty:[],unicode:"résumé",prefixes:["same prefix 😀 with another","same prefix 😀 with é and 予算"]};
    assert.deepEqual((await read(query(()=>newCalls++),statement,[JSON.stringify(third),"three"]))[0]?.row,third,"deletions and reorderings remain exact");
    assert.ok(bytes[2]!<bytes[0]!*.25,`reordering does not resend unchanged bodies: ${bytes}`);
    const held="SELECT $2::text AS fingerprint,'zip:11111'::text AS reused_page_id,NULL::jsonb AS row WHERE $1::jsonb IS NOT NULL";
    assert.deepEqual(await read(query(()=>newCalls++),held,["{}","three"]),[{fingerprint:"three",reused_page_id:"zip:11111"}]);
    await assert.rejects(read(async()=>{throw Error("read failed");},statement,[JSON.stringify(first),"one"]),/read failed/);
    retention.rows.clear();retention.bytes=0;
    assert.deepEqual((await read(query(()=>newCalls++),statement,[JSON.stringify(first),"one"]))[0]?.row,first,"evicted input copies are freshly read by fingerprint");
  }finally{await pg.close();}
});
