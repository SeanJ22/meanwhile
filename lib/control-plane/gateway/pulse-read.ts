import { RUNNER_ID, SNAPSHOT_ID } from "../admin-data.ts";
import { HUNT_SOURCE_PROGRESS_LOG_KEY, livenessOf, type OwnerSnapshot } from "../owner-surface.ts";
import { pulseRevision, type LivePulse } from "../live-pulse.ts";
import { ADMIN_CAPABILITIES } from "../admin-view/capabilities.ts";
import { adminV6ReadCapabilities, ADMIN_V6_CAPABILITY_REVISION } from "../admin-view/v6-capabilities.ts";
import { ADMIN_CONFIG_ID } from "./admin-config.ts";
import { ADMIN_RECEIPT_LOG_KEY } from "./contract.ts";
import { AGENT_JOB_LOG_KEY, liveJobCount } from "./agent-job.ts";
import { RESEARCH_STATE_ID } from "../scheduler/research-policy.ts";
import { RESEARCH_INTENT_LOG_KEY } from "../scheduler/research-policy.ts";
import { pulseLanesOf } from "../scheduler/lane-reading.ts";
import type { ControlPlaneRepositories, RecordProjection } from "../repository/types.ts";
import { placeReadConnection } from "../repository/pg-store.ts";

/** `failed` means we could not ask, which differs from an answer of nothing. */
type Reading<T> = { readonly value: T | null; readonly unread: string | null; readonly failed: boolean };

async function reading<T>(name: string, read: () => Promise<T | null>): Promise<Reading<T>> {
  try {
    const value = await read();
    return value === null
      ? { value: null, unread: `${name} (nothing published yet)`, failed: false }
      : { value, unread: null, failed: false };
  } catch {
    // The error is not carried: a driver message can contain the connection string.
    return { value: null, unread: `${name} (could not be read just now)`, failed: true };
  }
}

/** The fields the pulse reads; Postgres narrows each row to these before it leaves the store. */
export const PULSE_SNAPSHOT_FIELDS = {
  freshnessDebtRows: true,
  incidents: true,
  obligationsByState: true,
} as const satisfies RecordProjection & Partial<Record<keyof OwnerSnapshot, true>>;
export const PULSE_RESEARCH_FIELDS = { queue: ["lanes"] } as const satisfies RecordProjection;
/** Money/Hunts need only the saved policy revision on each pulse, no policy payload. */
export const PULSE_CONFIG_REVISION_FIELDS = {} as const satisfies RecordProjection;

type PulseSnapshot = Pick<OwnerSnapshot, keyof typeof PULSE_SNAPSHOT_FIELDS>;

/** Counts are calculated in PostgreSQL; none of these append-only logs crosses the wire. */
async function pulseLogCounts(repos: ControlPlaneRepositories) {
  const sql = placeReadConnection(repos);
  if (!sql) {
    const [receipts, intents, jobs] = await Promise.all([repos.adminReceipts.read(ADMIN_RECEIPT_LOG_KEY),
      repos.researchIntents.read(RESEARCH_INTENT_LOG_KEY), repos.agentJobs.read(AGENT_JOB_LOG_KEY)]);
    return { receipts: receipts.length, intents: intents.length, jobs: liveJobCount(jobs) };
  }
  const [row] = await sql.query(`WITH jobs AS (SELECT DISTINCT ON
      (CASE WHEN jsonb_typeof(record->'jobId')='string' AND record->>'jobId'<>'' THEN record->>'jobId' ELSE record_id END)
      record FROM cp_log_agent_jobs WHERE log_key=$3
      ORDER BY CASE WHEN jsonb_typeof(record->'jobId')='string' AND record->>'jobId'<>'' THEN record->>'jobId' ELSE record_id END,position DESC)
    SELECT (SELECT count(*)::text FROM cp_log_admin_receipts WHERE log_key=$1) AS receipts,
      (SELECT count(*)::text FROM cp_log_research_intents WHERE log_key=$2) AS intents,
      count(*) FILTER (WHERE record->>'status' IN ('REQUESTED','RUNNING'))::text AS running,
      count(*) FILTER (WHERE (record->>'status' IN ('REQUESTED','RUNNING','DONE','REFUSED','FAILED')) IS NOT TRUE)::text AS unreadable FROM jobs`,
    [ADMIN_RECEIPT_LOG_KEY, RESEARCH_INTENT_LOG_KEY, AGENT_JOB_LOG_KEY]) as Record<string,unknown>[];
  return { receipts:Number(row.receipts),intents:Number(row.intents),jobs:{running:Number(row.running),unreadable:Number(row.unreadable)} };
}

