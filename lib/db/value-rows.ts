import { createHash } from "node:crypto";
import { CivicReadCache } from "./civic-read-cache.ts";
import { currentStoreBudget, ControlPlaneRequestTimeout } from "../control-plane/repository/request-bounds.ts";
import { passDeadlineFromEnv } from "../ops/independent-runtime-pass.ts";

type Query = (text: string, params: readonly unknown[]) => Promise<unknown>;
type Row = Record<string, unknown> & { id: string; revision: number | string; updated_at: unknown; value: unknown };
type Version = { id: string; revision: number | string; updated_at: unknown; changed_at?: unknown; value_version: string };
type HeldVersion = Version & { row_version: string };
interface HeldMembership { readonly readAt: string; readonly versions: readonly HeldVersion[] }
const heldVersion = (row: HeldVersion, includeChangedAt: boolean): HeldVersion => ({ id: row.id, revision: row.revision,
  updated_at: row.updated_at, value_version: row.value_version, row_version: row.row_version,
  ...(includeChangedAt ? { changed_at: row.changed_at } : {}) });
const PAGE = 100;
// Bundled copies of this module and the driver must share one map (see versioned-query.ts).
const checkedStatements: Map<string, number> = ((globalThis as { [key: symbol]: Map<string, number> | undefined })[Symbol.for("meanwhile.valueVersionStatements")] ??= new Map<string, number>());
/** Only the exact statements executing this content-version protocol qualify. */
export const isValueVersionStatement = (text: string): boolean => checkedStatements.has(text);
async function checkedQuery(query: Query, text: string, params: readonly unknown[]): Promise<unknown> {
  checkedStatements.set(text, (checkedStatements.get(text) ?? 0) + 1);
  try { return await query(text, params); }
  finally {
    const remaining = checkedStatements.get(text)! - 1;
    if (remaining) checkedStatements.set(text, remaining);
    else checkedStatements.delete(text);
  }
}
/** Other explicit content-fingerprint readers use the same transport protocol. */
export { checkedQuery as checkedValueQuery };
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
export const valueVersionSql = (selected: string) => `encode(sha256(convert_to(coalesce((${selected})::text, ''), 'UTF8')), 'hex')`;

// Owner snapshots have their own DB-05 change. These are the standing workers'
// rows, including the same identities after an archive move.
export const hasValueVersion = (table: string): boolean =>
  /^cp_(?:work_items|occurrences|route_tasks)(?:_history|_archive)?$/.test(table) ||
  table === "cp_obligations" || table === "cp_doors";

/** A body's content version is independent of CAS revisions and timestamps.
 * Every use checks current membership and metadata; only missing or changed
 * selected values cross the connection. No schema change or production copy.
 */
export class ValueRows {
  private readonly database: string;
  private readonly cache: CivicReadCache;
  constructor(database: string, cache: CivicReadCache) { this.database = database; this.cache = cache; }

  private namespace(table: string, selected: string): string {
    return `values:${this.database}:${table.replace(/_(?:archive|history)$/, "")}:${hash(selected.replaceAll(`${table}.value`, "value"))}`;
  }

  private withinPass(table: string): void {
    const budget = currentStoreBudget();
    if (Date.now() >= Math.min(budget?.deadlineMs ?? Infinity, passDeadlineFromEnv())) {
      throw new ControlPlaneRequestTimeout({ operation: `${table}.changedValues`, callClass: "PAGE", timeoutMs: 0,
        kind: "DEADLINE", budget: budget?.label ?? "source pass" });
    }
  }

  private metadataSource(table: string, includeChangedAt: boolean): { from: string; native: string } {
    const native = (name: string) => `concat(${name}.tableoid::text,'/',pg_relation_filenode(${name}.tableoid)::text,'/',${name}.xmin::text,'/',${name}.ctid::text)`;
    if (!table.endsWith("_history")) return { from: table, native: native(table) };
    const hot = table.slice(0, -"_history".length), archive = `${hot}_archive`;
    const columns = `id,revision,updated_at,${includeChangedAt ? "changed_at," : ""}value`;
    return { from: `(SELECT ${columns},${native(hot)} AS __native_version FROM ${hot}
      UNION ALL SELECT ${columns},${native(archive)} AS __native_version FROM ${archive}) ${table}`,
    native: `${table}.__native_version` };
  }

