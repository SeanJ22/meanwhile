import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { readFederalCounts } from "../lib/sources/congress/counts.ts";
import { FEDERAL_PARSER_VERSION } from "../lib/sources/congress/targets.ts";

test("canonical federal counts sum keyed count fields, including encoded payloads, without counting fanouts twice", async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE TABLE civic_data_candidates(id text PRIMARY KEY,source_id text,record_class text,scope text,state text,
      acquisition_succeeded boolean,parser_version text,candidate jsonb);
      CREATE TABLE civic_data_promotions(record_class text,scope text,source_id text,current_version_id text,last_known_good_version_id text,payload jsonb);
      CREATE TABLE civic_data_payload_parts(hash text PRIMARY KEY,payload jsonb);`);
    for (const sql of readFileSync(new URL("../lib/db/migrations/0036_ne01.sql", import.meta.url), "utf8").split("--> statement-breakpoint")
      .filter(sql => /^\s*CREATE FUNCTION reader_payload_(?:value|node|members)\(/.test(sql))) await db.exec(sql);
    const counts = (loaded: number, joined: number, state = "US") => ({ loaded, joined, unjoined: loaded - joined,
      byState: { [state]: { loaded, joined, unjoined: loaded - joined } }, ...(joined < loaded ? { unjoinedReasons: { NO_HELD_IDENTITY: loaded - joined } } : {}) });
    const seed = async (id: string, partition: string, payload: unknown, source = "congress-api") => {
      const scope = `${source}:${partition}`;
      await db.query("INSERT INTO civic_data_candidates VALUES($1,$2,'FEDERAL_CIVIC_RECORD',$3,'PROMOTED',true,$4,'{}'::jsonb)", [id, source, scope, FEDERAL_PARSER_VERSION]);
      await db.query("INSERT INTO civic_data_promotions VALUES('FEDERAL_CIVIC_RECORD',$1,$2,$3,$3,$4::jsonb)", [scope, source, id, JSON.stringify(payload)]);
    };
    const root = "1".repeat(64), heldCounts = "2".repeat(64);
    await db.query("INSERT INTO civic_data_payload_parts VALUES($1,$2::jsonb),($3,$4::jsonb)", [root,
      JSON.stringify({ kind: "object", value: { countsPrimary: true, records: [], counts: { $civicPayloadPart: heldCounts } } }),
      heldCounts, JSON.stringify({ kind: "object", value: counts(2, 2, "VA") })]);
    await seed("member", "congress:C001078", { $civicPayloadPart: root });
    await seed("bill-fanout", "bill:117:hr:21", { countsPrimary: false, records: [], counts: counts(2, 2, "VA") });
    await seed("legacy-primary", "bill:117:hr:22", { records: [{ kind: "BILL" }], counts: counts(1, 0) });
    await db.query("UPDATE civic_data_candidates SET parser_version='src-cg/1' WHERE id='legacy-primary'");
    await seed("legacy-fanout", "bill:117:hr:23", { records: [{ kind: "BILL", bioguideId: "C001078" }], counts: counts(99, 99) });
    await seed("national", "national", { countsPrimary: true, records: [], counts: counts(999, 999) });
    await seed("other-source", "bill:117:hr:21", { records: [], counts: counts(37, 37) }, "govinfo");
    const query = async (text: string, params: readonly unknown[]) => (await db.query<Record<string, unknown>>(text, [...params])).rows;
    const first = await readFederalCounts(query, "congress-api");
    assert.equal(first.complete, true);
    assert.deepEqual(first.counts, { loaded: 3, joined: 2, unjoined: 1, byState: {
      VA: { loaded: 2, joined: 2, unjoined: 0 }, US: { loaded: 1, joined: 0, unjoined: 1 },
    }, unjoinedReasons: { NO_HELD_IDENTITY: 1 } });
    // The native partition moved while the national snapshot still says 999; the next narrow read sees the actual current total.
    const nextRoot = "3".repeat(64), nextCounts = "4".repeat(64);
    await db.query("INSERT INTO civic_data_payload_parts VALUES($1,$2::jsonb),($3,$4::jsonb)", [nextRoot,
      JSON.stringify({ kind: "object", value: { countsPrimary: true, records: [], counts: { $civicPayloadPart: nextCounts } } }),
      nextCounts, JSON.stringify({ kind: "object", value: counts(4, 4, "VA") })]);
    await db.query("INSERT INTO civic_data_candidates SELECT 'member-2',source_id,record_class,scope,state,acquisition_succeeded,parser_version,candidate FROM civic_data_candidates WHERE id='member'");
    await db.query("UPDATE civic_data_promotions SET current_version_id='member-2',last_known_good_version_id='member-2',payload=$1::jsonb WHERE current_version_id='member'", [JSON.stringify({ $civicPayloadPart: nextRoot })]);
    assert.equal((await readFederalCounts(query, "congress-api")).counts.loaded, 5);
    await seed("missing-counts", "unjoined:missing", { records: [] });
    assert.equal((await readFederalCounts(query, "congress-api")).complete, false, "a missing primary count field cannot masquerade as zero");
  } finally { await db.close(); }
});
