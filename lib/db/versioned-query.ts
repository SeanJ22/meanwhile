import { createHash } from "node:crypto";
import { deserialize, serialize } from "node:v8";
import { CivicReadCache, runtimeCivicReadCache } from "./civic-read-cache.ts";
import { singleStatementText, versionedStatementParts } from "./statement-kind.ts";

type Row = Record<string, unknown>;
export type VersionedSelectQuery = (text: string, params: readonly unknown[]) => Promise<readonly Row[]>;
interface SavedRow { readonly etag: string; readonly body: string }
export interface VersionedRowRetention { readonly rows: Map<string,string>; bytes: number }
const hash = (value: Uint8Array) => createHash("sha256").update(value).digest("hex");
// The bundler can copy this module into several server chunks; the driver and the reader must share one map.
// Identical concurrent statements are counted so one finishing never unmarks the other.
const activeStatements: Map<string, number> = ((globalThis as { [key: symbol]: Map<string, number> | undefined })[Symbol.for("meanwhile.versionedSelectStatements.v2")] ??= new Map<string, number>());
/** Transport adapters recognize only the exact checked statement currently executing. */
export const isVersionedSelectStatement = (text: string): boolean => activeStatements.has(text);

function resultScope(value: unknown): unknown {
  // A moving read window changes membership, not the identity of held row bodies.
  // The executed query and every returned content version still use the actual time.
  if (value instanceof Date || typeof value === "string" && /^\d{4}-\d{2}-\d{2}(?:$|[T ])/.test(value)) return "timestamp";
  if (Array.isArray(value)) return value.map(resultScope);
  if (value && typeof value === "object" && [Object.prototype, null].includes(Object.getPrototypeOf(value)))
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resultScope(item)]));
  return value;
}

/** PostgreSQL checks result-row versions and suppresses unchanged typed bodies in
 * one statement and one snapshot. Membership, ordering and database field types
 * participate in the current result; only changed bodies cross the connection.
 */
export function versionedSelect(connection: string, cache: CivicReadCache = runtimeCivicReadCache(connection), options: {readonly rowScope?: string;readonly retention?:VersionedRowRetention;readonly retainRow?:(row:Row)=>boolean} = {}) {
  // Scoped, turn-local reuse tags use 128 bits of SHA-256; saved source and build fingerprints keep all 256 bits.
  const rowRetention=options.retention ?? {rows:new Map<string,string>(),bytes:0};
  const scopeRows=new Set<string>();
  return async (query: VersionedSelectQuery, text: string, params: readonly unknown[] = []): Promise<Row[]> => {
    const statement = singleStatementText(text), parts = versionedStatementParts(statement);
    const key = hash(serialize([statement, options.rowScope ?? resultScope(params)]));
    const saved = await cache.row<readonly SavedRow[]>({
      namespace: "sql-result:v2", key,
      current: async (previous, held = []) => {
        const bodies = new Map([...rowRetention.rows].filter(([key])=>scopeRows.has(key)).concat(held.map(row => [row.etag, row.body] as [string,string])));
        // Aliases depend only on SQL, never the call, held rows or parameters.
        // Keep the names outside the caller's text without churning query text.
        let token = hash(Buffer.from(statement)).slice(0, 16);
        while (statement.includes(`_${token}`)) token = hash(Buffer.from(token)).slice(0, 16);
        const source = `db04_source_${token}`, tagged = `db04_rows_${token}`, selected = `db04_selected_${token}`;
        const ordinal = `db04_ordinal_${token}`, etag = `db04_etag_${token}`, unchanged = `db04_unchanged_${token}`;
        const version = `db04_version_${token}`, retained = `db04_retained_${token}`;
        const digest=`sha256(convert_to(row_to_json(${source})::text, 'UTF8') || record_send(${source}))`;
        const fingerprint=options.rowScope ? `encode(substring(${digest} from 1 for 16),'base64')` : `encode(${digest},'hex')`;
        const checked = `${parts.prefix ? parts.prefix + "," : "WITH"} ${source} AS MATERIALIZED (${parts.query}
        ), ${tagged} AS MATERIALIZED (
          SELECT ${source}.*, row_number() OVER () AS ${ordinal},
            ${fingerprint} AS ${etag}
          FROM ${source}
        ), ${selected} AS MATERIALIZED (
          SELECT *, (${etag}=ANY($${params.length + 1}::text[]) OR ${ordinal}<>min(${ordinal}) OVER (PARTITION BY ${etag})) AS ${unchanged}
          FROM ${tagged}
        ) SELECT body.*, current.${etag} AS ${version}, current.${unchanged} AS ${retained}
          FROM ${selected} current LEFT JOIN LATERAL (
            SELECT current.* WHERE NOT current.${unchanged}
          ) body ON true ORDER BY current.${ordinal}`;
        let rows: readonly Row[];
        activeStatements.set(checked, (activeStatements.get(checked) ?? 0) + 1);
        try { rows = await query(checked, [...params, [...bodies.keys()]]); }
        finally {
          const remaining = activeStatements.get(checked)! - 1;
          if (remaining) activeStatements.set(checked, remaining);
          else activeStatements.delete(checked);
        }
        const result: SavedRow[] = [];
        for (const row of rows) {
          if (typeof row[version] !== "string" || !(options.rowScope ? /^[A-Za-z0-9+/]{22}==$/ : /^[a-f0-9]{64}$/).test(row[version] as string) || typeof row[retained] !== "boolean") {
            throw new Error("A SQL read returned no database row version");
          }
          const revision = String(row[version]);
          let body = bodies.get(revision);
          if (row[retained] !== true) {
            const value = { ...row };
            delete value[ordinal]; delete value[etag]; delete value[unchanged]; delete value[version]; delete value[retained];
            // JSON copies cannot preserve the driver's dates, bigint and binary fields.
            body = serialize(value).toString("base64");
            bodies.set(revision, body);
          }
          if (body === undefined) throw new Error("An unchanged SQL row has no held body");
          result.push({ etag: revision, body });
          if(options.rowScope && (!options.retainRow || options.retainRow(deserialize(Buffer.from(body,"base64")) as Row))) {
            scopeRows.add(revision);
            if(rowRetention.rows.has(revision))rowRetention.rows.delete(revision);
            else rowRetention.bytes+=body.length;
            rowRetention.rows.set(revision,body);
            while(rowRetention.bytes>128*1024*1024 && rowRetention.rows.size) {
              const oldest=rowRetention.rows.keys().next().value!;rowRetention.bytes-=rowRetention.rows.get(oldest)!.length;rowRetention.rows.delete(oldest);
            }
          }
        }
        const revision = hash(serialize(result.map(row => row.etag)));
        return previous === revision ? { etag: revision, unchanged: true }
          : { etag: revision, value: result };
      },
    });
    return (saved ?? []).map(row => deserialize(Buffer.from(row.body, "base64")) as Row);
  };
}
