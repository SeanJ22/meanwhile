import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { canonicalCivicDataHash } from "../lib/civic-data/canonical-hash.ts";
import { civicVersionRef, civicVersionVault, holdCivicVersion, readCivicVersionPath, readCivicVersionRows, readCivicVersionText } from "../lib/civic-data/version-vault.ts";
import { MemoryEvidenceStore } from "../lib/control-plane/evidence/store.ts";
import type { Query } from "../lib/facts/publish.ts";
import { partitionCivicPayload } from "../lib/civic-data/payload-codec.ts";

const fingerprint = (value:unknown) => canonicalCivicDataHash(value,{durable:true});
const model = () => ({
  kind:"open-data", meetings:[{id:"sitting/first",location:{name:"Old Hall",address:"1 Civic Plaza"}},
    {id:"sitting/second",location:{name:"Prior Hall",address:"2 Civic Plaza"}}],
  agendaDocuments:[{id:"agenda/first",text:"First agenda. ".repeat(5000)},
    {id:"agenda/second",text:"Archived agenda. ".repeat(6000)}],
  records:[{id:"wiring/first",status:"VERIFIED",row:{bodyId:"body/one",route:"prior-route"},bodyIds:["body/one"],divisionIds:["division/one"]},
    {id:"wiring/second",status:"VERIFIED",row:{bodyId:"body/two",route:"other-route"},bodyIds:["body/two"],divisionIds:["division/two"]}],
});

test("literal source kind/value fields are facts rather than storage wrappers",async()=>{
  const vault=new MemoryEvidenceStore(),value={metadata:{kind:"object",value:{name:"Native fact"}},
    records:[{id:"native",kind:"object",value:{answer:42}}]};
  const ref=await holdCivicVersion(vault,value,fingerprint(value)),reader=civicVersionVault(vault);
  assert.equal(await reader.path(ref,["metadata","kind"]),"object");
  assert.deepEqual(await reader.rows(ref,["records"]),[{ordinal:1,value:value.records[0]}]);
  assert.deepEqual(await reader.read(ref),value);
});

test("lazy agenda text opens only its window and preserves Unicode across chunk boundaries",async()=>{
  const vault=new MemoryEvidenceStore(),body="a".repeat(8191)+"😀"+"b".repeat(8190)+
    Array.from({length:40},(_,index)=>String(index).padStart(3,"0")+"document ".repeat(910)).join("");
  const model={body,other:"UNRELATED_AGENDA_TEXT ".repeat(10000)},ref=await holdCivicVersion(vault,model,fingerprint(model));
  const get=vault.get.bind(vault),received:string[]=[];
  vault.get=async key=>{const value=await get(key);if(value)received.push(new TextDecoder().decode(value.bytes));return value;};
  const reader=civicVersionVault(vault),window=await reader.text(ref,["body"],{offset:8188,count:4});
  assert.deepEqual(window,{text:"aaa😀",offset:8188,nextOffset:8193,totalLength:body.length,offsetUnit:"UTF16_CODE_UNITS"});
  assert.ok(received.length<8,"a window does not load every string part");
  assert.ok(received.every(text=>!text.includes("UNRELATED_AGENDA_TEXT")));
  assert.equal((await reader.text(ref,["body"],{count:0}))?.totalLength,body.length);
  assert.equal((await reader.text({...ref,stringChunkUnits:undefined},["body"],{count:0}))?.totalLength,body.length,"original version-1 refs remain readable");
  let offset=0,result="";
  while(offset<body.length){const next=await reader.text(ref,["body"],{offset,count:8192});assert.ok(next);result+=next.text;offset=next.nextOffset;}
  assert.equal(result,body,"all windows reconstruct the original words and Unicode exactly");
});

test("historical venue, agenda, wiring and funding selections use shared vault parts",async()=>{
  const vault=new MemoryEvidenceStore(),before=model(),hash=fingerprint(before);
  const put=vault.put.bind(vault),putCalls:{key:string;bytes:Uint8Array}[]=[];
  vault.put=async(key,bytes,meta)=>{putCalls.push({key,bytes});await put(key,bytes,meta);};
  const ref=await holdCivicVersion(vault,before,hash);
  assert.deepEqual(await civicVersionRef(vault,hash),ref);
  const puts=putCalls.length;
  const reordered=Object.fromEntries(Object.entries(before).reverse());
  assert.deepEqual(await holdCivicVersion(vault,reordered,hash),ref);
  assert.equal(putCalls.length,puts,"the same facts have one immutable version even if key order changes");
  const get=vault.get.bind(vault),readKeys:string[]=[];
  vault.get=async key=>{readKeys.push(key);return get(key);};
  const reader=civicVersionVault(vault);
  assert.deepEqual(await reader.rows(ref,["meetings"],{match:{path:["id"],values:["sitting/second"]},fields:["id","location"]}),
    [{ordinal:2,value:before.meetings[1]}]);
  assert.deepEqual(await reader.rows(ref,["records"],{match:{path:["id"],values:["wiring/first"]},fields:["id","status","row"]}),
    [{ordinal:1,value:{id:"wiring/first",status:"VERIFIED",row:before.records[0].row}}]);
  assert.deepEqual(await reader.rows(ref,["records"],{fields:["bodyIds","divisionIds"]}),before.records.map((row,index)=>({ordinal:index+1,value:{bodyIds:row.bodyIds,divisionIds:row.divisionIds}})));
  const textKey=putCalls.find(call=>new TextDecoder().decode(call.bytes).startsWith('"Archived agenda.'))?.key;
  assert.ok(textKey,"large text is partitioned separately");
  assert.ok(!readKeys.includes(textKey),"venue and wiring readers do not load agenda text");
  assert.equal(await reader.path(ref,["agendaDocuments","1","text"]),before.agendaDocuments[1].text);
  assert.ok(readKeys.includes(textKey));
  assert.deepEqual(await reader.read(ref),before);
  assert.equal(await reader.path(ref,["agendaDocuments","9","text"]),null);
  await assert.rejects(holdCivicVersion(vault,before,"a".repeat(64)),/FINGERPRINT_MISMATCH/);
  const after={...before,meetings:before.meetings.map((row,index)=>index?{...row,location:{...row.location,name:"New Hall"}}:row)};
  await holdCivicVersion(vault,after,fingerprint(after));
  assert.equal(putCalls.filter(call=>call.key===textKey).length,1,"unchanged agenda parts are shared across versions");
  vault.get=async key=>key===textKey?{...(await get(key))!,bytes:new TextEncoder().encode('"corrupt"')}:get(key);
  await assert.rejects(civicVersionVault(vault).path(ref,["agendaDocuments","1","text"]),/MISSING_OR_CORRUPT/);
});

