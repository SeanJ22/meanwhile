import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { readReaderEdgeChanges } from "../lib/civic-data/reader-edge-changes.ts";
import { factDb } from "./helpers/fact-db.ts";

async function db() {
  const facts = await factDb();
  await facts.pg.exec(`CREATE TABLE civic_data_promotions (key text PRIMARY KEY, record_class text NOT NULL, scope text NOT NULL, promoted_at timestamptz NOT NULL)`);
  await facts.pg.exec(readFileSync(join(import.meta.dirname, "..", "lib", "db", "migrations", "R1_edge_changes.sql"), "utf8"));
  const promote = (recordClass: string, scope: string, at: string) => facts.query(`INSERT INTO civic_data_promotions VALUES ($1, $2, $3, $4)
    ON CONFLICT (key) DO UPDATE SET promoted_at = EXCLUDED.promoted_at`, [`${recordClass}:${scope}`, recordClass, scope, at]);
  return { ...facts, promote };
}

test("the edge reads what was promoted since it last published, and nothing when nothing moved", async () => {
  const { query, promote } = await db();
  await promote("BALLOT_CANDIDACY", "US-AZ:2026-general", "2026-10-01T00:00:00Z");
  await promote("STATE_LEGISLATOR", "US-NH", "2026-10-02T00:00:00Z");
  const first = await readReaderEdgeChanges(query);
  assert.equal(first.pointers.length, 2, "with no cursor, everything once");
  assert.equal(first.facts, false, "no fact is queued");
  await first.save();
  assert.deepEqual((await readReaderEdgeChanges(query)).pointers, [], "an unchanged edge has nothing to publish");

  await promote("BALLOT_CANDIDACY", "US-AZ:2026-general", new Date(Date.now() + 1_000).toISOString());
  const moved = await readReaderEdgeChanges(query);
  assert.deepEqual(moved.pointers, [{ recordClass: "BALLOT_CANDIDACY", scope: "US-AZ:2026-general" }], "only the state that moved");
  assert.deepEqual((await readReaderEdgeChanges(query)).pointers, moved.pointers, "unsaved, the change stays owed");
});

test("facts queued since the last publish call for every state's facts; a place queued before it does not, every minute", async () => {
  const { query } = await db();
  await query("INSERT INTO rebuild_queue (place_id, queued_at) VALUES ('ocd-division/country:us/state:az/place:tucson', now() - interval '1 day')");
  await (await readReaderEdgeChanges(query)).save();
  assert.equal((await readReaderEdgeChanges(query)).facts, false, "a stuck queue does not republish each minute");
  await query("INSERT INTO rebuild_queue (place_id, queued_at) VALUES ('ocd-division/country:us/state:az/place:mesa', now() + interval '1 second')");
  assert.equal((await readReaderEdgeChanges(query)).facts, true);
});
