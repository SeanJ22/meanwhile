import { makeSnapshotSource } from "../sources/snapshot/index.ts";
import type { MeetingsSnapshot } from "./snapshot.ts";
import type { Meeting, MeetingQuery, MeetingSource } from "../sources/types.ts";

export interface ResolvedMeetingSource {
  readonly name: string;
  load(query: MeetingQuery, now?: Date): Promise<Meeting[]>;
}

export function resolveMeetingSource<Raw>(source: MeetingSource<Raw>): ResolvedMeetingSource {
  return { name: source.name, async load(query, now) { return source.normalize(await source.fetch(query), now); } };
}

export function snapshotSourceFor(snapshot: MeetingsSnapshot): ResolvedMeetingSource {
  return resolveMeetingSource(makeSnapshotSource({ load: () => snapshot }));
}