test("version accessor reads new history from the vault and selects legacy/current fields in SQL",async()=>{
  const pg=new PGlite(),vault=new MemoryEvidenceStore(),before=model(),hash=fingerprint(before);
  try{
    await pg.exec(`CREATE TABLE civic_data_payload_parts(hash text primary key,payload jsonb);
      CREATE TABLE civic_data_candidates(id text primary key,normalized_hash text,read_model_fingerprint text,candidate jsonb);
      CREATE TABLE civic_data_promotions(current_version_id text,payload jsonb);`);
    for(const sql of readFileSync(new URL("../lib/db/migrations/0036_ne01.sql",import.meta.url),"utf8")
      .split("--> statement-breakpoint").filter(sql=>/^\s*CREATE FUNCTION reader_payload_(?:value|node|members)\(/.test(sql)))await pg.exec(sql);
    await pg.query("INSERT INTO civic_data_candidates VALUES ('legacy',$1,null,$2),('current',$1,$1,'{}'),('vault',$1,$1,'{}'),('missing',$3,$3,'{}')",
      [hash,{readModel:before},"c".repeat(64)]);
    await pg.query("INSERT INTO civic_data_promotions VALUES ('current',$1)",[before]);
    const encoded=partitionCivicPayload(before);
    for(const part of encoded.parts)await pg.query("INSERT INTO civic_data_payload_parts VALUES ($1,$2)",[part.hash,JSON.stringify(part.payload)]);
    await pg.query("INSERT INTO civic_data_candidates VALUES ('encoded',$1,null,$2)",[hash,{readModel:encoded.value}]);
    const seen:string[]=[];
    const query:Query=async(text,params=[])=>{seen.push(text);return(await pg.query<Record<string,unknown>>(text,[...params])).rows;};
    assert.equal(await readCivicVersionPath(query,()=>{throw new Error("legacy does not need a vault credential");},"legacy",["kind"]),"open-data");
    for(const id of ["legacy","current","encoded"]){
      assert.equal(await readCivicVersionPath(query,vault,id,["agendaDocuments","1","text"]),before.agendaDocuments[1].text);
      assert.deepEqual(await readCivicVersionRows(query,vault,id,["meetings"],{match:{path:["id"],values:["sitting/second"]},fields:["id","location"]}),
        [{ordinal:2,value:before.meetings[1]}]);
      assert.deepEqual(await readCivicVersionRows(query,vault,id,["records"],{fields:["bodyIds","divisionIds"]}),before.records.map((row,index)=>({ordinal:index+1,value:{bodyIds:row.bodyIds,divisionIds:row.divisionIds}})));
    }
    let received=0;
    const bounded:Query=async(text,params)=>{const rows=await query(text,params);received+=Buffer.byteLength(JSON.stringify(rows));return rows;};
    const window=await readCivicVersionText(bounded,()=>{throw new Error("legacy does not need the vault");},"legacy",["agendaDocuments","1","text"],{offset:3,count:9});
    assert.deepEqual(window,{text:before.agendaDocuments[1].text.slice(3,12),offset:3,nextOffset:12,totalLength:before.agendaDocuments[1].text.length,offsetUnit:"UNICODE_CODE_POINTS"});
    assert.ok(received<2048,"an old text window does not download its complete document");
    await assert.rejects(readCivicVersionRows(query,vault,"missing",["records"]),/CIVIC_VERSION_VAULT_MISSING/);
    await holdCivicVersion(vault,before,hash);seen.length=0;
    assert.equal(await readCivicVersionPath(query,vault,"vault",["agendaDocuments","1","text"]),before.agendaDocuments[1].text);
    assert.deepEqual(await readCivicVersionRows(query,vault,"vault",["records"],{fields:["bodyIds","divisionIds"]}),before.records.map((row,index)=>({ordinal:index+1,value:{bodyIds:row.bodyIds,divisionIds:row.divisionIds}})));
    assert.equal(seen.length,2,"each access asks SQL for a small version header only");
    assert.ok(seen.every(sql=>!sql.includes("candidate->")&&!sql.includes("SELECT payload")));
    const ref=await civicVersionRef(vault,hash);assert.ok(ref);
    await pg.query("INSERT INTO civic_data_candidates VALUES ('root',$1,$1,$2)",[hash,{vault:{readModel:ref}}]);
    assert.equal(await readCivicVersionPath(query,()=>vault,"root",["kind"]),"open-data");
    assert.deepEqual((await pg.query("SELECT read_model_fingerprint,candidate FROM civic_data_candidates WHERE id='legacy'")).rows,
      [{read_model_fingerprint:null,candidate:{readModel:before}}],"legacy versions are unchanged");
  }finally{await pg.close();}
});
