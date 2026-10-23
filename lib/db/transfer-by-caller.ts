import type { DatabaseTransfer } from "./transfer.ts";
import { currentReaderRoute, transferRead } from "./reader-route.ts";
import { AsyncLocalStorage } from "node:async_hooks";
import { basename } from "node:path";
import type { neonConfig } from "@neondatabase/serverless";

/** Set by the runner for its children: print this process's hour totals to stdout. */
export const VITAL_SIGNS_REPORT_ENV = "WTP_VITAL_SIGNS_REPORT";
/** The report line's prefix; the runner never shows these lines or counts them as progress. */
export const VITAL_SIGNS_LINE_PREFIX = "vital-signs-bytes ";
/* One write below the pipe's atomic size (4,096 bytes on Linux), so processes sharing a pipe never split a line. */
const VITAL_SIGNS_LINE_LIMIT = 3_800;

export type NeonDatabase = "reader" | "control-plane";

/** One process's (or the summed runner's) bytes for one UTC hour. */
export interface NeonBytesHour {
  /** The hour's start, ISO, e.g. 2026-10-06T07:00:00.000Z. */
  readonly hour: string;
  readonly requests: number;
  readonly bytes: Readonly<Record<NeonDatabase, number>>;
  /** Requests and request-body bytes by database: with `bytes`, the runner's rows in the daily transfer table (transfer.ts). */
  readonly sent?: Readonly<Record<NeonDatabase, NeonSent>>;
  /** Caller key → bytes. Keys are prefixed "reader: " for the reader database. */
  readonly byCaller: Readonly<Record<string, number>>;
  /** Which processes contributed: script name and pid. */
  readonly processes: readonly string[];
  /** The one process this part came from (a report line), and when it started; absent on a sum. */
  readonly pid?: number;
  readonly startedMs?: number;
  /** That process's peak resident memory so far, in bytes; absent on a sum. */
  readonly peakRssBytes?: number;
  /** Other hour counts (`countVitalSign`), e.g. rounds_finished. Absent on files that counted none. */
  readonly counters?: Readonly<Record<string, number>>;
}

export interface NeonBytesSummary {
  readonly hour: string;
  readonly controlPlaneBytes: number;
  readonly readerBytes: number;
  readonly requests: number;
  /** Largest first; the rest summed as "other". */
  readonly byCaller: readonly { readonly caller: string; readonly bytes: number }[];
  readonly processCount: number;
}

export interface NeonSent { readonly requests: number; readonly bytes: number }

interface Bucket { requests: number; bytes: Record<NeonDatabase, number>; sent: Record<NeonDatabase, NeonSent>; byCaller: Map<string, number>; counters: Map<string, number>; dirty: boolean }

interface CallerState {
  scope: AsyncLocalStorage<string>;
  pinnedSite: AsyncLocalStorage<string>;
  queryRoute: AsyncLocalStorage<string>;
  socketScope: AsyncLocalStorage<SocketRead>;
  sockets: WeakMap<WebSocket, SocketRead>;
  buckets: Map<string, Bucket>;
  siteCache: Map<string, string>;
  reportInstalled: boolean;
  keptInProcess: boolean;
}
interface SocketRead {
  caller: string | undefined;
  route: string;
  listeners: WeakMap<EventListenerOrEventListenerObject, EventListener>;
}
// Server bundles share pools; their borrowers must share the same async scopes and counters.
const callerSlot = Symbol.for("meanwhile.database.transfer.callers");
const host = globalThis as typeof globalThis & { [callerSlot]?: CallerState };
const callerState = host[callerSlot] ??= { scope: new AsyncLocalStorage<string>(), pinnedSite: new AsyncLocalStorage<string>(),
  queryRoute: new AsyncLocalStorage<string>(), socketScope: new AsyncLocalStorage<SocketRead>(), sockets: new WeakMap(),
  buckets: new Map(), siteCache: new Map(), reportInstalled: false, keptInProcess: false };
const { scope, pinnedSite, buckets, siteCache } = callerState;
/* Stack strings run to a few KB; a small cache keeps the per-process memory under 1 MB. */
const SITE_CACHE_LIMIT = 256;

export function hourStart(nowMs: number): string {
  return new Date(Math.floor(nowMs / 3_600_000) * 3_600_000).toISOString();
}

