import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { ASSIGNMENT_LOG_FIELDS } from "../lib/control-plane/assignment-read.ts";
import { pgAppendOnlyRepository, type Sql } from "../lib/control-plane/repository/pg-store.ts";
import { projectRecord } from "../lib/control-plane/repository/types.ts";

test("assignment count projections preserve absent, null and non-array values and never transfer source arrays", async () => {
  const db = new PGlite();
  try {
    await db.exec("CREATE TABLE cp_log_scout_results(log_key text,position bigint,changed_at timestamptz DEFAULT now(),record jsonb,PRIMARY KEY(log_key,position))");
    const records = [{ rungs: ["source body ".repeat(100_000)], nextRungs: ["next", "later"], worker: { modelReported: null, unused: "not selected" } },
      {}, { rungs: null, nextRungs: null }, { rungs: "legacy scalar", nextRungs: { legacy: true } }];
    for (const [position, record] of records.entries()) await db.query("INSERT INTO cp_log_scout_results(log_key,position,record) VALUES('work',$1,$2)", [position, record]);
    const returned: unknown[] = [];
    const sql: Sql = { query: async (text, params = []) => {
      const rows = (await db.query(text, [...params])).rows; returned.push(...rows); return rows;
    } };
    const repo = pgAppendOnlyRepository<Record<string, unknown>>(sql, "scout_results");
    const fields = ASSIGNMENT_LOG_FIELDS.scoutResults;
    assert.deepEqual((await repo.readKeys!(["work"], fields)).get("work"), records.map(record => projectRecord(record, fields)));
    assert.ok(Buffer.byteLength(JSON.stringify(returned)) < 5_000, "only the array counts cross the connection");
    assert.deepEqual(await repo.read("work"), records, "the keyed full-source read retains every original field and array");
  } finally { await db.close(); }
});
