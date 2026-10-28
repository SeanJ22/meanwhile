/**
 * One door-probes turn, started by the standing runner's door-probes lane (scripts/pilot-runner.mts). Its database
 * reads are metered under door-probes, so the job breaker, Admin's pause and release and the hourly meter rows name it.
 */
import { readSetting } from "../lib/control-plane/settings.ts";
import { installMeetingClockFrom, MEETING_SETTING_DEFAULTS } from "../lib/meetings/settings.ts";
import { HOST_CONCURRENCY_DEFAULT, HOST_CONCURRENCY_SETTING } from "../lib/control-plane/scheduler/provider-limits.ts";
import { websiteSizeFromHoldings, type WebsiteSizeForUrl } from "../lib/control-plane/scheduler/host-supervision.ts";
import { ADMIN_CONFIG_ID, type AdminConfig } from "../lib/control-plane/gateway/admin-config.ts";
import { admitJobLaunch } from "../lib/control-plane/job-breaker-local.ts";
import { controlPlaneUrlFromEnv, createPgRepositories } from "../lib/control-plane/repository/pg-store.ts";
import { acquireProcessSingleton } from "../lib/civic-data/process-singleton.ts";
import { readerFactDb } from "../lib/facts/db.ts";
import { hotMeetingPartitions } from "../lib/doors/hot-partitions.ts";
import { doorPartitionIds } from "../lib/doors/mission-refresh.ts";
import { DOOR_PROBE_TURN_GRACE_MS, DOOR_PROBE_TURN_MS, DOOR_PROBES_JOB, DOOR_PROBES_SINGLETON_PORT, runDoorProbeTurn } from "../lib/doors/probe-lane.ts";
import { pacedProbeFetch } from "../lib/doors/probe-fetch.ts";
import { readRunnerDoors } from "../lib/doors/runner-reads.ts";
import { stateOfPlace } from "../lib/method/fix-map.ts";
import { passDeadlineFromEnv } from "../lib/ops/independent-runtime-pass.ts";
import { installNeonRequestDeadline } from "../lib/ops/neon-request-deadline.ts";

let drained = false;
process.on("message", (message) => {
  if ((message as { kind?: unknown } | null)?.kind === "RUNTIME_RELEASE_DRAIN") {
    drained = true;
    console.log("door probes: runtime release requested; the looks in flight finish and the turn ends");
  }
});
process.on("SIGTERM", () => { drained = true; });

installNeonRequestDeadline();
const connection = controlPlaneUrlFromEnv();
if (!connection || !process.env.DATABASE_URL) throw new Error("Door probes need the door registry and the reader database");
const singleton = await acquireProcessSingleton(DOOR_PROBES_JOB.id, DOOR_PROBES_SINGLETON_PORT);
try {
  const repos = await createPgRepositories(connection, new Date().toISOString(), { skipBootstrap: true });
  // The owner's check clock (the hour, the seven-day window). The owner's in-flight bound (fetch.hostConcurrency) is how many
  // websites one turn looks at side by side; each website still has one request in flight at a time.
  const owner = (await repos.adminConfig.readNarrowed(ADMIN_CONFIG_ID, { settings: [HOST_CONCURRENCY_SETTING, ...Object.keys(MEETING_SETTING_DEFAULTS)] }))?.value as AdminConfig | null ?? null;
  installMeetingClockFrom(owner);
  const websites = readSetting(owner, HOST_CONCURRENCY_SETTING, HOST_CONCURRENCY_DEFAULT);
  const facts = readerFactDb();
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
    readHot: (doors) => hotMeetingPartitions(facts.query, Date.now(), doors.flatMap(doorPartitionIds)),
    fetchFn: pacedProbeFetch({ pacing: repos.websitePacing, sizeFor: (url) => sizeFor(url) }),
    websites,
    admitted: () => !drained && admitJobLaunch(DOOR_PROBES_JOB.id),
    deadlineMs: Math.min(passDeadlineFromEnv() - DOOR_PROBE_TURN_GRACE_MS, Date.now() + DOOR_PROBE_TURN_MS),
    log: (line) => console.log(line),
  });
  console.log(`RCD_PROBE turn ended (${report.ended === "HELD" ? "paused or drained" : "its hour is up"}): ${report.rounds} round(s), ` +
    `${report.looked} door(s) looked at with ${report.requests} request(s); ${report.changed} changed, ${report.failed} failed, ${report.waiting} waited on their website`);
} finally {
  await singleton.release();
}
