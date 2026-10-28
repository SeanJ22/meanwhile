import { createHash } from "node:crypto";
import { CivicReadCache, runtimeCivicReadCache } from "./civic-read-cache.ts";
import { currentStoreBudget, ControlPlaneRequestTimeout } from "../control-plane/repository/request-bounds.ts";
import { passDeadlineFromEnv } from "../ops/independent-runtime-pass.ts";
import { hasValueVersion, ValueRows } from "./value-rows.ts";

type Row = Record<string, unknown> & { id: string; revision: number | string; updated_at: unknown; value: unknown };
type Query = (text: string, params: readonly unknown[]) => Promise<unknown>;
type LogRow = Record<string, unknown> & { log_key: string; position: number | string; changed_at?: unknown; record: unknown };
const PAGE = 100;
const digest = (text: string) => createHash("sha256").update(text).digest("hex");
const logKey = (row: {log_key:string;position:number|string}) => JSON.stringify([row.log_key,String(row.position)]);
function withinPass(table: string): void {
  const budget = currentStoreBudget();
  if (Date.now() >= Math.min(budget?.deadlineMs ?? Infinity, passDeadlineFromEnv())) {
    throw new ControlPlaneRequestTimeout({ operation: `${table}.changedRows`, callClass: "PAGE", timeoutMs: 0,
      kind: "DEADLINE", budget: budget?.label ?? "source pass" });
  }
}

/** SQL adapters only. CivicReadCache owns every held body and validates each use. */
export class VersionedRows {
  private readonly database: string;
  private readonly cache: CivicReadCache;
  private readonly values: ValueRows;
  constructor(database: string, cache: CivicReadCache) {
    this.database=database;this.cache=cache;this.values=new ValueRows(database,cache);
  }

  /** A job's narrowed continuation, scoped to this database and confirmed by its current fingerprint. */
  async cached<T>(namespace: string, key: string, current: (etag: string | null, held?: T) => Promise<
    { readonly etag: string; readonly value: T } | { readonly etag: string; readonly unchanged: true } | null>): Promise<T | null> {
    return this.cache.jobState().row({ namespace: `${this.database}:${namespace}`, key, current });
  }

  private namespace(table: string, selected: string): string {
    return `rows:${this.database}:${table.replace(/_(?:archive|history)$/, "")}:${digest(selected)}`;
  }

  /** A successful write supplies bytes already owned by the caller; reads still confirm their revision. */
  async remember(table: string, row: Row): Promise<void> {
    if (hasValueVersion(table)) return this.values.remember(table, row);
    await this.cache.row({namespace: this.namespace(table, "value"), key: row.id,
      current: async () => ({etag: String(row.revision), value: row})});
  }

  async one(query: Query, table: string, id: string, selected = "value", project?: (value: unknown) => unknown, params:readonly unknown[]=[]): Promise<Row | null> {
    if (hasValueVersion(table)) return this.values.one(query, table, id, selected, params);
    return this.cache.row<Row>({namespace: this.namespace(table, params.length?`${selected}:${JSON.stringify(params)}`:selected), key: id,
      ...(project ? {source: {namespace: this.namespace(table, "value"), project: (row: Row) => ({...row,value: project(row.value)}),
        // A successful local write can already own a revision newer than this
        // selected copy. The same SQL comparison still confirms its use.
        newer: (source: string, held: string) => /^\d+$/.test(source) && /^\d+$/.test(held) && BigInt(source) > BigInt(held)}} : {}),
      current: async etag => {
        const [row] = await query(`SELECT id,revision,updated_at,revision::text=$2::text AS __unchanged,
          CASE WHEN revision::text=$2::text THEN NULL ELSE ${selected} END AS value FROM ${table} WHERE id=$1`,
        [id,etag,...params]) as (Row & {__unchanged:boolean})[];
        if (!row) return null;
        if (row.__unchanged === true) return {etag: String(row.revision),unchanged: true};
        return {etag: String(row.revision),value: {id:row.id,revision:row.revision,updated_at:row.updated_at,value:row.value}};
      }});
  }

  async known<T>(table: string, versions: readonly {id:string;revision:number|string}[], selected: string,
    values: (ids: readonly string[]) => Promise<readonly T[]>, keyOf: (row:T)=>string,
    revisionOf:(row:T)=>string): Promise<readonly T[]> {
    const result = new Map<string,T>();
    for (let at=0;at<versions.length;at+=PAGE) {
      withinPass(table);
      const page=versions.slice(at,at+PAGE);
      const rows=await this.cache.rows({namespace:this.namespace(table,selected),keys:page.map(row=>row.id),
        versions:async()=>page.map(row=>({key:row.id,etag:String(row.revision)})),values,keyOf,etagOf:revisionOf});
      for (const row of rows) result.set(keyOf(row),row);
    }
    return versions.flatMap(row=>result.has(row.id)?[result.get(row.id)!]:[]);
  }

