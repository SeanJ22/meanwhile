import assert from "node:assert/strict";
import test from "node:test";

import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { meetingBodyRowScope, meetingIndexRowScope, type MeetingStateIndex } from "../lib/meetings/body-records.ts";
import { servedWholeFromReaderEdge } from "../lib/meetings/edge-serving.ts";
import type { ReaderArtifactStore } from "../lib/meetings/edge-store.ts";
import {
  NEWBURY, PIMA, T1, T2, T3, T4, at, countWrites, failedCheck, freshEdge, publishPass, readPartition, readPlace,
} from "./helpers/meeting-body-fixtures.ts";

const HOUR = 3_600_000;
const sittingsOf = (read: Awaited<ReturnType<typeof readPlace>>) => read.kind === "PROMOTED" ? read.value.meetings.map((meeting) => meeting.id).sort() : [];

async function twoBodies() {
  const store = new MemoryRoutineDataStore();
  const edge = freshEdge();
  await readPartition(store, PIMA, T1, ["a", "b"]);
  await readPartition(store, NEWBURY, T1, ["x"]);
  return { store, edge };
}

test("a place reads only its own bodies: another state's meetings never stand in", async () => {
  const { store, edge } = await twoBodies();
  const first = await publishPass(store, edge, at(T1, HOUR));
  assert.equal(first.status, "PUBLISHED");
  const bodiesIn = async (state: string) => Object.keys(((await store.readPreparedReaderProjection("MEETING", meetingIndexRowScope(state)))!.payload as MeetingStateIndex).bodies);
  assert.deepEqual(await bodiesIn("AZ"), [PIMA.bodyId]);
  assert.deepEqual(await bodiesIn("NH"), [NEWBURY.bodyId]);
  assert.deepEqual(await bodiesIn("CA"), [], "a state with no promoted body is published once, empty, and then left alone");

  const pima = await readPlace(edge, store, [PIMA.ocdId!], at(T1, HOUR));
  assert.equal(pima.kind, "PROMOTED");
  assert.equal(sittingsOf(pima).length, 2);
  assert.ok(sittingsOf(pima).every((id) => id.startsWith("legistar:")), "Pima's place holds Pima's sittings");
  const newbury = await readPlace(edge, store, [NEWBURY.ocdId!], at(T1, HOUR));
  assert.equal(sittingsOf(newbury).length, 1);
  assert.ok(sittingsOf(newbury).every((id) => id.startsWith("schedulepage:")));
  const elsewhere = await readPlace(edge, store, ["ocd-division/country:us/state:az/place:nowhere"], at(T1, HOUR));
  assert.deepEqual(sittingsOf(elsewhere), [], "a place with no body holds no meeting");
  assert.equal((await readPlace(edge, store, [], at(T1, HOUR))).kind, "NOT_RECORDED", "a read names a place or a body");
  assert.equal(servedWholeFromReaderEdge(pima), true);
});

test("an unchanged hour writes nothing: no record, no row, no index, and the queue is empty", async () => {
  const { store, edge } = await twoBodies();
  await publishPass(store, edge, at(T1, HOUR));
  assert.deepEqual(await store.readMeetingQueue(), [], "the first pass settled what it covered");

  const writes = countWrites(store, edge);
  const again = await publishPass(store, edge, at(T1, 2 * HOUR));
  writes.stop();
  assert.equal(again.status, "CURRENT");
  assert.deepEqual({ records: writes.records, rows: writes.rows }, { records: 0, rows: 0 });
  assert.deepEqual(again.plan.stats, { states: [], composed: 0, unchanged: 0, checkedOnly: 0, superseded: 0, recordsWritten: 0, rowsWritten: 0, indexesWritten: 0, bytesWritten: 0, failed: [] });
});

test("a quiet re-check moves Last checked for its own body and writes no record; a failed check moves nothing", async () => {
  const { store, edge } = await twoBodies();
  await publishPass(store, edge, at(T1, HOUR));
  const before = await readPlace(edge, store, [PIMA.ocdId!], at(T1, HOUR));
  assert.equal(before.kind === "PROMOTED" && before.value.generatedAt, T1);

  const receipt = await readPartition(store, PIMA, T2, ["a", "b"]);
  assert.ok(receipt.confirmed, "nothing new: a receipt on the same version");
  assert.deepEqual((await store.readMeetingQueue()).map((row) => row.scope), [PIMA.scope]);
  const writes = countWrites(store, edge);
  const pass = await publishPass(store, edge, at(T2, 5 * 60_000));
  writes.stop();
  assert.equal(pass.plan.stats.checkedOnly, 1);
  assert.equal(pass.plan.stats.recordsWritten, 0, "the body's record is not written for a check");
  assert.equal(pass.plan.stats.rowsWritten, 0);
  assert.equal(pass.plan.stats.indexesWritten, 1);
  assert.deepEqual(pass.plan.stats.states, ["AZ"], "Newbury's state is not touched");

  const pima = await readPlace(edge, store, [PIMA.ocdId!], at(T2, 5 * 60_000));
  assert.equal(pima.kind === "PROMOTED" && pima.value.generatedAt, T2);
  assert.ok(pima.kind === "PROMOTED" && pima.value.meetings.every((meeting) => meeting.provenance.collectedAt === T2), "Pima's listings say they were read then");
  const newbury = await readPlace(edge, store, [NEWBURY.ocdId!], at(T2, 5 * 60_000));
  assert.equal(newbury.kind === "PROMOTED" && newbury.value.generatedAt, T1);

  await failedCheck(store, NEWBURY, T3);
  assert.deepEqual(await store.readMeetingQueue(), [], "a failed request is not a check and queues nothing");
  const failed = await publishPass(store, edge, at(T3, 60_000));
  assert.equal(failed.status, "CURRENT");
  assert.equal(failed.plan.stats.indexesWritten, 0);
  const still = await readPlace(edge, store, [NEWBURY.ocdId!], at(T3, 60_000));
  assert.equal(still.kind === "PROMOTED" && still.value.generatedAt, T1);
});

