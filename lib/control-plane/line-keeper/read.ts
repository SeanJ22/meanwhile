import type { Sql } from "../repository/pg-store.ts";
import { boundedQuery } from "../repository/request-bounds.ts";
import { COUNT_HOUR_SQL, countWindow, type HourCount, type OldestWaiting } from "../../counts/hour.ts";

export const query = (sql: Sql, operation: string, text: string, args: readonly unknown[] = []) =>
  boundedQuery(sql,{operation:`line-keeper.${operation}`,callClass:"PAGE"},text,args) as Promise<Record<string,unknown>[]>;
export const countTimestamp = (value: unknown) => value instanceof Date?value.toISOString():new Date(String(value)).toISOString();
export async function readCounts(sql: Sql, from: string, through: string, at=new Date().toISOString()): Promise<HourCount[]> {
  const rows = await query(sql,"hourly-counts",COUNT_HOUR_SQL,[from,through,at]);
  return rows.map(r=>({hour:countTimestamp(r.hour),state:String(r.state),family:String(r.family),stage:String(r.stage),
    total:Number(r.total),closedTotal:Number(r.closed_total),incoming:Number(r.incoming),outgoing:Number(r.outgoing),changed:Number(r.changed)}));
}
export async function readOldest(sql: Sql,at=new Date().toISOString()): Promise<OldestWaiting[]> {
  const rows = await query(sql,"oldest-waiting","SELECT state,family,stage,count,oldest_at,owner FROM count_oldest_waiting($1::timestamptz) ORDER BY state,family,stage",[at]);
  return rows.map(r=>({state:String(r.state),family:String(r.family),stage:String(r.stage),count:Number(r.count),
    oldestAt:r.oldest_at?countTimestamp(r.oldest_at):null,owner:String(r.owner)}));
}
export async function readHour(control: Sql, reader: Sql, at: string) {
  const window = countWindow(at);
  const before = countWindow(window.from);
  const [currentControl,currentReader,previousControl,previousReader,waiting] = await Promise.all([
    readCounts(control,window.from,window.through,at),readCounts(reader,window.from,window.through,at),
    readCounts(control,before.from,before.through,at),readCounts(reader,before.from,before.through,at),readOldest(control,at),
  ]);
  return {window,counts:[...currentControl,...currentReader],previous:[...previousControl,...previousReader],waiting};
}
