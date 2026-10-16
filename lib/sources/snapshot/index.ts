import type { MeetingsSnapshot } from "../../meetings/snapshot.ts";
import type {
  Meeting,
  NormalizeDropCounts,
  ReportingMeetingSource,
} from "../types.ts";
import { accountedNormalize } from "../normalize-account.ts";

const ZERO_DROPS: NormalizeDropCounts = {
  placeless: 0,
  unknownVenue: 0,
  unplaceableInTime: 0,
  notConfigured: 0,
};

export interface SnapshotSourceOptions {
  /** Injectable for tests; production defaults to the canonical data plane. */
  load?: () => MeetingsSnapshot | null | Promise<MeetingsSnapshot | null>;
}

export function makeSnapshotSource(
  options: SnapshotSourceOptions = {},
): ReportingMeetingSource<Meeting> {
  // Imported inside fetch(): this module is on the client-reachable graph, and
  // a static `node:fs` import here breaks the client build.
  const load =
    options.load ??
    (async () => {
      const reader = await import("../../meetings/snapshot.ts");
      return reader.requireMeetingsProjection(await reader.readMeetingsProjection());
    });

  const normalize = (raw: Meeting[], now: Date = new Date()): Meeting[] =>
    raw.map((meeting) => {
      if (meeting.status === "CANCELED") return meeting;
      const status =
        Date.parse(meeting.startsAt) < now.getTime() ? "CONCLUDED" : "SCHEDULED";
      return meeting.status === status ? meeting : { ...meeting, status };
    });

  return {
    name: "snapshot",

    // The query is ignored on purpose: the snapshot holds everything the last
    // refresh saw; the query above selects the place’s divisions and time window.
    async fetch(): Promise<Meeting[]> {
      const snapshot = await load();
      if (!snapshot) {
        // A missing projection is a broken serving path, not an empty calendar — say
        // so instead of serving a plausible-looking empty map.
        throw new Error(
          "no meetings snapshot found in the promoted projection — run the standing routine civic-data runner",
        );
      }
      return snapshot.meetings;
    },

    normalize,

    normalizeWithDrops(raw: Meeting[], now?: Date) {
      // Drops were counted when the snapshot was generated. `normalize` is a
      // `map`, so the conservation check asserts the read path stays total.
      return accountedNormalize(
        "snapshot",
        raw,
        { meetings: normalize(raw, now), drops: { ...ZERO_DROPS } },
        { logicalInput: raw.length },
      );
    },

    async upsert(meetings: Meeting[]) {
      return { inserted: 0, updated: meetings.length };
    },
  };
}
