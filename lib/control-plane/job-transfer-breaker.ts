import { hourStart } from "../db/transfer-by-caller.ts";

export const JOB_BREAKER_INTERVAL_MS = 10 * 60_000;
export const JOB_BREAKER_BYTES = 500_000_000;
export const JOB_BREAKER_JOB = "job-transfer-breaker";

/** Only this hour's two accounting rows are expanded, beside the data. No read map leaves Postgres. */
export const JOB_TRANSFER_SQL = `WITH tables AS (
  SELECT split_part(e.key,E'\\t',1) AS job,split_part(e.key,E'\\t',2) AS name,
    sum((e.value->>0)::bigint) AS requests,
    sum((e.value->>1)::bigint+(e.value->>2)::bigint) AS bytes
  FROM database_transfer_hourly h CROSS JOIN LATERAL jsonb_each(h.reads) e
  WHERE h.hour=$1::timestamptz GROUP BY 1,2
) SELECT job,sum(requests)::text AS requests,sum(bytes)::text AS bytes,
  (array_agg(name ORDER BY bytes DESC,name))[1] AS top_table
  FROM tables GROUP BY job ORDER BY job`;

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

/**
 * A paused job stays paused until the owner releases it in Admin. A released job counts only the bytes it reads after
 * its release took effect in that hour.
 */
export interface JobBreakerState {
  job: string;
  mode: "PAUSED" | "RELEASED";
  /** When the breaker paused the job, or when its release took effect. */
  at: string;
  hour: string;
  offsetBytes: number;
}
export interface JobBreakerEvent {
  id: string;
  checked_at: string;
  hour: string;
  action: "PAUSE" | "RESUME" | "CHECK";
  job: string | null;
  gb: number;
  top_table: string | null;
  bytes_per_request: number | null;
  state: JobBreakerState | null;
  detail: Record<string, unknown>;
}
export interface JobBreakerSnapshot {
  checkedAt: string;
  states: Record<string, JobBreakerState>;
  /** The newest owner release this controller has read. */
  releasesThrough?: string | null;
  pendingEvents?: JobBreakerEvent[];
}
export interface JobRelease { job: string; at: string }

/** Supervisors and serving identities keep only their own small reads; the work they run is metered and paused under each task's name. */
export function protectedJob(job: string): boolean {
  return ["pilot-runner", JOB_BREAKER_JOB, "index", "server", "production-contract-migrations", "routine-civic-data", "publish-now"].includes(job)
    || job.startsWith("admin:") || job.startsWith("reader:");
}

/** One crossing pauses a job. Nothing here resumes one: only the owner's release does. */
export function evaluateJobBreaker(input: {
  now: number;
  rows: readonly JobTransfer[];
  states: Readonly<Record<string, JobBreakerState>>;
  releases?: readonly JobRelease[];
}): { snapshot: JobBreakerSnapshot; events: JobBreakerEvent[]; released: string[] } {
  const at = new Date(input.now).toISOString(), hour = hourStart(input.now);
  const states: Record<string, JobBreakerState> = structuredClone(input.states), events: JobBreakerEvent[] = [], released: string[] = [];
  const rows = new Map(input.rows.map(row => [row.job, row]));
  for (const release of input.releases ?? []) {
    const state = states[release.job];
    if (state?.mode !== "PAUSED" || Date.parse(release.at) < Date.parse(state.at)) continue;
    states[release.job] = { job: release.job, mode: "RELEASED", at, hour, offsetBytes: rows.get(release.job)?.bytes ?? 0 };
    released.push(release.job);
  }
  for (const job of new Set([...Object.keys(states), ...rows.keys()])) {
    if (protectedJob(job)) { delete states[job]; continue; }
    const row = rows.get(job);
    if (states[job]?.mode === "PAUSED") continue;
    if (states[job]?.mode === "RELEASED" && states[job].hour !== hour) delete states[job];
    if (!row || row.bytes - (states[job]?.offsetBytes ?? 0) <= JOB_BREAKER_BYTES) continue;
    const paused: JobBreakerState = states[job] = { job, mode: "PAUSED", at, hour, offsetBytes: 0 };
    events.push({ id: `${at}:${job}:${String(events.length).padStart(8, "0")}`, checked_at: at, hour, action: "PAUSE", job,
      gb: row.bytes / 1e9, top_table: row.topTable, bytes_per_request: row.requests ? row.bytes / row.requests : null,
      state: paused, detail: { reason: "Hourly job transfer exceeded 0.5 GB; held until released in Admin", checkedHour: hour } });
  }
  return { snapshot: { checkedAt: at, states }, events, released };
}

