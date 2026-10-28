import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

test("new publication fingerprints bind to the candidate while legacy rows stay null", async () => {
  const pg = new PGlite();
  try {
    await pg.exec(`CREATE TABLE civic_data_candidates(id text primary key, normalized_hash text, candidate jsonb);
      CREATE TABLE civic_data_promotions(key text primary key,current_version_id text,payload jsonb);
      INSERT INTO civic_data_candidates VALUES ('old',null,'{}');
      INSERT INTO civic_data_promotions VALUES ('old','old','{}');`);
    await pg.exec(readFileSync(new URL("../lib/db/migrations/VB-01_read_model_fingerprints.sql", import.meta.url), "utf8"));
    assert.deepEqual((await pg.query("SELECT read_model_fingerprint FROM civic_data_candidates WHERE id='old'")).rows,
      [{read_model_fingerprint:null}]);
    assert.deepEqual((await pg.query("SELECT payload_fingerprint FROM civic_data_promotions WHERE key='old'")).rows,
      [{payload_fingerprint:null}]);
    const fingerprint = "a".repeat(64), other = "b".repeat(64);
    await pg.query(`INSERT INTO civic_data_candidates VALUES ('new',$1,$2,$1)`,
      [fingerprint, {normalization:{normalizedHash:fingerprint}}]);
    await pg.query(`INSERT INTO civic_data_promotions VALUES ('new','new','{}',$1)`,[fingerprint]);
    await assert.rejects(pg.query("UPDATE civic_data_promotions SET payload_fingerprint=$1 WHERE key='new'", [other]), /differs from its candidate/);
    await assert.rejects(pg.query("UPDATE civic_data_candidates SET read_model_fingerprint=$1 WHERE id='new'", [other]), /immutable/);
    await assert.rejects(pg.query("INSERT INTO civic_data_candidates VALUES ('bad',$1,$2,$3)",
      [fingerprint,{normalization:{normalizedHash:fingerprint}},other]), /differs from its normalized model/);
    assert.equal((await pg.query<{payload_fingerprint:string}>("SELECT payload_fingerprint FROM civic_data_promotions WHERE key='new'")).rows[0].payload_fingerprint, fingerprint);
  } finally { await pg.close(); }
});

test("the expanded atomic proof accepts vault facts and retains exact legacy payload protection",async()=>{
  const pg=new PGlite(),fp="a".repeat(64),at="2026-01-01T00:00:00Z",receipt={validatedAt:at};
  try{
    await pg.exec(`CREATE TABLE civic_data_candidates(id text primary key,source_id text,record_class text,scope text,state text,
      promoted_version_id text,last_known_good_version_id text,candidate jsonb,validation_receipt jsonb,retrieved_at timestamptz,read_model_fingerprint text);
      CREATE TABLE civic_data_promotions(key text primary key,source_id text,record_class text,scope text,current_version_id text,
        last_known_good_version_id text,payload jsonb,validation_receipt jsonb,promoted_at timestamptz,payload_fingerprint text);
      CREATE TABLE civic_data_candidate_events(candidate_id text,state text,sequence int,at timestamptz);`);
    await pg.exec(readFileSync(new URL("../lib/db/migrations/VB-01_candidate_vault.sql",import.meta.url),"utf8"));
    await pg.exec(`CREATE CONSTRAINT TRIGGER exact_proof AFTER INSERT OR UPDATE ON civic_data_promotions
      DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION assert_civic_data_promotion_integrity();`);
    const insert=async(id:string,candidate:unknown,fingerprint:string|null)=>{
      await pg.query(`INSERT INTO civic_data_candidates VALUES ($1,'source','MEETING',$1,'PROMOTED',$1,$1,$2,$3,$4,$5)`,[id,candidate,receipt,at,fingerprint]);
      await pg.query("INSERT INTO civic_data_candidate_events VALUES ($1,'PROMOTED',1,$2)",[id,at]);
    };
    await insert("vault",{vault:{readModel:{fingerprint:fp}}},fp);
    await pg.query(`INSERT INTO civic_data_promotions VALUES ('vault','source','MEETING','vault','vault','vault','{"fact":42}',$1,$2,$3)`,[receipt,at,fp]);
    await assert.rejects(pg.query("UPDATE civic_data_promotions SET payload_fingerprint=$1 WHERE key='vault'",["b".repeat(64)]),/exact proof-consistent/);
    await pg.query("UPDATE civic_data_candidates SET candidate=$1 WHERE id='vault'",[{vault:{readModel:{fingerprint:"b".repeat(64)}}}]);
    await assert.rejects(pg.query("UPDATE civic_data_promotions SET payload=payload WHERE key='vault'"),/exact proof-consistent/);
    await insert("legacy",{readModel:{fact:1}},null);
    await pg.query(`INSERT INTO civic_data_promotions VALUES ('legacy','source','MEETING','legacy','legacy','legacy','{"fact":1}',$1,$2,null)`,[receipt,at]);
    await assert.rejects(pg.query(`UPDATE civic_data_promotions SET payload='{"fact":2}' WHERE key='legacy'`),/exact proof-consistent/);
    await assert.rejects(pg.query(`UPDATE civic_data_promotions SET promoted_at='2026-01-02T00:00:00Z' WHERE key='legacy'`),/exact atomic first PROMOTED event/);
  }finally{await pg.close();}
});
