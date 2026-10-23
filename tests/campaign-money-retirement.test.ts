import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";
import {campaignDb,publishMoneyFixture} from "./helpers/campaign-money-db.ts";

test("retirement deletes the replaced load from facts and publications while retaining source evidence and other money",async()=>{
  const db=await campaignDb();
  try{
    await db.pg.exec(`      INSERT INTO entity(id,kind,name,state) VALUES('AL','place','Alabama','AL'),('campaign-committee:AL:old','committee','Collapsed committee','AL'),('person','person','Published person','AL'),('campaign-committee:AL:new','committee','New committee','AL');
      INSERT INTO source_copy(url,final_url,fetched_at,sha256,blob_key) VALUES('https://fcpa.alabamavotes.gov/','https://fcpa.alabamavotes.gov/',now(),repeat('a',64),'saved-source');
      INSERT INTO entity_place VALUES('campaign-committee:AL:old','AL');
      INSERT INTO entity_external_id VALUES('campaign-committee:AL:old','campaign-money-record','old');
      INSERT INTO fact(entity_id,field,value,value_text,status,provenance_kind,source_copy_id,quote,checked_at,produced_by)
        SELECT 'campaign-committee:AL:old','campaign-money:'||i,'{}','old',CASE WHEN i%2=0 THEN 'live' ELSE 'superseded' END,'OFFICIAL',1,'',now(),'campaign-finance:AL:receipts' FROM generate_series(1,1001) i;
      INSERT INTO owner_flag(fact_id,kind) VALUES(1,'AUDIT_LOOKS_WRONG');
      INSERT INTO fact(entity_id,field,value,value_text,status,provenance_kind,source_copy_id,quote,checked_at,produced_by) VALUES
        ('campaign-committee:AL:new','campaign-money:new','{}','new','live','OFFICIAL',1,'',now(),'campaign-person-money:AL:receipts'),
        ('person','campaign-cycle:2026','{}','new cycle','live','OFFICIAL',1,'',now(),'campaign-money'),
        ('person','legacy-money','{}','held source','live','OFFICIAL',1,'',now(),'legacy-state-money');
      INSERT INTO pass_cursor VALUES('campaign-finance:AL:receipts','old checkpoint');`);
    await publishMoneyFixture(db,{recordClass:"CAMPAIGN_FINANCE",scope:"US-AL:old",sourceId:"US-AL:campaign-finance-source",id:"old1",payload:{}});
    await publishMoneyFixture(db,{recordClass:"CAMPAIGN_FINANCE",scope:"US-AL:old",sourceId:"US-AL:campaign-finance-source",id:"old2",payload:{},fetchedOnly:true});
    await publishMoneyFixture(db,{recordClass:"STATE_CAMPAIGN_FINANCE",scope:"US-AZ:campaign-finance:2026",sourceId:"state-money-az",id:"held",payload:{}});
    await publishMoneyFixture(db,{recordClass:"CAMPAIGN_FINANCE",scope:"campaign-money:hourly",sourceId:"campaign-money",id:"new",payload:{}});
    const [before]=await db.query("SELECT version FROM fact_watermark WHERE scope='AL'");
    const migration=await readFile(new URL('../lib/db/migrations/0045_src_mn_retire_campaign_load.sql',import.meta.url),'utf8');
    await db.pg.transaction(async tx=>{for(const sql of migration.split('--> statement-breakpoint'))await tx.exec(sql);});
    assert.equal((await db.query("SELECT count(*) AS n FROM fact WHERE produced_by LIKE 'campaign-finance:%'"))[0].n,0);
    assert.equal((await db.query("SELECT count(*) AS n FROM fact WHERE status='live'"))[0].n,3);
    assert.equal((await db.query("SELECT count(*) AS n FROM source_copy WHERE blob_key='saved-source'"))[0].n,1);
    assert.equal((await db.query("SELECT count(*) AS n FROM entity WHERE id='campaign-committee:AL:old'"))[0].n,0);
    for(const table of ['civic_data_candidates','civic_data_promotions'])assert.equal((await db.query(`SELECT count(*) AS n FROM ${table} WHERE source_id='US-AL:campaign-finance-source'`))[0].n,0);
    assert.equal((await db.query("SELECT count(*) AS n FROM civic_data_candidate_events"))[0].n,8);
    assert.equal((await db.query("SELECT version FROM fact_watermark WHERE scope='AL'"))[0].version,Number(before.version)+1);
    assert.equal((await db.query("SELECT position::jsonb->>'factsRemoved' AS n FROM pass_cursor WHERE name='campaign-money:retired:AL'"))[0].n,'1001');
    await assert.rejects(db.query("DELETE FROM civic_data_promotions WHERE current_version_id='held'"),/live LKG authority/);
  }finally{await db.pg.close();}
});
