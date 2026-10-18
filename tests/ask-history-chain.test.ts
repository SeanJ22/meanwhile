import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { PgDialect } from "drizzle-orm/pg-core";
import { pointerMoveChainRead } from "../lib/civic-data/store.ts";

test("Ask history reads its anchored chain in one query, retaining ambiguous links and terminating cycles", async () => {
  const pg = new PGlite();
  const key = "FEDERAL_ROLL_CALL:member:example";
  try {
    await pg.exec("CREATE TABLE civic_data_candidate_events(candidate_id text, sequence integer, state text, at timestamptz, detail text)");
    const move = (id: string, previous: string, sequence = 1) => pg.query(
      "INSERT INTO civic_data_candidate_events VALUES($1,$2,'PROMOTED','2026-10-18',$3)",
      [id, sequence, `Atomic pointer ${key} moved from ${previous} to ${id}.`]);
    await move("v3", "v2"); await move("v2", "v1"); await move("v1", "bootstrap/no-version");
    await move("unrelated", "bootstrap/no-version");
    await pg.exec("INSERT INTO civic_data_candidate_events VALUES('v3',2,'NORMALIZED','2026-10-18','Short message')");
    let queries = 0;
    const db = { execute: async (statement: Parameters<PgDialect["sqlToQuery"]>[0]) => {
      queries++; const query = new PgDialect().sqlToQuery(statement);
      return pg.query(query.sql, query.params);
    } } as unknown as Parameters<typeof pointerMoveChainRead>[0];
    const read = () => pointerMoveChainRead(db, key, "v3");
    const first = await read();
    assert.equal(queries, 1);
    assert.deepEqual(first.rows.map(row => row.candidateId).sort(), ["v1", "v2", "v3"]);
    await move("v2", "other", 2);
    const ambiguous = await read();
    assert.equal(ambiguous.rows.filter(row => row.candidateId === "v2").length, 2);
    await pg.exec("DELETE FROM civic_data_candidate_events WHERE candidate_id='v2' AND sequence=2");
    await pg.query("UPDATE civic_data_candidate_events SET detail=$1 WHERE candidate_id='v1'",
      [`Atomic pointer ${key} moved from v3 to v1.`]);
    const cycle = await read();
    assert.deepEqual(cycle.rows.map(row => row.candidateId).sort(), ["v1", "v2", "v3"]);
  } finally { await pg.close(); }
});
