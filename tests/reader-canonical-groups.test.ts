import assert from "node:assert/strict";
import test from "node:test";
import {readCanonicalPackages} from "../lib/reader/canonical.ts";
import {migratedReaderDb} from "./helpers/migrated-reader-db.ts";
import {installReaderDatabaseQuery} from "../lib/reader/database.ts";
import {readStatePackage} from "../lib/reader/state.ts";
import {nationalPresidentPointers} from "../lib/reader/national.ts";
import {withReaderSelection} from "../lib/db/reader-route.ts";

test("one migrated canonical batch preserves state geography and extra pointers when another group's proof fails",async()=>{
  const {pg,publish}=await migratedReaderDb();
  const state={recordClass:"CURATED_READER_RECORD"as const,scope:"US:rs03-group-state"};
  const country={recordClass:"CURATED_READER_RECORD"as const,scope:"US:rs03-group-country"};
  const extra={recordClass:"CURATED_READER_RECORD"as const,scope:"US:rs03-group-geography"};
  const payload={name:"Held state",fullFacts:{contact:"Complete contact",source:"https://example.gov/source"}};
  const at="2026-10-21T00:00:00.000Z";
  let reads=0;
  try{
    await publish({...state,id:"rs03-group-state",value:payload,at,sourceId:"rs03-state-source"});
    await publish({...extra,id:"rs03-group-geography",value:{districts:["held-district"]},at,sourceId:"rs03-geography-source"});
    await publish({...country,id:"rs03-group-country",value:{official:"Unverified country data"},payloadHash:"0".repeat(64),at,sourceId:"rs03-country-source"});
    const groups=readCanonicalPackages([[state],[country]],async statements=>{
      reads++;assert.equal(statements.length,1);
      const statement=statements[0];return[(await pg.query<Record<string,unknown>>(statement.text,[...statement.params])).rows];
    },{text:"SELECT $1::text[] AS canonical_keys,$2::text AS version_id",params:[[
      `${extra.recordClass}:${extra.scope}`],"held-geography-version"],canonicalKeys:true});
    const held=await groups.readGroup(0);
    assert.equal(held.additionalRows[0].version_id,"held-geography-version");
    assert.deepEqual(held.additionalEntries,[extra]);
    const record=await held.readPromotedEntry!(state.recordClass,state.scope);
    assert.equal(record.kind,"PROMOTED");if(record.kind==="PROMOTED")assert.deepEqual(record.projection.payload,payload);
    assert.equal((await held.readPromotedEntry!(extra.recordClass,extra.scope)).kind,"PROMOTED");
    await assert.rejects(groups.readGroup(1),/READER_PUBLISHED_PAYLOAD_HASH_MISMATCH/);
    assert.equal((await groups.readPromotedEntry!(state.recordClass,state.scope)).kind,"PROMOTED");
    assert.equal(reads,1,"decoding failure cannot trigger another query or hide the independent state's answer");
  }finally{await pg.close();}
});

test("a cold state schedules its President pointers in the same query and keeps a transport failure failed",async()=>{
  let reads=0;
  const failure=new Error("The first combined read failed");
  installReaderDatabaseQuery(async statements=>{
    reads++;assert.equal(statements.length,1);
    const keys=statements[0].params[0]as string[];
    assert.ok(keys.some(key=>key.startsWith("REGISTRY_RUNTIME_BINDING:US-AZ:")));
    for(const pointer of nationalPresidentPointers())assert.ok(keys.includes(`${pointer.recordClass}:${pointer.scope}`),"the President must not open another initial connection");
    throw failure;
  });
  try{
    await withReaderSelection({states:["AZ"],keys:new Set(["state:AZ"])},async()=>{
      const first=readStatePackage("AZ");
      await assert.rejects(first,error=>error===failure);
      assert.equal(readStatePackage("AZ"),first);
      await assert.rejects(first,error=>error===failure);
      assert.equal(reads,1);
    });
  }finally{installReaderDatabaseQuery(undefined);}
});
