import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { canonicalCivicDataHash } from "../lib/civic-data/canonical-hash.ts";
import { MemoryEvidenceStore } from "../lib/control-plane/evidence/store.ts";
import { holdCivicVersion } from "../lib/civic-data/version-vault.ts";
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
  const candidate={retrieval:{derived:{inputs}}} as unknown as RoutineCandidate;
  assert.equal(await derivedInputAuthorityIssue(store,candidate),null);
  assert.ok(bytes<1_500,`${bytes} bytes includes no unrelated inventory or wiring`);
  const member=inputs.at(-1)! as Extract<DerivedInputRef,{kind:"MEMBER_ACQUISITION"}>;
  const foreign={retrieval:{derived:{inputs:[...inputs.slice(0,-1),{...member,finalUrl:"https://unrelated.gov/calendar"}]}}} as unknown as RoutineCandidate;
  assert.match((await derivedInputAuthorityIssue(store,foreign))!,/DERIVED_MEMBER_HOST_NOT_ATTESTED/);
  const first=inputs[0] as Extract<DerivedInputRef,{kind:"PROMOTED_VERSION"}>;
  const altered={retrieval:{derived:{inputs:[{...first,readModelSha256:"f".repeat(64)},...inputs.slice(1)]}}} as unknown as RoutineCandidate;
  assert.match((await derivedInputAuthorityIssue(store,altered))!,/DERIVED_INPUT_READ_MODEL_MISMATCH/);
});

test("current wiring heads and members use the promotion fingerprint without a candidate read model", async t => {
  const pg = new PGlite(); t.after(() => pg.close());
  await pg.exec(`CREATE TABLE civic_data_candidates(id text PRIMARY KEY,record_class text,scope text,state text,acquisition_succeeded boolean,promoted_version_id text,last_known_good_version_id text,normalized_hash text,candidate jsonb,validation_receipt jsonb);
    CREATE TABLE civic_data_promotions(key text PRIMARY KEY,record_class text,scope text,current_version_id text,last_known_good_version_id text,source_id text,promoted_at timestamptz,payload jsonb,validation_receipt jsonb);`);
  await installKeyedRows(pg);
  const model = { kind: "meeting-source-wiring", records: [{ id: "one", status: "ACTIVE", row: { officialHost: "example.gov", route: "https://example.gov/calendar" } }] };
  const fingerprint = canonicalCivicDataHash(model), receipt = { candidateId: "current", recordClass: "CURATED_READER_RECORD", scope: DERIVED_WIRING_SCOPE, decision: "GOOD" };
  await pg.query(`INSERT INTO civic_data_candidates(id,record_class,scope,state,acquisition_succeeded,promoted_version_id,last_known_good_version_id,normalized_hash,candidate,validation_receipt,read_model_fingerprint)
    VALUES('current','CURATED_READER_RECORD',$1,'PROMOTED',true,'current','current',$2,'{}',$3,$2)`, [DERIVED_WIRING_SCOPE,fingerprint,receipt]);
  await pg.query(`INSERT INTO civic_data_promotions(key,record_class,scope,current_version_id,last_known_good_version_id,source_id,payload,validation_receipt,payload_fingerprint)
    VALUES($1,'CURATED_READER_RECORD',$2,'current','current','wiring',$3,$4,$5)`, [`CURATED_READER_RECORD:${DERIVED_WIRING_SCOPE}`,DERIVED_WIRING_SCOPE,model,receipt,fingerprint]);
  const query = async (text: string, params: readonly unknown[] = []) => (await pg.query<Record<string,unknown>>(text,[...params])).rows;
  assert.equal((await readDerivedInputHeads(query,["current"]))[0].readModelKind, model.kind);
  assert.deepEqual(await readDerivedWiringRows(query,"current",["one"]), [{key:"one",status:"ACTIVE",officialHost:"example.gov",route:"https://example.gov/calendar"}]);
  await pg.exec("DELETE FROM civic_data_rows");
  assert.deepEqual(await readDerivedWiringRows(query,"current",["one"]), [{key:"one",status:"ACTIVE",officialHost:"example.gov",route:"https://example.gov/calendar"}], "an unindexed current pointer also selects from its payload");
  await pg.query("UPDATE civic_data_promotions SET payload_fingerprint=$1",["0".repeat(64)]);
  assert.equal((await readDerivedInputHeads(query,["current"]))[0].readModelSha256, null);
  assert.deepEqual(await readDerivedWiringRows(query,"current",["one"]), [], "a mismatched current pointer cannot fall back to an older candidate body");
});

test("historical wiring fields are selected from its fingerprint-filed vault model", async t => {
  const pg=new PGlite();t.after(()=>pg.close());
  await pg.exec(`CREATE TABLE civic_data_candidates(id text PRIMARY KEY,record_class text,scope text,state text,acquisition_succeeded boolean,
    promoted_version_id text,last_known_good_version_id text,normalized_hash text,candidate jsonb,validation_receipt jsonb);
    CREATE TABLE civic_data_promotions(key text PRIMARY KEY,record_class text,scope text,current_version_id text,last_known_good_version_id text,
      source_id text,promoted_at timestamptz,payload jsonb,validation_receipt jsonb);`);
  await installKeyedRows(pg);
  const vault=new MemoryEvidenceStore(),model={kind:"meeting-source-wiring",records:[
    {id:"one",status:"ACTIVE",row:{officialHost:"Example.Gov",route:"https://example.gov/calendar"}},
    {id:"other",status:"ACTIVE",row:{officialHost:"unrelated.gov",route:"https://unrelated.gov",evidence:"unrelated ".repeat(20_000)}}]};
  const fingerprint=canonicalCivicDataHash(model,{durable:true}),ref=await holdCivicVersion(vault,model,fingerprint);
  const receipt={candidateId:"old",recordClass:"CURATED_READER_RECORD",scope:DERIVED_WIRING_SCOPE,decision:"GOOD"};
  await pg.query(`INSERT INTO civic_data_candidates(id,record_class,scope,state,acquisition_succeeded,promoted_version_id,last_known_good_version_id,
    normalized_hash,candidate,validation_receipt,read_model_fingerprint) VALUES('old','CURATED_READER_RECORD',$1,'PROMOTED',true,'old','old',$2,$3,$4,$2)`,
    [DERIVED_WIRING_SCOPE,fingerprint,{vault:{readModel:ref}},receipt]);
  let transferred=0;
  const query=async(text:string,params:readonly unknown[]=[])=>{const rows=(await pg.query<Record<string,unknown>>(text,[...params])).rows;
    transferred+=JSON.stringify(rows).length;return rows;};
  assert.equal((await readDerivedInputHeads(query,["old"],vault))[0].readModelKind,model.kind);
  assert.deepEqual(await readDerivedWiringRows(query,"old",["one"],vault),[{key:"one",status:"ACTIVE",officialHost:"example.gov",route:"https://example.gov/calendar"}]);
  assert.ok(transferred<2000,`${transferred} database bytes include no unrelated wiring body`);
});
