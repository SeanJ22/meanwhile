import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";
import {factDb} from "./helpers/fact-db.ts";

test("retirement deletes the replaced load from facts and publications while retaining source evidence and other money",async()=>{
  const db=await factDb();
  try{
    await db.pg.exec(`CREATE TABLE civic_data_candidates(id text PRIMARY KEY,source_id text,record_class text,last_known_good_version_id text REFERENCES civic_data_candidates(id) ON DELETE RESTRICT);
      CREATE TABLE civic_data_promotions(key text PRIMARY KEY,source_id text,record_class text,current_version_id text REFERENCES civic_data_candidates(id) ON DELETE RESTRICT);
      CREATE TABLE civic_data_candidate_events(candidate_id text REFERENCES civic_data_candidates(id) ON DELETE RESTRICT);
      CREATE FUNCTION refuse_retirement() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'immutable'; END $$;
      CREATE TRIGGER civic_data_promotions_no_delete_or_rewrite BEFORE DELETE ON civic_data_promotions FOR EACH ROW EXECUTE FUNCTION refuse_retirement();
      CREATE TRIGGER civic_data_candidates_immutable_evidence BEFORE DELETE ON civic_data_candidates FOR EACH ROW EXECUTE FUNCTION refuse_retirement();
      CREATE TRIGGER civic_data_candidate_events_append_only BEFORE DELETE ON civic_data_candidate_events FOR EACH ROW EXECUTE FUNCTION refuse_retirement();
      INSERT INTO entity(id,kind,name,state) VALUES('AL','place','Alabama','AL'),('campaign-committee:AL:old','committee','Collapsed committee','AL'),('person','person','Published person','AL'),('campaign-committee:AL:new','committee','New committee','AL');
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
      INSERT INTO civic_data_candidates VALUES('old1','US-AL:campaign-finance-source','CAMPAIGN_FINANCE','old1'),('old2','US-AL:campaign-finance-source','CAMPAIGN_FINANCE','old1'),('held','state-money-az','STATE_CAMPAIGN_FINANCE','held'),('new','campaign-money','CAMPAIGN_FINANCE','new');
      INSERT INTO civic_data_promotions VALUES('old','US-AL:campaign-finance-source','CAMPAIGN_FINANCE','old2'),('held','state-money-az','STATE_CAMPAIGN_FINANCE','held'),('new','campaign-money','CAMPAIGN_FINANCE','new');
      INSERT INTO civic_data_candidate_events VALUES('old1'),('old2'),('held'),('new');
      INSERT INTO pass_cursor VALUES('campaign-finance:AL:receipts','old checkpoint');`);
    const [before]=await db.query("SELECT version FROM fact_watermark WHERE scope='AL'");
    const migration=await readFile(new URL('../lib/db/migrations/0045_src_mn_retire_campaign_load.sql',import.meta.url),'utf8');
    await db.pg.transaction(async tx=>{for(const sql of migration.split('--> statement-breakpoint'))await tx.exec(sql);});
    assert.equal((await db.query("SELECT count(*) AS n FROM fact WHERE produced_by LIKE 'campaign-finance:%'"))[0].n,0);
    assert.equal((await db.query("SELECT count(*) AS n FROM fact WHERE status='live'"))[0].n,3);
    assert.equal((await db.query("SELECT count(*) AS n FROM source_copy WHERE blob_key='saved-source'"))[0].n,1);
    assert.equal((await db.query("SELECT count(*) AS n FROM entity WHERE id='campaign-committee:AL:old'"))[0].n,0);
    for(const table of ['civic_data_candidates','civic_data_promotions'])assert.equal((await db.query(`SELECT count(*) AS n FROM ${table} WHERE source_id='US-AL:campaign-finance-source'`))[0].n,0);
    assert.equal((await db.query("SELECT count(*) AS n FROM civic_data_candidate_events"))[0].n,2);
    assert.equal((await db.query("SELECT version FROM fact_watermark WHERE scope='AL'"))[0].version,Number(before.version)+1);
    assert.equal((await db.query("SELECT position::jsonb->>'factsRemoved' AS n FROM pass_cursor WHERE name='campaign-money:retired:AL'"))[0].n,'1001');
    await assert.rejects(db.query("DELETE FROM civic_data_promotions WHERE key='held'"),/immutable/);
  }finally{await db.pg.close();}
});
