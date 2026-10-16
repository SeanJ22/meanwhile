import { AsyncLocalStorage } from "node:async_hooks";
import { neon, neonConfig } from "@neondatabase/serverless";
import { countNeonBytes, installNeonBytesReport, socketCaller, VITAL_SIGNS_REPORT_ENV, type NeonBytesHour } from "./transfer-by-caller.ts";

import { currentReaderRoute, transferRead } from "./reader-route.ts";

type FetchLike = typeof fetch;
export interface DatabaseTransfer {
  readonly day: string;
  readonly database: "reader" | "control-plane";
  readonly client: "reader" | "runner";
  readonly requests: number;
  readonly requestBytes: number;
  readonly responseBytes: number;
  readonly reads?: Readonly<Record<string, readonly [number, number, number]>>;
}

const internal = new AsyncLocalStorage<boolean>();
const pending = new Map<string, DatabaseTransfer>();
let installed = false;
let lastFlush = 0;
let flushing: Promise<boolean> | null = null;

const easternDay = (at: Date) => new Intl.DateTimeFormat("sv-SE", { timeZone: "America/New_York" }).format(at);

function runnerClient(): boolean {
  return Boolean(process.env.WTP_RUNTIME_AUTHORITY_CAPABILITY) || process.env.WTP_SANCTIONED_WRITE === "routine-civic-data-promotion";
}

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
    const requestBytes = typeof init?.body === "string" ? Buffer.byteLength(init.body) : 0;
    const read = `${currentReaderRoute()}\t${transferRead(typeof init?.body === "string" ? init.body : undefined)}`;
    await record({
      day: easternDay(new Date()),
      database: connection === process.env.DATABASE_URL ? "reader" : "control-plane",
      client: runnerClient() ? "runner" : "reader",
      requests: 1,
      requestBytes,
      reads: { [read]: [1, requestBytes, bytes.byteLength] },
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
        `INSERT INTO database_transfer_daily (day, database_name, client, requests, request_bytes, response_bytes, reads)
         VALUES ($1::date, $2, $3, $4, $5, $6, $7::jsonb)
         ON CONFLICT (day, database_name, client) DO UPDATE SET
         requests = database_transfer_daily.requests + EXCLUDED.requests,
         request_bytes = database_transfer_daily.request_bytes + EXCLUDED.request_bytes,
         response_bytes = database_transfer_daily.response_bytes + EXCLUDED.response_bytes,
         reads = (SELECT COALESCE(jsonb_object_agg(k, jsonb_build_array(
           COALESCE((a->>0)::bigint,0) + COALESCE((b->>0)::bigint,0),
           COALESCE((a->>1)::bigint,0) + COALESCE((b->>1)::bigint,0),
           COALESCE((a->>2)::bigint,0) + COALESCE((b->>2)::bigint,0))), '{}'::jsonb)
           FROM jsonb_each(database_transfer_daily.reads) old(k,a) FULL JOIN jsonb_each(EXCLUDED.reads) new(k,b) USING(k)),
         updated_at = now()`,
        [row.day, row.database, row.client, row.requests, row.requestBytes, row.responseBytes, JSON.stringify(row.reads ?? {})],
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
  const reads = { ...prior?.reads };
  for (const [read, counts] of Object.entries(row.reads ?? {})) {
    const held = reads[read] ?? [0, 0, 0];
    reads[read] = [held[0] + counts[0], held[1] + counts[1], held[2] + counts[2]];
  }
  pending.set(key, prior ? { ...row, reads, requests: prior.requests + row.requests,
    requestBytes: prior.requestBytes + row.requestBytes, responseBytes: prior.responseBytes + row.responseBytes } : row);
}


function reportsToRunner(): boolean {
  return process.env[VITAL_SIGNS_REPORT_ENV] === "1";
}

function counted(row: DatabaseTransfer, caller?: string): void {
  countNeonBytes(row.database, row.responseBytes, Date.now(), { requests: row.requests, bytes: row.requestBytes }, caller);
  if (reportsToRunner()) return;
  accumulate(row);
  // An answered query must not wait on the accounting write to the reader database.
  if (Date.now() - lastFlush >= 60_000) void flushDatabaseTransfer();
}

/** Which of the two civic databases a socket URL reaches, by host; null for any other host. */
function socketDatabase(url: string | URL): DatabaseTransfer["database"] | null {
  const host = (value: string | undefined) => {
    try { return value ? new URL(value).hostname.toLowerCase().replace("-pooler.", ".") : null; } catch { return null; }
  };
  let target: string;
  try { target = new URL(String(url)).hostname.toLowerCase().replace("-pooler.", "."); } catch { return null; }
  if (target === host(process.env.DATABASE_URL)) return "reader";
  if (target === host(process.env.WTP_CONTROL_PLANE_DATABASE_URL)) return "control-plane";
  return null;
}

const messageBytes = (data: unknown): number => typeof data === "string" ? Buffer.byteLength(data)
  : data instanceof ArrayBuffer || ArrayBuffer.isView(data) ? data.byteLength : data instanceof Blob ? data.size : 0;

/** The Pool driver's sockets (locks, pinned connections, the meeting and publication stores), counted like HTTP responses. */
function countedWebSocket(Socket: typeof WebSocket): typeof WebSocket {
  return class CountedWebSocket extends Socket {
    constructor(url: string | URL, protocols?: string | string[]) {
      super(url, protocols);
      const database = socketDatabase(url);
      if (database === null) return;
      const caller = socketCaller();
      const read = `${currentReaderRoute()}\tsocket`;
      const row = (responseBytes: number, requestBytes: number): DatabaseTransfer => ({ day: easternDay(new Date()), database,
        client: runnerClient() ? "runner" : "reader", requests: 0, requestBytes, responseBytes,
        reads: { [read]: [0, requestBytes, responseBytes] } });
      this.addEventListener("message", event => { try { counted(row(messageBytes(event.data), 0), caller); } catch { /* accounting never breaks a read */ } });
      const send = this.send.bind(this);
      this.send = data => { try { counted(row(0, messageBytes(data)), caller); } catch { /* accounting never breaks a write */ } send(data); };
    }
  };
}

/** Shared Neon HTTP and socket hook; query execution is unchanged and counter failure never hides data. */
export function installDatabaseTransferCounter(): void {
  if (installed) return;
  installed = true;
  installNeonBytesReport();
  neonConfig.fetchFunction = databaseTransferFetch((neonConfig.fetchFunction ?? fetch) as FetchLike, row => { counted(row); });
  const Socket = (neonConfig.webSocketConstructor ?? globalThis.WebSocket) as typeof WebSocket | undefined;
  if (Socket) neonConfig.webSocketConstructor = countedWebSocket(Socket);
  // Long-running processes flush once a minute. The supervisor also awaits a flush before it exits.
  const timer = setInterval(() => { if (Date.now() - lastFlush >= 60_000) void flushDatabaseTransfer(); }, 60_000);
  timer.unref();
  // A process outside the runner also saves its final partial minute.
  process.once("beforeExit", () => { void flushDatabaseTransfer(); });
}

const runnerParts = new Map<string, { readonly hour: string; readonly bytes: NeonBytesHour["bytes"]; readonly sent: NonNullable<NeonBytesHour["sent"]> }>();
const NOTHING_SENT: NonNullable<NeonBytesHour["sent"]> = { reader: { requests: 0, bytes: 0 }, "control-plane": { requests: 0, bytes: 0 } };


export function keepRunnerTransfer(part: NeonBytesHour): void {
  if (!Number.isSafeInteger(part.pid)) return;
  installDatabaseTransferCounter();
  const key = `${part.pid}:${part.startedMs ?? ""}:${part.hour}`;
  const prior = runnerParts.get(key);
  const sent = part.sent ?? NOTHING_SENT;
  runnerParts.set(key, { hour: part.hour, bytes: part.bytes, sent });
  const day = easternDay(new Date(part.hour));
  for (const database of ["reader", "control-plane"] as const) {
    const responseBytes = (part.bytes[database] ?? 0) - (prior?.bytes[database] ?? 0);
    const requests = sent[database].requests - (prior?.sent[database].requests ?? 0);
    const requestBytes = sent[database].bytes - (prior?.sent[database].bytes ?? 0);
    if (responseBytes > 0 || requests > 0 || requestBytes > 0) {
      accumulate({ day, database, client: "runner", requests: Math.max(0, requests), requestBytes: Math.max(0, requestBytes), responseBytes: Math.max(0, responseBytes) });
    }
  }
  const oldest = new Date(Date.parse(part.hour) - 2 * 3_600_000).toISOString();
  for (const [held, value] of runnerParts) if (value.hour < oldest) runnerParts.delete(held);
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
    requests::text, request_bytes::text, response_bytes::text, reads
    FROM database_transfer_daily WHERE day >= (now() AT TIME ZONE 'America/New_York')::date - $1::int
    ORDER BY day DESC, database_name, client`, [Number.isFinite(days) ? Math.max(1, Math.min(90, Math.trunc(days))) - 1 : 6]);
  return { kind: "RECORDED", rows: rows.map(row => ({ day: row.day, database: row.database, client: row.client,
    requests: Number(row.requests), requestBytes: Number(row.request_bytes), responseBytes: Number(row.response_bytes), reads: row.reads })) };
  } catch (error) {
    if ((error as { code?: string }).code === "42P01") return { kind: "NOT_INSTALLED", rows: [],
      detail: "Daily database transfer is not recorded until migration 0030 is applied." };
    throw error;
  }
}
