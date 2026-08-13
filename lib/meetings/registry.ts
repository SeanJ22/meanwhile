import type { CompositeSource } from "../sources/composite/index.ts";
import { buildCompositeSource } from "../sources/composite/wiring.ts";
import { mockSource } from "../sources/mock/index.ts";
import type { Meeting, MeetingQuery, MeetingSource } from "../sources/types.ts";

/**
 * The one place that knows which adapter is serving meetings.
 *
 * Everything above this line — the query cascade, the API route, the map —
 * works against normalized Meeting records and cannot tell a fixture from a
 * live response.
 *
 * **The active source is the composite** as of the 2026-08 reprioritization:
 * four zips across three states admit no single vendor, which answered the
 * composite-versus-hold-the-mock question (`docs/state.md` §5.2 item 1). The
 * mock stays in the repo and stays selectable, because the cascade and
 * zip-coverage tests exercise the *mechanism* against fixtures and must never
 * touch the network — they pin `WTP_MEETING_SOURCE=mock` before querying.
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
  const name = process.env.WTP_MEETING_SOURCE?.trim() || "composite";

  let source = resolved.get(name);
  if (!source) {
    if (name === "mock") {
      source = resolve(mockSource);
    } else {
      activeComposite = buildCompositeSource();
      source = resolve(activeComposite);
    }
    resolved.set(name, source);
  }
  return source;
}

/**
 * The composite behind the active source, when the active source is the
 * composite — for the coverage report and any surface that renders the
 * per-source accounting. Null under the mock.
 */
export function getActiveComposite(): CompositeSource | null {
  return activeComposite;
}
