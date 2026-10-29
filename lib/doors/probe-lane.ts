/**
 * Door probes' own standing turn. One turn reads the open-door list once, then only its changed rows, and keeps
 * looking: every hot door that falls due is looked at, several websites side by side and never two requests at once
 * to one website, until each due door has had its look this hour or waits on its website. Then it sleeps until the
 * next door falls due. Every look goes through the shared per-website count (`pacedProbeFetch`), so each website's
 * hourly allowance, Retry-After and refusals hold exactly as for every other reader. A breaker pause or a release
 * drain stops new looks within the turn.
 */
import { ADMIN_CONFIG_ID, type AdminConfig } from "../control-plane/gateway/admin-config.ts";
import type { ControlPlaneRepositories } from "../control-plane/repository/types.ts";
import { websiteSizeFromHoldings, type WebsiteSizeForUrl } from "../control-plane/scheduler/host-supervision.ts";
import { HOST_CONCURRENCY_DEFAULT, HOST_CONCURRENCY_SETTING } from "../control-plane/scheduler/provider-limits.ts";
import { readSetting } from "../control-plane/settings.ts";
import { withDatabaseJob } from "../db/transfer-by-caller.ts";
import type { Query } from "../facts/publish.ts";
import { installMeetingClockFrom, MEETING_SETTING_DEFAULTS } from "../meetings/settings.ts";
import { stateOfPlace } from "../method/fix-map.ts";
import type { IndependentRuntimeLane } from "../ops/independent-runtime-pass.ts";
import { hotMeetingPartitions } from "./hot-partitions.ts";
import { nextProbeAtMs, probeHolds, runHourlyProbes, type ProbeRunReport } from "./hourly-check.ts";
import { doorPartitionIds } from "./mission-refresh.ts";
import type { ProbeFetch } from "./probe.ts";
import { pacedProbeFetch } from "./probe-fetch.ts";
import type { DoorRecord, DoorRepository } from "./registry.ts";
import { readRunnerDoors } from "./runner-reads.ts";

/** One turn. Its open-door list is read in full once, so a longer turn reads less. A look already started when it ends still finishes. */
export const DOOR_PROBE_TURN_MS = 60 * 60_000;
/** Doors (changed rows only) and hot partitions are read again this often within a turn. */
export const DOOR_PROBE_REFRESH_MS = 10 * 60_000;
/** Rounds start at least this far apart, so a door whose look cannot be stored is not asked again at once. */
export const DOOR_PROBE_ROUND_MS = 30_000;
/** A pause or a drain is noticed within this while the turn sleeps. */
const SLEEP_STEP_MS = 5_000;
/** A turn with nothing due says when its next look is, this often. */
const QUIET_LINE_MS = 5 * 60_000;
/** The lane's clock: a turn that ended is followed by the next within this. */
const DOOR_PROBE_LANE_EVERY_MS = 60_000;

/**
 * Its own meter, breaker and Admin release. Bytes per turn (one hour), from the Oct 28 21:00 UTC hour of this job:
 * the open-door list read in full once (4.0 MB), its changed rows on five refreshes (1.5 MB), six hot-partition
 * statements (0.3 MB), 1,399 hot doors' look writes at 5.2 KB (the door read and compare-and-set: 7.3 MB) and 504
 * pages' pacing rows at 4.6 KB (2.3 MB): 15.4 MB, with room for every hot partition's door.
 */
export const DOOR_PROBES_JOB = { id: "door-probes", databaseBytesPerRun: 18_000_000 } as const;

export function doorProbesLane(run: (deadlineMs: number) => Promise<void>): IndependentRuntimeLane {
  return { id: DOOR_PROBES_JOB.id, everyMs: DOOR_PROBE_LANE_EVERY_MS, budgetMs: DOOR_PROBE_TURN_MS, run };
}

export interface StandingDoorProbeInput {
  readonly repos: Pick<ControlPlaneRepositories, "adminConfig" | "doors" | "websitePacing">;
  /** The reader database, for the hot-partition statement. */
  readonly readerQuery: Query;
  /** The lane's deadline: no look starts after it. */
  readonly deadlineMs: number;
  /** False once the breaker pauses door-probes or the runner holds admissions for a release. */
  readonly admitted: () => boolean;
  readonly log: (line: string) => void;
  readonly fetchImpl?: typeof fetch;
  readonly clock?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
}

/**
 * One turn inside the standing runner's own process. It starts no child, so it never waits for host memory that bulk
 * workers hold: its memory is the open-door list's probe fields and a few pages in flight. Every database read is
 * metered under door-probes, so the breaker, Admin's pause and release and the hourly meter rows name it.
 */