function countsFrom(snapshot: PulseSnapshot | null): {
  readonly freshnessDebtRows: number | null;
  readonly incidents: number | null;
  readonly obligations: number | null;
  readonly unread: readonly string[];
} {
  if (snapshot === null) return { freshnessDebtRows: null, incidents: null, obligations: null, unread: [] };
  const unread: string[] = [];
  const debt = snapshot.freshnessDebtRows.held ? snapshot.freshnessDebtRows.value.value : null;
  if (debt === null) unread.push("how much freshness debt is outstanding (the last publish could not measure it)");
  return {
    freshnessDebtRows: debt,
    incidents: snapshot.incidents.length,
    obligations: snapshot.obligationsByState.reduce((sum, row) => sum + row.count.value, 0),
    unread,
  };
}

export async function readPulse(
  repos: ControlPlaneRepositories,
  nowIso: string,
): Promise<LivePulse> {
  const [heartbeat, snapshot, research, logs, sourceProgress, config] = await Promise.all([
    reading("the runner's heartbeat", async () => (await repos.runnerHeartbeat.readNarrowed(RUNNER_ID,
      {beatAt:true,lastCycleFinishedAt:true,nextCycleDueAt:true})) ?? null),
    reading("the control centre snapshot", async () => (await repos.ownerSnapshots.readNarrowed(SNAPSHOT_ID, PULSE_SNAPSHOT_FIELDS)) ?? null),
    reading("the research lane's state", async () => (await repos.researchState.readNarrowed(RESEARCH_STATE_ID, PULSE_RESEARCH_FIELDS)) ?? null),
    reading("orders, jobs and research requests", () => pulseLogCounts(repos)),
    reading("shared source activity", async () => (await repos.ownerDigests.readLatest([HUNT_SOURCE_PROGRESS_LOG_KEY],{digestId:true})).get(HUNT_SOURCE_PROGRESS_LOG_KEY) as {digestId:string} | undefined ?? {digestId:null}),
    reading("the saved hunt policy", async () => (await repos.adminConfig.readNarrowed(ADMIN_CONFIG_ID,
      PULSE_CONFIG_REVISION_FIELDS)) ?? null),
  ]);

  const snapshotValue = (snapshot.value?.value ?? null) as PulseSnapshot | null;
  const counts = countsFrom(snapshotValue);

  /* An unreadable row makes the whole count unknown; an empty log is zero. */
  const jobCount = logs.value?.jobs ?? null;

  /* Tracker decision cards are not counted; the field stays as "not counted" so its absence is not read as zero. */
  const decisionsWaiting: number | null = null;

  const unread = [
    heartbeat.unread,
    snapshot.unread,
    research.unread,
    logs.unread,
    sourceProgress.unread,
    config.failed ? config.unread : null,
    jobCount !== null && jobCount.unreadable > 0
      ? "how many jobs are running for you (the log holds rows this strip cannot read)"
      : null,
    ...counts.unread,
  ].filter((name): name is string => name !== null);

  const beat = (heartbeat.value?.value ?? null) as import("../owner-surface.ts").RunnerHeartbeat | null;
  return {
    revision: pulseRevision({
      beatAt: beat?.beatAt ?? null,
      heartbeatRevision: heartbeat.value?.revision ?? null,
      snapshotRevision: snapshot.value?.revision ?? null,
      decisionCount: null,
      researchRevision: research.value?.revision ?? null,
      receiptCount: logs.value?.receipts ?? null,
      researchIntentCount: logs.value?.intents ?? null,
      sourceProgressId: sourceProgress.value?.digestId ?? null,
      capabilityRevision: `${ADMIN_CAPABILITIES.revision}|${ADMIN_V6_CAPABILITY_REVISION}|${config.value?.revision ?? "-"}`,
    }),
    at: nowIso,
    capabilities: ADMIN_CAPABILITIES,
    v6: adminV6ReadCapabilities({ configRevision: config.value?.revision ?? null,
      snapshotRevision: snapshot.value?.revision ?? null, researchRevision: research.value?.revision ?? null,
      heartbeatRevision: heartbeat.value?.revision ?? null,
      sourceProgressId: sourceProgress.value?.digestId ?? null,
      workerAgeBucket: Math.floor(Date.parse(nowIso) / 15_000),
      historyRevision: logs.value !== null ? `${logs.value.receipts}:${logs.value.intents}` : null }),
    runner: {
      beatAt: beat?.beatAt ?? null,
      lastCycleFinishedAt: beat?.lastCycleFinishedAt ?? null,
      nextCycleDueAt: beat?.nextCycleDueAt ?? null,
      /* Derived from the beat and this instant, never stored. Null when the heartbeat could not be read. */
      state: heartbeat.failed ? null : livenessOf(beat, nowIso).state,
    },
    counts: {
      decisionsWaiting,
      freshnessDebtRows: counts.freshnessDebtRows,
      incidents: counts.incidents,
      obligations: counts.obligations,
      agentJobsRunning: jobCount === null || jobCount.unreadable > 0 ? null : jobCount.running,
    },
    lanes: pulseLanesOf(research.value?.value ?? null),
    unread,
  };
}
