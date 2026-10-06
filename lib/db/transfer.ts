import { AsyncLocalStorage } from "node:async_hooks";
import { neon, neonConfig } from "@neondatabase/serverless";
import { recordQueryBytes, startQueryBytesLog } from "./query-bytes.ts";

type FetchLike = typeof fetch;
export interface DatabaseTransfer {
  readonly day: string;
  readonly database: "reader" | "control-plane";
  readonly client: "reader" | "runner";
  readonly requests: number;
  readonly requestBytes: number;
  readonly responseBytes: number;
}

const internal = new AsyncLocalStorage<boolean>();
const pending = new Map<string, DatabaseTransfer>();
let installed = false;
let lastFlush = 0;
let flushing: Promise<boolean> | null = null;

/** Decoded HTTP body bytes, before parsing. This measures our reads, not Neon's billing lag. */
export function databaseTransferFetch(underlying: FetchLike, record: (value: DatabaseTransfer) => void | Promise<unknown>): FetchLike {
  return async (input, init) => {
    const response = await underlying(input, init);
    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
    const connection = headers.get("neon-connection-string");
    if (connection === null || internal.getStore()) return response;
    // A dedicated feedback branch is neither of these two civic databases.
    if (connection === process.env.FEEDBACK_DATABASE_URL && connection !== process.env.DATABASE_URL &&
        connection !== process.env.WTP_CONTROL_PLANE_DATABASE_URL) return response;
    const bytes = await response.arrayBuffer();
    recordQueryBytes(bytes.byteLength);
    await record({
      day: new Intl.DateTimeFormat("sv-SE", { timeZone: "America/New_York" }).format(new Date()),
      database: connection === process.env.DATABASE_URL ? "reader" : "control-plane",
      client: process.env.WTP_RUNTIME_AUTHORITY_CAPABILITY || process.env.WTP_SANCTIONED_WRITE === "routine-civic-data-promotion" ? "runner" : "reader",
      requests: 1,
      requestBytes: typeof init?.body === "string" ? Buffer.byteLength(init.body) : 0,
      responseBytes: bytes.byteLength,
    });
    return new Response([204, 205, 304].includes(response.status) ? null : bytes,
      { status: response.status, statusText: response.statusText, headers: response.headers });
  };
}

export function pendingDatabaseTransfer(): readonly DatabaseTransfer[] { return [...pending.values()]; }

/** One aggregate per day/database/client. A failed write keeps the pending bytes for the next flush. */
export async function flushDatabaseTransfer(): Promise<boolean> {
  if (flushing) return flushing;
  if (pending.size === 0) return true;
  const url = process.env.DATABASE_URL;
  if (!url) return false;
  lastFlush = Date.now();
  const batch = [...pending.entries()];
  for (const [key] of batch) pending.delete(key);
  flushing = internal.run(true, async () => {
    try {
      const sql = neon(url);
      await sql.transaction(batch.map(([, row]) => sql.query(
        `INSERT INTO database_transfer_daily (day, database_name, client, requests, request_bytes, response_bytes)
         VALUES ($1::date, $2, $3, $4, $5, $6)
         ON CONFLICT (day, database_name, client) DO UPDATE SET
         requests = database_transfer_daily.requests + EXCLUDED.requests,
         request_bytes = database_transfer_daily.request_bytes + EXCLUDED.request_bytes,
         response_bytes = database_transfer_daily.response_bytes + EXCLUDED.response_bytes,
         updated_at = now()`,
        [row.day, row.database, row.client, row.requests, row.requestBytes, row.responseBytes],
      )));
      lastFlush = Date.now();
      return true;
    } catch {
      for (const [, row] of batch) accumulate(row);
      return false;
    } finally { flushing = null; }
  });
  return flushing;
}

function accumulate(row: DatabaseTransfer): void {
  const key = `${row.day}:${row.database}:${row.client}`;
  const prior = pending.get(key);
  pending.set(key, prior ? { ...row, requests: prior.requests + row.requests,
    requestBytes: prior.requestBytes + row.requestBytes, responseBytes: prior.responseBytes + row.responseBytes } : row);
}

/** Shared Neon HTTP hook; query execution is unchanged and counter failure never hides data. */
export function installDatabaseTransferCounter(): void {
  if (installed) return;
  installed = true;
  startQueryBytesLog();
  neonConfig.fetchFunction = databaseTransferFetch((neonConfig.fetchFunction ?? fetch) as FetchLike, (row) => {
    accumulate(row);
    // An answered query must not wait on the accounting write to the reader database.
    if (Date.now() - lastFlush >= 60_000) void flushDatabaseTransfer();
  });
  // Long-running processes flush once a minute. The supervisor also awaits a flush before it exits.
  const timer = setInterval(() => { if (Date.now() - lastFlush >= 60_000) void flushDatabaseTransfer(); }, 60_000);
  timer.unref();
  // Short-lived acquisition/repair children also save their final partial minute.
  process.once("beforeExit", () => { void flushDatabaseTransfer(); });
}

export type DailyDatabaseTransferRead =
  | { readonly kind: "RECORDED"; readonly rows: readonly DatabaseTransfer[] }
  | { readonly kind: "NOT_INSTALLED"; readonly rows: readonly DatabaseTransfer[]; readonly detail: string };

/** Admin's small daily read. Days are Eastern, matching Admin's calendar. */
export async function readDailyDatabaseTransfer(days = 7): Promise<DailyDatabaseTransferRead> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not configured");
  const sql = neon(url);
  try {
  const rows = await sql.query(`SELECT day::text, database_name AS database, client,
    requests::text, request_bytes::text, response_bytes::text
    FROM database_transfer_daily WHERE day >= (now() AT TIME ZONE 'America/New_York')::date - $1::int
    ORDER BY day DESC, database_name, client`, [Number.isFinite(days) ? Math.max(1, Math.min(90, Math.trunc(days))) - 1 : 6]);
  return { kind: "RECORDED", rows: rows.map(row => ({ day: row.day, database: row.database, client: row.client,
    requests: Number(row.requests), requestBytes: Number(row.request_bytes), responseBytes: Number(row.response_bytes) })) };
  } catch (error) {
    if ((error as { code?: string }).code === "42P01") return { kind: "NOT_INSTALLED", rows: [],
      detail: "Daily database transfer is not recorded until migration 0030 is applied." };
    throw error;
  }
}
