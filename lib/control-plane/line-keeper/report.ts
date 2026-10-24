import { neon } from "@neondatabase/serverless";
import type { Sql } from "../repository/pg-store.ts";
import { readCounts, readOldest, query, countTimestamp } from "./read.ts";
import { type LineState } from "./model.ts";
/** Admin reads counters and grouped ages. No inventory or source document is held in a report. */
export async function readLineReport(control:Sql, reader?:Sql):Promise<LineState|null> {
  const rows=await query(control,"admin-runs",`SELECT hour,checked_at,problems,bytes_read FROM line_keeper_run ORDER BY hour DESC LIMIT 2`);
  if(!rows.length)return null;
  const readerSql=reader??(process.env.DATABASE_URL?neon(process.env.DATABASE_URL,{readOnly:true}):null);
  const waiting=await readOldest(control).catch(()=>null);
  const hours=await Promise.all(rows.map(async row=>{
    const from=countTimestamp(row.hour),through=new Date(Date.parse(from)+3_600_000).toISOString();
    const counts=readerSql?await Promise.all([readCounts(control,from,through),readCounts(readerSql,from,through)]).then(r=>r.flat()).catch(()=>null):null;
    return {from,through,measuredAt:countTimestamp(row.checked_at),counts,waiting,problems:[],own:{bytesRead:Number(row.bytes_read)}};
  }));
  // The status clock uses the actual completed run, even while count readers show current inventories.
  return {version:2,checkedAt:hours.map(h=>h.measuredAt).sort().at(-1)!,hours};
}
