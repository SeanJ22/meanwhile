/**
 * **WHAT A RESEARCH CYCLE WAS WAITING ON, READABLE FROM ANOTHER THREAD.**
 * (Runner bounded store calls, 2026-09-23.)
 *
 * The research child publishes what it is waiting on — the last phase it
 * finished, the labelled await it is inside, and the store calls in flight —
 * into a SharedArrayBuffer. The stall diagnostic's worker thread reads it near
 * the supervisor's wall. A worker has its own event loop, so it can still read
 * and write when the main thread is blocked in a synchronous call; a timer on
 * the main thread could not.
 *
 * This module is the shared layout and the pure reporting, imported by both
 * sides. It imports nothing but types, so the worker can load it directly.
 *
 * ```
 *   bytes 0-15   Int32 x4   [0] seqlock  [1] snapshot length  [2] record claim  [3] unused
 *   bytes 16-23  BigInt64   the main thread's last event-loop turn, epoch ms
 *   bytes 32-    Uint8      the snapshot as UTF-8 JSON
 * ```
 *
 * The record claim decides who writes the cycle's one local record at the
 * reserved path: ARMED, then either the cycle (FINALIZED) or the diagnostic
 * (STALL_WRITING, then STALL_WRITTEN). A cycle that finishes after the
 * diagnostic fired waits for STALL_WRITTEN and carries the stall block forward.
 */

export const STALL_SNAPSHOT_CAPACITY_BYTES = 32 * 1024;
const HEADER_INTS = 4;
const PING_OFFSET = 16;
const BODY_OFFSET = 32;

export const RECORD_CLAIM = {
  ARMED: 0,
  FINALIZED: 1,
  STALL_WRITING: 2,
  STALL_WRITTEN: 3,
} as const;

/** One labelled await the cycle is inside, outermost first. */
export interface PendingStep {
  readonly label: string;
  readonly since: string;
}

/** One store call in flight, named `<repository>.<method>`. */
export interface PendingStoreCall {
  readonly call: string;
  readonly since: string;
}

export interface PendingSnapshot {
  readonly lastPhase: string | null;
  readonly lastPhaseAt: string | null;
  readonly steps: readonly PendingStep[];
  /**
   * The last labelled await that failed, and when. By the time a crash handler
   * runs, the failing await has already been left; this keeps its name.
   */
  readonly lastFailed: PendingStep | null;
  /** The oldest store calls in flight, at most STORE_CALLS_SHOWN of them. */
  readonly store: readonly PendingStoreCall[];
  readonly storeInFlight: number;
  readonly updatedAt: string;
}

export const STORE_CALLS_SHOWN = 8;

export function allocateStallBuffer(capacity: number = STALL_SNAPSHOT_CAPACITY_BYTES): SharedArrayBuffer {
  return new SharedArrayBuffer(BODY_OFFSET + capacity);
}

function header(sab: SharedArrayBuffer): Int32Array {
  return new Int32Array(sab, 0, HEADER_INTS);
}

