import {
  encodeMeetingBlob,
  MEETING_BODY_FORMAT_VERSION,
  meetingStateOf,
  placesOf,
  sha256OfJson,
  type MeetingBodyRecord,
  type MeetingIndexBody,
  type MeetingStateIndex,
} from "../../lib/meetings/body-records.ts";
import { publishReaderEdgeArtifacts, type PublishReaderExtras } from "../../lib/meetings/edge-serving.ts";
import type { ReaderArtifactStore } from "../../lib/meetings/edge-store.ts";
import { snapshotCounts } from "../../lib/meetings/snapshot.ts";
import type { Meeting } from "../../lib/sources/types.ts";

export interface EdgeBody {
  readonly bodyId: string;
  readonly divisions: readonly string[];
  readonly meetings: readonly Meeting[];
}

/** Publishes bodies straight to the edge as the writer would, with no partitions behind them: one record each, one index per state. */
export async function publishMeetingBodies(
  store: ReaderArtifactStore,
  now: string,
  bodies: readonly EdgeBody[],
  extras: PublishReaderExtras = { everydayRouting: null },
) {
  const byState = new Map<string, Record<string, MeetingIndexBody>>();
  for (const { bodyId, divisions, meetings } of bodies) {
    const snapshot = { formatVersion: 1 as const, generatedAt: now, counts: snapshotCounts([...meetings], 0), sources: [], meetings: [...meetings], agendaDocuments: [] };
    const record: MeetingBodyRecord = { formatVersion: MEETING_BODY_FORMAT_VERSION, bodyId, snapshot, agenda: null, history: null, sourceThrough: now, retrievedAt: now, promotedThrough: now };
    const entry: MeetingIndexBody = { record: await store.putImmutable(encodeMeetingBlob(record), "json.gz"), divisions: [...divisions], checks: { checkedAt: null, routes: {} } };
    for (const state of new Set(divisions.map((division) => meetingStateOf(division)))) byState.set(state, { ...byState.get(state), [bodyId]: entry });
  }
  const meetingStates = Object.fromEntries([...byState].map(([state, held]) => {
    const index: MeetingStateIndex = { formatVersion: MEETING_BODY_FORMAT_VERSION, state, places: placesOf(held), bodies: held };
    return [state, { versionId: sha256OfJson(index), value: index }];
  }));
  return publishReaderEdgeArtifacts({ store, now, extras, meetingStates });
}