export function runStandingDoorProbes(input: StandingDoorProbeInput): Promise<DoorProbeTurnReport> {
  return withDatabaseJob(DOOR_PROBES_JOB.id, async () => {
    const { repos } = input;
    // The owner's check clock (the hour, the seven-day window). The owner's in-flight bound (fetch.hostConcurrency) is how
    // many websites one turn looks at side by side; each website still has one request in flight at a time.
    const owner = (await repos.adminConfig.readNarrowed(ADMIN_CONFIG_ID,
      { settings: [HOST_CONCURRENCY_SETTING, ...Object.keys(MEETING_SETTING_DEFAULTS)] }))?.value as AdminConfig | null ?? null;
    installMeetingClockFrom(owner);
    const websites = readSetting(owner, HOST_CONCURRENCY_SETTING, HOST_CONCURRENCY_DEFAULT);
    let sizeFor: WebsiteSizeForUrl = () => null;
    let sizeStates = "";
    const report = await runDoorProbeTurn({
      repo: repos.doors,
      readDoors: async () => {
        const listed = await readRunnerDoors(repos.doors, ["status"], "OPEN", "probes");
        const states = [...new Set(listed.flatMap((door) => stateOfPlace(door.ocdId ?? "") ?? []))].sort();
        if (states.join() !== sizeStates) { sizeStates = states.join(); sizeFor = websiteSizeFromHoldings(states); }
        return listed;
      },
      readHot: (doors) => hotMeetingPartitions(input.readerQuery, (input.clock ?? Date.now)(), doors.flatMap(doorPartitionIds)),
      fetchFn: pacedProbeFetch({ pacing: repos.websitePacing, sizeFor: (url) => sizeFor(url), clock: input.clock, fetchImpl: input.fetchImpl }),
      websites,
      admitted: input.admitted,
      deadlineMs: input.deadlineMs,
      log: input.log,
      clock: input.clock,
      sleep: input.sleep,
    });
    input.log(`RCD_PROBE turn ended (${report.ended === "HELD" ? "paused or drained" : "its hour is up"}): ${report.rounds} round(s), ` +
      `${report.looked} door(s) looked at with ${report.requests} request(s); ${report.changed} changed, ${report.failed} failed, ${report.waiting} waited on their website`);
    return report;
  });
}

export interface DoorProbeTurnInput {
  readonly repo: DoorRepository;
  /** The open doors' probe fields: in full the first time, changed rows after. */
  readonly readDoors: () => Promise<readonly DoorRecord[]>;
  readonly readHot: (doors: readonly DoorRecord[]) => Promise<ReadonlySet<string>>;
  readonly fetchFn: ProbeFetch;
  /** Websites looked at side by side. */
  readonly websites: number;
  /** False once the breaker pauses door-probes or the runner drains for a release. */
  readonly admitted: () => boolean;
  readonly deadlineMs: number;
  readonly log: (line: string) => void;
  readonly clock?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
}

export interface DoorProbeTurnReport extends Omit<ProbeRunReport, "deferred"> {
  readonly rounds: number;
  readonly ended: "DEADLINE" | "HELD";
}

const at = (ms: number): string => new Date(ms).toISOString();

export async function runDoorProbeTurn(input: DoorProbeTurnInput): Promise<DoorProbeTurnReport> {
  const clock = input.clock ?? Date.now;
  const sleep = input.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const holds = probeHolds();
  const doors = new Map<string, DoorRecord>();
  let hot: ReadonlySet<string> = new Set();
  let readAt = Number.NEGATIVE_INFINITY;
  let quietLineAt = clock();
  const total = { looked: 0, changed: 0, unchanged: 0, failed: 0, waiting: 0, requests: 0, rounds: 0 };
  const ended = (why: DoorProbeTurnReport["ended"]): DoorProbeTurnReport => ({ ...total, ended: why });

  while (clock() < input.deadlineMs) {
    if (!input.admitted()) return ended("HELD");
    const roundAt = clock();
    if (roundAt - readAt >= DOOR_PROBE_REFRESH_MS) {
      const listed = await input.readDoors();
      doors.clear();
      for (const door of listed) doors.set(door.doorId, door);
      hot = await input.readHot(listed);
      readAt = roundAt;
    }
    try {
      const report = await runHourlyProbes(input.repo, [...doors.values()], hot, input.fetchFn, at(roundAt), {
        deadlineMs: input.deadlineMs, websites: input.websites, admitted: input.admitted, holds, clock,
        onRecorded: (doorId, validators) => {
          const door = doors.get(doorId);
          if (door) doors.set(doorId, { ...door, validators });
        },
      });
      total.rounds += 1;
      for (const key of ["looked", "changed", "unchanged", "failed", "waiting", "requests"] as const) total[key] += report[key];
      if (report.looked > 0 || report.waiting > 0) {
        quietLineAt = clock();
        input.log(`RCD_PROBE ${at(roundAt)} ${report.looked} door(s) looked at (${report.requests} request(s), up to ${input.websites} websites at once): ` +
          `${report.changed} changed, ${report.unchanged} the same, ${report.failed} failed; ` +
          `${report.waiting} waiting on their website's hour or its request to wait; ${report.deferred} not due`);
      }
    } catch (error) {
      input.log(`RCD_PROBE ${at(roundAt)} CANNOT_TELL — ${error instanceof Error ? error.message : String(error)}; the doors not stored are looked at again next round`);
    }
    const next = nextProbeAtMs([...doors.values()], hot, clock(), holds);
    const wake = Math.min(Math.max(next, roundAt + DOOR_PROBE_ROUND_MS), readAt + DOOR_PROBE_REFRESH_MS, input.deadlineMs);
    if (clock() - quietLineAt >= QUIET_LINE_MS) {
      quietLineAt = clock();
      input.log(`RCD_PROBE ${at(quietLineAt)} every due door has had its look or waits on its website; the next look is ${Number.isFinite(next) ? `at ${at(next)}` : "when a door turns hot"}`);
    }
    while (clock() < wake) {
      if (!input.admitted()) return ended("HELD");
      await sleep(Math.min(SLEEP_STEP_MS, wake - clock()));
    }
  }
  return ended("DEADLINE");
}
