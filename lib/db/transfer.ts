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
  pendingDailyParts: Map<string, NeonBytesHour>;
  warned: Map<string, number>;
  runnerParts: Map<string, { readonly hour: string; readonly bytes: NeonBytesHour["bytes"];
    readonly sent: NonNullable<NeonBytesHour["sent"]>; readonly reads: NonNullable<NeonBytesHour["reads"]> }>;
  installed: boolean;
  lastFlush: number;
  flushing: Promise<boolean> | null;
}
const transferSlot = Symbol.for("meanwhile.database.transfer.pending");
const transferHost = globalThis as typeof globalThis & { [transferSlot]?: TransferState };
const transferState: TransferState = transferHost[transferSlot] ??= { internal: new AsyncLocalStorage<boolean>(), pending: new Map(),
  pendingHours: new Map(), pendingParts: new Map(), pendingDailyParts: new Map(), warned: new Map(), runnerParts: new Map(), installed: false, lastFlush: 0, flushing: null };
const { internal, pending, pendingHours, pendingParts, pendingDailyParts, warned, runnerParts } = transferState;

export function pendingDatabaseTransfer(): readonly DatabaseTransfer[] { return [...pending.values()]; }
export function pendingRunnerDatabaseTransfer(): readonly HourlyDatabaseTransfer[] { return [...pendingHours.values()]; }

/** A process/hour part is saved to the hourly table, and a reader function's part also to its daily row. */
function queuePart(part: NeonBytesHour): void {
  retain(pendingParts, part);
  if (part.client === "reader") retain(pendingDailyParts, part);
}
function retain(parts: Map<string, NeonBytesHour>, part: NeonBytesHour): void {
  const key = processTransferKey(part);
  parts.set(key, mergeProcessTransfer(parts.get(key), part));
}

const WARN_EVERY_MS = 10 * 60_000;
function warnUnsaved(table: string, error: unknown): void {
  const now = Date.now();
  if (now - (warned.get(table) ?? 0) < WARN_EVERY_MS) return;
  warned.set(table, now);
  // Names and codes only: a driver message can carry the database address.
  const { code, sourceError } = (error ?? {}) as { code?: unknown; sourceError?: unknown };
  const kind = [error instanceof Error ? error.name : typeof error, typeof code === "string" ? code : null,
    sourceError instanceof Error ? sourceError.name : null].filter(Boolean).join(" ");
  console.warn(`DATABASE_TRANSFER ${table} could not be saved (${kind}); its counts are kept for the next flush.`);
}

/** Saves one table's parts in small transactions. A failed transaction keeps its parts for the next flush;
 * cumulative cursors make the retry exact. */
async function saveParts(sql: ReturnType<typeof neon>, table: "hourly" | "daily", parts: readonly NeonBytesHour[],
  retry: Map<string, NeonBytesHour>): Promise<boolean> {
  let saved = true;
  for (let at = 0; at < parts.length; at += 25) {
    const chunk = parts.slice(at, at + 25);
    try {
      const statements = chunk.flatMap(part => processTransferStatements(part, table));
      if (statements.length) await sql.transaction(statements.map(statement => sql.query(statement.query, [...statement.params])),
        { fetchOptions: { signal: AbortSignal.timeout(5_000) } });
    } catch (error) {
      saved = false;
      warnUnsaved(`database_transfer_${table}`, error);
      for (const part of chunk) retain(retry, part);
    }
  }
  return saved;
}

/** Hourly rows (the job breaker's meter) and reader functions' daily rows are saved independently,
 * so a slow or failed daily write never holds back an hour. */
