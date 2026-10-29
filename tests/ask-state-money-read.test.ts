import assert from "node:assert/strict";
import test from "./helpers/playbooks.ts";
import {readKeyedSelection} from "../lib/civic-data/keyed-reader.ts";
import {migratedReaderDb} from "./helpers/migrated-reader-db.ts";
import { withReaderSelection } from "../lib/db/reader-route.ts";
import { requestedStateMoneySubjects } from "../lib/ask/state-money-subjects.ts";
import { stateCampaignRecordsAsk } from "../lib/ask/state-campaign.ts";
import {campaignDb,publishMoneyFixture} from "./helpers/campaign-money-db.ts";
import{installFactReader}from"../lib/facts/db.ts";

test("a named campaign question reads its source filer's rows without name-joining an officeholder", async () => {
  const {pg,publish}=await migratedReaderDb();
  try {
    const records = [{ candidateNameAsFiled: "SELEN, TAYFUN", targetKeys: ["native:first"], totals: { receipts: 42 } },
      { candidateNameAsFiled: "Another Person", targetKeys: ["native:second"] },
      { candidateNameAsFiled: "Tayfun Someone", targetKeys: ["native:third"] }];
    await publish({id:'money-v1',recordClass:'STATE_CAMPAIGN_FINANCE',scope:'US-NJ:campaign',sourceId:'official',at:'2026-10-20T00:00:00.000Z',value:{cycle:2026,formatVersion:1,records}});
    const read=async(keys:string[])=>{const entry=await readKeyedSelection(async(text,params=[])=>(await pg.query(text,[...params])).rows,'STATE_CAMPAIGN_FINANCE','US-NJ:campaign',keys);
      assert.equal(entry.kind,'PROMOTED');return entry.kind==='PROMOTED'?(entry.projection.payload as {records:unknown}).records:undefined;};
    assert.deepEqual(await read(["ask-money-name:tayfun selen"]), [records[0]]);
    assert.deepEqual(await read(["native:second"]), [records[1]]);
    assert.deepEqual(await read(["ask-money-name:tayfun other"]), []);
  } finally { await pg.close(); }
});

test("concurrent campaign questions select their published people without reading another person's money", async () => {
  const db=await campaignDb();
  try{
    const state="ocd-division/country:us/state:nh";
    await db.query("INSERT INTO source_copy(url,final_url,fetched_at,sha256,blob_key) VALUES('https://www.sos.nh.gov/','https://www.sos.nh.gov/',now(),repeat('a',64),'fixture')");
    for(const name of ["First","Second"]){
      const id=`published:${name}`;
      await db.query("INSERT INTO entity(id,kind,name,state) VALUES($1,'person',$2,'NH')",[id,`${name} Person`]);
      await publishMoneyFixture(db,{recordClass:"REGISTRY_RUNTIME_BINDING",scope:`US-NH:${name}`,payload:{bodyRosters:[{bodyId:`${state}/place:${name.toLowerCase()}#council`,sourceUrl:"https://www.sos.nh.gov/",members:[{id,name:`${name} Person`,officeTitle:"Mayor"}]}]}});
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
