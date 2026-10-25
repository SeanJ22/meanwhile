import { createHash } from "node:crypto";
import { CivicReadCache, runtimeCivicReadCache } from "../../db/civic-read-cache.ts";
import { currentReaderRoute } from "../../db/reader-route.ts";
import { currentStoreBudget, ControlPlaneRequestTimeout } from "./request-bounds.ts";
import { passDeadlineFromEnv } from "../../ops/independent-runtime-pass.ts";

type Row = Record<string, unknown> & { id: string; revision: number | string; updated_at: unknown; value: unknown };
type Query = (text: string, params: readonly unknown[]) => Promise<unknown>;
const PAGE = 100;
function withinPass(table:string): void {
  const budget=currentStoreBudget();
  if(Date.now()>=Math.min(budget?.deadlineMs??Infinity,passDeadlineFromEnv()))throw new ControlPlaneRequestTimeout({
    operation:`${table}.resumeChangedRows`,callClass:"PAGE",timeoutMs:0,kind:"DEADLINE",budget:budget?.label??"source pass"});
}
const FALLBACK_BYTES = 32 * 1024 * 1024;
const memory = new Map<string, string>();
let memoryBytes = 0;
const fallback = new CivicReadCache({
  read: async key => {
    const value = memory.get(key);
    if (value !== undefined) { memory.delete(key); memory.set(key, value); }
    return value ?? null;
  },
  write: async (key, value) => {
    if (value.length > FALLBACK_BYTES) return;
    memoryBytes -= memory.get(key)?.length ?? 0;
    memory.delete(key);
    while (memory.size && memoryBytes + value.length > FALLBACK_BYTES) {
      const oldest = memory.keys().next().value!;
      memoryBytes -= memory.get(oldest)!.length; memory.delete(oldest);
    }
    memory.set(key, value); memoryBytes += value.length;
  },
});

/** Membership is read afresh, including removals, closures and inactive obligations.
 * Values cross the connection only when their row revision changed or a disposable copy was lost.
 */
export class RevisionReads {
  private readonly database: string;
  private readonly cache: CivicReadCache;
  constructor(database: string, cache: CivicReadCache) { this.database = database; this.cache = cache.jobState(); }

  private namespace(table: string, selected: string): string {
    const logical = table.replace(/_(?:archive|history)$/, "");
    const shape = createHash("sha256").update(selected).digest("hex");
    return `cp-rows:${this.database}:${logical}:${shape}`;
  }

  async remember(table: string, row: Row): Promise<void> {
    await this.cache.row({namespace:this.namespace(table,"value"),key:row.id,current:async()=>({etag:String(row.revision),value:row})});
  }

  async one(query: Query, table: string, id: string, selected = "value", project?: (value:unknown)=>unknown): Promise<Row | null> {
    return this.cache.row<Row>({ namespace: this.namespace(table, selected), key: id, current: async etag => {
      const full=etag===null&&project?await this.cache.readCheckpoint<Row>(this.namespace(table,"value"),id):null;
      const expected=etag??(full?String(full.revision):null);
      const [row] = await query(`SELECT id,revision,updated_at,revision::text=$2::text AS __unchanged,
        CASE WHEN revision::text=$2::text THEN NULL ELSE ${selected} END AS value FROM ${table} WHERE id=$1`, [id, expected]) as (Row & { __unchanged: boolean })[];
      if (!row) return null;
      if (row.__unchanged === true) return full&&project?{etag:String(row.revision),value:{...full,value:project(full.value)}}
        :{ etag: String(row.revision), unchanged: true };
      const value: Row = { id: row.id, revision: row.revision, updated_at: row.updated_at, value: row.value };
      return { etag: String(row.revision), value };
    } });
  }

