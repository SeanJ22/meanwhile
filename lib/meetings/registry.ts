import { mockSource } from "../sources/mock/index.ts";
import type { Meeting, MeetingQuery, MeetingSource } from "../sources/types.ts";

/**
 * The one place that knows which adapter is serving meetings.
 *
 * Everything above this line — the query cascade, the API route, the map —
 * works against normalized Meeting records and cannot tell a fixture from a
 * Legistar response. Adding the real source means adding a directory under
 * lib/sources/ and changing `active` below.
 */

/**
 * A source with its upstream payload type sealed off.
 *
 * `Raw` is an implementation detail of a single adapter; letting it leak would
 * make every caller generic over a type it has no use for.
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

const active = resolve(mockSource);

export function getMeetingSource(): ResolvedMeetingSource {
  return active;
}
