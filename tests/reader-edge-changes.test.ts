import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { READER_EDGE_PAGE, readReaderEdgeChanges } from "../lib/civic-data/reader-edge-changes.ts";
import { publishReaderEdge, readerEdgePieceResultLine } from "../lib/civic-data/reader-edge-publication.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { LocalFileArtifactStore } from "../lib/meetings/edge-store.ts";
import type { BoundedChildLauncher } from "../lib/civic-data/bounded-child-pass.ts";
import { edgeChangesDb } from "./helpers/fact-db.ts";
import { PIECE_ENV } from "./helpers/reader-edge-pieces.ts";

const later = (ms: number) => new Date(Date.now() + ms).toISOString();

test("the edge reads what was promoted or confirmed since it last published, and nothing when nothing moved", async () => {
  const { query, promote, confirm } = await edgeChangesDb();
  await promote("BALLOT_CANDIDACY", "US-AZ:2026-general", "2026-10-01T00:00:00Z");
  const people = await promote("STATE_LEGISLATOR", "US-NH", "2026-10-02T00:00:00Z");
  const first = await readReaderEdgeChanges(query);
  assert.equal(first.pointers.length, 2, "with no cursor, everything once");
  await first.save(new Map());
  assert.deepEqual((await readReaderEdgeChanges(query)).pointers, [], "an unchanged edge has nothing to publish");

  await promote("BALLOT_CANDIDACY", "US-AZ:2026-general", later(1_000));
  const moved = await readReaderEdgeChanges(query);
  assert.deepEqual(moved.pointers, [{ recordClass: "BALLOT_CANDIDACY", scope: "US-AZ:2026-general" }], "only the state that moved");
  assert.deepEqual((await readReaderEdgeChanges(query)).pointers, moved.pointers, "unsaved, the change stays owed");
  await moved.save(new Map());

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
  await resumed.save(new Map());

  const after = await readReaderEdgeChanges(query);
  assert.deepEqual(after.pointers, []);
  assert.deepEqual([...after.done], [], "progress belongs to the publication it was saved for");
  await promote("MEETING", "US-AZ:pima", later(1_000));
  const next = await readReaderEdgeChanges(query);
  await next.saveDone("meetings/AZ");
  await query("UPDATE pass_cursor SET position = $1 WHERE name = 'reader-edge'", [later(5_000)]);
  assert.deepEqual([...(await readReaderEdgeChanges(query)).done], [], "a cursor another publication moved discards stale progress");
});

test("a piece that keeps failing stays owed on its own: the cursor moves, the rest stay current, and it is tried again within the hour", async t => {
  const { query, promote } = await edgeChangesDb();
  await promote("CURATED_READER_RECORD", "US-AZ:broken", "2026-10-01T00:00:00Z");
  await promote("CURATED_READER_RECORD", "US-NH:fine", "2026-10-01T00:00:00Z");
  const directory = mkdtempSync(join(tmpdir(), "reader-edge-owed-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const launched: string[] = [];
  const launch: BoundedChildLauncher = async command => {
    const piece = command.id.slice("reader-edge:".length), ok = piece !== "other-reader-data/AZ";
    launched.push(piece);
    return { id: command.id, status: 0, signal: null, termination: "EXITED", stderr: "", errorMessage: null,
      stdout: readerEdgePieceResultLine({ ok, readerEdge: ok ? "PUBLISHED" : "FAILED", store: "local folder", sequence: null, detail: ok ? null : "unreadable" }) };
  };
  const publish = () => publishReaderEdge({ store: new MemoryRoutineDataStore(), query, artifactStore: new LocalFileArtifactStore(directory),
    deadlineMs: Number.MAX_SAFE_INTEGER, env: PIECE_ENV, children: { launch, slots: { acquire: async () => () => {} } } });
  assert.equal((await publish()).readerEdge, "FAILED");
  assert.deepEqual(launched.sort(), ["other-reader-data/AZ", "other-reader-data/NH"]);
  const after = await readReaderEdgeChanges(query);
  assert.deepEqual(after.pointers, [], "the cursor moved past the failure");
  assert.deepEqual([...after.owed.keys()], ["other-reader-data/AZ"]);

  launched.length = 0;
  assert.equal((await publish()).readerEdge, "CURRENT", "within the hour the failed piece waits and nothing else is owed");
  assert.deepEqual(launched, []);
  await query("UPDATE pass_cursor SET position = $1 WHERE name = 'reader-edge:owed'", [JSON.stringify({ "other-reader-data/AZ": "2026-10-01T00:00:00Z" })]);
  assert.equal((await publish()).readerEdge, "FAILED");
  assert.deepEqual(launched, ["other-reader-data/AZ"], "an hour on, only the owed piece is tried");
  assert.equal(Date.parse([...(await readReaderEdgeChanges(query)).owed.values()][0]!) > Date.parse("2026-10-02T00:00:00Z"), true, "and its clock restarts");
});

test("a first read of a country-sized edge goes a page at a time, past pointers stamped at the same instant", async () => {
  const { query } = await edgeChangesDb();
  const total = READER_EDGE_PAGE + 7;
  await query(`INSERT INTO civic_data_candidates SELECT 'v' || g, 'MEETING', 'scope-' || g FROM generate_series(1, $1) g`, [total]);
  await query(`INSERT INTO civic_data_promotions SELECT 'MEETING:scope-' || g, 'MEETING', 'scope-' || g, 'v' || g, '2026-10-01T00:00:00Z' FROM generate_series(1, $1) g`, [total]);
  const first = await readReaderEdgeChanges(query);
  assert.equal(first.pointers.length, READER_EDGE_PAGE);
  assert.equal(first.more, true);
  await first.save(new Map());
  const second = await readReaderEdgeChanges(query);
  assert.equal(second.more, false);
  assert.equal(second.pointers.length, 7, "the page after the last saved pointer, though every one shares its instant");
  assert.equal(new Set([...first.pointers, ...second.pointers].map(row => row.scope)).size, total, "every pointer exactly once");
  await second.save(new Map());
  assert.deepEqual((await readReaderEdgeChanges(query)).pointers, [], "then the edge is current");
});