  async rows(query: Query, table: string, predicate: string, params: readonly unknown[], selected="value",
    page?: (rows: readonly Row[]) => Promise<void> | void, includeChangedAt = false,
    accept?: (row: { id: string; revision: number | string }) => boolean): Promise<Row[]> {
    if (hasValueVersion(table)) return this.values.rows(query, table, predicate, params, selected, page, includeChangedAt, accept);
    const result:Row[]=[];
    let after:string|null=null;
    for (;;) {
      withinPass(table);
      const filters=[predicate,after===null?"":`id > $${params.length+1}`].filter(Boolean);
      const versions=await query(`SELECT id,revision FROM ${table}${filters.length?` WHERE ${filters.join(" AND ")}`:""}
        ORDER BY id LIMIT ${PAGE}`,after===null?params:[...params,after]) as {id:string;revision:number|string}[];
      const rows=await this.known(table,versions,selected,async ids=>await query(
        `SELECT id,revision,updated_at,${selected} AS value FROM ${table}
         WHERE ${predicate?`(${predicate}) AND `:""}id=ANY($${params.length+1}::text[]) ORDER BY id`,[...params,ids]) as Row[],
      row=>row.id,row=>String(row.revision));
      if (page) await page(rows);
      else result.push(...rows);
      if (versions.length<PAGE) return result;
      after=versions.at(-1)!.id;
    }
  }

  async selectedRows(query:Query,table:string,membership:string,params:readonly unknown[],selected="value"):Promise<Row[]> {
    if (hasValueVersion(table)) return this.values.selectedRows(query, table, membership, params, selected);
    const versions=await query(`SELECT picked.id,source.revision FROM
      (SELECT members.*,row_number() OVER() AS __order FROM (${membership}) members) picked
      JOIN ${table} source USING(id) ORDER BY picked.__order`,params) as {id:string;revision:number|string}[];
    return [...await this.known(table,versions,selected,async ids=>await query(
      `SELECT id,revision,updated_at,${selected} AS value FROM ${table} WHERE id=ANY($1::text[])`,[ids]) as Row[],
    row=>row.id,row=>String(row.revision))];
  }

  /** Arbitrary bounded membership selection, then only changed log-slot bodies. */
  async selectedLogs(query: Query, table: string, membership: string, params: readonly unknown[], selected="record", metadata=""): Promise<LogRow[]> {
    const versions=await query(`SELECT picked.log_key,picked.position,concat(source.xmin::text,'/',source.ctid::text) AS etag
      FROM (SELECT members.*,row_number() OVER() AS __order FROM (${membership}) members) picked
      JOIN ${table} source USING(log_key,position) ORDER BY picked.__order`,params) as {log_key:string;position:number|string;etag:string}[];
    const ordered=versions.map(row=>({...row,key:logKey(row)}));
    const result=await this.cache.rows({namespace:this.namespace(table,`log:${selected}:${metadata}`),keys:ordered.map(row=>row.key),
      versions:async()=>ordered,
      values:async keys=>{
        const ids=keys.map(key=>JSON.parse(key) as [string,string]);
        const found:(LogRow & {__etag:string})[]=[];
        for(let at=0;at<ids.length;at+=PAGE) {
          const page=ids.slice(at,at+PAGE);
          found.push(...await query(`SELECT log_key,position,${selected} AS record${metadata?`,${metadata}`:""},
            concat(xmin::text,'/',ctid::text) AS __etag FROM ${table}
            WHERE (log_key,position) IN (SELECT * FROM unnest($1::text[],$2::bigint[])) LIMIT ${PAGE}`,
          [page.map(row=>row[0]),page.map(row=>row[1])]) as (LogRow & {__etag:string})[]);
        }
        return found;
      },keyOf:logKey,etagOf:row=>String(row.__etag)});
    return [...result];
  }

  async keys(query: Query, table: string, keys: readonly string[], selected="record"): Promise<ReadonlyMap<string,readonly unknown[]>> {
    const result=new Map<string,unknown[]>();
    for (let at=0;at<keys.length;at+=PAGE) {
      let after:{key:string;position:number|string}|null=null;
      for (;;) {
        withinPass(table);
        const rows=await this.selectedLogs(query,table,`SELECT log_key,position FROM ${table}
          WHERE log_key = ANY($1::text[])${after===null?"":" AND (log_key,position)>($2::text,$3::bigint)"}
          ORDER BY log_key, position LIMIT ${PAGE}`,[keys.slice(at,at+PAGE),...(after===null?[]:[after.key,after.position])],selected);
        for (const row of rows) {
          const values=result.get(row.log_key)??[];
          values.push(typeof row.record==="string"?JSON.parse(row.record):row.record);
          result.set(row.log_key,values);
        }
        if(rows.length<PAGE)break;
        const last=rows.at(-1)!;after={key:last.log_key,position:last.position};
      }
    }
    return result;
  }
}

const readers=new WeakMap<object,VersionedRows>();
let sequence=0;
export function versionedRowsFor(sql:object):VersionedRows {
  let rows=readers.get(sql);
  if(!rows){rows=new VersionedRows(`connection-${++sequence}`,runtimeCivicReadCache());readers.set(sql,rows);}
  return rows;
}
export function shareVersionedRows(sql:object,connection:string,cache=runtimeCivicReadCache(connection)):void {
  const url=new URL(connection);
  const database=digest(url.hostname.replace("-pooler.",".")+url.pathname);
  readers.set(sql,new VersionedRows(database,cache));
}