  private async metadata(query: Query, table: string, predicate: string, params: readonly unknown[], selected: string,
    includeChangedAt: boolean): Promise<Version[]> {
    const source = this.metadataSource(table, includeChangedAt);
    const rowVersion = `encode(sha256(convert_to(jsonb_build_array(id,revision::text,updated_at,
      ${includeChangedAt ? "changed_at" : "NULL"},${source.native})::text,'UTF8')),'hex')`;
    const namespace = `membership:v2:${this.database}:${table}:${hash(selected)}:${hash(predicate)}:${includeChangedAt}`;
    const held = await this.cache.row<HeldMembership>({ namespace, key: hash(JSON.stringify(params)), current: async (etag, previous) => {
      this.withinPass(table);
      const [current] = await checkedQuery(query, `SELECT count(*) AS count,now()::text AS read_at,
        encode(sha256(convert_to(coalesce(string_agg(row_version,'' ORDER BY id),''),'UTF8')),'hex') AS etag
        FROM (SELECT id,${rowVersion} AS row_version FROM ${source.from}${predicate ? ` WHERE ${predicate}` : ""}) versions`,
      params) as { count: number | string; read_at: string; etag: string }[];
      if (!current || !/^[a-f0-9]{64}$/.test(current.etag)) throw new Error("A membership read returned no database version");
      if (current.etag === etag) return { etag: current.etag, unchanged: true };
      if (Number(current.count) === 0) return { etag: current.etag, value: { readAt: current.read_at, versions: [] } };
      const changed = previous && !table.endsWith("_history")
        ? await this.changedSince(query, table, predicate, params, selected, includeChangedAt, rowVersion, previous, Number(current.count))
        : null;
      if (changed !== null && changed.etag === current.etag) return { etag: current.etag, value: { readAt: current.read_at, versions: changed.versions } };
      const versions: HeldVersion[] = [];
      const actual = createHash("sha256");
      let after: string | null = null;
      for (;;) {
        this.withinPass(table);
        const cursor = `$${params.length + 1}`;
        const page = await checkedQuery(query, `SELECT id,revision,updated_at,${includeChangedAt ? "changed_at," : ""}
          ${valueVersionSql(selected)} AS value_version,${rowVersion} AS row_version
          FROM ${source.from} WHERE ${predicate ? `(${predicate}) AND ` : ""}(${cursor}::text IS NULL OR id>${cursor})
          ORDER BY id LIMIT ${PAGE}`, [...params, after]) as HeldVersion[];
        for (const row of page) {
          if (!/^[a-f0-9]{64}$/.test(row.row_version)) throw new Error("A membership read returned no database row version");
          actual.update(row.row_version);
          versions.push(heldVersion(row, includeChangedAt));
        }
        if (page.length < PAGE) break;
        after = page.at(-1)!.id;
      }
      // Tag the metadata actually read, including races between pages. A later
      // database check can reuse it only if that exact membership is current.
      return { etag: actual.digest("hex"), value: { readAt: current.read_at, versions } };
    } });
    return held?.versions.map(({ row_version: _held, ...version }) => version) ?? [];
  }

  /** The held membership with only the rows changed since it was read. Rows that joined or left the
   * membership, or any difference from the database's own membership version, mean a full read instead. */
  private async changedSince(query: Query, table: string, predicate: string, params: readonly unknown[], selected: string,
    includeChangedAt: boolean, rowVersion: string, previous: HeldMembership, count: number): Promise<{ etag: string; versions: HeldVersion[] } | null> {
    if (previous.versions.length !== count || previous.versions.some(version => typeof version.row_version !== "string")) return null;
    const since = `$${params.length + 1}`, cursor = `$${params.length + 2}`;
    const changed: HeldVersion[] = [];
    let after: string | null = null;
    for (;;) {
      this.withinPass(table);
      // A writer's transaction stamps changed_at when it starts; the margin covers ones still open at the last read.
      let page: HeldVersion[];
      try {
        page = await checkedQuery(query, `SELECT id,revision,updated_at,${includeChangedAt ? "changed_at," : ""}
          ${valueVersionSql(selected)} AS value_version,${rowVersion} AS row_version
          FROM ${table} WHERE ${predicate ? `(${predicate}) AND ` : ""}changed_at >= ${since}::timestamptz - interval '5 minutes'
            AND (${cursor}::text IS NULL OR id>${cursor})
          ORDER BY id LIMIT ${PAGE}`, [...params, previous.readAt, after]) as HeldVersion[];
      } catch (error) {
        // A table without a change stamp reads its whole membership instead.
        if ((error as { code?: unknown }).code === "42703") return null;
        throw error;
      }
      changed.push(...page);
      if (changed.length > count) return null;
      if (page.length < PAGE) break;
      after = page.at(-1)!.id;
    }
    const at = new Map(previous.versions.map((version, index) => [version.id, index]));
    const versions = [...previous.versions];
    for (const row of changed) {
      const index = at.get(row.id);
      if (index === undefined || !/^[a-f0-9]{64}$/.test(row.row_version)) return null;
      versions[index] = heldVersion(row, includeChangedAt);
    }
    const actual = createHash("sha256");
    for (const version of versions) actual.update(version.row_version);
    return { etag: actual.digest("hex"), versions };
  }