  async known<T>(table: string, versions: readonly { id: string; revision: number | string }[], selected: string,
    values: (ids: readonly string[]) => Promise<readonly T[]>, keyOf: (row: T) => string,
    revisionOf: (row: T) => string): Promise<readonly T[]> {
    // Hot, archive and history are one logical row with the same revision.
    const namespace=this.namespace(table,selected),scan=createHash("sha256").update(versions.map(row=>row.id).join("\n")).digest("hex");
    const previous=await this.cache.readCheckpoint<{after:string}>(`${namespace}:values`,scan);
    const ordered=previous ? [...versions.filter(row=>row.id>previous.after),...versions.filter(row=>row.id<=previous.after)] : versions;
    const result=new Map<string,T>();
    for(let at=0;at<ordered.length;at+=PAGE) {
      withinPass(table);
      const page=ordered.slice(at,at+PAGE);
      const rows=await this.cache.rows({namespace,keys:page.map(row=>row.id),
        versions:async()=>page.map(row=>({key:row.id,etag:String(row.revision)})),values,keyOf,etagOf:revisionOf});
      for(const row of rows)result.set(keyOf(row),row);
      await this.cache.checkpoint(`${namespace}:values`,scan,{after:page.at(-1)!.id});
    }
    await this.cache.checkpoint(`${namespace}:values`,scan,null);
    return versions.flatMap(row=>result.has(row.id)?[result.get(row.id)!]:[]);
  }

  async rows(query: Query, table: string, predicate: string, params: readonly unknown[], selected = "value", resume = true): Promise<Row[]> {
    const result: Row[] = [];
    const checkpoints = resume && !currentReaderRoute().startsWith("admin:");
    const scan = createHash("sha256").update(JSON.stringify([table,predicate,params,selected])).digest("hex");
    const namespace = `cp-scan:${this.database}`;
    const previous = checkpoints ? await this.cache.readCheckpoint<{after:string}>(namespace,scan) : null;
    const prefix = previous?.after ?? null;
    let after: string | null = prefix;
    for (;;) {
      withinPass(table);
      const filters = [predicate, after === null ? "" : `id > $${params.length + 1}`].filter(Boolean);
      // Admin already diffs these exact result rows at the HTTP transport. Avoid a second protocol there.
      if (currentReaderRoute().startsWith("admin:")) {
        const rows = await query(`SELECT id,revision,updated_at,${selected} AS value FROM ${table}${filters.length ? ` WHERE ${filters.join(" AND ")}` : ""}
          ORDER BY id LIMIT ${PAGE}`, after === null ? params : [...params, after]) as Row[];
        result.push(...rows);
        if (rows.length < PAGE) return result;
        after = rows.at(-1)!.id;
        continue;
      }
      const versions = await query(`SELECT id,revision FROM ${table}${filters.length ? ` WHERE ${filters.join(" AND ")}` : ""}
        ORDER BY id LIMIT ${PAGE}`, after === null ? params : [...params, after]) as { id: string; revision: number | string }[];
      const rows = await this.known(table, versions, selected, async ids => {
        const found: Row[] = [];
        for (let at = 0; at < ids.length; at += 100) {
          const chunk = await query(`SELECT id,revision,updated_at,${selected} AS value FROM ${table}
            WHERE ${predicate ? `(${predicate}) AND ` : ""}id=ANY($${params.length + 1}::text[]) ORDER BY id`,
          [...params, ids.slice(at, at + 100)]) as Row[];
          found.push(...chunk);
        }
        return found;
      }, row => row.id, row => String(row.revision));
      result.push(...rows);
      if (versions.length < PAGE) {
        // Refresh membership of the completed prefix as well: an item closed, removed from this query
        // or inserted before the saved cursor during the interruption must not be missed.
        const earlier = prefix ? await this.rows(query,table,
          [predicate,`id <= $${params.length+1}`].filter(Boolean).map(filter=>`(${filter})`).join(" AND "),[...params,prefix],selected,false) : [];
        if (checkpoints) await this.cache.checkpoint(namespace,scan,null);
        return [...earlier,...result];
      }
      after = versions.at(-1)!.id;
      if (checkpoints) await this.cache.checkpoint(namespace,scan,{after});
    }
  }
}

const readers = new WeakMap<object, RevisionReads>();
let sequence = 0;
export function revisionReadsFor(sql: object): RevisionReads {
  let held = readers.get(sql);
  if (!held) { held = new RevisionReads(`connection-${++sequence}`, fallback); readers.set(sql, held); }
  return held;
}

export function shareRevisionReads(sql: object, connection: string, cache = runtimeCivicReadCache() ?? fallback): void {
  const url = new URL(connection);
  const identity = createHash("sha256").update(url.hostname.replace("-pooler.", ".") + url.pathname).digest("hex");
  readers.set(sql, new RevisionReads(identity, cache));
}
