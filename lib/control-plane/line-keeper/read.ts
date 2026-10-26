import type { Sql } from "../repository/pg-store.ts";
import { boundedQuery } from "../repository/request-bounds.ts";
import { COUNT_HOUR_SQL, countWindow, type HourCount, type OldestWaiting } from "../../counts/hour.ts";
import { runnerReadProblems } from "../../db/runner-read-families.ts";

export const query = (sql: Sql, operation: string, text: string, args: readonly unknown[] = []) =>
  boundedQuery(sql,{operation:`line-keeper.${operation}`,callClass:"PAGE"},text,args) as Promise<Record<string,unknown>[]>;
export const countTimestamp = (value: unknown) => value instanceof Date?value.toISOString():new Date(String(value)).toISOString();
export async function readCounts(sql: Sql, from: string, through: string, at=new Date().toISOString()): Promise<HourCount[]> {
  const rows = await query(sql,"hourly-counts",COUNT_HOUR_SQL,[from,through,at]);
  return rows.map(r=>({hour:countTimestamp(r.hour),state:String(r.state),family:String(r.family),stage:String(r.stage),
    total:Number(r.total),closedTotal:r.closed_total===null?null:Number(r.closed_total),incoming:r.incoming===null?null:Number(r.incoming),outgoing:r.outgoing===null?null:Number(r.outgoing),changed:r.changed===null?null:Number(r.changed),observedIn:Number(r.observed_in),observedOut:Number(r.observed_out)}));
}
export async function readOldest(sql: Sql,at=new Date().toISOString()): Promise<OldestWaiting[]> {
  const rows = await query(sql,"oldest-waiting","SELECT state,family,stage,count,oldest_at,owner FROM count_oldest_waiting($1::timestamptz) ORDER BY state,family,stage",[at]);
  return rows.map(r=>({state:String(r.state),family:String(r.family),stage:String(r.stage),count:Number(r.count),
    oldestAt:r.oldest_at?countTimestamp(r.oldest_at):null,owner:String(r.owner)}));
}
/** The page queue is held on the reader database; only grouped ages leave it. */
export async function readRebuildWaiting(sql: Sql): Promise<OldestWaiting[]> {
  const rows = await query(sql,"oldest-place-pages",`SELECT coalesce(e.state,'US') AS state,
    count(*)::int AS count,min(q.queued_at) AS oldest_at FROM rebuild_queue q
    JOIN entity e ON e.id=q.place_id GROUP BY coalesce(e.state,'US') ORDER BY state`);
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
