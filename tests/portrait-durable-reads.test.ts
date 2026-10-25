import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { neonConfig } from "../lib/db/client.ts";
import { PostgresRoutineDataStore } from "../lib/civic-data/store.ts";
import { derivedReadModelHash } from "../lib/civic-data/derived-door.ts";
import { partitionCivicPayload } from "../lib/civic-data/payload-codec.ts";

test("source hash checks and captures reuse unchanged durable versions across fresh jobs and invalidate on a real change",async t=>{
  const pg=new PGlite(),beforeFetch=neonConfig.fetchFunction;
  const envKeys=["DATABASE_URL","WTP_VITAL_SIGNS_REPORT","WTP_CIVIC_READ_CACHE_URL","WTP_PORTRAIT_READ_CACHE_DIR"] as const;
  const before=Object.fromEntries(envKeys.map(key=>[key,process.env[key]]));
  process.env.DATABASE_URL="postgres://readonly:fixture@ep-portrait-durable.invalid/neondb";
  process.env.WTP_VITAL_SIGNS_REPORT="1";delete process.env.WTP_CIVIC_READ_CACHE_URL;
  process.env.WTP_PORTRAIT_READ_CACHE_DIR=await mkdtemp(join(tmpdir(),"db03-portrait-cache-test-"));
  t.after(async()=>{neonConfig.fetchFunction=beforeFetch;for(const key of envKeys){if(before[key]===undefined)delete process.env[key];else process.env[key]=before[key];}await pg.close();});
  await pg.exec("CREATE TABLE civic_data_candidates(id text PRIMARY KEY,state text,candidate jsonb); CREATE TABLE civic_data_payload_parts(hash text PRIMARY KEY,payload jsonb)");
  const model={roster:{officeholders:[{id:"one",name:"One",photo:null}]}},capture={finalUrl:"https://source.example.gov/one",capture:{rawHash:"a".repeat(64)}};
  const envelope={recordClass:"STATE_LEGISLATOR",scope:"US-AZ:openstates-people:v1",readModel:model,
    normalizedPayload:{captures:[capture],unused:"unrelated-capture-body".repeat(20000)}};
  const encoded=partitionCivicPayload(envelope);
  await pg.query("INSERT INTO civic_data_candidates VALUES('version','PROMOTED',$1)",[encoded.value]);
  for(const part of encoded.parts)await pg.query("INSERT INTO civic_data_payload_parts VALUES($1,$2)",[part.hash,JSON.stringify(part.payload)]);
  const queries:string[]=[],bodies:string[]=[];
  neonConfig.fetchFunction=async(_input:Parameters<typeof fetch>[0],init?:Parameters<typeof fetch>[1])=>{
    const request=JSON.parse(String(init?.body));assert.ok(!request.queries);
    assert.match(request.query,/^\s*(SELECT|WITH)\b/i);queries.push(request.query);
    const result=await pg.query<Record<string,unknown>>(request.query,request.params.map((value:unknown)=>value==="t"||value==="true"?true:value==="f"||value==="false"?false:value));
    const body=JSON.stringify({command:"SELECT",rowCount:result.rows.length,rowAsArray:true,fields:result.fields,
      rows:result.rows.map(row=>result.fields.map(field=>row[field.name]===null?null:typeof row[field.name]==="object"?JSON.stringify(row[field.name]):String(row[field.name])))});
    bodies.push(body);return new Response(body);
  };
  const first=new PostgresRoutineDataStore();
  const identity=await first.readDerivedInputIdentity("version");
  assert.equal(identity?.readModelSha256,derivedReadModelHash(model));assert.equal(identity?.scope,envelope.scope);assert.equal(identity?.recordClass,envelope.recordClass);
  const afterCold=queries.length;
  assert.equal((await new PostgresRoutineDataStore().readDerivedInputIdentity("version"))?.readModelSha256,derivedReadModelHash(model));
  assert.equal(queries.length-afterCold,1,"the next job asks only for the source row version");
  assert.deepEqual(await first.readPortraitCaptures(["version"],[capture.finalUrl]),[capture]);
  const beforeWarm=queries.length;
  assert.deepEqual(await new PostgresRoutineDataStore().readPortraitCaptures(["version"],[capture.finalUrl]),[capture]);
  assert.equal(queries.length-beforeWarm,1,"unchanged capture data stays in the existing read cache");
  assert.ok(bodies.every(body=>!body.includes("unrelated-capture-body")),"neither a source check nor a capture read fetches an unrelated candidate body");
  const changed={roster:{officeholders:[{id:"one",name:"Changed",photo:null}]}};
  const next=partitionCivicPayload({...envelope,readModel:changed});
  for(const part of next.parts)await pg.query("INSERT INTO civic_data_payload_parts VALUES($1,$2) ON CONFLICT DO NOTHING",[part.hash,JSON.stringify(part.payload)]);
  await pg.query("UPDATE civic_data_candidates SET candidate=$1 WHERE id='version'",[next.value]);
  assert.equal((await first.readDerivedInputIdentity("version"))?.readModelSha256,derivedReadModelHash(changed),"a source row change invalidates both instance and shared cached checks");
  const moved=partitionCivicPayload({...envelope,readModel:changed,scope:"US-WY:openstates-people:v1"});
  for(const part of moved.parts)await pg.query("INSERT INTO civic_data_payload_parts VALUES($1,$2) ON CONFLICT DO NOTHING",[part.hash,JSON.stringify(part.payload)]);
  await pg.query("UPDATE civic_data_candidates SET candidate=$1 WHERE id='version'",[moved.value]);
  assert.equal((await first.readDerivedInputIdentity("version"))?.scope,"US-WY:openstates-people:v1","identity is taken from the stored envelope rather than assumed from a previous read");
});
