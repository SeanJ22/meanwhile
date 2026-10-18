import assert from "node:assert/strict";
import test from "node:test";

import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { meetingBodyRowScope, meetingIndexRowScope, type MeetingIndexRow } from "../lib/meetings/body-records.ts";
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
  const bodiesIn = async (state: string) => Object.keys(((await store.readPreparedReaderProjection("MEETING", meetingIndexRowScope(state)))!.payload as MeetingIndexRow).bodies);
  assert.deepEqual(await bodiesIn("AZ"), [PIMA.bodyId]);
  assert.deepEqual(await bodiesIn("NH"), [NEWBURY.bodyId]);
  assert.equal(await store.readPreparedReaderProjection("MEETING", meetingIndexRowScope("CA")), null, "a state with no promoted meeting has no piece and no index");

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
  assert.deepEqual(again.plan.stats, { states: [], composed: 0, unchanged: 0, checkedOnly: 0, superseded: 0, recordsWritten: 0, rowsWritten: 0, pointersWritten: 0, indexesWritten: 0, bytesWritten: 0, failed: [] });
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
  assert.equal(pass.plan.stats.indexesWritten, 0, "a check moves the body's pointer, not its state's index");
  assert.equal(pass.plan.stats.pointersWritten, 1);
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

test("a changed body rewrites only itself: its record, its row and its pointer", async () => {
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
  assert.equal(pass.plan.stats.pointersWritten, 1);
  assert.equal(pass.plan.stats.indexesWritten, 0, "the state's index moves only when a body comes or goes");
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
  await readPartition(store, PIMA, T1, ["lost1", "lost2"]);
  await readPartition(store, NEWBURY, T1, ["lost3"]);
  await publishPass(store, edge, at(T1, HOUR));
  const lost = (await bodyPointerOf(edge, "AZ", PIMA.bodyId))!.record;
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

  const az = (await store.readPreparedReaderProjection("MEETING", meetingIndexRowScope("AZ")))!.payload as MeetingIndexRow;
  const nh = (await store.readPreparedReaderProjection("MEETING", meetingIndexRowScope("NH")))!.payload as MeetingIndexRow;
  assert.deepEqual(Object.keys(az.bodies), [PIMA.bodyId]);
  assert.deepEqual(Object.keys(nh.bodies).sort(), [NEWBURY.bodyId, PIMA.bodyId].sort(), "one id, a copy in each state");
  assert.equal((await bodyPointerOf(edge, "AZ", PIMA.bodyId))!.record, (await bodyPointerOf(edge, "NH", PIMA.bodyId))!.record, "the same record");
  const rowAz = await store.readPreparedReaderProjection("MEETING", meetingBodyRowScope("AZ", PIMA.bodyId));
  const rowNh = await store.readPreparedReaderProjection("MEETING", meetingBodyRowScope("NH", PIMA.bodyId));
  assert.ok(rowAz && rowNh, "a row per state");
  assert.equal(rowAz.factSha256, rowNh.factSha256);

  const ids = (index: MeetingIndexRow) => Object.values(index.bodies).length;
  assert.equal(ids(az), 1);
  const newburyPlace = await readPlace(edge, store, [NEWBURY.ocdId!], at(T1, HOUR));
  assert.equal(sittingsOf(newburyPlace).length, 3, "Newbury's place holds its own body and the body that serves it");
  const all = [az, nh].flatMap((index) => Object.keys(index.bodies));
  assert.equal(new Set(all).size, 2);
});

import { meetingHistoryScope } from "../lib/civic-data/meeting-partitions.ts";
import { promotedInputRef } from "../lib/civic-data/derived-authority.ts";
import { buildMeetingHistorySnapshot, meetingHistoryCandidate, moveConcludedMeetingsToHistory, readMeetingHistory } from "../lib/civic-data/meeting-history.ts";
import { processRegisteredMeetingHistoryCandidate } from "../lib/civic-data/promotion.ts";
import type { RoutineRecordClass } from "../lib/civic-data/types.ts";
import { readMeetingPartitionProjection } from "../lib/meetings/snapshot.ts";
import { promoteRows } from "./helpers/reader-edge-meetings.ts";
import { row } from "./helpers/meeting-body-fixtures.ts";
import { bodyPointerOf } from "./helpers/meeting-body-national.ts";
import type { Meeting } from "../lib/sources/types.ts";

