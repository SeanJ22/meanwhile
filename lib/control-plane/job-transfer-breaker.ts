import { easternDay, hourStart } from "../db/transfer-by-caller.ts";

export const JOB_BREAKER_INTERVAL_MS = 10 * 60_000;
export const JOB_BREAKER_BYTES = 500_000_000;
export const JOB_BREAKER_HOURLY_BUDGET = 5_000_000;
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

export interface JobBreakerState {
  job: string;
  mode: "PAUSED_HOUR" | "PAUSED_CODE" | "HALF_RATE";
  tripDay: string;
  trips: number;
  tripHour: string;
  code: string | null;
  offsetHour: string;
  offsetBytes: number;
  lastTransfer?: JobTransfer & { hour: string };
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
  pendingEvents?: JobBreakerEvent[];
}

/** These are serving/parent identities, never independently pausable acquisitions. */
export function protectedJob(job: string): boolean {
  return ["pilot-runner", JOB_BREAKER_JOB, "index", "server", "production-contract-migrations"].includes(job) || job.startsWith("admin:") || job.startsWith("reader:");
}

/** A trip is one crossing per job/hour. A code hold survives midnight and process/release restarts. */
export function evaluateJobBreaker(input: {
  now: number;
  rows: readonly JobTransfer[];
  states: Readonly<Record<string, JobBreakerState>>;
  code: (job: string) => string | null;
}): { snapshot: JobBreakerSnapshot; events: JobBreakerEvent[] } {
  const at = new Date(input.now).toISOString(), hour = hourStart(input.now), day = easternDay(new Date(input.now));
  const states: Record<string,JobBreakerState> = structuredClone(input.states), events: JobBreakerEvent[] = [];
  const rows = new Map(input.rows.map(row => [row.job, row]));
  const emit = (state: JobBreakerState, action: "PAUSE" | "RESUME", reason: string) => {
    const row = rows.get(state.job);
    const measurement = row ? { ...row, hour } : state.lastTransfer;
    // A quiet next-hour resume retains the measured trip's table and request size. checked_at is the action clock.
    events.push({ id: `${at}:${state.job}:${events.length}`, checked_at: at, hour: measurement?.hour ?? hour, action, job: state.job,
      gb: (measurement?.bytes ?? 0) / 1e9, top_table: measurement?.topTable ?? null,
      bytes_per_request: measurement?.requests ? measurement.bytes / measurement.requests : null,
      state: { ...state }, detail: { reason, checkedHour: hour } });
  };
  for (const job of new Set([...Object.keys(states), ...rows.keys()])) {
    if (protectedJob(job)) continue;
    let state = states[job];
    const row = rows.get(job), code = input.code(job);
    if (state?.mode === "PAUSED_CODE" && code && state.code && code !== state.code) {
      state = states[job] = { ...state, mode: "HALF_RATE", trips: 0, tripDay: day, code,
        offsetHour: hour, offsetBytes: row?.bytes ?? 0, tripHour: "" };
      emit(state, "RESUME", "Job code changed in the running release");
    } else if (state?.mode === "PAUSED_HOUR" && state.tripHour < hour) {
      state = states[job] = { ...state, mode: "HALF_RATE" };
      emit(state, "RESUME", "Next hour; launch interval doubled");
    }
    if (state?.mode === "PAUSED_CODE" || state?.mode === "PAUSED_HOUR") continue;
    const bytes = (row?.bytes ?? 0) - (state?.offsetHour === hour ? state.offsetBytes : 0);
    if (bytes <= JOB_BREAKER_BYTES || state?.tripHour === hour) continue;
    const trips = (state?.tripDay === day ? state.trips : 0) + 1;
    state = states[job] = { job, mode: trips >= 2 ? "PAUSED_CODE" : "PAUSED_HOUR", trips, tripDay: day,
      tripHour: hour, code, offsetHour: state?.offsetHour ?? hour, offsetBytes: state?.offsetBytes ?? 0,
      lastTransfer: row ? {...row,hour} : state?.lastTransfer };
    emit(state, "PAUSE", trips >= 2 ? "Second trip today; waiting for this job's code to change" : "Hourly job transfer exceeded 0.5 GB");
  }
  return { snapshot: { checkedAt: at, states }, events };
}

export const JOB_BREAKER_STATE_SQL = `SELECT DISTINCT ON (job) job,state
  FROM cp_job_transfer_breaker WHERE action IN ('PAUSE','RESUME') ORDER BY job,checked_at DESC,id DESC`;
export const JOB_BREAKER_WRITE_SQL = `INSERT INTO cp_job_transfer_breaker
  (id,checked_at,hour,action,job,gb,top_table,bytes_per_request,state,detail)
  SELECT id,checked_at,hour,action,job,gb,top_table,bytes_per_request,state,detail
  FROM jsonb_to_recordset($1::jsonb) AS x(id text,checked_at timestamptz,hour timestamptz,action text,
    job text,gb numeric,top_table text,bytes_per_request numeric,state jsonb,detail jsonb)
  ON CONFLICT (id) DO NOTHING`;

export interface BreakerSql { query(text: string, params?: readonly unknown[]): Promise<Record<string, unknown>[]> }
export async function readJobBreakerStates(sql: BreakerSql): Promise<Record<string, JobBreakerState>> {
  const rows = await sql.query(JOB_BREAKER_STATE_SQL);
  return Object.fromEntries(rows.map(row => [String(row.job), row.state as JobBreakerState]));
}
export async function writeJobBreakerEvents(sql: BreakerSql, events: readonly JobBreakerEvent[]): Promise<void> {
  await sql.query(JOB_BREAKER_WRITE_SQL, [JSON.stringify(events)]);
}