test("a changed body rewrites only itself and its own state's index", async () => {
  const { store, edge } = await twoBodies();
  await publishPass(store, edge, at(T1, HOUR));
  const pima = (await store.readPreparedReaderProjection("MEETING", meetingIndexRowScope("AZ")))!;
  await readPartition(store, NEWBURY, T4, ["x", "y"]);
  const writes = countWrites(store, edge);
  const pass = await publishPass(store, edge, at(T4, 60_000));
  writes.stop();
  assert.deepEqual(pass.plan.stats.states, ["NH"]);
  assert.equal(pass.plan.stats.composed, 1);
  assert.equal(pass.plan.stats.recordsWritten, 1);
  assert.equal(pass.plan.stats.rowsWritten, 1, "the body's row");
  assert.equal(pass.plan.stats.indexesWritten, 1, "and its state's index");
  assert.equal((await store.readPreparedReaderProjection("MEETING", meetingIndexRowScope("AZ")))!.sequence, pima.sequence, "Arizona's index was not rewritten");

  const newbury = await readPlace(edge, store, [NEWBURY.ocdId!], at(T4, 60_000));
  assert.equal(sittingsOf(newbury).length, 2, "the new sitting reaches readers");
  assert.equal(newbury.kind === "PROMOTED" && newbury.value.generatedAt, T4);
  const row = await store.readPreparedReaderProjection("MEETING", meetingBodyRowScope("NH", NEWBURY.bodyId));
  assert.equal((row!.payload as { snapshot: { meetings: unknown[] } }).snapshot.meetings.length, 2);
});

test("an edge miss reads that one body's row by key, and the read is no longer held whole from the edge", async () => {
  const store = new MemoryRoutineDataStore();
  const edge = freshEdge();
  await readPartition(store, PIMA, T1, ["m1", "m2"]);
  await readPartition(store, NEWBURY, T1, ["m3"]);
  await publishPass(store, edge, at(T1, HOUR));
  const index = (await store.readPreparedReaderProjection("MEETING", meetingIndexRowScope("AZ")))!.payload as MeetingStateIndex;
  const lost = index.bodies[PIMA.bodyId]!.record.key;
  const missing: ReaderArtifactStore = Object.create(edge, { readBytes: { value: async (key: string) => key === lost ? null : edge.readBytes(key) } });
  const read = await readPlace(missing, store, [PIMA.ocdId!], at(T1, HOUR));
  assert.equal(sittingsOf(read).length, 2, "the body's row answers");
  assert.equal(servedWholeFromReaderEdge(read), false, "a database answer is not held by the CDN");
  const other = await readPlace(missing, store, [NEWBURY.ocdId!], at(T1, HOUR));
  assert.equal(servedWholeFromReaderEdge(other), true, "a body the edge holds is untouched");
});

test("a body touching two states keeps one id with a copy in each, and every meeting sits in exactly one body per state", async () => {
  const { store, edge } = await twoBodies();
  const shared = async () => ({ bodies: [{ id: PIMA.bodyId, ocdId: PIMA.ocdId, alsoServesOcdIds: [NEWBURY.ocdId!] }] });
  await publishPass(store, edge, at(T1, HOUR), shared);

  const az = (await store.readPreparedReaderProjection("MEETING", meetingIndexRowScope("AZ")))!.payload as MeetingStateIndex;
  const nh = (await store.readPreparedReaderProjection("MEETING", meetingIndexRowScope("NH")))!.payload as MeetingStateIndex;
  assert.deepEqual(Object.keys(az.bodies), [PIMA.bodyId]);
  assert.deepEqual(Object.keys(nh.bodies).sort(), [NEWBURY.bodyId, PIMA.bodyId].sort(), "one id, a copy in each state");
  assert.equal(az.bodies[PIMA.bodyId]!.record.sha, nh.bodies[PIMA.bodyId]!.record.sha, "the same record");
  const rowAz = await store.readPreparedReaderProjection("MEETING", meetingBodyRowScope("AZ", PIMA.bodyId));
  const rowNh = await store.readPreparedReaderProjection("MEETING", meetingBodyRowScope("NH", PIMA.bodyId));
  assert.ok(rowAz && rowNh, "a row per state");
  assert.equal(rowAz.factSha256, rowNh.factSha256);

  const ids = (index: MeetingStateIndex) => Object.values(index.bodies).length;
  assert.equal(ids(az), 1);
  const newburyPlace = await readPlace(edge, store, [NEWBURY.ocdId!], at(T1, HOUR));
  assert.equal(sittingsOf(newburyPlace).length, 3, "Newbury's place holds its own body and the body that serves it");
  const all = [az, nh].flatMap((index) => Object.keys(index.bodies));
  assert.equal(new Set(all).size, 2);
});
