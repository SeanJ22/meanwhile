import { hourStart } from "../db/transfer-by-caller.ts";

export const JOB_BREAKER_INTERVAL_MS = 10 * 60_000;
export const JOB_BREAKER_JOB = "job-transfer-breaker";
/** A job's normal hourly reads are never taken as less than this, so a small job's noise is never a spike. */
export const NORMAL_FLOOR_BYTES = 200_000_000;
/** An hour above this many times a job's normal is a spike. */
export const SPIKE_TIMES = 3;
/** Each spike doubles how far apart the job's launches are, up to this. */
const MAX_SLOW_TIMES = 8;
/** Each ordinary hour moves a job's normal this share of the way toward what it read. */
const NORMAL_WEIGHT = 1 / 8;
/** A slow-down stays on the record this long after it happened; a normal this long after the job last read. */
const KEEP_MS = 7 * 86_400_000;

/** Only one hour's accounting rows are expanded, beside the data. No read map leaves Postgres. */
export const JOB_TRANSFER_SQL = `WITH tables AS (
  SELECT split_part(e.key,E'\\t',1) AS job,split_part(e.key,E'\\t',2) AS name,
    sum((e.value->>0)::bigint) AS requests,
    sum((e.value->>1)::bigint+(e.value->>2)::bigint) AS bytes
  FROM database_transfer_hourly h CROSS JOIN LATERAL jsonb_each(h.reads) e
  WHERE h.hour=$1::timestamptz GROUP BY 1,2
) SELECT job,sum(requests)::text AS requests,sum(bytes)::text AS bytes,
  (array_agg(name ORDER BY bytes DESC,name))[1] AS top_table
  FROM tables GROUP BY job ORDER BY job`;
/**
 * Only when the breaker has no saved state at all: each job's median hour over the last day, for jobs whose median reaches
 * the floor. One answer row per such job; the hourly read maps stay in Postgres.
 */
const JOB_NORMAL_SEED_SQL = `WITH hours AS (
  SELECT h.hour,split_part(e.key,E'\\t',1) AS job,sum((e.value->>1)::bigint+(e.value->>2)::bigint) AS bytes
  FROM database_transfer_hourly h CROSS JOIN LATERAL jsonb_each(h.reads) e
  WHERE h.hour >= $1::timestamptz - interval '24 hours' AND h.hour < $1::timestamptz GROUP BY 1,2
) SELECT job,(percentile_cont(0.5) WITHIN GROUP (ORDER BY bytes))::bigint::text AS normal FROM hours
  GROUP BY job HAVING percentile_cont(0.5) WITHIN GROUP (ORDER BY bytes) >= $2 ORDER BY job`;

export interface JobTransfer {
  job: string;
  requests: number;
  bytes: number;
  topTable: string | null;
}
export function jobTransfers(rows: readonly Record<string, unknown>[]): JobTransfer[] {
  return rows.map(row => {
    const requests = Number(row.requests), bytes = Number(row.bytes);
    if (!Number.isSafeInteger(requests) || requests < 0 || !Number.isSafeInteger(bytes) || bytes < 0)
      throw new Error("Invalid hourly job transfer counters");
    return { job: String(row.job), requests, bytes, topTable: row.top_table == null ? null : String(row.top_table) };
  });
}

/** One slow-down: the hour that read far more than the job's normal, and how far apart its launches went. */
export interface JobSlowdown {
  at: string;
  hour: string;
  bytes: number;
  normal: number;
  topTable: string | null;
  bytesPerRequest: number | null;
  times: number;
  /** When it read at its normal again and went back to its ordinary pace. */
  back?: string;
}
export interface JobPace {
  /** Learned from its own ordinary hours. Absent while under the floor. */
  normal?: number;
  /** The last hour it read anything. */
  seen: string;
  /** How many times further apart its launches are while it is slowed. Absent at its ordinary pace. */
  times?: number;
  slowed?: JobSlowdown;
}
/** Kept in the runner's local file and in the state column of each CHECK row. */
export interface JobBreakerState {
  hour: string;
  jobs: Record<string, JobPace>;
}
export interface JobPaceChange extends JobSlowdown { job: string; kind: "SLOW" | "NORMAL" }
export interface JobBreakerCheck {
  id: string;
  checked_at: string;
  hour: string;
  action: "CHECK";
  job: null;
  gb: number;
  top_table: string | null;
  bytes_per_request: number | null;
  state: JobBreakerState | null;
  detail: Record<string, unknown> & { changes: JobPaceChange[] };
}
export interface JobBreakerSnapshot extends JobBreakerState {
  checkedAt: string;
  pendingEvents?: JobBreakerCheck[];
}

/** Supervisors and serving identities keep only their own small reads; the work they run is metered and slowed under each task's name. */
export function protectedJob(job: string): boolean {
  return ["pilot-runner", JOB_BREAKER_JOB, "index", "server", "production-contract-migrations", "routine-civic-data", "publish-now"].includes(job)
    || job.startsWith("admin:") || job.startsWith("reader:");
}
function jobNormal(pace: Pick<JobPace, "normal"> | undefined): number {
  return Math.max(pace?.normal ?? 0, NORMAL_FLOOR_BYTES);
}

/**
 * Nothing here stops a job. When the hour the breaker last looked at is over, each job's normal learns from it if the
 * job ran at its ordinary pace, and a slowed job that read at or under its normal goes back to its ordinary pace. In the
 * current hour, a job past three times its normal slows: its launches go twice as far apart, once per hour, up to 8 times.
 */