export function withQueryCaller<T>(operation: string, run: () => T): T {
  const route = currentReaderRoute();
  return callerState.queryRoute.run(route === "unattributed" ? callerState.queryRoute.getStore() ?? route : route,
    () => scope.run(`${operation} ← ${namedSite()}`, run));
}

const countedFetchSlot = Symbol.for("meanwhile.database.transfer.fetch");
const callerSocketSlot = Symbol.for("meanwhile.database.transfer.socket.context");

/** Keep the requesting client with a pooled socket, without changing its query or transport. */
export function installDatabaseClientAccounting(config: typeof neonConfig, installCounter: () => void): void {
  if (!(config.fetchFunction as (FetchLike & { [countedFetchSlot]?: boolean }) | undefined)?.[countedFetchSlot]) installCounter();
  const Socket = (config.webSocketConstructor ?? globalThis.WebSocket) as typeof WebSocket | undefined;
  if (!Socket || Object.hasOwn(Socket, callerSocketSlot)) return;
  const held = (socket: WebSocket): SocketRead => {
    let read = callerState.sockets.get(socket);
    if (!read) {
      read = { caller: scope.getStore(), route: callerState.queryRoute.getStore() ?? currentReaderRoute(), listeners: new WeakMap() };
      callerState.sockets.set(socket, read);
    }
    return read;
  };
  class CallerSocket extends Socket {
    constructor(url: string | URL, protocols?: string | string[]) {
      super(url, protocols);
      const read = held(this), send = this.send.bind(this);
      this.send = data => {
        read.caller = scope.getStore() ?? read.caller;
        read.route = callerState.queryRoute.getStore() ?? read.route;
        callerState.socketScope.run(read, () => send(data));
      };
    }
  }
  const add = Socket.prototype.addEventListener, remove = Socket.prototype.removeEventListener;
  CallerSocket.prototype.addEventListener = function (this: WebSocket, type: string, listener: EventListenerOrEventListenerObject | null, options?: AddEventListenerOptions | boolean): void {
    if (listener === null) return;
    if (type !== "message") return add.call(this, type, listener, options);
    const read = held(this);
    let wrapped = read.listeners.get(listener);
    if (!wrapped) {
      wrapped = event => callerState.socketScope.run(read, () => typeof listener === "function" ? listener.call(this, event) : listener.handleEvent(event));
      read.listeners.set(listener, wrapped);
    }
    add.call(this, type, wrapped, options);
  } as typeof add;
  CallerSocket.prototype.removeEventListener = function (this: WebSocket, type: string, listener: EventListenerOrEventListenerObject | null, options?: EventListenerOptions | boolean): void {
    if (listener === null) return;
    remove.call(this, type, type === "message" ? held(this).listeners.get(listener) ?? listener : listener, options);
  } as typeof remove;
  Object.defineProperty(CallerSocket, callerSocketSlot, { value: true });
  config.webSocketConstructor = CallerSocket;
}

function namedSite(): string {
  const site = pinnedSite.getStore() ?? callSite();
  if (site !== "unknown") return site;
  const route = currentReaderRoute();
  return route !== "unattributed" ? route : basename(process.argv[1] ?? "server");
}

export function withDatabaseQuery<T>(text: string, run: () => T): T {
  return withQueryCaller(`query:${transferRead(JSON.stringify({ query: text }))}`, run);
}

export function withCallerSite<T>(run: () => T): T {
  const site = callSite();
  const outer = pinnedSite.getStore();
  return pinnedSite.run(site === "unknown" && outer !== undefined ? outer : site, run);
}