  async remember(table: string, row: Row): Promise<void> {
    // Writers can supply the version returned by PostgreSQL without reading the
    // submitted value back. Never guess PostgreSQL's JSON representation in JS.
    if (typeof row.value_version !== "string") return;
    await this.cache.row<Row>({ namespace: this.namespace(table, "value"), key: row.id,
      current: async () => ({ etag: String(row.value_version), value: row }) });
  }

  async one(query: Query, table: string, id: string, selected: string, params: readonly unknown[] = []): Promise<Row | null> {
    let current: Version | undefined;
    const body = await this.cache.row<Row>({
      namespace: this.namespace(table, params.length ? `${selected}:${JSON.stringify(params)}` : selected), key: id,
      current: async etag => {
        const [row] = await checkedQuery(query, `WITH current_value AS MATERIALIZED (
          SELECT id,revision,updated_at,${selected} AS value FROM ${table} WHERE id=$1
        ), versioned_value AS (
          SELECT *,${valueVersionSql("value")} AS value_version FROM current_value
        ) SELECT id,revision,updated_at,value_version,value_version=$2::text AS __unchanged,
          CASE WHEN value_version=$2::text THEN NULL ELSE value END AS value FROM versioned_value`,
        [id, etag, ...params]) as (Row & { value_version: string; __unchanged: boolean })[];
        if (!row) return null;
        const { value, __unchanged, ...metadata } = row;
        current = { id: row.id, revision: row.revision, updated_at: row.updated_at,
          changed_at: row.changed_at, value_version: row.value_version };
        return __unchanged ? { etag: row.value_version, unchanged: true }
          : { etag: row.value_version, value: { ...metadata, value } as Row };
      },
    });
    return body && current ? { ...body, ...current } : null;
  }

  private async known(query: Query, table: string, versions: readonly Version[], selected: string,
    predicate = "", params: readonly unknown[] = [], includeChangedAt = false): Promise<Row[]> {
    const result = await this.cache.rows<Row, Version & { key: string; etag: string }>({
      namespace: this.namespace(table, selected), keys: versions.map(row => row.id),
      versions: async () => versions.map(row => ({ ...row, key: row.id, etag: row.value_version })),
      values: async ids => await checkedQuery(query, `SELECT id,revision,updated_at,${includeChangedAt ? "changed_at," : ""}${selected} AS value,
        ${valueVersionSql(selected)} AS value_version FROM ${table}
        WHERE ${predicate ? `(${predicate}) AND ` : ""}id=ANY($${params.length + 1}::text[])`, [...params, ids]) as Row[],
      keyOf: row => row.id, etagOf: row => String(row.value_version),
      freshen: (row, current) => ({ ...row, id: current.id, revision: current.revision,
        updated_at: current.updated_at, changed_at: current.changed_at, value_version: current.value_version }),
    });
    return [...result];
  }

  async rows(query: Query, table: string, predicate: string, params: readonly unknown[], selected: string,
    page?: (rows: readonly Row[]) => Promise<void> | void, includeChangedAt = false,
    accept?: (row: { id: string; revision: number | string }) => boolean): Promise<Row[]> {
    const result: Row[] = [];
    const current = await this.metadata(query, table, predicate, params, selected, includeChangedAt);
    const versions = accept ? current.filter(accept) : current;
    if (versions.length === 0 && page) await page([]);
    for (let at = 0; at < versions.length; at += PAGE) {
      this.withinPass(table);
      const rows = await this.known(query, table, versions.slice(at, at + PAGE), selected, predicate, params, includeChangedAt);
      if (page) await page(rows);
      else result.push(...rows);
    }
    return result;
  }

  async selectedRows(query: Query, table: string, membership: string, params: readonly unknown[], selected: string): Promise<Row[]> {
    const versions = await checkedQuery(query, `SELECT ${table}.id,${table}.revision,${table}.updated_at,
        ${valueVersionSql(selected)} AS value_version
      FROM (SELECT members.*,row_number() OVER() AS __order FROM (${membership}) members) picked
      JOIN ${table} USING(id) ORDER BY picked.__order`, params) as Version[];
    const result: Row[] = [];
    for (let at = 0; at < versions.length; at += PAGE) {
      this.withinPass(table);
      result.push(...await this.known(query, table, versions.slice(at, at + PAGE), selected));
    }
    return result;
  }
}
