import { createHash } from "node:crypto";
import { CivicReadCache, runtimeCivicReadCache } from "../../db/civic-read-cache.ts";
import { INCREMENTAL_READS_SLACK_MS } from "./incremental-reads.ts";

type Query = (text: string, params: readonly unknown[]) => Promise<unknown>;
interface Slot { position: number; changedAt: string; record: unknown }
interface HeldLog { through: string | null; rows: Slot[] }
const PAGE = 100;

/** Append-only slots already held by a job never need another body read. The
 * overlapping database clock also finds a lower position that committed later. */
export class RetainedLogReads {
  private readonly cache: CivicReadCache;
  private readonly database: string;
  constructor(database: string, cache: CivicReadCache) { this.database=database;this.cache = cache.jobState(); }

  async keys(query: Query, table: string, keys: readonly string[], selected = "record"): Promise<ReadonlyMap<string, readonly unknown[]>> {
    const namespace = `cp-log:${this.database}:${table}:${createHash("sha256").update(selected).digest("hex")}`;
    const result = new Map<string, readonly unknown[]>();
    const ordered=[...new Set(keys)].sort();
    for (let offset = 0; offset < ordered.length; offset += PAGE) {
      const wanted = ordered.slice(offset,offset+PAGE);
      const held = new Map(await Promise.all(wanted.map(async key => [key,
        await this.cache.readCheckpoint<HeldLog>(namespace,key) ?? {through:null,rows:[]}] as const)));
      const [clock] = await query("SELECT now() AS read_at",[]) as {read_at:string}[];
      const through = new Date(clock.read_at).toISOString();
      const since = wanted.map(key => {const at=held.get(key)!.through;return at===null?null:new Date(Date.parse(at)-INCREMENTAL_READS_SLACK_MS).toISOString();});
      const slots = wanted.flatMap((key,index)=>held.get(key)!.rows.filter(row=>since[index]===null || row.changedAt>=since[index]!)
        .map(row=>({log_key:key,position:row.position})));
      let after: {key:string;position:number}|null = null;
      for (;;) {
        const rows = await query(`SELECT l.log_key,l.position,l.changed_at,${selected} AS record
          FROM ${table} l JOIN unnest($1::text[],$2::timestamptz[]) AS wanted(log_key,since) ON wanted.log_key=l.log_key
          WHERE (wanted.since IS NULL OR l.changed_at>=wanted.since)
            AND NOT EXISTS(SELECT 1 FROM jsonb_to_recordset($3::jsonb) AS held(log_key text,position bigint)
              WHERE held.log_key=l.log_key AND held.position=l.position)
            ${after===null?"":"AND (l.log_key,l.position)>($4::text,$5::bigint)"}
          ORDER BY l.log_key,l.position LIMIT ${PAGE}`,[wanted,since,JSON.stringify(slots),...(after===null?[]:[after.key,after.position])]) as
            {log_key:string;position:number|string;changed_at:string;record:unknown}[];
        const changed=new Set<string>();
        for(const row of rows) {
          const state=held.get(row.log_key)!;
          const entry={position:Number(row.position),changedAt:new Date(row.changed_at).toISOString(),
            record:typeof row.record==="string"?JSON.parse(row.record):row.record};
          const index=state.rows.findIndex(value=>value.position===entry.position);
          if(index<0)state.rows.push(entry);else state.rows[index]=entry;
          changed.add(row.log_key);
        }
        // Save completed pages before another bounded query can reach its deadline.
        for(const key of changed)await this.cache.checkpoint(namespace,key,held.get(key)!);
        if(rows.length<PAGE)break;
        const last=rows.at(-1)!;after={key:last.log_key,position:Number(last.position)};
      }
      for(const key of wanted) {
        const state=held.get(key)!;state.through=through;state.rows.sort((a,b)=>a.position-b.position);
        await this.cache.checkpoint(namespace,key,state);
        if(state.rows.length)result.set(key,state.rows.map(row=>row.record));
      }
    }
    return result;
  }
}

const readers=new WeakMap<object,RetainedLogReads>();
const memory=new Map<string,string>();
let memoryBytes=0,sequence=0;
const fallback=new CivicReadCache({read:async key=>memory.get(key)??null,write:async(key,saved)=>{
  const bound=32*1024*1024;if(saved.length>bound)return;
  memoryBytes-=memory.get(key)?.length??0;memory.delete(key);
  while(memory.size&&memoryBytes+saved.length>bound){const oldest=memory.keys().next().value!;memoryBytes-=memory.get(oldest)!.length;memory.delete(oldest);}
  memory.set(key,saved);memoryBytes+=saved.length;
}});
export function shareRetainedLogReads(sql: object, connection: string, cache=runtimeCivicReadCache()): void {
  const url=new URL(connection),database=createHash("sha256").update(url.hostname.replace("-pooler.",".")+url.pathname).digest("hex");
  readers.set(sql,new RetainedLogReads(database,cache??fallback));
}
export function retainedLogReadsFor(sql:object):RetainedLogReads {
  let held=readers.get(sql);if(!held){held=new RetainedLogReads(`connection-${++sequence}`,fallback);readers.set(sql,held);}return held;
}
