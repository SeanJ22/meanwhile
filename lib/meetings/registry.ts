import type { CompositeSource } from "../sources/composite/index.ts";
import { buildCompositeSource } from "../sources/composite/wiring.ts";
import { resolveMeetingSource, type ResolvedMeetingSource } from "./snapshot-source.ts";

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
    source = resolveMeetingSource(activeComposite);
    resolved.set(name, source);
  }
  return source;
}

export function getActiveComposite(): CompositeSource | null {
  return activeComposite;
}


// This module is on the client-reachable import graph and must stay free of node:fs.
