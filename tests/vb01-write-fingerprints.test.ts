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
