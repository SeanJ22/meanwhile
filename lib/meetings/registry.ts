import type { CompositeSource } from "../sources/composite/index.ts";
import { buildCompositeSource } from "../sources/composite/wiring.ts";
import { mockSource } from "../sources/mock/index.ts";
import { makeSnapshotSource } from "../sources/snapshot/index.ts";
import type { Meeting, MeetingQuery, MeetingSource } from "../sources/types.ts";

/**
 * The one place that knows which adapter is serving meetings.
 *
 * Everything above this line — the query cascade, the API route, the map —
 * works against normalized Meeting records and cannot tell a fixture from a
 * live response from a committed file.
 *
 * **The active source is the snapshot** as of 2026-08-13: production must not
 * fan out to vendor portals per request (`lib/meetings/snapshot.ts` has the
 * two reasons), so the app reads the committed file the ingest refreshes.
 *
 * `WTP_MEETING_SOURCE` overrides:
 *   `snapshot`  — the committed file (the default)
 *   `composite` — the live fan-out, for local development against the real
 *                 vendors. Never the production path.
 *   `mock`      — fixtures; pinned by the cascade and zip-coverage tests so
 *                 the suite never touches the network.
 */

export interface ResolvedMeetingSource {
  readonly name: string;
  /** fetch + normalize, composed. */
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

/** The live composite instance, kept so its run report stays reachable. */
let activeComposite: CompositeSource | null = null;

export function getMeetingSource(): ResolvedMeetingSource {
  // Read per call rather than at module load, so a test can pin the mock
  // before its first query regardless of import order.
  const name = process.env.WTP_MEETING_SOURCE?.trim() || "snapshot";

  let source = resolved.get(name);
  if (!source) {
    if (name === "mock") {
      source = resolve(mockSource);
    } else if (name === "composite") {
      activeComposite = buildCompositeSource();
      source = resolve(activeComposite);
    } else {
      source = resolve(makeSnapshotSource());
    }
    resolved.set(name, source);
  }
  return source;
}

/**
 * The composite behind the active source, when the active source is the
 * composite — for the coverage report and any surface that renders the
 * per-source accounting. Null under the mock and under the snapshot.
 */
export function getActiveComposite(): CompositeSource | null {
  return activeComposite;
}

// The snapshot freshness metadata accessor lives in lib/meetings/snapshot.ts
// (`getActiveSnapshotMeta`), not here: this module sits on the
// client-reachable import graph and must stay free of node:fs.
