import { collectProcessTransfers } from "./transfer-journal.ts";
import { mergeProcessTransfer, processTransferKey, processTransferStatements } from "./process-transfer.ts";
import { AsyncLocalStorage } from "node:async_hooks";
import { neon, neonConfig } from "@neondatabase/serverless";
import { countNeonBytes, databaseTransferFetch, onNeonBytesCount, keepsNeonBytesInProcess, easternDay, installNeonBytesReport, runnerClient, socketCaller, VITAL_SIGNS_REPORT_ENV, type NeonBytesHour } from "./transfer-by-caller.ts";

import { currentReaderRoute } from "./reader-route.ts";
import { afterResponse } from "../log/after-response.ts";
import { assertDatabaseReadTarget } from "./read-target.ts";
import { runtimeCivicReadCache, type CivicRowVersion } from "./civic-read-cache.ts";

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
export interface HourlyDatabaseTransfer extends Omit<DatabaseTransfer, "day" | "client"> { readonly hour: string }
export interface RunnerDatabaseTransfer {
  readonly hours: readonly { readonly hour: string; readonly readerBytes: number; readonly controlPlaneBytes: number }[];
  readonly reads: readonly { readonly hour: string; readonly database: string; readonly job: string; readonly table: string;
    readonly file?: string; readonly requests: number; readonly requestBytes: number; readonly responseBytes: number }[];
}

interface TransferState {
  internal: AsyncLocalStorage<boolean>;
  pending: Map<string, DatabaseTransfer>;
  pendingHours: Map<string, HourlyDatabaseTransfer>;
  pendingParts: Map<string, NeonBytesHour>;
  runnerParts: Map<string, { readonly hour: string; readonly bytes: NeonBytesHour["bytes"];
    readonly sent: NonNullable<NeonBytesHour["sent"]>; readonly reads: NonNullable<NeonBytesHour["reads"]> }>;
  installed: boolean;
  lastFlush: number;
  flushing: Promise<boolean> | null;
}
const transferSlot = Symbol.for("meanwhile.database.transfer.pending");
const transferHost = globalThis as typeof globalThis & { [transferSlot]?: TransferState };
const transferState: TransferState = transferHost[transferSlot] ??= { internal: new AsyncLocalStorage<boolean>(), pending: new Map(),
  pendingHours: new Map(), pendingParts: new Map(), runnerParts: new Map(), installed: false, lastFlush: 0, flushing: null };
const { internal, pending, pendingHours, pendingParts, runnerParts } = transferState;

export function pendingDatabaseTransfer(): readonly DatabaseTransfer[] { return [...pending.values()]; }
export function pendingRunnerDatabaseTransfer(): readonly HourlyDatabaseTransfer[] { return [...pendingHours.values()]; }

/** Cumulative process counters and their cursors are saved in one transaction. Failed writes retain every part. */
export async function flushDatabaseTransfer(): Promise<boolean> {
  if (transferState.flushing) {
    const saved = await transferState.flushing;
    return saved && pendingParts.size ? flushDatabaseTransfer() : saved;
  }
  if (!pendingParts.size) return true;
  const url = process.env.DATABASE_URL;
  if (!url) return false;
  transferState.lastFlush = Date.now();
  const batch = [...pending.entries()], hours = [...pendingHours.entries()], parts = [...pendingParts.entries()];
  pending.clear(); pendingHours.clear(); pendingParts.clear();
  transferState.flushing = internal.run(true, async () => {
    try {
      assertDatabaseReadTarget(url);
      const sql = neon(url);
      const statements = parts.flatMap(([, part]) => processTransferStatements(part, easternDay(new Date(part.hour))));
      for (let at = 0; at < statements.length; at += 100) {
        await sql.transaction(statements.slice(at, at + 100).map(statement => sql.query(statement.query, [...statement.params])),
          { fetchOptions: { signal: AbortSignal.timeout(5_000) } });
      }
      transferState.lastFlush = Date.now();
      return true;
    } catch {
      for (const [, row] of batch) accumulate(row);
      for (const [, row] of hours) accumulateHour(row);
      for (const [key, part] of parts) pendingParts.set(key, mergeProcessTransfer(pendingParts.get(key), part));
      return false;
    } finally { transferState.flushing = null; }
  });
  return transferState.flushing;
}