export async function flushDatabaseTransfer(): Promise<boolean> {
  if (transferState.flushing) {
    const saved = await transferState.flushing;
    return saved && (pendingParts.size || pendingDailyParts.size) ? flushDatabaseTransfer() : saved;
  }
  if (!pendingParts.size && !pendingDailyParts.size) return true;
  const url = process.env.DATABASE_URL;
  if (!url) return false;
  transferState.lastFlush = Date.now();
  const batch = [...pending.values()], hours = [...pendingHours.values()];
  const hourParts = [...pendingParts.values()], dayParts = [...pendingDailyParts.values()];
  pending.clear(); pendingHours.clear(); pendingParts.clear(); pendingDailyParts.clear();
  transferState.flushing = internal.run(true, async () => {
    try {
      let sql: ReturnType<typeof neon>;
      try { assertDatabaseReadTarget(url); sql = neon(url); } catch (error) {
        warnUnsaved("database_transfer_hourly", error);
        for (const part of hourParts) retain(pendingParts, part);
        for (const part of dayParts) retain(pendingDailyParts, part);
        for (const row of batch) accumulate(row);
        for (const row of hours) accumulateHour(row);
        return false;
      }
      const hourly = await saveParts(sql, "hourly", hourParts, pendingParts);
      if (!hourly) for (const row of hours) accumulateHour(row);
      const daily = await saveParts(sql, "daily", dayParts, pendingDailyParts);
      if (!daily) for (const row of batch) accumulate(row);
      transferState.lastFlush = Date.now();
      return hourly && daily;
    } finally { transferState.flushing = null; }
  });
  return transferState.flushing;
}

