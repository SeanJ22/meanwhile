import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { FEDERAL_KEY_VOTE_READER_PAYLOAD } from "../lib/civic-data/read-model.ts";
import { withReaderSelection } from "../lib/db/reader-route.ts";
import { readFederalKeyVotesProjection, getFederalKeyVotesReadModel } from "../lib/votes/key-votes-projection.ts";
import { FEDERAL_KEY_VOTE_SCOPE, FEDERAL_VOTES_SOURCE_ID } from "../lib/votes/data-plane.ts";
import { syntheticFederalKeyVotes } from "./helpers/promoted-fixtures.ts";
import { provenEdgeEntry } from "./helpers/promoted-edge-entry.ts";

test("key-vote slicing preserves the reviewed question catalog and returns only selected members' positions", async () => {
  const db = new PGlite();
  try {
    await db.exec("CREATE FUNCTION reader_payload_value(value jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE AS 'SELECT value'; CREATE TABLE key_vote_fixture(payload jsonb)");
    const entries = [{ id: "one", senate: [{ congress: 119, session: 1, rollNumber: 372 }] }, { id: "two" }];
    await db.query("INSERT INTO key_vote_fixture VALUES($1)", [{ snapshot: { entries }, positions: { fetchedAt: "2026-10-18",
      positions: { one: { "congress:K000377": "NO", "congress:C001098": "YES" }, two: { "congress:C001098": "NO" } },
      retiredMappings: { rejected: { "congress:C001098": "NO" } } } }]);
    const result = await db.query<{ value: { snapshot: { entries: unknown }; positions: { positions: unknown; retiredMappings?: unknown } } }>(
      `SELECT ${FEDERAL_KEY_VOTE_READER_PAYLOAD} AS value FROM key_vote_fixture p WHERE $1::text=$2::text`,
      ["test", "test", ["congress:K000377"]]);
    assert.deepEqual(result.rows[0]!.value.snapshot.entries, entries);
    assert.deepEqual(result.rows[0]!.value.positions.positions, { one: { "congress:K000377": "NO" }, two: {} });
    assert.equal(result.rows[0]!.value.positions.retiredMappings, undefined);
  } finally { await db.close(); }
});

test("concurrent places keep their key-vote readings in their own request", async () => {
  let release!: () => void;
  let ready = 0;
  const both = new Promise<void>(resolve => { release = resolve; });
  await Promise.all(["AZ", "TX"].map(state => withReaderSelection({ states: [state], keys: new Set() }, async () => {
    const base = syntheticFederalKeyVotes();
    const value = { ...base, positions: { ...base.positions, fetchedAt: state } };
    await readFederalKeyVotesProjection({ edge: provenEdgeEntry({ recordClass: "FEDERAL_KEY_VOTE", scope: FEDERAL_KEY_VOTE_SCOPE,
      sourceId: FEDERAL_VOTES_SOURCE_ID, versionId: `test:key-vote:${state}`, value }) });
    if (++ready === 2) release();
    await both;
    assert.equal(getFederalKeyVotesReadModel().positions.fetchedAt, state);
  })));
});