/** The standing collector also recovers readonly sessions and children that died before stdout settlement. */
export function collectDatabaseTransferJournals(dir: string): void {
  for (const part of collectProcessTransfers(dir)) keepRunnerTransfer(part);
}

function accumulateHour(row: HourlyDatabaseTransfer): void {
  const key = `${row.hour}:${row.database}`, prior = pendingHours.get(key), reads = { ...prior?.reads };
  for (const [read, counts] of Object.entries(row.reads ?? {})) {
    const before = reads[read] ?? [0,0,0];
    reads[read] = [before[0]+counts[0],before[1]+counts[1],before[2]+counts[2]];
  }
  pendingHours.set(key, { ...row, reads, requests: row.requests+(prior?.requests ?? 0),
    requestBytes: row.requestBytes+(prior?.requestBytes ?? 0),responseBytes: row.responseBytes+(prior?.responseBytes ?? 0) });
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
  const read = Object.keys(row.reads ?? {})[0]?.split("\t").slice(1).join("\t");
  countNeonBytes(row.database, row.responseBytes, Date.now(), { requests: row.requests, bytes: row.requestBytes }, caller,
    read === "socket" ? undefined : read);
  if (reportsToRunner()) return;
  accumulate(row);
  // An answered query must not wait on the accounting write to the reader database.
  if (Date.now() - transferState.lastFlush >= 60_000) void flushDatabaseTransfer();
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
const countedSocketSlot = Symbol.for("meanwhile.database.transfer.socket.counted");
function countedWebSocket(Socket: typeof WebSocket): typeof WebSocket {
  if ((Socket as typeof WebSocket & { [countedSocketSlot]?: boolean })[countedSocketSlot]) return Socket;
  class CountedWebSocket extends Socket {
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
  }
  Object.defineProperty(CountedWebSocket, countedSocketSlot, { value: true });
  return CountedWebSocket;
}

/** Shared Neon HTTP and socket hook; query execution is unchanged and counter failure never hides data. */
export function installDatabaseTransferCounter(): void {
  onNeonBytesCount(part => {
    if (!reportsToRunner() || keepsNeonBytesInProcess()) {
      const key = processTransferKey(part);
      pendingParts.set(key, mergeProcessTransfer(pendingParts.get(key), part));
    }
  });
  installNeonBytesReport();
  neonConfig.fetchFunction = databaseTransferFetch((neonConfig.fetchFunction ?? fetch) as FetchLike, row => { counted(row); }, () => internal.getStore() === true, async () => {
    if (!reportsToRunner()) await afterResponse(() => flushDatabaseTransfer(), { backgroundFallback: true });
  });
  const Socket = (neonConfig.webSocketConstructor ?? globalThis.WebSocket) as typeof WebSocket | undefined;
  if (Socket) neonConfig.webSocketConstructor = countedWebSocket(Socket);
  if (transferState.installed) return;
  transferState.installed = true;
  // Long-running processes flush once a minute. The supervisor also awaits a flush before it exits.
  const timer = setInterval(() => { if (Date.now() - transferState.lastFlush >= 60_000) void flushDatabaseTransfer(); }, 60_000);
  timer.unref();
  // A process outside the runner also saves its final partial minute.
  process.once("beforeExit", () => { void flushDatabaseTransfer(); });
}


const NOTHING_SENT: NonNullable<NeonBytesHour["sent"]> = { reader: { requests: 0, bytes: 0 }, "control-plane": { requests: 0, bytes: 0 } };


export function keepRunnerTransfer(part: NeonBytesHour): void {
  if (!Number.isSafeInteger(part.pid)) return;
  installDatabaseTransferCounter();
  const key = `${part.pid}:${part.startedMs ?? ""}:${part.hour}`;
  const prior = runnerParts.get(key);
  pendingParts.set(processTransferKey(part), mergeProcessTransfer(pendingParts.get(processTransferKey(part)), part));
  const sent = part.sent ?? NOTHING_SENT;
  const reads = { ...prior?.reads };
  for (const [read, counts] of Object.entries(part.reads ?? {}))
    reads[read] = counts.map((count, i) => Math.max(count, prior?.reads[read]?.[i] ?? 0)) as [number, number, number];
  runnerParts.set(key, { hour: part.hour,
    bytes: { reader: Math.max(part.bytes.reader, prior?.bytes.reader ?? 0), "control-plane": Math.max(part.bytes["control-plane"], prior?.bytes["control-plane"] ?? 0) },
    sent: Object.fromEntries((["reader", "control-plane"] as const).map(database => [database, {
      requests: Math.max(sent[database].requests, prior?.sent[database].requests ?? 0), bytes: Math.max(sent[database].bytes, prior?.sent[database].bytes ?? 0),
    }])) as NonNullable<NeonBytesHour["sent"]>, reads });
  const day = easternDay(new Date(part.hour));
  for (const database of ["reader", "control-plane"] as const) {
    const reads: Record<string, readonly [number, number, number]> = {};
    for (const [read, counts] of Object.entries(part.reads ?? {})) {
      if (!read.startsWith(database + "\t")) continue;
      const before = prior?.reads[read] ?? [0, 0, 0];
      const delta = counts.map((count, i) => Math.max(0, count - before[i])) as [number, number, number];
      if (delta.some(value => value > 0)) reads[read.slice(database.length + 1)] = delta;
    }
    const responseBytes = (part.bytes[database] ?? 0) - (prior?.bytes[database] ?? 0);
    const requests = sent[database].requests - (prior?.sent[database].requests ?? 0);
    const requestBytes = sent[database].bytes - (prior?.sent[database].bytes ?? 0);
    if (responseBytes > 0 || requests > 0 || requestBytes > 0 || Object.keys(reads).length) {
      const delta = { database, requests: Math.max(0, requests), requestBytes: Math.max(0, requestBytes), responseBytes: Math.max(0, responseBytes) };
      accumulate({ day, ...delta, client: "runner" });
      accumulateHour({ hour: part.hour, ...delta, reads });
    }
  }
  const oldest = new Date(Date.parse(part.hour) - 2 * 3_600_000).toISOString();
  for (const [held, value] of runnerParts) if (value.hour < oldest) runnerParts.delete(held);
}

export type DailyDatabaseTransferRead =
  | { readonly kind: "RECORDED"; readonly rows: readonly DatabaseTransfer[]; readonly runner?: RunnerDatabaseTransfer | null }
  | { readonly kind: "NOT_INSTALLED"; readonly rows: readonly DatabaseTransfer[]; readonly detail: string };

/** Accounting maps follow the same row-version path as civic and control-plane bodies. */
async function readTransferRows(url: string, table: "database_transfer_daily" | "database_transfer_hourly",
  columns: string, where: string, args: readonly unknown[], key: string): Promise<Record<string, unknown>[]> {
  const sql = neon(url);
  const etag = "xmin::text || ':' || ctid::text";
  const versions = async (keys?: readonly string[]) => (await sql.query(
    `SELECT ${key} AS key,${etag} AS etag FROM ${table} WHERE ${where}${keys ? ` AND ${key}=ANY($${args.length + 1}::text[])` : ""}`,
    keys ? [...args, keys] : [...args])) as CivicRowVersion[];
  const initial = await versions();
  let first = true;
  const rows = await runtimeCivicReadCache(url).rows<Record<string, unknown>, CivicRowVersion>({
    namespace: `${table}:${columns}`, keys: initial.map(row => row.key),
    versions: async keys => { if (first) { first = false; return initial; } return versions(keys); },
    values: keys => sql.query(`SELECT ${columns},${key} AS key,${etag} AS etag FROM ${table}
      WHERE ${where} AND ${key}=ANY($${args.length + 1}::text[])`, [...args, keys]),
    keyOf: row => String(row.key), etagOf: row => String(row.etag),
  });
  return [...rows];
}

/** Admin's small daily read. Days are Eastern, matching Admin's calendar. */
export async function readDailyDatabaseTransfer(days = 7): Promise<DailyDatabaseTransferRead> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not configured");
  assertDatabaseReadTarget(url);
  try {
  const rows = await readTransferRows(url, "database_transfer_daily",
    "day::text,database_name AS database,client,requests::text,request_bytes::text,response_bytes::text,reads",
    "day >= (now() AT TIME ZONE 'America/New_York')::date - $1::int",
    [Number.isFinite(days) ? Math.max(1, Math.min(90, Math.trunc(days))) - 1 : 6],
    "day::text || E'\\t' || database_name || E'\\t' || client");
  rows.sort((a,b) => String(b.day).localeCompare(String(a.day)) || String(a.database).localeCompare(String(b.database)) || String(a.client).localeCompare(String(b.client)));
  let runner: RunnerDatabaseTransfer | null = null;
  try { runner = await readRunnerDatabaseTransfer(); } catch { /* Existing daily totals remain readable. */ }
  return { kind: "RECORDED", runner, rows: rows.map(row => ({ day: String(row.day), database: row.database as DatabaseTransfer["database"], client: row.client as DatabaseTransfer["client"],
    requests: Number(row.requests), requestBytes: Number(row.request_bytes), responseBytes: Number(row.response_bytes), reads: row.reads as DatabaseTransfer["reads"] })) };
  } catch (error) {
    if ((error as { code?: string }).code === "42P01") return { kind: "NOT_INSTALLED", rows: [],
      detail: "Daily database transfer is not recorded until migration 0030 is applied." };
    throw error;
  }
}