/** The first stack frame outside the database layers, as a repo-relative "path:line". */
export function callerFromStack(stack: string | undefined): string {
  if (!stack) return "unknown";
  const cached = siteCache.get(stack);
  if (cached !== undefined) return cached;
  let site = "unknown";
  let sharedClient: string | undefined;
  for (const line of stack.split("\n").slice(1)) {
    if (/node:|node_modules|\/lib\/control-plane\/repository\/|\/lib\/db\/|\/lib\/ops\/neon-request-deadline\.|\/lib\/control-plane\/scheduler\/cycle-(?:phases|stall)\.|\(<anonymous>\)/.test(line)) continue;
    const match = line.match(/.*[/\\]((?:lib|scripts|app|netlify|tests)[/\\][^:()]+):(\d+):\d+/);
    if (!match) continue;
    const candidate = `${match[1].replace(/\\/g, "/")}:${match[2]}`;
    if (/\/lib\/(?:facts\/db|reader\/database|civic-data\/(?:store|read-model))\./.test(line)) {
      sharedClient ??= candidate;
      continue;
    }
    site = candidate;
    break;
  }
  if (site === "unknown" && sharedClient) site = sharedClient;
  if (siteCache.size >= SITE_CACHE_LIMIT) siteCache.clear();
  siteCache.set(stack, site);
  return site;
}

/** The code opening a database socket, under which the socket's bytes count: "websocket ← path:line". */
export function socketCaller(): string {
  return scope.getStore() ?? `websocket ← ${namedSite()}`;
}

function callSite(): string {
  const limit = Error.stackTraceLimit;
  Error.stackTraceLimit = 40;
  const holder: { stack?: string } = {};
  Error.captureStackTrace(holder, callSite);
  Error.stackTraceLimit = limit;
  return callerFromStack(holder.stack);
}

export function countNeonBytes(database: NeonDatabase, bytes: number, nowMs: number = Date.now(),
  sent: NeonSent = { requests: 1, bytes: 0 }, caller?: string): void {
  try {
    const socket = callerState.socketScope.getStore();
    const site = socket?.caller ?? caller ?? scope.getStore() ?? `query ← ${namedSite()}`;
    const key = database === "reader" ? `reader: ${site}` : site;
    const bucket = bucketFor(nowMs);
    bucket.requests += sent.requests;
    bucket.sent[database] = { requests: bucket.sent[database].requests + sent.requests, bytes: bucket.sent[database].bytes + sent.bytes };
    bucket.bytes[database] += bytes;
    bucket.byCaller.set(key, (bucket.byCaller.get(key) ?? 0) + bytes);
    const route = socket?.route ?? callerState.queryRoute.getStore();
    if (route && route !== "unattributed") {
      const name = `neon_bytes:${database}:${route}`;
      bucket.counters.set(name, (bucket.counters.get(name) ?? 0) + bytes);
    }
    bucket.dirty = true;
  } catch { /* accounting never breaks a read */ }
}

function bucketFor(nowMs: number): Bucket {
  const hour = hourStart(nowMs);
  let bucket = buckets.get(hour);
  if (!bucket) {
    bucket = { requests: 0, bytes: { reader: 0, "control-plane": 0 },
      sent: { reader: { requests: 0, bytes: 0 }, "control-plane": { requests: 0, bytes: 0 } },
      byCaller: new Map(), counters: new Map(), dirty: false };
    buckets.set(hour, bucket);
  }
  return bucket;
}

/** Add to one of this hour's vital-sign counts in this process (rounds, facts). Never throws. */
export function countVitalSign(name: string, by = 1, nowMs: number = Date.now()): void {
  try {
    if (!Number.isFinite(by)) return;
    installNeonBytesReport();
    const bucket = bucketFor(nowMs);
    bucket.counters.set(name, (bucket.counters.get(name) ?? 0) + by);
    bucket.dirty = true;
  } catch { /* accounting never breaks work */ }
}

function processLabel(): string {
  return `${basename(process.argv[1] ?? "node").replace(/\.m?[jt]s$/, "")}#${process.pid}`;
}

function snapshot(hour: string, bucket: Bucket): NeonBytesHour {
  return { hour, requests: bucket.requests, bytes: { ...bucket.bytes }, sent: { ...bucket.sent },
    byCaller: Object.fromEntries(bucket.byCaller), processes: [processLabel()],
    ...(bucket.counters.size > 0 ? { counters: Object.fromEntries(bucket.counters) } : {}) };
}

/** This process's own counts, in memory. */
export function processNeonBytes(): readonly NeonBytesHour[] {
  return [...buckets.entries()].map(([hour, bucket]) => snapshot(hour, bucket));
}

