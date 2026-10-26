import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { canonicalCivicDataHash } from "../lib/civic-data/canonical-hash.ts";
import { readDerivedInputHeads, readDerivedWiringRows } from "../lib/civic-data/derived-input-rows.ts";
import { derivedInputAuthorityIssue, DERIVED_WIRING_SCOPE } from "../lib/civic-data/derived-door.ts";
import type { DerivedInputRef } from "../lib/civic-data/derived-authority.ts";
import type { RoutineCandidate } from "../lib/civic-data/types.ts";
import { installKeyedRows } from "./helpers/keyed-rows.ts";

test("derived input validation reads immutable hashes and only named wiring members",async t=>{
  const pg=new PGlite();t.after(()=>pg.close());
  await pg.exec(`CREATE TABLE civic_data_candidates(id text PRIMARY KEY,record_class text,scope text,state text,acquisition_succeeded boolean,promoted_version_id text,last_known_good_version_id text,normalized_hash text,candidate jsonb,validation_receipt jsonb);
    CREATE TABLE civic_data_promotions(key text PRIMARY KEY,record_class text,scope text,current_version_id text,last_known_good_version_id text,source_id text,promoted_at timestamptz,payload jsonb,validation_receipt jsonb);`);
  await installKeyedRows(pg);
  const inputs:DerivedInputRef[]=[];
  const add=async(id:string,recordClass:string,scope:string,readModel:unknown)=>{
    const hash=canonicalCivicDataHash(readModel),receipt={candidateId:id,recordClass,scope,decision:"GOOD"};
    await pg.query("INSERT INTO civic_data_candidates VALUES($1,$2,$3,'PROMOTED',true,$1,$1,$4,$5::jsonb,$6::jsonb)",[id,recordClass,scope,hash,JSON.stringify({readModel,normalization:{normalizedHash:hash}}),JSON.stringify(receipt)]);
    inputs.push({kind:"PROMOTED_VERSION",recordClass,scope,versionId:id,readModelSha256:hash,promotedAt:"2026-10-01T00:00:00Z"});
  };
  await add("registration","REGISTRATION","US-AZ:registration:v1",{governments:[{unrelated:"full inventory evidence ".repeat(20_000)}]});
  await add("wiring","CURATED_READER_RECORD",DERIVED_WIRING_SCOPE,{kind:"meeting-source-wiring",records:[
    {id:"one",status:"ACTIVE",row:{officialHost:"example.gov",route:"https://example.gov/calendar",sourceFields:{complete:true}}},
    {id:"other",status:"ACTIVE",row:{officialHost:"unrelated.gov",route:"https://unrelated.gov",heldEvidence:"unrelated wiring ".repeat(20_000)}}]});
  inputs.push({kind:"MEMBER_ACQUISITION",memberKey:"one",requestedUrl:"https://example.gov/calendar",finalUrl:"https://example.gov/calendar",httpStatus:200,rawHash:"a".repeat(64),retrievedAt:"2026-10-01T00:00:00Z"});
  let bytes=0;
  const query=async(text:string,params:readonly unknown[]=[])=>{const rows=(await pg.query<Record<string,unknown>>(text,[...params])).rows;bytes+=JSON.stringify(rows).length;return rows;};
  const store={readDerivedInputHeads:(ids:readonly string[])=>readDerivedInputHeads(query,ids),readDerivedWiringRows:(id:string,keys:readonly string[])=>readDerivedWiringRows(query,id,keys),
    readCandidate:async()=>{throw new Error("whole promoted input read");}};
  const candidate={retrieval:{derived:{inputs}}} as RoutineCandidate;
  assert.equal(await derivedInputAuthorityIssue(store,candidate),null);
  assert.ok(bytes<1_500,`${bytes} bytes includes no unrelated inventory or wiring`);
  const member=inputs.at(-1)! as Extract<DerivedInputRef,{kind:"MEMBER_ACQUISITION"}>;
  const foreign={retrieval:{derived:{inputs:[...inputs.slice(0,-1),{...member,finalUrl:"https://unrelated.gov/calendar"}]}}} as RoutineCandidate;
  assert.match((await derivedInputAuthorityIssue(store,foreign))!,/DERIVED_MEMBER_HOST_NOT_ATTESTED/);
  const first=inputs[0] as Extract<DerivedInputRef,{kind:"PROMOTED_VERSION"}>;
  const altered={retrieval:{derived:{inputs:[{...first,readModelSha256:"f".repeat(64)},...inputs.slice(1)]}}} as RoutineCandidate;
  assert.match((await derivedInputAuthorityIssue(store,altered))!,/DERIVED_INPUT_READ_MODEL_MISMATCH/);
});