export function evaluateJobBreaker(input: {
  now: number;
  rows: readonly JobTransfer[];
  state: JobBreakerState | null;
  /** The finished hour's totals, read once when the clock has moved past the state's hour. */
  closed?: readonly JobTransfer[];
}): { state: JobBreakerState; changes: JobPaceChange[] } {
  const at = new Date(input.now).toISOString(), hour = hourStart(input.now), changes: JobPaceChange[] = [];
  const jobs: Record<string, JobPace> = Object.fromEntries(Object.entries(structuredClone(input.state?.jobs ?? {}))
    .filter(([job, pace]) => !protectedJob(job) && typeof pace?.seen === "string"));
  if (input.state && input.state.hour !== hour && input.closed) {
    const finished = input.state.hour, closed = new Map(input.closed.map(row => [row.job, row]));
    for (const job of new Set([...Object.keys(jobs), ...closed.keys()])) {
      if (protectedJob(job)) continue;
      const row = closed.get(job), pace = jobs[job];
      if (!pace) {
        if (row && row.bytes >= NORMAL_FLOOR_BYTES) jobs[job] = { normal: row.bytes, seen: finished };
        continue;
      }
      if (row) pace.seen = finished;
      if (pace.times) {
        if (pace.slowed && pace.slowed.hour !== finished && (row?.bytes ?? 0) <= jobNormal(pace)) {
          delete pace.times;
          pace.slowed.back = at;
          changes.push({ job, kind: "NORMAL", ...pace.slowed });
        }
      } else if (row) {
        // Only an hour at its ordinary pace teaches a job its normal.
        const learned = pace.normal === undefined ? row.bytes : Math.round(pace.normal + (row.bytes - pace.normal) * NORMAL_WEIGHT);
        if (learned >= NORMAL_FLOOR_BYTES) pace.normal = learned; else delete pace.normal;
      }
    }
  }
  for (const row of input.rows) {
    if (protectedJob(row.job)) continue;
    const pace = jobs[row.job], normal = jobNormal(pace);
    if (row.bytes <= SPIKE_TIMES * normal || pace?.slowed?.hour === hour) continue;
    const slowed: JobSlowdown = { at, hour, bytes: row.bytes, normal, topTable: row.topTable,
      bytesPerRequest: row.requests ? row.bytes / row.requests : null, times: Math.min(MAX_SLOW_TIMES, (pace?.times ?? 1) * 2) };
    jobs[row.job] = { ...pace, seen: hour, times: slowed.times, slowed };
    changes.push({ job: row.job, kind: "SLOW", ...slowed });
  }
  const recent = (when: string | undefined) => when !== undefined && input.now - Date.parse(when) < KEEP_MS;
  for (const [job, pace] of Object.entries(jobs)) {
    if (pace.slowed && !pace.times && !recent(pace.slowed.at)) delete pace.slowed;
    if (!pace.times && !pace.slowed && !(pace.normal !== undefined && recent(pace.seen))) delete jobs[job];
  }
  return { state: { hour, jobs }, changes };
}

const JOB_BREAKER_WRITE_SQL = `INSERT INTO cp_job_transfer_breaker
  (id,checked_at,hour,action,job,gb,top_table,bytes_per_request,state,detail)
  SELECT id,checked_at,hour,action,job,gb,top_table,bytes_per_request,state,detail
  FROM jsonb_to_recordset($1::jsonb) AS x(id text,checked_at timestamptz,hour timestamptz,action text,
    job text,gb numeric,top_table text,bytes_per_request numeric,state jsonb,detail jsonb)
  ON CONFLICT (id) DO NOTHING`;
/** The newest check's saved state: one row. A check written before slowing existed has none. */
const JOB_BREAKER_STATE_SQL = `SELECT checked_at,state FROM cp_job_transfer_breaker
  WHERE action='CHECK' ORDER BY checked_at DESC,id DESC LIMIT 1`;

const iso = (value: unknown) => value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString();
export interface BreakerSql { query(text: string, params?: readonly unknown[]): Promise<Record<string, unknown>[]> }
export interface SavedJobBreakerState { checkedAt: string; state: JobBreakerState | null }
export async function readJobBreakerState(sql: BreakerSql): Promise<SavedJobBreakerState | null> {
  const [row] = await sql.query(JOB_BREAKER_STATE_SQL);
  if (!row) return null;
  const state = row.state as Partial<JobBreakerState> | null;
  return { checkedAt: iso(row.checked_at), state: state && typeof state.hour === "string" && state.jobs && typeof state.jobs === "object"
    ? { hour: state.hour, jobs: state.jobs } : null };
}
export async function readJobNormalSeed(sql: BreakerSql, now: number): Promise<Record<string, JobPace>> {
  const hour = hourStart(now);
  return Object.fromEntries((await sql.query(JOB_NORMAL_SEED_SQL, [hour, NORMAL_FLOOR_BYTES]))
    .map(row => [String(row.job), Number(row.normal)] as const)
    .filter(([job, normal]) => !protectedJob(job) && Number.isSafeInteger(normal) && normal >= NORMAL_FLOOR_BYTES)
    .map(([job, normal]) => [job, { normal, seen: hour }]));
}
export async function writeJobBreakerEvents(sql: BreakerSql, events: readonly JobBreakerCheck[]): Promise<void> {
  await sql.query(JOB_BREAKER_WRITE_SQL, [JSON.stringify(events)]);
}
