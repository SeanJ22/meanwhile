/**
 * **NEON BYTES BY CALLING CODE, PER UTC HOUR.** (Vital signs, Sean, Oct 6.)
 *
 * Release 8's first hour moved about 9.4 GB from the control-plane project and
 * nothing in the database could say which code read it: the project has no
 * pg_stat_statements, and the table read counters count rows Postgres touched,
 * not bytes sent to us. This counter names the source.
 *
 * Every Neon HTTP response already passes through `databaseTransferFetch`
 * (transfer.ts), which measures its decoded body. Here each of those bodies is
 * added to an hour bucket under a caller key:
 *
 *   <repository operation> ← <first frame outside the repository layer>
 *   e.g. "cp_attempts.list ← lib/control-plane/promotion/campaign-publication-cycle.ts:56"
 *
 * The operation is the name `boundedQuery` already gives every control-plane
 * call; the frame is read from the stack once per distinct stack and cached.
 * Nothing is logged per query and nothing is written to a database.
 *
 * The runner is several processes (the parent, the research child, its lease
 * workers, routine and publication children). When `WTP_VITAL_SIGNS_DIR` is set,
 * which the standing runner does for itself and every child it starts, each
 * process writes its own hour totals, with its other hour counters
 * (`countVitalSign`: rounds finished, killed or deferred; facts published), to one small file there once a minute and
 * when it exits, and the parent sums the hour's files. A process killed without
 * warning loses at most its last minute. Outside the runner (the site, Admin,
 * tests) the counts stay in memory.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

export const VITAL_SIGNS_DIR_ENV = "WTP_VITAL_SIGNS_DIR";

export type NeonDatabase = "reader" | "control-plane";

/** One process's (or the summed runner's) bytes for one UTC hour. */
export interface NeonBytesHour {
  /** The hour's start, ISO, e.g. 2026-10-06T07:00:00.000Z. */
  readonly hour: string;
  readonly requests: number;
  readonly bytes: Readonly<Record<NeonDatabase, number>>;
  /** Caller key → bytes. Keys are prefixed "reader: " for the reader database. */
  readonly byCaller: Readonly<Record<string, number>>;
  /** Which processes contributed: script name and pid. */
  readonly processes: readonly string[];
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

interface Bucket { requests: number; bytes: Record<NeonDatabase, number>; byCaller: Map<string, number>; counters: Map<string, number>; dirty: boolean }

const scope = new AsyncLocalStorage<string>();
const buckets = new Map<string, Bucket>();
const siteCache = new Map<string, string>();
const SITE_CACHE_LIMIT = 5_000;
let flushInstalled = false;

export function hourStart(nowMs: number): string {
  return new Date(Math.floor(nowMs / 3_600_000) * 3_600_000).toISOString();
}

/**
 * Run one control-plane call with its operation name in scope, so the bytes of
 * the HTTP response it causes are counted under it and under the code that
 * asked for it. The call site is read here, synchronously with the caller.
 */
export function withQueryCaller<T>(operation: string, run: () => T): T {
  return scope.run(`${operation} ← ${callSite()}`, run);
}

/** The first stack frame outside the database layers, as a repo-relative "path:line". */
export function callerFromStack(stack: string | undefined): string {
  if (!stack) return "unknown";
  const cached = siteCache.get(stack);
  if (cached !== undefined) return cached;
  let site = "unknown";
  for (const line of stack.split("\n").slice(1)) {
    if (/node:|node_modules|\/lib\/control-plane\/repository\/|\/lib\/db\/|\(<anonymous>\)/.test(line)) continue;
    const match = line.match(/.*[/\\]((?:lib|scripts|app|netlify|tests)[/\\][^:()]+):(\d+):\d+/);
    if (match) { site = `${match[1].replace(/\\/g, "/")}:${match[2]}`; break; }
  }
  if (siteCache.size >= SITE_CACHE_LIMIT) siteCache.clear();
  siteCache.set(stack, site);
  return site;
}

function callSite(): string {
  const limit = Error.stackTraceLimit;
  Error.stackTraceLimit = 40;
  const holder: { stack?: string } = {};
  Error.captureStackTrace(holder, callSite);
  Error.stackTraceLimit = limit;
  return callerFromStack(holder.stack);
}

/** Called once per counted Neon HTTP response (transfer.ts). Never throws. */
export function countNeonBytes(database: NeonDatabase, bytes: number, nowMs: number = Date.now()): void {
  try {
    const caller = scope.getStore() ?? `query ← ${callSite()}`;
    const key = database === "reader" ? `reader: ${caller}` : caller;
    const bucket = bucketFor(nowMs);
    bucket.requests += 1;
    bucket.bytes[database] += bytes;
    bucket.byCaller.set(key, (bucket.byCaller.get(key) ?? 0) + bytes);
    bucket.dirty = true;
  } catch { /* accounting never breaks a read */ }
}

function bucketFor(nowMs: number): Bucket {
  const hour = hourStart(nowMs);
  let bucket = buckets.get(hour);
  if (!bucket) {
    bucket = { requests: 0, bytes: { reader: 0, "control-plane": 0 }, byCaller: new Map(), counters: new Map(), dirty: false };
    buckets.set(hour, bucket);
  }
  return bucket;
}

/** Add to one of this hour's vital-sign counts in this process (rounds, facts). Never throws. */
export function countVitalSign(name: string, by = 1, nowMs: number = Date.now()): void {
  try {
    if (!Number.isFinite(by)) return;
    const bucket = bucketFor(nowMs);
    bucket.counters.set(name, (bucket.counters.get(name) ?? 0) + by);
    bucket.dirty = true;
  } catch { /* accounting never breaks work */ }
}

function processLabel(): string {
  return `${basename(process.argv[1] ?? "node").replace(/\.m?[jt]s$/, "")}#${process.pid}`;
}

function snapshot(hour: string, bucket: Bucket): NeonBytesHour {
  return { hour, requests: bucket.requests, bytes: { ...bucket.bytes },
    byCaller: Object.fromEntries(bucket.byCaller), processes: [processLabel()],
    ...(bucket.counters.size > 0 ? { counters: Object.fromEntries(bucket.counters) } : {}) };
}

/** This process's own counts, in memory. */
export function processNeonBytes(): readonly NeonBytesHour[] {
  return [...buckets.entries()].map(([hour, bucket]) => snapshot(hour, bucket));
}

/**
 * Write this process's hour files (atomically, one per hour it has counts for)
 * and forget finished hours once written. Synchronous so it can run at exit.
 */
export function flushNeonBytes(dir: string | undefined = process.env[VITAL_SIGNS_DIR_ENV], nowMs: number = Date.now()): boolean {
  if (!dir) return false;
  const current = hourStart(nowMs);
  try {
    mkdirSync(dir, { recursive: true });
    for (const [hour, bucket] of [...buckets.entries()]) {
      if (bucket.dirty) {
        const file = join(dir, `${hour.slice(0, 13)}--${process.pid}.json`);
        writeFileSync(`${file}.tmp`, JSON.stringify(snapshot(hour, bucket)), "utf8");
        renameSync(`${file}.tmp`, file);
        bucket.dirty = false;
      }
      if (hour < current) buckets.delete(hour);
    }
    return true;
  } catch { return false; }
}

/** One flush a minute and one at exit, in every process that counts. */
export function installNeonBytesFlush(): void {
  if (flushInstalled) return;
  flushInstalled = true;
  const timer = setInterval(() => { flushNeonBytes(); }, 60_000);
  timer.unref();
  process.once("exit", () => { flushNeonBytes(); });
}

/** Sum every process's file for one hour. Unreadable files are skipped, not fatal. */
export function readNeonBytesHour(dir: string, hour: string): NeonBytesHour {
  const sum = { requests: 0, bytes: { reader: 0, "control-plane": 0 } as Record<NeonDatabase, number>,
    byCaller: {} as Record<string, number>, processes: [] as string[], counters: {} as Record<string, number> };
  let names: string[] = [];
  try { names = readdirSync(dir); } catch { /* no runner files yet */ }
  const prefix = `${hour.slice(0, 13)}--`;
  for (const name of names) {
    if (!name.startsWith(prefix) || !name.endsWith(".json")) continue;
    try {
      const part = JSON.parse(readFileSync(join(dir, name), "utf8")) as NeonBytesHour;
      if (part.hour !== hour) continue;
      sum.requests += part.requests;
      sum.bytes.reader += part.bytes.reader ?? 0;
      sum.bytes["control-plane"] += part.bytes["control-plane"] ?? 0;
      for (const [caller, bytes] of Object.entries(part.byCaller)) sum.byCaller[caller] = (sum.byCaller[caller] ?? 0) + bytes;
      sum.processes.push(...part.processes);
      for (const [name, count] of Object.entries(part.counters ?? {})) sum.counters[name] = (sum.counters[name] ?? 0) + count;
    } catch { /* a half-written or foreign file */ }
  }
  return { hour, ...sum };
}

/** Delete hour files older than `keepMs` (default two days). */
export function pruneNeonBytes(dir: string, nowMs: number = Date.now(), keepMs = 48 * 3_600_000): void {
  const oldest = hourStart(nowMs - keepMs).slice(0, 13);
  let names: string[] = [];
  try { names = readdirSync(dir); } catch { return; }
  for (const name of names) {
    if (name.slice(0, 13) < oldest) { try { unlinkSync(join(dir, name)); } catch { /* already gone */ } }
  }
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
