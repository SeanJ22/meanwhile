import { PostgresRoutineDataStore, type RoutineDataStore } from "../civic-data/store.ts";
import { refuseDatabaseInEdgeOnlyContext, reportReaderStateFailure } from "../registry/runtime-edge.ts";
import {
  composeMeetingBodyHistory,
  meetingBodyRowScope,
  meetingIndexRowScope,
  type MeetingBodyRow,
  readerIndexOf,
  type MeetingIndexRow,
  type MeetingStateIndex,
} from "./body-records.ts";
import { MEETINGS_RECORD_CLASS, type MeetingsSnapshot } from "./snapshot.ts";

type RowStore = Pick<RoutineDataStore, "readPreparedReaderProjection" | "readPromotions">;

/** A state's meeting index, read by key from the database after the edge could not supply it. */
export async function readMeetingIndexRow(state: string, store?: RowStore): Promise<MeetingStateIndex | null> {
  const scope = meetingIndexRowScope(state);
  refuseDatabaseInEdgeOnlyContext(`${MEETINGS_RECORD_CLASS}:${scope}`);
  try {
    const row = await (store ?? new PostgresRoutineDataStore()).readPreparedReaderProjection(MEETINGS_RECORD_CLASS, scope);
    return row === null ? null : readerIndexOf(row.payload as MeetingIndexRow);
  } catch (error) {
    reportReaderStateFailure("meeting-index", state, scope, error, "DATABASE");
    return null;
  }
}

/** One body's row in one state, read by key after the edge could not supply its record. */
export async function readMeetingBodyRow(state: string, bodyId: string, store?: RowStore): Promise<MeetingBodyRow | null> {
  const scope = meetingBodyRowScope(state, bodyId);
  refuseDatabaseInEdgeOnlyContext(`${MEETINGS_RECORD_CLASS}:${scope}`);
  try {
    const row = await (store ?? new PostgresRoutineDataStore()).readPreparedReaderProjection(MEETINGS_RECORD_CLASS, scope);
    return row === null ? null : row.payload as MeetingBodyRow;
  } catch (error) {
    reportReaderStateFailure("meeting-body", state, scope, error, "DATABASE");
    return null;
  }
}

/** A body's kept past sittings, from the history partitions its row names. */
export async function readMeetingBodyHistory(row: MeetingBodyRow, store?: RowStore): Promise<MeetingsSnapshot | null> {
  if (row.historyScopes.length === 0) return null;
  refuseDatabaseInEdgeOnlyContext(`${MEETINGS_RECORD_CLASS}:${row.historyScopes[0]}`);
  try {
    const held = await (store ?? new PostgresRoutineDataStore()).readPromotions<MeetingsSnapshot>(MEETINGS_RECORD_CLASS, row.historyScopes);
    return composeMeetingBodyHistory(row.bodyId, held.map((pointer) => ({ contractId: pointer.scope, scope: pointer.scope, versionId: pointer.versionId, value: pointer.payload })), row.snapshot.generatedAt);
  } catch (error) {
    reportReaderStateFailure("meeting-history", null, row.historyScopes[0] ?? null, error, "DATABASE");
    return null;
  }
}
