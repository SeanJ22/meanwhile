import assert from "node:assert/strict";
import test from "./helpers/playbooks.ts";
import { PGlite } from "@electric-sql/pglite";
import { STATE_MONEY_READER_PAYLOAD } from "../lib/civic-data/read-model.ts";
import { withReaderSelection } from "../lib/db/reader-route.ts";
import { requestedStateMoneySubjects } from "../lib/ask/state-money-subjects.ts";
import { stateCampaignRecordsAsk } from "../lib/ask/state-campaign.ts";
import{factDb}from"./helpers/fact-db.ts";
import{installFactReader}from"../lib/facts/db.ts";
import{readFileSync}from"node:fs";

test("a named campaign question reads its source filer's rows without name-joining an officeholder", async () => {
  const pg = new PGlite();
  try {
    await pg.exec(`CREATE FUNCTION reader_payload_value(value jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE AS 'SELECT value';
      CREATE FUNCTION reader_payload_node(value jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE AS 'SELECT value';
      CREATE FUNCTION reader_payload_members(value jsonb) RETURNS TABLE(ordinal_index bigint,item jsonb) LANGUAGE sql IMMUTABLE AS 'SELECT n,v FROM jsonb_array_elements(value) WITH ORDINALITY e(v,n)';
      CREATE TABLE money_fixture(payload jsonb)`);
    const records = [{ candidateNameAsFiled: "SELEN, TAYFUN", targetKeys: ["native:first"], totals: { receipts: 42 } },
      { candidateNameAsFiled: "Another Person", targetKeys: ["native:second"] },
      { candidateNameAsFiled: "Tayfun Someone", targetKeys: ["native:third"] }];
    await pg.query("INSERT INTO money_fixture VALUES ($1)", [{ cycle: 2026, formatVersion: 1, records }]);
    const read = (keys: string[]) => pg.query<{ value: { records: unknown } }>(`SELECT ${STATE_MONEY_READER_PAYLOAD} value FROM money_fixture p WHERE $1::text=$2::text`, ["fixture", "fixture", keys]);
    assert.deepEqual((await read(["ask-money-name:tayfun selen"])).rows[0]!.value.records, [records[0]]);
    assert.deepEqual((await read(["native:second"])).rows[0]!.value.records, [records[1]]);
    assert.deepEqual((await read(["ask-money-name:tayfun other"])).rows[0]!.value.records, []);
  } finally { await pg.close(); }
});

test("concurrent campaign questions select their published people without reading another person's money", async () => {
  const db=await factDb();
  try{
    await db.pg.exec("CREATE TABLE civic_data_payload_parts(hash text PRIMARY KEY,payload jsonb);CREATE TABLE civic_data_promotions(record_class text,scope text,current_version_id text,payload jsonb)");
    for(const sql of readFileSync(new URL("../lib/db/migrations/0036_ne01.sql",import.meta.url),"utf8").split("--> statement-breakpoint"))if(/CREATE FUNCTION reader_payload_(?:node|value|members)\(/.test(sql))await db.pg.exec(sql);
    const state="ocd-division/country:us/state:nh";
    await db.query("INSERT INTO source_copy(url,final_url,fetched_at,sha256,blob_key) VALUES('https://www.sos.nh.gov/','https://www.sos.nh.gov/',now(),repeat('a',64),'fixture')");
    for(const name of ["First","Second"]){
      const id=`published:${name}`;
      await db.query("INSERT INTO entity(id,kind,name,state) VALUES($1,'person',$2,'NH')",[id,`${name} Person`]);
      await db.query("INSERT INTO civic_data_promotions VALUES('REGISTRY_RUNTIME_BINDING',$1,$2,$3)",[`US-NH:${name}`,name,JSON.stringify({bodyRosters:[{bodyId:`${state}/place:${name.toLowerCase()}#council`,sourceUrl:"https://www.sos.nh.gov/",members:[{id,name:`${name} Person`,officeTitle:"Mayor"}]}]})]);
      await db.query("INSERT INTO fact(entity_id,field,value,value_text,status,provenance_kind,source_copy_id,quote,checked_at,produced_by) VALUES($1,'campaign-cycle:2026',$2,'','live','OFFICIAL',1,'',now(),'fixture')",[id,JSON.stringify({person:{name:`${name} Person`},cycle:2026})]);
    }
    installFactReader(db.query);
    await Promise.all(["First","Second"].map(name=>withReaderSelection({states:["NH"],keys:new Set()},async()=>{
      const selected=await requestedStateMoneySubjects(`How much has ${name} Person raised?`,["NH"]);
      assert.deepEqual(selected.map(row=>row.id),[`published:${name}`]);
      assert.deepEqual(await requestedStateMoneySubjects("How much has Other Person raised?",["NH"]),[]);
    })));
  }finally{installFactReader(undefined);await db.pg.close();}
});

test("campaign record questions select the explicit state or exact place, and unknown places cannot stand in", () => {
  const state = "ocd-division/country:us/state:ca", oakland = `${state}/place:oakland`, alameda = `${state}/county:alameda`;
  const divisions = [state, oakland, alameda];
  assert.deepEqual(stateCampaignRecordsAsk("What campaign finance records are held for Oakland?", divisions), [oakland]);
  assert.deepEqual(stateCampaignRecordsAsk("What campaign finance records are held for California?", divisions), [state]);
  assert.deepEqual(stateCampaignRecordsAsk("Which campaign filings do you have here?", divisions), [oakland]);
  assert.equal(stateCampaignRecordsAsk("What campaign finance records are held for Fresno?", divisions), null);
  assert.equal(stateCampaignRecordsAsk("What campaign finance records are held for Minnesota?", divisions), null);
  assert.equal(stateCampaignRecordsAsk("How much has Other Person raised?", divisions), null);
  assert.equal(stateCampaignRecordsAsk("Which campaign reports did Other Person file?", divisions), null);
});