function body(sab: SharedArrayBuffer): Uint8Array {
  return new Uint8Array(sab, BODY_OFFSET);
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Write the snapshot under the seqlock. Never throws; a snapshot too large for the buffer drops its store list. */
export function writePendingSnapshot(sab: SharedArrayBuffer, snapshot: PendingSnapshot): void {
  try {
    const target = body(sab);
    let bytes = encoder.encode(JSON.stringify(snapshot));
    if (bytes.length > target.length) {
      bytes = encoder.encode(JSON.stringify({ ...snapshot, store: [], steps: snapshot.steps.slice(-4) }));
    }
    if (bytes.length > target.length) return;
    const h = header(sab);
    Atomics.add(h, 0, 1);
    target.set(bytes);
    Atomics.store(h, 1, bytes.length);
    Atomics.add(h, 0, 1);
  } catch {
    /* publishing is diagnostics; it never takes down the cycle */
  }
}

/** Read the last complete snapshot, or null when none was published or it could not be read consistently. */
export function readPendingSnapshot(sab: SharedArrayBuffer): PendingSnapshot | null {
  const h = header(sab);
  const source = body(sab);
  for (let tries = 0; tries < 64; tries += 1) {
    const before = Atomics.load(h, 0);
    if (before % 2 === 1) {
      /* A write is in progress; give it a millisecond. */
      waitOn(h, 0, before, 1);
      continue;
    }
    const length = Atomics.load(h, 1);
    if (length <= 0 || length > source.length) return null;
    /* A private copy: TextDecoder refuses a view of shared memory. */
    const copy = new Uint8Array(length);
    copy.set(source.subarray(0, length));
    if (Atomics.load(h, 0) !== before) continue;
    try {
      return JSON.parse(decoder.decode(copy)) as PendingSnapshot;
    } catch {
      return null;
    }
  }
  return null;
}

export function pingMainThread(sab: SharedArrayBuffer, nowMs: number): void {
  try {
    Atomics.store(new BigInt64Array(sab, PING_OFFSET, 1), 0, BigInt(Math.trunc(nowMs)));
  } catch {
    /* a missed ping only makes the main thread look blocked */
  }
}

export function lastMainThreadPing(sab: SharedArrayBuffer): number | null {
  const value = Number(Atomics.load(new BigInt64Array(sab, PING_OFFSET, 1), 0));
  return Number.isFinite(value) && value > 0 ? value : null;
}

/** Compare-and-set the record claim; returns the claim that was there. */
export function claimRecord(sab: SharedArrayBuffer, from: number, to: number): number {
  return Atomics.compareExchange(header(sab), 2, from, to);
}

export function recordClaim(sab: SharedArrayBuffer): number {
  return Atomics.load(header(sab), 2);
}

export function settleRecordClaim(sab: SharedArrayBuffer, to: number): void {
  const h = header(sab);
  Atomics.store(h, 2, to);
  Atomics.notify(h, 2);
}

function waitOn(view: Int32Array, index: number, value: number, timeoutMs: number): void {
  try {
    Atomics.wait(view, index, value, Math.max(0, timeoutMs));
  } catch {
    /* a runtime that forbids waiting here reads the value as it stands */
  }
}

/** Block up to `timeoutMs` while the claim still reads `value`. Node allows this on the main thread. */
export function waitWhileClaim(sab: SharedArrayBuffer, value: number, timeoutMs: number): void {
  waitOn(header(sab), 2, value, timeoutMs);
}

/* ----------------------------------------------------------- reporting --- */

const seconds = (ms: number): string => {
  const s = Math.max(0, Math.round(ms / 1000));
  return s >= 60 ? `${Math.floor(s / 60)}m${String(s % 60).padStart(2, "0")}s` : `${s}s`;
};

/** A main thread whose event loop has not turned for this long is blocked, not awaiting. */
export const MAIN_THREAD_BLOCKED_AFTER_MS = 15_000;

export interface StallReading {
  readonly snapshot: PendingSnapshot | null;
  readonly nowMs: number;
  readonly processStartedMs: number;
  readonly wallAtMs: number;
  readonly mainThreadPingMs: number | null;
  /** Defaults to MAIN_THREAD_BLOCKED_AFTER_MS. */
  readonly blockedAfterMs?: number;
}

/** Whether the main thread's event loop looks blocked, from the last ping. Null when it never pinged. */
export function mainThreadBlocked(
  reading: Pick<StallReading, "nowMs" | "mainThreadPingMs" | "blockedAfterMs">,
): boolean | null {
  if (reading.mainThreadPingMs === null) return null;
  return reading.nowMs - reading.mainThreadPingMs > (reading.blockedAfterMs ?? MAIN_THREAD_BLOCKED_AFTER_MS);
}

/** The innermost labelled await, or null. */
export function innermostStep(snapshot: PendingSnapshot | null): PendingStep | null {
  return snapshot?.steps.at(-1) ?? null;
}

/** The lines the diagnostic writes to stderr and into the record: what was pending, by name. */
export function stallDiagnosticLines(reading: StallReading): string[] {
  const { snapshot, nowMs } = reading;
  const since = (iso: string): string => {
    const at = Date.parse(iso);
    return Number.isFinite(at) ? `since ${iso} (${seconds(nowMs - at)})` : `since ${iso}`;
  };
  const lines = [
    `freshness:shadow · STALL DIAGNOSTIC: the cycle is still running ${seconds(nowMs - reading.processStartedMs)} into its ` +
      `${seconds(reading.wallAtMs - reading.processStartedMs)} wall, ${seconds(reading.wallAtMs - nowMs)} before the supervisor ends it`,
  ];
  if (snapshot === null) {
    lines.push("  nothing was published about what the cycle is waiting on; the diagnostic cannot name it");
  } else {
    lines.push(
      snapshot.lastPhase === null
        ? "  last phase finished: none yet"
        : `  last phase finished: ${snapshot.lastPhase}${snapshot.lastPhaseAt ? ` at ${snapshot.lastPhaseAt} (${seconds(nowMs - Date.parse(snapshot.lastPhaseAt))} ago)` : ""}`,
    );
    const step = innermostStep(snapshot);
    lines.push(
      step === null
        ? "  pending await: none labelled; the cycle is between labelled await sites"
        : `  pending await: ${step.label} ${since(step.since)}` +
            (snapshot.steps.length > 1 ? `, inside ${snapshot.steps.slice(0, -1).map((s) => s.label).join(" > ")}` : ""),
    );
    lines.push(
      snapshot.storeInFlight === 0
        ? "  store calls in flight: none"
        : `  store calls in flight: ${snapshot.storeInFlight} — ${snapshot.store.map((c) => `${c.call} ${since(c.since)}`).join("; ")}` +
            (snapshot.storeInFlight > snapshot.store.length ? `; ${snapshot.storeInFlight - snapshot.store.length} more` : ""),
    );
    if (snapshot.lastFailed) lines.push(`  last failed await: ${snapshot.lastFailed.label} at ${snapshot.lastFailed.since}`);
  }
  const blocked = mainThreadBlocked(reading);
  lines.push(
    blocked === null
      ? "  main thread: never reported an event-loop turn"
      : blocked
        ? `  main thread: its event loop has not turned for ${seconds(nowMs - (reading.mainThreadPingMs ?? nowMs))}; a synchronous call is blocking it, inside the pending await above`
        : `  main thread: its event loop turned ${seconds(nowMs - (reading.mainThreadPingMs ?? nowMs))} ago, so it is waiting on the pending await above`,
  );
  return lines;
}

/** The block a stalled cycle's local record carries, and a finished cycle carries forward. */
export interface StallDiagnosticBlock {
  readonly at: string;
  readonly secondsBeforeWall: number;
  readonly lastPhase: string | null;
  readonly pending: readonly PendingStep[];
  readonly storeInFlight: readonly PendingStoreCall[];
  readonly storeInFlightCount: number;
  readonly mainThreadBlocked: boolean | null;
  readonly lines: readonly string[];
}

export function stallDiagnosticBlock(reading: StallReading): StallDiagnosticBlock {
  return {
    at: new Date(reading.nowMs).toISOString(),
    secondsBeforeWall: Math.round((reading.wallAtMs - reading.nowMs) / 1000),
    lastPhase: reading.snapshot?.lastPhase ?? null,
    pending: reading.snapshot?.steps ?? [],
    storeInFlight: reading.snapshot?.store ?? [],
    storeInFlightCount: reading.snapshot?.storeInFlight ?? 0,
    mainThreadBlocked: mainThreadBlocked(reading),
    lines: stallDiagnosticLines(reading),
  };
}

/** The local run record the diagnostic writes; the crash-record shape, so every reader of those reads it. */
export function stallRunRecord(input: {
  readonly startedAt: string;
  readonly testedSha: string | null;
  readonly cycleId: string;
  readonly block: StallDiagnosticBlock;
}): Record<string, unknown> {
  const step = input.block.pending.at(-1)?.label ?? null;
  const store = input.block.storeInFlight[0]?.call ?? null;
  return {
    startedAt: input.startedAt,
    finishedAt: null,
    cycleId: input.cycleId,
    testedSha: input.testedSha,
    stalled: true,
    error:
      `CYCLE_STALLED: ${input.block.secondsBeforeWall} s before the wall the cycle was waiting on ` +
      `${step ?? "no labelled await"}${store ? ` (store call ${store})` : ""}` +
      (input.block.mainThreadBlocked ? "; its event loop was blocked" : ""),
    stallDiagnostic: input.block,
    digest: [
      "PILOT HEALTH",
      `  the cycle had not finished ${input.block.secondsBeforeWall} s before the supervisor's wall — a stalled cycle, never an idle one`,
      ...input.block.lines.slice(1).map((line) => `    ${line.trim()}`),
      "  ROLLUP    NOT GREEN — the cycle did not finish",
    ],
  };
}
