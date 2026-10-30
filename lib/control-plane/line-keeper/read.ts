import type { Sql } from "../repository/pg-store.ts";
import { boundedQuery } from "../repository/request-bounds.ts";
import { COUNT_HOUR_SQL, countWindow, type HourCount, type OldestWaiting } from "../../counts/hour.ts";
import { runnerReadProblems } from "../../db/runner-read-families.ts";
import type { JobPaceChange } from "../job-transfer-breaker.ts";

export const query = (sql: Sql, operation: string, text: string, args: readonly unknown[] = []) =>
  boundedQuery(sql,{operation:`line-keeper.${operation}`,callClass:"PAGE"},text,args) as Promise<Record<string,unknown>[]>;
export const countTimestamp = (value: unknown) => value instanceof Date?value.toISOString():new Date(String(value)).toISOString();
/** One compact response carries the same running counters without thousands of repeated column names and clocks. */
export const PACKED_HOUR_COUNTS_SQL = `WITH counted AS (${COUNT_HOUR_SQL})
  SELECT coalesce(jsonb_agg(jsonb_build_array(state,family,stage,total,closed_total,incoming,outgoing,changed,observed_in,observed_out)
    ORDER BY state,family,stage),'[]'::jsonb) AS counts FROM counted`;
export async function readCounts(sql: Sql, from: string, through: string, at=new Date().toISOString()): Promise<HourCount[]> {
  const [row] = await query(sql,"hourly-counts",PACKED_HOUR_COUNTS_SQL,[from,through,at]);
  const counts = typeof row?.counts === "string" ? JSON.parse(row.counts) : row?.counts;
  if (!Array.isArray(counts)) throw new Error("Hourly counts could not be read");
  return counts.map((r: unknown[])=>({hour:countTimestamp(from),state:String(r[0]),family:String(r[1]),stage:String(r[2]),
    total:Number(r[3]),closedTotal:r[4]===null?null:Number(r[4]),incoming:r[5]===null?null:Number(r[5]),outgoing:r[6]===null?null:Number(r[6]),changed:r[7]===null?null:Number(r[7]),observedIn:Number(r[8]),observedOut:Number(r[9])}));
}
export async function readOldest(sql: Sql,at=new Date().toISOString()): Promise<OldestWaiting[]> {
  const rows = await query(sql,"oldest-waiting","SELECT state,family,stage,count,oldest_at,owner FROM count_oldest_waiting($1::timestamptz) ORDER BY state,family,stage",[at]);
  return rows.map(r=>({state:String(r.state),family:String(r.family),stage:String(r.stage),count:Number(r.count),
    oldestAt:r.oldest_at?countTimestamp(r.oldest_at):null,owner:String(r.owner)}));
}
/** The page queue is held on the reader database; only grouped ages leave it. */
export async function readRebuildWaiting(sql: Sql): Promise<OldestWaiting[]> {
  const rows = await query(sql,"oldest-place-pages",`SELECT coalesce(e.state,'US') AS state,
    count(*)::int AS count,min(q.stale_at) AS oldest_at FROM place_page q
    JOIN entity e ON e.id=q.place_id WHERE q.stale_at IS NOT NULL GROUP BY coalesce(e.state,'US') ORDER BY state`);
  return rows.map(r=>({state:String(r.state),family:"Place pages",stage:"rebuilt",count:Number(r.count),
    oldestAt:r.oldest_at?countTimestamp(r.oldest_at):null,owner:"the page builder"}));
}
export async function readHour(control: Sql, reader: Sql, at: string) {
  const window = countWindow(at);
  const before = countWindow(window.from);
  const [currentControl,currentReader,previousControl,previousReader,waiting,rebuilds] = await Promise.all([
    readCounts(control,window.from,window.through,at),readCounts(reader,window.from,window.through,at),
    readCounts(control,before.from,before.through,at),readCounts(reader,before.from,before.through,at),readOldest(control,at),readRebuildWaiting(reader),
  ]);
  return {window,counts:[...currentControl,...currentReader],previous:[...previousControl,...previousReader],waiting:[...waiting,...rebuilds]};
}

/** Oversight reads only the slow-downs and returns in the window's checks; it never reopens transfer read maps or saved state. */
export async function readJobBreakerEvents(control: Sql, from: string, through: string): Promise<(JobPaceChange & { id: string })[]> {
  const rows=await query(control,"job-transfer-breaker",`SELECT id,detail->'changes' AS changes FROM cp_job_transfer_breaker
    WHERE checked_at >= $1::timestamptz AND checked_at < $2::timestamptz AND action='CHECK'
    AND jsonb_array_length(coalesce(detail->'changes','[]'::jsonb))>0 ORDER BY checked_at,id`,[from,through]);
  return rows.flatMap(row=>(row.changes as JobPaceChange[]).map(change=>({...change,id:`${String(row.id)}:${change.job}`})));
}

/** Aggregate beside the accounting rows; their large read maps never cross the wire. */
export async function readRunnerReadProblems(reader: Sql, from: string, through: string) {
  const rows = await query(reader, "runner-read-growth", `WITH hours AS (
    SELECT hour,database_name,reads FROM database_transfer_hourly
    WHERE hour >= $1::timestamptz - interval '24 hours' AND hour < $2::timestamptz
  ), coverage AS (
    SELECT count(DISTINCT hour)::int AS previous_hours FROM hours WHERE hour < $1::timestamptz
  ), reads AS (
    SELECT hour,database_name,split_part(item.key,E'\\t',1) AS job,
      split_part(item.key,E'\\t',2) AS data,split_part(item.key,E'\\t',3) AS file,
      coalesce((item.value->>2)::bigint,0) AS bytes
    FROM hours CROSS JOIN LATERAL jsonb_each(reads) item
  ) SELECT database_name AS database,job,
    coalesce(sum(bytes) FILTER (WHERE hour >= $1::timestamptz),0)::text AS response_bytes,
    coalesce(sum(bytes) FILTER (WHERE hour < $1::timestamptz),0)::text AS previous_bytes,
    (SELECT previous_hours FROM coverage) AS previous_hours,
    coalesce(array_agg(DISTINCT file) FILTER (WHERE hour >= $1::timestamptz AND file<>''),ARRAY[]::text[]) AS files,
    coalesce(array_agg(DISTINCT data) FILTER (WHERE hour >= $1::timestamptz AND data<>''),ARRAY[]::text[]) AS tables
    FROM reads GROUP BY database_name,job`, [from, through]);
  return runnerReadProblems(rows.map(row => ({ database: String(row.database), job: String(row.job),
    responseBytes: Number(row.response_bytes), previousBytes: Number(row.previous_bytes), previousHours: Number(row.previous_hours),
    files: row.files as string[], tables: row.tables as string[] })));
}