/** The latest pause or release of each job: a few rows, without their state documents. */
export const JOB_BREAKER_LATEST_SQL = `SELECT job,action,checked_at,hour,gb,top_table,bytes_per_request FROM (
  SELECT DISTINCT ON (job) job,action,checked_at,hour,gb,top_table,bytes_per_request FROM cp_job_transfer_breaker
  WHERE action IN ('PAUSE','RESUME') ORDER BY job,checked_at DESC,id DESC) latest ORDER BY checked_at DESC,job`;
/** Owner releases written since the controller last looked, with an hour's overlap for a writer whose clock runs behind. */
export const JOB_BREAKER_RELEASES_SQL = `SELECT job,checked_at FROM cp_job_transfer_breaker
  WHERE action='RESUME' AND checked_at > $1::timestamptz - interval '1 hour' ORDER BY checked_at,id`;
export const JOB_BREAKER_WRITE_SQL = `INSERT INTO cp_job_transfer_breaker
  (id,checked_at,hour,action,job,gb,top_table,bytes_per_request,state,detail)
  SELECT id,checked_at,hour,action,job,gb,top_table,bytes_per_request,state,detail
  FROM jsonb_to_recordset($1::jsonb) AS x(id text,checked_at timestamptz,hour timestamptz,action text,
    job text,gb numeric,top_table text,bytes_per_request numeric,state jsonb,detail jsonb)
  ON CONFLICT (id) DO NOTHING`;
/** A release lands only on a job whose latest entry is a pause, always after it; the receipt id makes a resend the same release. */
export const JOB_BREAKER_RELEASE_SQL = `WITH latest AS (SELECT action,checked_at FROM cp_job_transfer_breaker
    WHERE job=$3 AND action IN ('PAUSE','RESUME') ORDER BY checked_at DESC,id DESC LIMIT 1),
  at AS (SELECT greatest($2::timestamptz,latest.checked_at+interval '1 millisecond') AS at FROM latest WHERE latest.action='PAUSE')
  INSERT INTO cp_job_transfer_breaker (id,checked_at,hour,action,job,gb,top_table,bytes_per_request,state,detail)
  SELECT $1,at.at,date_trunc('hour',at.at),'RESUME',$3,0,NULL,NULL,jsonb_build_object('job',$3::text,'mode','RELEASED'),$4::jsonb FROM at
  ON CONFLICT (id) DO NOTHING RETURNING id`;

const iso = (value: unknown) => value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString();
export interface JobBreakerLatest {
  job: string;
  action: "PAUSE" | "RESUME";
  at: string;
  hour: string;
  gb: number;
  topTable: string | null;
  bytesPerRequest: number | null;
}
export interface BreakerSql { query(text: string, params?: readonly unknown[]): Promise<Record<string, unknown>[]> }
export async function readJobBreakerLatest(sql: BreakerSql): Promise<JobBreakerLatest[]> {
  return (await sql.query(JOB_BREAKER_LATEST_SQL)).map(row => ({ job: String(row.job), action: row.action === "PAUSE" ? "PAUSE" : "RESUME",
    at: iso(row.checked_at), hour: iso(row.hour), gb: Number(row.gb), topTable: row.top_table == null ? null : String(row.top_table),
    bytesPerRequest: row.bytes_per_request == null ? null : Number(row.bytes_per_request) }));
}
/** The jobs the control plane holds paused, built from each row's own columns. */
export function pausedStates(latest: readonly JobBreakerLatest[]): Record<string, JobBreakerState> {
  return Object.fromEntries(latest.filter(row => row.action === "PAUSE" && !protectedJob(row.job)).map(row => [row.job,
    { job: row.job, mode: "PAUSED", at: row.at, hour: row.hour, offsetBytes: 0 } satisfies JobBreakerState]));
}
export async function readJobReleases(sql: BreakerSql, since: string | null): Promise<JobRelease[]> {
  return (await sql.query(JOB_BREAKER_RELEASES_SQL, [since ?? new Date(0).toISOString()]))
    .map(row => ({ job: String(row.job), at: iso(row.checked_at) }));
}
export async function writeJobBreakerEvents(sql: BreakerSql, events: readonly JobBreakerEvent[]): Promise<void> {
  await sql.query(JOB_BREAKER_WRITE_SQL, [JSON.stringify(events)]);
}
/** The owner's release from Admin. False when the job is not paused. */
export async function releaseJob(sql: BreakerSql, input: { job: string; at: string; receiptId: string; actorRef: string }): Promise<boolean> {
  const rows = await sql.query(JOB_BREAKER_RELEASE_SQL, [`release:${input.receiptId}`, input.at, input.job,
    JSON.stringify({ reason: "Released by the owner in Admin", receiptId: input.receiptId, actorRef: input.actorRef })]);
  return rows.length > 0;
}
