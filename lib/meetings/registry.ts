import type { CompositeSource } from "../sources/composite/index.ts";
import { buildCompositeSource } from "../sources/composite/wiring.ts";
import { makeSnapshotSource } from "../sources/snapshot/index.ts";
import type { MeetingsSnapshot } from "./snapshot.ts";
import type { Meeting, MeetingQuery, MeetingSource } from "../sources/types.ts";

export interface ResolvedMeetingSource {
  readonly name: string;
  load(query: MeetingQuery, now?: Date): Promise<Meeting[]>;
}

function resolve<Raw>(source: MeetingSource<Raw>): ResolvedMeetingSource {
  return {
    name: source.name,
    async load(query, now) {
      const raw = await source.fetch(query);
      return source.normalize(raw, now);
    },
  };
}

const resolved = new Map<string, ResolvedMeetingSource>();

let activeComposite: CompositeSource | null = null;

export function getMeetingSource(): ResolvedMeetingSource {
  // Read per call rather than at module load, so a test can set it before its first query.
  const name = process.env.WTP_MEETING_SOURCE?.trim() || "snapshot";
  if (process.env.NODE_ENV === "production" && name !== "snapshot") {
    throw new Error(`PRODUCTION_MEETING_SOURCE_MUST_BE_CANONICAL:${name}`);
  }
  if (name !== "composite") throw new Error("MEETING_SNAPSHOT_SOURCE_NEEDS_A_PLACE_READ: build it with snapshotSourceFor");

  let source = resolved.get(name);
  if (!source) {
    activeComposite = buildCompositeSource();
    source = resolve(activeComposite);
    resolved.set(name, source);
  }
  return source;
}

export function getActiveComposite(): CompositeSource | null {
  return activeComposite;
}

export function snapshotSourceFor(snapshot: MeetingsSnapshot): ResolvedMeetingSource {
  return resolve(makeSnapshotSource({ load: () => snapshot }));
}

// This module is on the client-reachable import graph and must stay free of node:fs.
