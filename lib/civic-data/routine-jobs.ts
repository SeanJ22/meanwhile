import { storedKeyEnvironment } from "../core/keys-values.ts";
import { admitJobLaunch } from "../control-plane/job-breaker-local.ts";
import { withDatabaseJob } from "../db/transfer-by-caller.ts";

export interface RoutineJob {
  readonly id: string;
  readonly label: string;
  readonly databaseBytesPerRun: number;
}

/**
 * Work the routine and publish-now runners do in their own process. Each is metered under its own name and slows alone when it
 * reads far more than its normal. Source children and the reads made for one
 * source (its portrait list, its voting doors, its settlement) run under that source's task id. Bytes per run are the busiest
 * measured hour of the files each job calls (database_transfer_hourly, Oct 26–27); box-fact-audit and state-pointer-retirement
 * had no separate measurement and carry conservative figures.
 * Door sync/install declarations round up the CP-01 production-copy cold runs on Oct 28 (request plus response):
 * 2,603,964 and 14,631,412 bytes. Unchanged passes use 53,803 and 2,766 bytes, including a fresh repository instance.
 */
export const ROUTINE_JOBS = {
  doors: { id: "doors", label: "Door install", databaseBytesPerRun: 15_000_000 },
  doorSync: { id: "door-sync", label: "Door registry sync", databaseBytesPerRun: 3_000_000 },
  meetingPins: { id: "meeting-pins", label: "Meeting map pins", databaseBytesPerRun: 6_000_000 },
  boxFacts: { id: "box-facts", label: "Box findings publication", databaseBytesPerRun: 4_500_000 },
  workerPublication: { id: "worker-publication", label: "Saved worker results scan", databaseBytesPerRun: 40_000_000 },
  workerFacts: { id: "worker-facts", label: "Rosters and comment rules from workers", databaseBytesPerRun: 2_000_000 },
  doorPublication: { id: "door-publication", label: "Changed doors to publish", databaseBytesPerRun: 10_000_000 },
  readerEntityIds: { id: "reader-entity-ids", label: "Reader page ids", databaseBytesPerRun: 1_000_000 },
  factEntities: { id: "fact-entities", label: "Places and bodies for facts", databaseBytesPerRun: 6_000_000 },
  censusGoverningBodies: { id: "census-governing-bodies", label: "Census governing boards", databaseBytesPerRun: 1_000_000 },
  factCartons: { id: "fact-cartons", label: "Rosters, offices and comment rules onto facts", databaseBytesPerRun: 15_000_000 },
  electionResults: { id: "election-results", label: "Election results", databaseBytesPerRun: 1_000_000 },
  pageRefresh: { id: "page-refresh", label: "Pages past their refresh date", databaseBytesPerRun: 1_000_000 },
  boxFactAudit: { id: "box-fact-audit", label: "Published Box facts re-check", databaseBytesPerRun: 5_000_000 },
  statePointerRetirement: { id: "state-pointer-retirement", label: "Old state data cleanup", databaseBytesPerRun: 10_000_000 },
} as const satisfies Record<string, RoutineJob>;

/** In-process work runs under its own meter. A job slowed for reading far more than its normal skips a turn now and then; its fallback stands and its work stays owed. */
export async function runRoutineJob<T>(job: Pick<RoutineJob, "id">, run: () => Promise<T>, slowed: (id: string) => T,
  env: NodeJS.ProcessEnv = storedKeyEnvironment()): Promise<T> {
  if (!admitJobLaunch(job.id, env)) return slowed(job.id);
  return withDatabaseJob(job.id, run);
}
