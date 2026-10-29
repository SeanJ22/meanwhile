import assert from "node:assert/strict";
import test from "node:test";
import {migratedReaderDb} from "./helpers/migrated-reader-db.ts";
import {readKeyedSelection} from "../lib/civic-data/keyed-reader.ts";
import { withReaderSelection } from "../lib/db/reader-route.ts";
import { readFederalKeyVotesProjection, getFederalKeyVotesReadModel } from "../lib/votes/key-votes-projection.ts";
import { FEDERAL_KEY_VOTE_SCOPE, FEDERAL_VOTES_SOURCE_ID } from "../lib/votes/data-plane.ts";
import { syntheticFederalKeyVotes } from "./helpers/promoted-fixtures.ts";
import { provenEdgeEntry } from "./helpers/promoted-edge-entry.ts";

test("key-vote slicing preserves the reviewed question catalog and returns only selected members' positions", async () => {
  const {pg:db,publish}=await migratedReaderDb();
  try {
    const entries = [{ id: "one", senate: [{ congress: 119, session: 1, rollNumber: 372 }] }, { id: "two" }];
    await publish({id:'key-vote-v1',recordClass:'FEDERAL_KEY_VOTE',scope:FEDERAL_KEY_VOTE_SCOPE,sourceId:FEDERAL_VOTES_SOURCE_ID,at:'2026-10-20T00:00:00.000Z',value:{ snapshot: { entries }, positions: { fetchedAt: "2026-10-18",
      positions: { one: { "congress:K000377": "NO", "congress:C001098": "YES" }, two: { "congress:C001098": "NO" } },
      retiredMappings: { rejected: { "congress:C001098": "NO" } } } }});
    const result=await readKeyedSelection(async(text,params=[])=>(await db.query<Record<string,unknown>>(text,[...params])).rows,'FEDERAL_KEY_VOTE',FEDERAL_KEY_VOTE_SCOPE,['congress:K000377']);
    assert.equal(result.kind,'PROMOTED');if(result.kind!=='PROMOTED')return;
    const value=result.projection.payload as {snapshot:{entries:unknown};positions:{positions:unknown;retiredMappings?:unknown}};
    assert.deepEqual(value.snapshot.entries, entries);
    assert.deepEqual(value.positions.positions, { one: { "congress:K000377": "NO" }, two: {} });
    assert.equal(value.positions.retiredMappings, undefined);
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
