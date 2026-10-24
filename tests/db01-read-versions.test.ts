import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { CivicReadCache } from "../lib/db/civic-read-cache.ts";

test("clock copies survive the next pass and invalidate on every committed input change", async t => {
  const pg = new PGlite();
  t.after(() => pg.close());
  await pg.exec(`CREATE TABLE civic_data_candidates(id text PRIMARY KEY,record_class text,scope text);
    CREATE TABLE civic_data_promotions(key text PRIMARY KEY,record_class text,scope text);
    CREATE TABLE civic_data_candidate_events(candidate_id text,sequence integer,PRIMARY KEY(candidate_id,sequence));
    CREATE TABLE owner_flag(id integer,fact_id bigint,reader_family text,reader_id text,resolved text);`);
  await pg.exec(readFileSync(new URL("../lib/db/migrations/DB-01_read_versions.sql", import.meta.url), "utf8"));
  const saved = new Map<string, string>();
  const copy = () => new CivicReadCache({ read: async key => saved.get(key) ?? null, write: async (key, value) => { saved.set(key, value); } });
  let fullReads = 0;
  const read = () => copy().rows({ namespace: "clock", keys: ["MEETING:AZ"], keyOf: row => row.key,
    versions: async () => (await pg.query<{ etag: string }>(`SELECT coalesce((SELECT version::text
      FROM civic_data_clock_versions WHERE record_class='MEETING' AND scope='AZ'),'0') AS etag`)).rows.map(row => ({ key: "MEETING:AZ", etag: row.etag })),
    values: async () => [{ key: "MEETING:AZ", value: ++fullReads }],
  });
  await read(); await read();
  assert.equal(fullReads, 1, "a new process on the next pass keeps unchanged clock bytes");
  for (const statement of [
    "INSERT INTO civic_data_candidates VALUES('az','MEETING','AZ')",
    "INSERT INTO civic_data_candidate_events VALUES('az',1)",
    "INSERT INTO civic_data_candidate_events VALUES('az',2)",
    "UPDATE civic_data_candidates SET id=id WHERE id='az'",
    "INSERT INTO civic_data_promotions VALUES('az','MEETING','AZ')",
    "DELETE FROM civic_data_promotions WHERE key='az'",
  ]) {
    const before: number = fullReads;
    await pg.exec(statement); await read(); await read();
    assert.equal(fullReads, before + 1, statement);
  }
  const before = fullReads;
  await pg.exec("INSERT INTO civic_data_candidates VALUES('nj','MEETING','NJ')");
  await pg.exec("BEGIN; INSERT INTO civic_data_candidate_events VALUES('az',3); ROLLBACK;");
  await read();
  assert.equal(fullReads, before, "an unrelated state and rolled-back work leave the AZ version unchanged");
});