export function runnerDatabaseTransferView(rows: readonly HourlyDatabaseTransfer[], totals = rows): RunnerDatabaseTransfer {
  const hours = new Map<string, { hour: string; readerBytes: number; controlPlaneBytes: number }>();
  for (const row of totals) {
    const hour = hours.get(row.hour) ?? { hour: row.hour, readerBytes: 0, controlPlaneBytes: 0 };
    hour[row.database === "reader" ? "readerBytes" : "controlPlaneBytes"] += row.responseBytes;
    hours.set(row.hour, hour);
  }
  return { hours: [...hours.values()].sort((a,b) => b.hour.localeCompare(a.hour)),
    reads: rows.flatMap(row => Object.entries(row.reads ?? {}).map(([key, counts]) => {
      const [job, table, file] = key.split("\t");
      return { hour: row.hour,database: row.database,job,table: table ?? "",...(file ? { file } : {}),requests: counts[0],requestBytes: counts[1],responseBytes: counts[2] };
    })).sort((a,b) => b.responseBytes-a.responseBytes || a.job.localeCompare(b.job)) };
}

/** Read small hour totals, then only the selected hour's job/table details. */
export async function readRunnerDatabaseTransfer(selectedHour?: string): Promise<RunnerDatabaseTransfer> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not configured");
  assertDatabaseReadTarget(url);
  const totals = (await readTransferRows(url, "database_transfer_hourly",
    "hour::text,database_name AS database,response_bytes::text",
    "hour >= now()-interval '31 days'", [], "hour::text || E'\\t' || database_name")).map(row => ({
      hour: new Date(String(row.hour)).toISOString(),database: row.database,responseBytes: Number(row.response_bytes),requests: 0,requestBytes: 0,
    })) as HourlyDatabaseTransfer[];
  totals.sort((a,b) => b.hour.localeCompare(a.hour));
  const hour = selectedHour ?? totals[0]?.hour;
  if (!hour) return { hours: [], reads: [] };
  const rows = await readTransferRows(url, "database_transfer_hourly",
    "hour::text,database_name AS database,requests::text,request_bytes::text,response_bytes::text,reads",
    "hour=$1::timestamptz", [hour], "hour::text || E'\\t' || database_name");
  return runnerDatabaseTransferView(rows.map(row => ({ hour: new Date(String(row.hour)).toISOString(),database: row.database as DatabaseTransfer["database"],
    requests: Number(row.requests),requestBytes: Number(row.request_bytes),responseBytes: Number(row.response_bytes),reads: row.reads as DatabaseTransfer["reads"] })), totals);
}