test("a body's rows are written monotonically: an older composition can never overwrite a newer one", async () => {
  const { store, edge } = await twoBodies();
  await publishPass(store, edge, at(T1, HOUR));
  const scope = meetingBodyRowScope("AZ", PIMA.bodyId);
  const held = (await store.readPreparedReaderProjection("MEETING", scope))!;
  const input = (generatedAt: string) => ({ ...held, payload: held.payload, composedFrom: held.composedFrom, generatedAt, composedAt: generatedAt });

  const stale = await store.writePreparedReaderProjection(input("2026-08-01T00:00:00.000Z"), null);
  assert.equal(stale.published, false, "a null-expected write over an existing row is refused");
  assert.equal(stale.sequence, held.sequence, "the newer row is untouched");

  const advance = await store.writePreparedReaderProjection(input("2026-09-02T00:00:00.000Z"), held.sequence);
  assert.deepEqual(advance, { published: true, sequence: held.sequence + 1 });
  const casMiss = await store.writePreparedReaderProjection(input("2026-08-15T00:00:00.000Z"), held.sequence);
  assert.equal(casMiss.published, false, "a write at a superseded sequence cannot regress the row");
  assert.equal(casMiss.sequence, held.sequence + 1);
  assert.equal((await store.readPreparedReaderProjection("MEETING", scope))?.generatedAt, "2026-09-02T00:00:00.000Z", "the newest composition is what serves");
});

test("an unchanged pass opens no partition: the index, not the payloads, decides it", async () => {
  class OpenCountingStore extends MemoryRoutineDataStore {
    opened = 0;
    override async readPromotion<T = unknown>(recordClass: RoutineRecordClass, scope: string) { this.opened += 1; return super.readPromotion<T>(recordClass, scope); }
    override async readPromotions<T = unknown>(recordClass: RoutineRecordClass, scopes: readonly string[]) { this.opened += 1; return super.readPromotions<T>(recordClass, scopes); }
    override async readCandidates(ids: readonly string[]) { this.opened += 1; return super.readCandidates(ids); }
  }
  const store = new OpenCountingStore();
  const edge = freshEdge();
  await readPartition(store, PIMA, T1, ["a", "b"]);
  await publishPass(store, edge, at(T1, HOUR));
  assert.ok(store.opened > 0, "the first pass reads what it composes");
  store.opened = 0;
  const again = await publishPass(store, edge, at(T1, 2 * HOUR));
  assert.equal(again.status, "CURRENT");
  assert.equal(store.opened, 0);
});

test("a carried sitting is counted as carried in its body's record, with its reason", async () => {
  const { store, edge } = await twoBodies();
  await readPartition(store, PIMA, T2, ["a"]);
  await publishPass(store, edge, at(T2, HOUR));
  const pima = await readPlace(edge, store, [PIMA.ocdId!], at(T2, HOUR));
  assert.equal(pima.kind, "PROMOTED");
  if (pima.kind !== "PROMOTED") return;
  assert.deepEqual([pima.value.counts.fresh, pima.value.counts.carried, pima.value.counts.total], [1, 1, 2]);
  const gone = pima.value.meetings.find((meeting) => meeting.id.endsWith(":b"));
  assert.equal(gone?.carried?.reason, "UNEXPLAINED_DISAPPEARANCE");
  assert.equal(pima.value.sources.reduce((sum, source) => sum + (source.carriedForward ?? 0), 0), 1);
  const newbury = await readPlace(edge, store, [NEWBURY.ocdId!], at(T2, HOUR));
  assert.equal(newbury.kind === "PROMOTED" && newbury.value.counts.carried, 0, "another body's counts are its own");
});

