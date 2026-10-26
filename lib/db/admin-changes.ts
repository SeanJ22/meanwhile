import { createHash } from "node:crypto";
import { currentReaderRoute } from "./reader-route.ts";
import { countedFetchSlot } from "./transfer-by-caller.ts";

type FetchLike = typeof fetch;
interface Statement { query: string; params?: unknown[] }
interface Result { command: string; rowCount: number; fields: { name: string; dataTypeID: number }[]; rows: (string | null)[][] }
interface Held { readonly result: Result; readonly hashes: readonly string[]; readonly bytes: number }
const LIMIT_BYTES = 32 * 1024 * 1024;
const MAX_ENTRIES = 512;
const changedFetchSlot=Symbol.for('meanwhile.database.admin-changes.fetch');
type MarkedFetch=FetchLike&{[countedFetchSlot]?:boolean;[changedFetchSlot]?:boolean};
const md5 = (value: string) => createHash("md5").update(value).digest("hex");
// PostgreSQL's jsonb array text has a space after each comma. Elements here are wire text or null.
const rowHash = (row: readonly (string | null)[]) => md5(`[${row.map(value => JSON.stringify(value)).join(", ")}]`);

/** Admin asks PostgreSQL for changed result rows. Original field types and row order reach the driver intact.
 * Every query still executes: inserts, removals, filters, counts and time-dependent answers are observed on
 * this read. Held results only save transfer; losing them causes a fresh read and never a stale answer.
 */
export function adminChangesFetch(fetch: FetchLike): FetchLike {
  if((fetch as MarkedFetch)[changedFetchSlot])return fetch;
  const held = new Map<string, Held>();
  let bytes = 0;
  const keep = (key: string, result: Result) => {
    const previous = held.get(key);
    if (previous) { bytes -= previous.bytes; held.delete(key); }
    const size = Buffer.byteLength(JSON.stringify(result));
    if (size > LIMIT_BYTES || result.command !== "SELECT" || new Set(result.fields.map(field => field.name)).size !== result.fields.length ||
      result.rows.some(row => !Array.isArray(row) || row.some(value => value !== null && typeof value !== "string"))) return;
    while (held.size && (bytes + size > LIMIT_BYTES || held.size >= MAX_ENTRIES)) {
      const oldest = held.keys().next().value!;
      bytes -= held.get(oldest)!.bytes; held.delete(oldest);
    }
    held.set(key, { result, bytes: size, hashes: result.rows.map(rowHash) }); bytes += size;
  };
  const changedFetch:FetchLike=async (input, init) => {
    if (!currentReaderRoute().startsWith("admin:") || typeof init?.body !== "string") return fetch(input, init);
    const headers = new Headers(init.headers);
    if (headers.get("neon-raw-text-output") !== "true" || headers.get("neon-array-mode") !== "true") return fetch(input, init);
    let request: Statement & { queries?: Statement[] };
    try { request = JSON.parse(init.body); } catch { return fetch(input, init); }
    const statements = request.queries ?? [request];
    const entries = statements.map(statement => {
      const key = md5(`${headers.get("neon-connection-string")}\n${currentReaderRoute()}\n${statement.query}`);
      const previous = held.get(key);
      // Side effects never go into a read CTE. Parameters deliberately are not part of the cache key:
      // the current query executes with its current parameters and diffs against this caller's last answer.
      if (!previous || !/^\s*(SELECT|WITH)\b/i.test(statement.query) || /\b(INSERT|UPDATE|DELETE|MERGE|FOR\s+SHARE)\b/i.test(statement.query)) return { key, previous: null, statement };
      const params = statement.params ?? [];
      const columns = previous.result.fields.map(field => {
        const column = `r."${field.name.replaceAll('"', '""')}"`;
        // These casts differ from their wire representation (t/f and padded char).
        return field.dataTypeID === 16 ? `pg_catalog.boolout(${column})::text`
          : field.dataTypeID === 1042 ? `pg_catalog.bpcharout(${column})::text` : `${column}::text`;
      });
      if (!columns.length) return { key, previous: null, statement };
      const query = `WITH __mw_admin_rows AS MATERIALIZED (${statement.query.trim().replace(/;+$/, "")}),
        __mw_admin_index AS MATERIALIZED (SELECT row_number() OVER () AS n, jsonb_build_array(${columns.join(",")}) AS v FROM __mw_admin_rows r)
        SELECT jsonb_build_object('length',count(*),'changed',coalesce(jsonb_agg(jsonb_build_array(n,v) ORDER BY n)
          FILTER (WHERE md5(v::text) IS DISTINCT FROM $${params.length + 1}::jsonb ->> ((n-1)::int)), '[]'::jsonb)) AS delta FROM __mw_admin_index`;
      return { key, previous, statement: { query, params: [...params, JSON.stringify(previous.hashes)] } };
    });
    const changed = request.queries ? { ...request, queries: entries.map(entry => entry.statement) } : entries[0].statement;
    const response = await fetch(input, { ...init, body: JSON.stringify(changed) });
    if (!response.ok) return response;
    const envelope = await response.json() as Result & { results?: Result[] };
    const results = envelope.results ?? [envelope];
    const restored = results.map((result, index) => {
      const entry = entries[index];
      if (!entry) throw new Error("Admin database response has an unexpected result count");
      if (entry.previous) {
        const delta = JSON.parse(result.rows[0][0]!) as { length: number; changed: [number, (string | null)[]][] };
        const rows = entry.previous.result.rows.slice(0, delta.length);
        for (const [position, row] of delta.changed) rows[position - 1] = row;
        if (rows.length !== delta.length || Array.from({length:delta.length},(_,index)=>rows[index]).some(row => !row)) throw new Error("Admin changed rows are incomplete");
        result = { ...entry.previous.result, rowCount: delta.length, rows };
      }
      keep(entry.key, result);
      return result;
    });
    return new Response(JSON.stringify(envelope.results ? { ...envelope, results: restored } : restored[0]), {
      status: response.status, statusText: response.statusText,
      headers: { "content-type": "application/json" },
    });
  };
  Object.defineProperty(changedFetch,changedFetchSlot,{value:true});
  if((fetch as MarkedFetch)[countedFetchSlot])Object.defineProperty(changedFetch,countedFetchSlot,{value:true});
  return changedFetch;
}
