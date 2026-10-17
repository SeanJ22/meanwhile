import { readMeetingBodies, readReaderEdgeMeetings } from "../../lib/meetings/edge-serving.ts";
import type { MeetingRegistryRead } from "../../lib/meetings/body-publication.ts";
import type { MeetingIndexRow } from "../../lib/meetings/body-records.ts";
import { meetingIndexRowScope } from "../../lib/meetings/body-records.ts";
import { meetingSettingsFromValues } from "../../lib/meetings/settings.ts";
import type { RoutineDataStore } from "../../lib/civic-data/store.ts";
import type { ReaderArtifactStore } from "../../lib/meetings/edge-store.ts";
import { freshEdge, publishPass } from "./meeting-body-fixtures.ts";

/**
 * Everything promoted, served the way the per-body flow serves it: one publication pass, then every body of every
 * published state read and merged. For tests whose subject is what the partitions hold together, not one place.
 */
export async function readEveryBody(
  store: RoutineDataStore,
  now: string,
  options: { readonly window?: "SHOWN" | "HELD"; readonly includeAgenda?: boolean; readonly registry?: (state: string) => Promise<MeetingRegistryRead | null>; readonly edge?: ReaderArtifactStore } = {},
) {
  const edge = options.edge ?? freshEdge();
  const pass = await publishPass(store, edge, now, options.registry);
  const manifest = (await edge.readManifest())?.manifest ?? null;
  const settings = meetingSettingsFromValues();
  const states = Object.keys(manifest?.meetingStates ?? {});
  const bodyIds: string[] = [];
  for await (const body of readMeetingBodies({ store: edge, dataStore: store, manifest, states, now, settings })) bodyIds.push(body.bodyId);
  const read = await readReaderEdgeMeetings({
    store: edge, dataStore: store, manifest, states, bodyIds, now, settings,
    window: options.window ?? "HELD", includeAgenda: options.includeAgenda,
  });
  return { read, edge, plan: pass.plan, status: pass.status, bodyIds };
}

/** One state's published index, from its database row. */
export async function stateIndexOf(store: RoutineDataStore, state: string): Promise<MeetingIndexRow | null> {
  const row = await store.readPreparedReaderProjection("MEETING", meetingIndexRowScope(state));
  return row === null ? null : row.payload as MeetingIndexRow;
}

/** A read by body id: for a body whose door names no division, which no place resolves to. */
export function readBody(edge: ReaderArtifactStore, store: RoutineDataStore, now: string, bodyId: string, window: "SHOWN" | "HELD" = "SHOWN") {
  return readReaderEdgeMeetings({ store: edge, dataStore: store, bodyIds: [bodyId], now, settings: meetingSettingsFromValues(), window });
}