test("history-only changes republish the body, and an unreadable history keeps its accepted record and version", async () => {
  class HistoryUnreadableStore extends MemoryRoutineDataStore {
    unreadable = false;
    override async readPromotion<T = unknown>(recordClass: RoutineRecordClass, scope: string) {
      if (this.unreadable && scope === meetingHistoryScope(PIMA.scope)) throw new Error("history store unavailable");
      return super.readPromotion<T>(recordClass, scope);
    }
  }
  const old = (suffix: string, startsAt: string): Meeting => ({ ...row(PIMA, suffix, startsAt, T1), status: "CONCLUDED", agendaUrl: `https://example.gov/agenda/${suffix}` });
  const store = new HistoryUnreadableStore();
  const edge = freshEdge();
  await promoteRows(store, PIMA, [old("first", "2026-02-01T17:00:00.000Z"), row(PIMA, "live", "2026-10-10T17:00:00.000Z", T1)], [], T1);
  const live = (await readMeetingPartitionProjection(PIMA, { store, now: T2, bypassCache: true }))!;
  assert.equal(live.kind, "PROMOTED");
  const door = (candidate: Parameters<typeof processRegisteredMeetingHistoryCandidate>[2], now: string) => processRegisteredMeetingHistoryCandidate(store, PIMA.id, candidate, now);
  const moved = await moveConcludedMeetingsToHistory({ store, partition: PIMA, previous: live.kind === "PROMOTED" ? live.value : null, generatedAt: T2, door });
  assert.equal(moved.outcome, "MOVED", moved.detail);

  const ids = async (window: "HELD" | "SHOWN" = "HELD") => {
    const read = await readPlace(edge, store, [PIMA.ocdId!], at(T2, HOUR), { window });
    return read.kind === "PROMOTED" ? read.value.meetings.map((meeting) => meeting.id.split(":").at(-1)).sort() : [];
  };
  const first = await publishPass(store, edge, at(T2, HOUR));
  assert.equal(first.status, "PUBLISHED");
  assert.deepEqual(await ids(), ["first", "live"], "the kept past sitting is served with the live window");
  assert.deepEqual(await ids("SHOWN"), ["live"]);
  const accepted = (await bodyPointerOf(edge, "AZ", PIMA.bodyId))!.composition;

  // A second kept sitting reaches history alone: the live partition does not move.
  const history = await readMeetingHistory(PIMA, { store, now: T3 });
  assert.equal(history.kind, "PROMOTED");
  if (history.kind !== "PROMOTED") return;
  const inputs = [
    promotedInputRef("MEETING", PIMA.scope, live.metadata.versionId, live.value, live.metadata.promotedAt)!,
    promotedInputRef("MEETING", meetingHistoryScope(PIMA.scope), history.metadata.versionId, history.value, history.metadata.promotedAt)!,
  ];
  const grown = buildMeetingHistorySnapshot({ history: history.value, moved: [old("second", "2026-02-02T17:00:00.000Z")], agendaDocuments: [], generatedAt: T3 });
  const promoted = await door(meetingHistoryCandidate(PIMA, grown, inputs), T3);
  assert.ok(promoted.promoted, promoted.candidate.failureDetail ?? "");
  assert.deepEqual((await store.readMeetingQueue()).map((entry) => entry.scope), [meetingHistoryScope(PIMA.scope)], "only the history moved");
  const second = await publishPass(store, edge, at(T3, HOUR));
  assert.equal(second.plan.stats.composed, 1);
  assert.equal(second.plan.stats.recordsWritten, 1);
  assert.deepEqual(await ids(), ["first", "live", "second"]);
  const republished = (await bodyPointerOf(edge, "AZ", PIMA.bodyId))!.composition;
  assert.notEqual(republished, accepted);

  // A third history version cannot be read: the body keeps what it accepted, and the partition stays queued.
  const again = buildMeetingHistorySnapshot({ history: grown, moved: [old("third", "2026-02-03T17:00:00.000Z")], agendaDocuments: [], generatedAt: T4 });
  const nextInputs = [inputs[0]!, promotedInputRef("MEETING", meetingHistoryScope(PIMA.scope), promoted.promoted.versionId, grown, promoted.promoted.promotedAt)!];
  assert.ok((await door(meetingHistoryCandidate(PIMA, again, nextInputs), T4)).promoted);
  store.unreadable = true;
  const refused = await publishPass(store, edge, at(T4, HOUR));
  assert.deepEqual(refused.plan.stats.failed.map((failure) => failure.bodyId), [PIMA.bodyId]);
  assert.match(refused.plan.stats.failed[0]!.error, /MEETING_HISTORY_UNREADABLE/);
  store.unreadable = false;
  assert.deepEqual(await ids(), ["first", "live", "second"], "the accepted records keep serving");
  assert.equal((await bodyPointerOf(edge, "AZ", PIMA.bodyId))!.composition, republished, "a failed read never claims the new history version");
  assert.deepEqual((await store.readMeetingQueue()).map((entry) => entry.scope), [meetingHistoryScope(PIMA.scope)]);

  const healed = await publishPass(store, edge, at(T4, 2 * HOUR));
  assert.equal(healed.plan.stats.recordsWritten, 1);
  assert.deepEqual(await ids(), ["first", "live", "second", "third"]);
});