export function takeNeonBytesHours(nowMs: number = Date.now()): readonly NeonBytesHour[] {
  const current = hourStart(nowMs);
  const taken: NeonBytesHour[] = [];
  for (const [hour, bucket] of [...buckets.entries()]) {
    if (bucket.dirty) { taken.push({ ...snapshot(hour, bucket), pid: process.pid, startedMs: Math.floor(performance.timeOrigin),
      peakRssBytes: process.resourceUsage().maxRSS * 1024 }); bucket.dirty = false; }
    if (hour < current) buckets.delete(hour);
  }
  return taken;
}

export function formatVitalSignsReport(part: NeonBytesHour): string {
  const ranked = Object.entries(part.byCaller).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const line = (byCaller: Record<string, number>) => `${VITAL_SIGNS_LINE_PREFIX}${JSON.stringify({ ...part, byCaller })}`;
  let kept = ranked.length;
  for (;;) {
    const rest = ranked.slice(kept).reduce((total, [, bytes]) => total + bytes, 0);
    const byCaller = Object.fromEntries(ranked.slice(0, kept));
    if (rest > 0) byCaller.other = (byCaller.other ?? 0) + rest;
    const text = line(byCaller);
    if (new TextEncoder().encode(text).length <= VITAL_SIGNS_LINE_LIMIT || kept === 0) return text;
    kept -= 1;
  }
}

/** One report line back into its hour part; anything else is null. */
export function parseVitalSignsReport(line: string): NeonBytesHour | null {
  const text = line.trim();
  if (!text.startsWith(VITAL_SIGNS_LINE_PREFIX.trim())) return null;
  try {
    const part = JSON.parse(text.slice(VITAL_SIGNS_LINE_PREFIX.trim().length)) as NeonBytesHour;
    if (typeof part?.hour !== "string" || !Number.isSafeInteger(part.pid) || typeof part.requests !== "number" ||
      !part.bytes || typeof part.byCaller !== "object" || !Array.isArray(part.processes)) return null;
    return part;
  } catch { return null; }
}

export function reportNeonBytes(nowMs: number = Date.now(), write: (text: string) => void = text => { process.stdout.write(text); }): boolean {
  if (callerState.keptInProcess || process.env[VITAL_SIGNS_REPORT_ENV] !== "1") return false;
  try {
    for (const part of takeNeonBytesHours(nowMs)) write(`${formatVitalSignsReport(part)}\n`);
    return true;
  } catch { return false; }
}

export function vitalSignsLineFilter(onReport: (part: NeonBytesHour) => void): { readonly take: (chunk: string) => string; readonly end: () => string } {
  let held = "";
  let midLine = false;
  const take = (chunk: string): string => {
    let text = held + chunk;
    held = "";
    let out = "";
    while (text) {
      const newline = text.indexOf("\n");
      if (midLine) {
        if (newline < 0) { out += text; break; }
        out += text.slice(0, newline + 1);
        text = text.slice(newline + 1);
        midLine = false;
        continue;
      }
      if (newline < 0) {
        const mayBeReport = VITAL_SIGNS_LINE_PREFIX.startsWith(text) || text.startsWith(VITAL_SIGNS_LINE_PREFIX);
        if (mayBeReport && text.length <= 2 * VITAL_SIGNS_LINE_LIMIT) held = text;
        else { out += text; midLine = true; }
        break;
      }
      const line = text.slice(0, newline);
      const part = line.startsWith(VITAL_SIGNS_LINE_PREFIX) ? parseVitalSignsReport(line) : null;
      if (part) { try { onReport(part); } catch { /* accounting never breaks output */ } }
      else out += text.slice(0, newline + 1);
      text = text.slice(newline + 1);
    }
    return out;
  };
  return { take, end: () => { const rest = held; held = ""; return rest; } };
}

/** One report a minute and one at exit, in every process that counts. */
export function installNeonBytesReport(): void {
  if (callerState.reportInstalled) return;
  callerState.reportInstalled = true;
  const timer = setInterval(() => { reportNeonBytes(); }, 60_000);
  timer.unref();
  /* At exit every hour this process counted is reported again, so its last part carries its peak memory. */
  process.once("exit", () => { for (const bucket of buckets.values()) bucket.dirty = true; reportNeonBytes(); });
}

/** The runner parent sums the hour itself (takeNeonBytesHours); it never reports to its own output. */
export function keepNeonBytesInProcess(): void {
  callerState.keptInProcess = true;
}

