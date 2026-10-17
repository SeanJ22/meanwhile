import assert from "node:assert/strict";
import test from "node:test";
import { readReaderEdgeChanges } from "../lib/civic-data/reader-edge-changes.ts";
import { edgeChangesDb } from "./helpers/fact-db.ts";

const later = (ms: number) => new Date(Date.now() + ms).toISOString();

test("the edge reads what was promoted or confirmed since it last published, and nothing when nothing moved", async () => {
  const { query, promote, confirm } = await edgeChangesDb();
  await promote("BALLOT_CANDIDACY", "US-AZ:2026-general", "2026-10-01T00:00:00Z");
  const people = await promote("STATE_LEGISLATOR", "US-NH", "2026-10-02T00:00:00Z");
  const first = await readReaderEdgeChanges(query);
  assert.equal(first.pointers.length, 2, "with no cursor, everything once");
  await first.save();
  assert.deepEqual((await readReaderEdgeChanges(query)).pointers, [], "an unchanged edge has nothing to publish");

  await promote("BALLOT_CANDIDACY", "US-AZ:2026-general", later(1_000));
  const moved = await readReaderEdgeChanges(query);
  assert.deepEqual(moved.pointers, [{ recordClass: "BALLOT_CANDIDACY", scope: "US-AZ:2026-general" }], "only the state that moved");
  assert.deepEqual((await readReaderEdgeChanges(query)).pointers, moved.pointers, "unsaved, the change stays owed");
  await moved.save();

  await confirm(people, later(2_000));
  assert.ok((await readReaderEdgeChanges(query)).pointers.some(row => row.recordClass === "STATE_LEGISLATOR" && row.scope === "US-NH"), "a confirmed version is owed too");
});

test("a publication killed part way resumes after the last piece it saved, then starts fresh once the cursor moves", async () => {
  const { query, promote } = await edgeChangesDb();
  await promote("MEETING", "US-AZ:pima", "2026-10-01T00:00:00Z");
  await promote("STATE_LEGISLATOR", "US-NH", "2026-10-01T00:00:00Z");
  const first = await readReaderEdgeChanges(query);
  assert.deepEqual([...first.done], []);
  await first.saveDone("meetings/AZ");

  const resumed = await readReaderEdgeChanges(query);
  assert.deepEqual([...resumed.done], ["meetings/AZ"], "the restart skips the saved piece");
  assert.equal(resumed.pointers.length, 2, "still from an empty cursor");
  await resumed.saveDone("state-legislators/US-NH");
  await resumed.save();

  const after = await readReaderEdgeChanges(query);
  assert.deepEqual(after.pointers, []);
  assert.deepEqual([...after.done], [], "progress belongs to the publication it was saved for");
  await promote("MEETING", "US-AZ:pima", later(1_000));
  const next = await readReaderEdgeChanges(query);
  await next.saveDone("meetings/AZ");
  await query("UPDATE pass_cursor SET position = $1 WHERE name = 'reader-edge'", [later(5_000)]);
  assert.deepEqual([...(await readReaderEdgeChanges(query)).done], [], "a cursor another publication moved discards stale progress");
});