/** The standing collector also recovers readonly sessions and children that died before stdout settlement. */
export function collectDatabaseTransferJournals(dir: string): readonly NeonBytesHour[] {
  const parts = collectProcessTransfers(dir);
  for (const part of parts) keepRunnerTransfer(part);
  return parts;
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
    if (!reportsToRunner() || keepsNeonBytesInProcess()) queuePart(part);
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
  queuePart(part);
  const sent = part.sent ?? NOTHING_SENT;
  const reads = { ...prior?.reads };
  for (const [read, counts] of Object.entries(part.reads ?? {}))
    reads[read] = counts.map((count, i) => Math.max(count, prior?.reads[read]?.[i] ?? 0)) as [number, number, number];
  runnerParts.set(key, { hour: part.hour,
    bytes: { reader: Math.max(part.bytes.reader, prior?.bytes.reader ?? 0), "control-plane": Math.max(part.bytes["control-plane"], prior?.bytes["control-plane"] ?? 0) },
    sent: Object.fromEntries((["reader", "control-plane"] as const).map(database => [database, {
      requests: Math.max(sent[database].requests, prior?.sent[database].requests ?? 0), bytes: Math.max(sent[database].bytes, prior?.sent[database].bytes ?? 0),
    }])) as NonNullable<NeonBytesHour["sent"]>, reads });
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

const transferRow = (row: Record<string, unknown>): DatabaseTransfer => ({ day: String(row.day), database: row.database as DatabaseTransfer["database"],
  client: row.client as DatabaseTransfer["client"], requests: Number(row.requests), requestBytes: Number(row.request_bytes),
  responseBytes: Number(row.response_bytes), reads: row.reads as DatabaseTransfer["reads"] });

/** The runner keeps no daily row: its day is every hour's bytes less what reader functions saved for that day.
 * A runner row saved before every hour was kept holds more than its hours, and stands where it is larger. */
function withRunnerDays(saved: readonly DatabaseTransfer[], hours: readonly DatabaseTransfer[]): DatabaseTransfer[] {
  const key = (row: DatabaseTransfer) => `${row.day}\t${row.database}`;
  const readers = new Map(saved.filter(row => row.client === "reader").map(row => [key(row), row]));
  const runners = new Map(saved.filter(row => row.client === "runner").map(row => [key(row), row]));
  for (const hour of hours) {
    const reader = readers.get(key(hour)), stored = runners.get(key(hour));
    const rebuilt: DatabaseTransfer = { day: hour.day, database: hour.database, client: "runner",
      requests: Math.max(0, hour.requests - (reader?.requests ?? 0)), requestBytes: Math.max(0, hour.requestBytes - (reader?.requestBytes ?? 0)),
      responseBytes: Math.max(0, hour.responseBytes - (reader?.responseBytes ?? 0)), reads: {} };
    if (!stored || rebuilt.responseBytes > stored.responseBytes) runners.set(key(hour), rebuilt);
  }
  return [...readers.values(), ...runners.values()];
}

/** Admin's small daily read. Days are Eastern, matching Admin's calendar. */
export async function readDailyDatabaseTransfer(days = 7): Promise<DailyDatabaseTransferRead> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not configured");
  assertDatabaseReadTarget(url);
  const window = Number.isFinite(days) ? Math.max(1, Math.min(90, Math.trunc(days))) - 1 : 6;
  try {
  const rows = await readTransferRows(url, "database_transfer_daily",
    "day::text,database_name AS database,client,requests::text,request_bytes::text,response_bytes::text,reads",
    "day >= (now() AT TIME ZONE 'America/New_York')::date - $1::int",
    [window],
    "day::text || E'\\t' || database_name || E'\\t' || client");
  const totals = await readHourTotals(url, `hour >= least(now()-interval '31 days',
    (((now() AT TIME ZONE 'America/New_York')::date - $1::int)::timestamp AT TIME ZONE 'America/New_York'))`, [window]);
  const today = easternDay(new Date()), first = new Date(Date.parse(`${today}T12:00:00Z`) - window * 86_400_000).toISOString().slice(0, 10);
  const hourDays = new Map<string, DatabaseTransfer>();
  for (const hour of totals) {
    const day = easternDay(new Date(hour.hour));
    if (day < first) continue;
    const held = hourDays.get(`${day}\t${hour.database}`);
    hourDays.set(`${day}\t${hour.database}`, { day, database: hour.database, client: "runner", requests: (held?.requests ?? 0) + hour.requests,
      requestBytes: (held?.requestBytes ?? 0) + hour.requestBytes, responseBytes: (held?.responseBytes ?? 0) + hour.responseBytes });
  }
  let runner: RunnerDatabaseTransfer | null = null;
  const lastMonth = new Date(Date.now() - 31 * 86_400_000).toISOString();
  try { runner = await readRunnerDatabaseTransfer(undefined, totals.filter(hour => hour.hour >= lastMonth)); } catch { /* Existing daily totals remain readable. */ }
  return { kind: "RECORDED", runner, rows: withRunnerDays(rows.map(transferRow), [...hourDays.values()]).sort((a,b) => b.day.localeCompare(a.day)
    || a.database.localeCompare(b.database) || a.client.localeCompare(b.client)) };
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

const readHourTotals = async (url: string, where: string, args: readonly unknown[]): Promise<HourlyDatabaseTransfer[]> =>
  (await readTransferRows(url, "database_transfer_hourly",
    "hour::text,database_name AS database,requests::text,request_bytes::text,response_bytes::text",
    where, args, "hour::text || E'\\t' || database_name")).map(row => ({ hour: new Date(String(row.hour)).toISOString(),
    database: row.database as DatabaseTransfer["database"], requests: Number(row.requests), requestBytes: Number(row.request_bytes),
    responseBytes: Number(row.response_bytes) }));

/** Admin's daily reading line: every hour since yesterday began in Eastern time, read by key as small totals. */
export async function readRecentHourTotals(): Promise<HourlyDatabaseTransfer[]> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not configured");
  assertDatabaseReadTarget(url);
  return readHourTotals(url, "hour >= (((now() AT TIME ZONE 'America/New_York')::date - 1)::timestamp AT TIME ZONE 'America/New_York')", []);
}

/** Read small hour totals, then only the selected hour's job/table details. */
export async function readRunnerDatabaseTransfer(selectedHour?: string, held?: readonly HourlyDatabaseTransfer[]): Promise<RunnerDatabaseTransfer> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not configured");
  assertDatabaseReadTarget(url);
  const totals = [...held ?? await readHourTotals(url, "hour >= now()-interval '31 days'", [])];
  totals.sort((a,b) => b.hour.localeCompare(a.hour));
  const hour = selectedHour ?? totals[0]?.hour;
  if (!hour) return { hours: [], reads: [] };
  const rows = await readTransferRows(url, "database_transfer_hourly",
    "hour::text,database_name AS database,requests::text,request_bytes::text,response_bytes::text,reads",
    "hour=$1::timestamptz", [hour], "hour::text || E'\\t' || database_name");
  return runnerDatabaseTransferView(rows.map(row => ({ hour: new Date(String(row.hour)).toISOString(),database: row.database as DatabaseTransfer["database"],
    requests: Number(row.requests),requestBytes: Number(row.request_bytes),responseBytes: Number(row.response_bytes),reads: row.reads as DatabaseTransfer["reads"] })), totals);
}