export function summarizeNeonBytes(hour: NeonBytesHour, top = 20): NeonBytesSummary {
  const ranked = Object.entries(hour.byCaller).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const kept = ranked.slice(0, top).map(([caller, bytes]) => ({ caller, bytes }));
  const rest = ranked.slice(top).reduce((total, [, bytes]) => total + bytes, 0);
  return {
    hour: hour.hour, controlPlaneBytes: hour.bytes["control-plane"], readerBytes: hour.bytes.reader,
    requests: hour.requests, byCaller: rest > 0 ? [...kept, { caller: "other", bytes: rest }] : kept,
    processCount: hour.processes.length,
  };
}

function megabytes(bytes: number): string {
  return bytes >= 1e9 ? `${(bytes / 1e9).toFixed(2)} GB` : `${(bytes / 1e6).toFixed(1)} MB`;
}

/** The runner journal's line: the hour, the totals, then the largest callers. */
export function formatNeonBytesLine(summary: NeonBytesSummary, label: string, top = 10): string {
  const callers = summary.byCaller.slice(0, top).map(entry => `${megabytes(entry.bytes)} ${entry.caller}`).join("; ");
  return `neon bytes ${label} (hour from ${summary.hour}, ${summary.processCount} runner processes, ${summary.requests} requests): ` +
    `control plane ${megabytes(summary.controlPlaneBytes)}, reader ${megabytes(summary.readerBytes)}` +
    (callers ? `; largest: ${callers}` : "");
}

const easternDayFormatter = new Intl.DateTimeFormat("sv-SE", { timeZone: "America/New_York" });
export const easternDay = (at: Date) => easternDayFormatter.format(at);

export function runnerClient(): boolean {
  return Boolean(process.env.WTP_RUNTIME_AUTHORITY_CAPABILITY) || process.env.WTP_SANCTIONED_WRITE === "routine-civic-data-promotion";
}

type FetchLike = typeof fetch;

export function databaseTransferFetch(underlying: FetchLike, record: (value: DatabaseTransfer) => void | Promise<unknown>, internal: () => boolean = () => false): FetchLike {
  if ((underlying as FetchLike & { [countedFetchSlot]?: boolean })[countedFetchSlot]) return underlying;
  const countedFetch: FetchLike = async (input, init) => {
    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
    const connection = headers.get("neon-connection-string");
    if (connection === null || internal()) return underlying(input, init);
    if (connection === process.env.FEEDBACK_DATABASE_URL && connection !== process.env.DATABASE_URL &&
        connection !== process.env.WTP_CONTROL_PLANE_DATABASE_URL) return underlying(input, init);
    const day = easternDay(new Date()), database = connection === process.env.DATABASE_URL ? "reader" : "control-plane";
    const client = runnerClient() ? "runner" : "reader";
    const requestBytes = typeof init?.body === "string" ? Buffer.byteLength(init.body) : 0;
    const route = callerState.queryRoute.getStore() ?? currentReaderRoute();
    const read = `${route}\t${transferRead(typeof init?.body === "string" ? init.body : undefined)}`;
    const caller = scope.getStore() ?? `query:${read.split("\t")[1]} ← ${namedSite()}`;
    const response = await underlying(input, init);
    let received = 0, recorded: Promise<void> | null = null;
    const finish = (): Promise<void> => recorded ??= Promise.resolve().then(() => callerState.queryRoute.run(route, () => scope.run(caller, () => record({
      day, database, client, requests: 1, requestBytes, responseBytes: received,
      reads: { [read]: [1, requestBytes, received] },
    })))).then(() => undefined);
    if (response.body === null) { await finish(); return response; }
    const reader = response.body.getReader();
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const chunk = await reader.read();
          if (chunk.done) { await finish(); controller.close(); }
          else { received += chunk.value.byteLength; controller.enqueue(chunk.value); }
        } catch (error) { await finish(); controller.error(error); }
      },
      async cancel(reason) {
        try { await reader.cancel(reason); }
        finally { await finish(); }
      },
    }, { highWaterMark: 0 });
    return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
  };
  Object.defineProperty(countedFetch, countedFetchSlot, { value: true });
  return countedFetch;
}
