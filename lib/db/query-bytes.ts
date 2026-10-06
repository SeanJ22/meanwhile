import { AsyncLocalStorage } from "node:async_hooks";

/**
 * **WHICH CODE PULLED THE BYTES FROM POSTGRES.** (MW-VS-01, vital-signs.md.)
 *
 * Release 8's first hour moved about 9.4 GB and nobody could name the source,
 * because the database keeps no per-query statistics. This counts, in memory,
 * the decoded response bytes each calling code site received. Nothing is
 * logged per query and nothing is written here: `flushQueryBytes()` returns and
 * resets the hour's counts for the hourly vital-signs writer, and
 * `WTP_QUERY_BYTES_LOG=1` prints the top callers every ten minutes.
 *
 * The caller is the operation tag the bounded runner set around the query
 * (table.operation) plus the first stack frame outside `repository/`, found
 * once per call site and cached. A query that did not come through the
 * bounded runner is keyed by the first frame outside the driver. Bytes are
 * counted at the HTTP layer (`databaseTransferFetch`), so they are what the
 * runner received, not a re-serialization of the parsed rows.
 */

export interface QueryBytesCaller {
  readonly caller: string;
  readonly bytes: number;
  readonly queries: number;
}

export interface QueryBytesFlush {
  readonly totalBytes: number;
  readonly totalQueries: number;
  /** The top callers by bytes, then one "other" row for the rest. */
  readonly byCaller: readonly QueryBytesCaller[];
}

/** Callers kept apart; the rest add up under OTHER_CALLER. */
export const QUERY_BYTES_TOP = 20;
export const OTHER_CALLER = "other";
/** A hard bound on distinct keys held in memory in one window. */
const MAX_KEYS = 500;
const SITE_CACHE_MAX = 1_000;

interface Tally { bytes: number; queries: number }
type Counts = Map<string, Tally>;

const callerStore = new AsyncLocalStorage<string>();
let hour: Counts = new Map();
let window: Counts = new Map();
const siteCache = new Map<string, string>();

/** First stack frame that is not this module, the driver, node itself, or the repository layer. */
function firstOutsideFrame(stack: string, skipRepository: boolean): string {
  for (const line of stack.split("\n").slice(1)) {
    if (!/\bat\b/.test(line)) continue;
    if (line.includes("node_modules") || line.includes("node:") || /db[\\/]query-bytes\.ts/.test(line)) continue;
    if (skipRepository && /[\\/]repository[\\/]/.test(line)) continue;
    if (/db[\\/]transfer\.ts/.test(line)) continue;
    const match = /\(?((?:file:\/\/)?[^()\s]+?):(\d+):\d+\)?\s*$/.exec(line);
    if (match) return `${match[1]!.replace(/^file:\/\//, "").replace(/^.*?\/((?:lib|scripts|app|components)\/)/, "$1")}:${match[2]}`;
  }
  return "unknown";
}

function siteOf(skipRepository: boolean): string {
  const holder: { stack?: string } = {};
  const limit = Error.stackTraceLimit;
  Error.stackTraceLimit = 30;
  Error.captureStackTrace(holder, siteOf);
  Error.stackTraceLimit = limit;
  const stack = holder.stack ?? "";
  const key = `${skipRepository ? "r" : "d"}:${stack}`;
  const cached = siteCache.get(key);
  if (cached !== undefined) return cached;
  const site = firstOutsideFrame(stack, skipRepository);
  if (siteCache.size >= SITE_CACHE_MAX) siteCache.clear();
  siteCache.set(key, site);
  return site;
}

/** The caller tag for an operation, from the stack as it is now. Take it before the first await. */
export function queryCallerTag(operation: string): string {
  return `${operation} @ ${siteOf(true)}`;
}

/** Run one store call under its caller tag, so the bytes it receives are counted against it. */
export function withQueryCaller<T>(tag: string, run: () => Promise<T>): Promise<T> {
  return callerStore.run(tag, run);
}

function add(counts: Counts, caller: string, bytes: number): void {
  const key = !counts.has(caller) && counts.size >= MAX_KEYS ? OTHER_CALLER : caller;
  const tally = counts.get(key);
  if (tally) { tally.bytes += bytes; tally.queries++; }
  else counts.set(key, { bytes, queries: 1 });
}

/** Called once per answered query with the decoded body size. Never throws. */
export function recordQueryBytes(bytes: number): void {
  try {
    if (!(bytes >= 0)) return;
    const caller = callerStore.getStore() ?? `driver @ ${siteOf(false)}`;
    add(hour, caller, bytes);
    add(window, caller, bytes);
  } catch { /* the counter must never hide data */ }
}

function summarize(counts: Counts): QueryBytesFlush {
  const rows = [...counts.entries()].map(([caller, t]) => ({ caller, bytes: t.bytes, queries: t.queries }))
    .sort((a, b) => b.bytes - a.bytes || a.caller.localeCompare(b.caller));
  const top = rows.slice(0, QUERY_BYTES_TOP);
  const rest = rows.slice(QUERY_BYTES_TOP);
  const byCaller = rest.length === 0 ? top : [...top, {
    caller: OTHER_CALLER, bytes: rest.reduce((n, r) => n + r.bytes, 0), queries: rest.reduce((n, r) => n + r.queries, 0),
  }];
  return {
    totalBytes: rows.reduce((n, r) => n + r.bytes, 0),
    totalQueries: rows.reduce((n, r) => n + r.queries, 0),
    byCaller,
  };
}

/** Return the counts since the last flush and reset them. The hourly vital-signs writer calls this. */
export function flushQueryBytes(): QueryBytesFlush {
  const out = summarize(hour);
  hour = new Map();
  return out;
}

/** One line per caller, biggest first, for the ten-minute diagnostic. */
export function queryBytesLogLines(flush: QueryBytesFlush, minutes: number): string[] {
  if (flush.totalQueries === 0) return [];
  const mb = (n: number) => (n / 1e6).toFixed(2);
  return [
    `QUERY_BYTES ${minutes}min total ${mb(flush.totalBytes)} MB in ${flush.totalQueries} queries`,
    ...flush.byCaller.map(r => `QUERY_BYTES ${mb(r.bytes)} MB ${r.queries}q ${r.caller}`),
  ];
}

/** Print and reset the ten-minute window. */
export function printQueryBytesWindow(write: (line: string) => void = line => console.log(line), minutes = 10): void {
  const flush = summarize(window);
  window = new Map();
  for (const line of queryBytesLogLines(flush, minutes)) write(line);
}

let logTimer: ReturnType<typeof setInterval> | undefined;

/** With WTP_QUERY_BYTES_LOG=1, print the top callers every ten minutes. Idempotent. */
export function startQueryBytesLog(
  env: Record<string, string | undefined> = process.env,
  write: (line: string) => void = line => console.log(line),
  intervalMs = 10 * 60_000,
): boolean {
  if (env.WTP_QUERY_BYTES_LOG !== "1" || logTimer) return false;
  logTimer = setInterval(() => printQueryBytesWindow(write, Math.round(intervalMs / 60_000)), intervalMs);
  logTimer.unref();
  return true;
}

export function stopQueryBytesLog(): void {
  if (logTimer) clearInterval(logTimer);
  logTimer = undefined;
}

/** Test seam. */
export function resetQueryBytes(): void {
  hour = new Map(); window = new Map(); siteCache.clear();
}
