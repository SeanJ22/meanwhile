import type { CompositeSource } from "../sources/composite/index.ts";
import { buildCompositeSource } from "../sources/composite/wiring.ts";
import { mockSource } from "../sources/mock/index.ts";
import { makeSnapshotSource } from "../sources/snapshot/index.ts";
import type { MeetingsSnapshot } from "./snapshot.ts";
import type { Meeting, MeetingQuery, MeetingSource } from "../sources/types.ts";

/**
 * The one place that knows which adapter is serving meetings.
 *
 * Everything above this line — the query cascade, the API route, the map —
 * works against normalized Meeting records and cannot tell a test fixture
 * from a diagnostic live response from a canonical promoted projection.
 *
 * **The active production source is the canonical projection:** production
 * must not fan out to vendor portals per request, so the app composes the
 * proof-valid source/body pointers promoted by the standing runner.
 *
 * `WTP_MEETING_SOURCE` is a non-production diagnostic seam. Production
 * accepts only `snapshot`, whose implementation reads the canonical promoted
 * source/body pointers. `composite` may exercise live adapters locally and
 * `mock` is pinned by deterministic tests; neither can become a Reader
 * fallback through configuration.
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
  if (process.env.NODE_ENV === "production" && name !== "snapshot") {
    throw new Error(`PRODUCTION_MEETING_SOURCE_MUST_BE_CANONICAL:${name}`);
  }

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

/**
 * A resolved snapshot source over an ALREADY-composed snapshot (D.1).
 *
 * The API route reads and composes the canonical projection once, then hands
 * that snapshot to both the search cascade (through this source) and the
 * freshness metadata — instead of the snapshot source's default `load`, which
 * reads, validates and composes the 124-partition projection a second time. The
 * `load` is a constant, so `fetch()`/`normalize()` behave exactly as the
 * default does over the same snapshot.
 */
export function snapshotSourceFor(snapshot: MeetingsSnapshot): ResolvedMeetingSource {
  return resolve(makeSnapshotSource({ load: () => snapshot }));
}

// The snapshot freshness metadata accessor lives in lib/meetings/snapshot.ts
// (`getActiveSnapshotMeta`), not here: this module sits on the
// client-reachable import graph and must stay free of node:fs.
