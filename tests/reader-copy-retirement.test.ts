import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { CONSOLE_READER_INPUT_SQL } from "../scripts/pilot-runtime-publish.mts";

test("RS-01 contract retires copies and queues while preserving source evidence and fact refresh", async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE TABLE civic_data_promotions(key text PRIMARY KEY,record_class text,scope text,
        current_version_id text DEFAULT 'source-version',promoted_at timestamptz DEFAULT now());
      CREATE TABLE civic_data_candidates(id text PRIMARY KEY);
      CREATE TABLE civic_data_candidate_events(id text PRIMARY KEY,candidate_id text DEFAULT 'source-version');
      CREATE TABLE civic_data_reader_projections(key text PRIMARY KEY);
      CREATE TABLE meeting_publication_queue(scope text PRIMARY KEY);
      CREATE TABLE rebuild_queue(place_id text PRIMARY KEY);
      CREATE TABLE pass_cursor(name text PRIMARY KEY,position text);
      CREATE TABLE entity(id text PRIMARY KEY,state text);
      CREATE TABLE fact(entity_id text,field text,status text);
      CREATE TABLE fact_watermark(scope text PRIMARY KEY,version bigint);
      CREATE FUNCTION enforce_civic_data_promotion_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION 'canonical pointers cannot be deleted'; END $$;
      CREATE TRIGGER civic_data_promotions_no_delete_or_rewrite BEFORE UPDATE OR DELETE ON civic_data_promotions
        FOR EACH ROW EXECUTE FUNCTION enforce_civic_data_promotion_mutation();
      CREATE FUNCTION fact_changed() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NULL; END $$;
      CREATE TRIGGER fact_changed AFTER INSERT OR UPDATE OF status ON fact FOR EACH ROW EXECUTE FUNCTION fact_changed();
      INSERT INTO civic_data_promotions(key,record_class,scope) VALUES
        ('MEETING:supported-bodies','MEETING','supported-bodies'),
        ('MEETING:US-AZ:meetings-body:copy','MEETING','US-AZ:meetings-body:copy'),
        ('MEETING:source:ical:body:canonical','MEETING','source:ical:body:canonical'),
        ('MEETING:source:ical:body:canonical:history','MEETING','source:ical:body:canonical:history');
      INSERT INTO civic_data_candidates VALUES ('fetched-source-evidence');
      INSERT INTO civic_data_candidate_events(id) VALUES ('validation-evidence');
      INSERT INTO pass_cursor VALUES ('reader-edge','old'),('state-facts:AZ','old'),('publish-now:workers','keep');
      INSERT INTO entity VALUES ('local-body','AZ');`);
    const sql = await readFile(new URL("../lib/db/migrations/RS-01_retire_copies.sql", import.meta.url), "utf8");
    await db.exec(`BEGIN;\n${sql}\nCOMMIT;`);
    assert.deepEqual((await db.query("SELECT scope FROM civic_data_promotions ORDER BY scope")).rows,
      [{scope:"source:ical:body:canonical"},{scope:"source:ical:body:canonical:history"}]);
    assert.deepEqual((await db.query("SELECT id FROM civic_data_candidates")).rows,[{id:"fetched-source-evidence"}]);
    assert.deepEqual((await db.query("SELECT id FROM civic_data_candidate_events")).rows,[{id:"validation-evidence"}]);
    assert.deepEqual((await db.query("SELECT name FROM pass_cursor")).rows,[{name:"publish-now:workers"}]);
    const tables = (await db.query<{ tablename: string }>("SELECT tablename FROM pg_tables WHERE schemaname='public'")).rows.map(row=>row.tablename);
    for(const name of ["civic_data_reader_projections","meeting_publication_queue","rebuild_queue"]) assert.ok(!tables.includes(name));
    const signature = async () => (await db.query<{signature:string}>(CONSOLE_READER_INPUT_SQL)).rows[0]?.signature;
    const beforeFact = await signature();
    assert.match(beforeFact ?? "", /^[a-f0-9]{32}$/);
    await assert.rejects(db.query("DELETE FROM civic_data_promotions WHERE scope='source:ical:body:canonical'"),/canonical pointers cannot be deleted/);
    await db.exec("INSERT INTO fact VALUES ('local-body','comment:rules','live')");
    assert.deepEqual((await db.query("SELECT scope,version::text FROM fact_watermark ORDER BY scope")).rows,[{scope:"AZ",version:"1"},{scope:"comment",version:"1"}]);
    assert.notEqual(await signature(), beforeFact, "console refresh follows canonical fact changes after copy retirement");
  } finally { await db.close(); }
});
