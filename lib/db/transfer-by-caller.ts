/**
 * Neon response bytes by calling code, per UTC hour. Each body measured by
 * `databaseTransferFetch` (transfer.ts) is added to an hour bucket under
 *
 *   <repository operation> ← <first frame outside the repository layer>
 *
 * When `WTP_VITAL_SIGNS_REPORT=1`, each process prints its whole hour so far
 * as one `vital-signs-bytes {json}` stdout line once a minute and at exit; the
 * runner parent strips and sums those lines. This module writes no files: it
 * is in every data command's import closure. Elsewhere the counts stay in memory.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { basename } from "node:path";

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
  /** Caller key → bytes. Keys are prefixed "reader: " for the reader database. */
  readonly byCaller: Readonly<Record<string, number>>;
  /** Which processes contributed: script name and pid. */
  readonly processes: readonly string[];
  /** The one process this part came from (a report line), and when it started; absent on a sum. */
  readonly pid?: number;
  readonly startedMs?: number;
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
/* Stack strings run to a few KB; a small cache keeps the per-process memory under 1 MB. */
const SITE_CACHE_LIMIT = 256;
let reportInstalled = false;
let keptInProcess = false;

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
  return { hour, requests: bucket.requests, bytes: { ...bucket.bytes },
    byCaller: Object.fromEntries(bucket.byCaller), processes: [processLabel()],
    ...(bucket.counters.size > 0 ? { counters: Object.fromEntries(bucket.counters) } : {}) };
}

/** This process's own counts, in memory. */
export function processNeonBytes(): readonly NeonBytesHour[] {
  return [...buckets.entries()].map(([hour, bucket]) => snapshot(hour, bucket));
}

/**
 * This process's hours with counts not yet handed on (its whole total for each),
 * marked handed on; finished hours are forgotten once handed on.
 */
export function takeNeonBytesHours(nowMs: number = Date.now()): readonly NeonBytesHour[] {
  const current = hourStart(nowMs);
  const taken: NeonBytesHour[] = [];
  for (const [hour, bucket] of [...buckets.entries()]) {
    if (bucket.dirty) { taken.push({ ...snapshot(hour, bucket), pid: process.pid, startedMs: Math.floor(performance.timeOrigin) }); bucket.dirty = false; }
    if (hour < current) buckets.delete(hour);
  }
  return taken;
}

/**
 * The report line for one process's hour. Callers beyond what fits one atomic
 * pipe write are summed as "other" (largest kept), so the totals stay whole.
 */
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

/**
 * Print this process's unreported hour totals as report lines, when the runner
 * asked for them. Synchronous so it can run at exit. Never throws.
 */
export function reportNeonBytes(nowMs: number = Date.now(), write: (text: string) => void = text => { process.stdout.write(text); }): boolean {
  if (keptInProcess || process.env[VITAL_SIGNS_REPORT_ENV] !== "1") return false;
  try {
    for (const part of takeNeonBytesHours(nowMs)) write(`${formatVitalSignsReport(part)}\n`);
    return true;
  } catch { return false; }
}

/**
 * Take report lines out of a child's output stream, chunk by chunk: each whole
 * report line goes to `onReport`, everything else comes back unchanged and in
 * order. Only a partial line that may still become a report line is held for
 * the next chunk; `end()` returns whatever is still held when the stream closes.
 */
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
  if (reportInstalled) return;
  reportInstalled = true;
  const timer = setInterval(() => { reportNeonBytes(); }, 60_000);
  timer.unref();
  process.once("exit", () => { reportNeonBytes(); });
}

/** The runner parent sums the hour itself (takeNeonBytesHours); it never reports to its own output. */
export function keepNeonBytesInProcess(): void {
  keptInProcess = true;
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
