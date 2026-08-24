import type { MeetingsSnapshot } from "../../meetings/snapshot.ts";
import type {
  Meeting,
  NormalizeDropCounts,
  ReportingMeetingSource,
} from "../types.ts";
import { accountedNormalize } from "../normalize-account.ts";

/**
 * The snapshot-backed meeting source — what production serves.
 *
 * Reads the committed snapshot instead of fanning out to vendor portals per
 * request (see `lib/meetings/snapshot.ts` for why the fan-out cannot ship).
 * Everything above `lib/meetings/registry.ts` sees the same `Meeting` records
 * it would have seen live; the only observable difference is `generatedAt`,
 * which the UI renders as "last checked" rather than hiding.
 *
 * `normalize()` re-derives SCHEDULED/CONCLUDED from `now` rather than
 * trusting the statuses the snapshot froze: a snapshot generated Tuesday
 * still claims Wednesday's meeting is upcoming on Thursday. CANCELED is a
 * fact about the body's decision, not about the clock, so it survives.
 */

const ZERO_DROPS: NormalizeDropCounts = {
  placeless: 0,
  unknownVenue: 0,
  unplaceableInTime: 0,
  notConfigured: 0,
};

export interface SnapshotSourceOptions {
  /** Injectable for tests; defaults to the committed file. */
  load?: () => MeetingsSnapshot | null | Promise<MeetingsSnapshot | null>;
}

export function makeSnapshotSource(
  options: SnapshotSourceOptions = {},
): ReportingMeetingSource<Meeting> {
  // The file reader is imported inside fetch(), not at module top: this
  // module sits on the client-reachable graph (client components import
  // RADIUS_LADDER_KM from query.ts, which imports the registry, which builds
  // this source), and a static `node:fs` import here breaks the client build.
  const load =
    options.load ??
    (async () => (await import("../../meetings/snapshot.ts")).readSnapshot());

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
    // refresh saw, and the cascade above filters by time and radius itself.
    async fetch(): Promise<Meeting[]> {
      const snapshot = await load();
      if (!snapshot) {
        // A missing snapshot is a broken deploy, not an empty calendar — say
        // so instead of serving a plausible-looking empty map.
        throw new Error(
          "no meetings snapshot found — run `pnpm ingest composite` to generate data/meetings-snapshot.json",
        );
      }
      return snapshot.meetings;
    },

    normalize,

    normalizeWithDrops(raw: Meeting[], now?: Date) {
      // Drops were counted and recorded when the snapshot was generated; they
      // live in its per-source reports. Nothing is dropped on the read path.
      // A-002 · `normalize` is a `map`: every snapshot row becomes exactly one
      // meeting, and nothing is dropped on the read path. So the conservation
      // check here is a real assertion that the read path stays total, and it
      // is the cheapest place in the product to notice if it ever stops being.
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
