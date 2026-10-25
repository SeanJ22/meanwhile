import { createHash } from "node:crypto";
import { CivicReadCache, runtimeCivicReadCache } from "../../db/civic-read-cache.ts";
import { currentReaderRoute } from "../../db/reader-route.ts";

type Row = Record<string, unknown> & { id: string; revision: number | string; updated_at: unknown; value: unknown };
type Query = (text: string, params: readonly unknown[]) => Promise<unknown>;
const PAGE = 100;
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
  constructor(database: string, cache: CivicReadCache) { this.database = database; this.cache = cache; }

  private namespace(table: string, selected: string): string {
    const logical = table.replace(/_(?:archive|history)$/, "");
    const shape = createHash("sha256").update(selected).digest("hex");
    return `cp-rows:${this.database}:${logical}:${shape}`;
  }

  async one(query: Query, table: string, id: string, selected = "value"): Promise<Row | null> {
    return this.cache.row<Row>({ namespace: this.namespace(table, selected), key: id, current: async etag => {
      const [row] = await query(`SELECT id,revision,updated_at,revision::text=$2::text AS __unchanged,
        CASE WHEN revision::text=$2::text THEN NULL ELSE ${selected} END AS value FROM ${table} WHERE id=$1`, [id, etag]) as (Row & { __unchanged: boolean })[];
      if (!row) return null;
      if (row.__unchanged === true) return { etag: String(row.revision), unchanged: true };
      const value: Row = { id: row.id, revision: row.revision, updated_at: row.updated_at, value: row.value };
      return { etag: String(row.revision), value };
    } });
  }

  async known<T>(table: string, versions: readonly { id: string; revision: number | string }[], selected: string,
    values: (ids: readonly string[]) => Promise<readonly T[]>, keyOf: (row: T) => string,
    revisionOf: (row: T) => string): Promise<readonly T[]> {
    // Hot, archive and history are one logical row with the same revision.
    return this.cache.rows({ namespace: this.namespace(table, selected),
      keys: versions.map(row => row.id),
      versions: async () => versions.map(row => ({ key: row.id, etag: String(row.revision) })),
      values, keyOf, etagOf: revisionOf });
  }

  async rows(query: Query, table: string, predicate: string, params: readonly unknown[], selected = "value"): Promise<Row[]> {
    const result: Row[] = [];
    let after: string | null = null;
    for (;;) {
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
      if (versions.length < PAGE) return result;
      after = versions.at(-1)!.id;
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
