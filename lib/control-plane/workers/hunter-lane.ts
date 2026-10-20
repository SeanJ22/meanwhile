/**
 * The standing hunter lane: a child of the runner that leases the round's queued tasks to worker processes,
 * admits every paid request through guards re-armed every refresh, and keeps running plain-code tasks while
 * paid work is held. It ends itself after `HUNTER_LANE_LIFE_MS` (or when a release asks it to drain),
 * releasing request holds it never settled. Each worker has its own progress clock and a stuck one is ended alone.
 */
import { copyFileSync, mkdirSync, mkdtempSync, renameSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { temporaryPath } from "../../civic-data/temporary-path.ts";
import type { LeaseWorkerSummary } from "./process-pool.ts";
import { releaseOpenJobs, SPEND_HOLD_STALE_MS, type JobSpend } from "../expansion/spend-holds.ts";
import { HUNTER_LANE_REFRESH_MS, type ArmedHunterLane } from "./hunter-lane-arming.ts";

export const HUNTER_QUEUE_FORMAT = 2;
const openQueueSnapshots = new Set<() => void>();
process.once("exit", () => { for (const close of openQueueSnapshots) close(); });
/** How long one lane process runs before it hands over to a fresh one. Below the hold staleness, with room for its last wave. */
export const HUNTER_LANE_LIFE_MS = 55 * 60_000;
/** While the queue holds nothing new, the lane reads it this often. */
export const HUNTER_LANE_IDLE_READ_MS = 30_000;
/** An idle lane says so this often, well inside the runner's 10-minute no-progress limit. */
export const HUNTER_LANE_IDLE_SAY_MS = 5 * 60_000;
if (HUNTER_LANE_LIFE_MS + 60 * 60_000 >= SPEND_HOLD_STALE_MS) throw new Error("a lane's life and its last wave must end before a hold goes stale");

/* Each worker has its own progress clock; a worker quiet this long is ended alone. Shorter than the runner's no-progress limit by more than the lane's progress period. */
export const HUNTER_JOB_QUIET_MS = 7 * 60_000;
/** A worker this old takes no further task; it finishes the one it holds and a fresh worker takes its place. */
export const HUNTER_WORKER_RETIRE_MS = 30 * 60_000;
/** The outer wall on one worker process: retirement plus a last task. Within the lane's last-wave allowance above. */
export const HUNTER_WORKER_WALL_MS = 45 * 60_000;
/** While workers move, the lane says so at most this often; while none moves it says nothing, so a real hang is still seen. */
export const HUNTER_LANE_PROGRESS_EVERY_MS = 60_000;
if (HUNTER_WORKER_WALL_MS > 60 * 60_000 || HUNTER_WORKER_RETIRE_MS >= HUNTER_WORKER_WALL_MS) throw new Error("a worker retires before its wall, and its wall fits the lane's last wave");

/**
 * The lane's own progress signal: one line, at most every period, only when a
 * worker moved since the last one. Each line carries running totals, so it is
 * always new output to the runner.
 */
export function hunterLaneProgress(options: { readonly log: (line: string) => void; readonly everyMs?: number;
  readonly setTimer?: (run: () => void, ms: number) => unknown; readonly clearTimer?: (timer: unknown) => void }) {
  const everyMs = options.everyMs ?? HUNTER_LANE_PROGRESS_EVERY_MS;
  const setTimer = options.setTimer ?? ((run, ms) => { const t = setTimeout(run, ms); t.unref?.(); return t; });
  const clearTimer = options.clearTimer ?? (timer => clearTimeout(timer as ReturnType<typeof setTimeout>));
  let live = 0, steps = 0, done = 0, stuck = 0;
  let timer: unknown = null;
  const flush = (): void => {
    if (timer !== null) clearTimer(timer);
    timer = null;
    options.log(`hunter lane: working: ${live} worker(s) running; ${steps} step(s) and ${done} task(s) finished since the lane started` +
      (stuck > 0 ? `; ${stuck} stuck worker(s) ended alone` : ""));
  };
  const moved = (): void => { if (timer === null) timer = setTimer(flush, everyMs); };
  return {
    started: (): void => { live += 1; },
    ended: (): void => { live = Math.max(0, live - 1); },
    step: (): void => { steps += 1; moved(); },
    taskDone: (): void => { done += 1; moved(); },
    stuck: (): void => { stuck += 1; moved(); },
    stop: (): void => { if (timer !== null) clearTimer(timer); timer = null; },
  };
}

/** The journal line for a worker the lane ended alone. */
export function stuckWorkerLine(worker: { readonly pid: number; readonly taskId: string | null; readonly waitingOn: string;
  readonly lastMovedAt: string; readonly startedAt: string; readonly quietMs: number; readonly tasksDone: number }): string {
  return `hunter lane: stuck worker ended alone: pid ${worker.pid}; task ${worker.taskId ?? "none"}; waiting on ${worker.waitingOn}; ` +
    `last moved ${worker.lastMovedAt} (quiet ${Math.round(worker.quietMs / 60_000)} min); started ${worker.startedAt}; ` +
    `${worker.tasksDone} task(s) finished before it; its task remains owed and the other workers keep running`;
}

/** The round's queue: the tasks it planned, in its order, and which of them are plain code. */
export interface HunterQueue {
  readonly format: typeof HUNTER_QUEUE_FORMAT;
  readonly writtenAt: string;
  readonly taskIds: Iterable<string> & { readonly length: number };
  readonly plainTaskIds: Iterable<string> & { readonly length: number };
  readonly rank: (id: string) => number;
  readonly isPlain: (id: string) => boolean;
  readonly close: () => void;
}

/** The queue sits beside the round's reading. Only its metadata enters the lane. */
export function hunterQueuePath(armingPath: string): string {
  return join(dirname(armingPath), "queue.sqlite");
}

export function writeHunterQueue(path: string, queue: { readonly writtenAt: string; readonly taskIds: Iterable<string>; readonly plainTaskIds: Iterable<string> }): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  rmSync(temporary, { force: true });
  const db = new DatabaseSync(temporary);
  try {
    db.exec("PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF; PRAGMA cache_size=-1024; PRAGMA mmap_size=0; CREATE TABLE metadata(format INTEGER,written_at TEXT); CREATE TABLE tasks(seq INTEGER PRIMARY KEY,id TEXT UNIQUE NOT NULL,plain INTEGER NOT NULL DEFAULT 0); BEGIN");
    db.prepare("INSERT INTO metadata VALUES (?,?)").run(HUNTER_QUEUE_FORMAT, queue.writtenAt);
    const insert = db.prepare("INSERT OR IGNORE INTO tasks(id) VALUES (?)");
    for (const id of queue.taskIds) insert.run(id);
    const plain = db.prepare("UPDATE tasks SET plain=1 WHERE id=?");
    for (const id of queue.plainTaskIds) plain.run(id);
    db.exec("COMMIT");
  } catch (error) { db.close(); rmSync(temporary, { force: true }); throw error; }
  db.close();
  renameSync(temporary, path);
}

export function readHunterQueue(path: string): HunterQueue | { readonly unread: string } {
  let db: DatabaseSync | undefined;
  let directory: string | undefined;
  try {
    directory = mkdtempSync(temporaryPath(join(tmpdir(), "meanwhile-hunter-queue-")));
    const snapshot = temporaryPath(join(directory, "queue.sqlite"));
    // The public queue stays replaceable on Windows while an older wave reads its immutable disk view.
    copyFileSync(path, temporaryPath(snapshot));
    db = new DatabaseSync(snapshot, { readOnly: true });
    db.exec("PRAGMA cache_size=-1024; PRAGMA mmap_size=0");
    const meta = db.prepare("SELECT * FROM metadata").get();
    if (!meta || meta.format !== HUNTER_QUEUE_FORMAT || typeof meta.written_at !== "string") throw new Error("unexpected queue form");
    const count = db.prepare("SELECT count(*) AS total,coalesce(sum(plain),0) AS plain FROM tasks").get()!;
    const all = db.prepare("SELECT id FROM tasks ORDER BY seq");
    const plain = db.prepare("SELECT id FROM tasks WHERE plain=1 ORDER BY seq");
    const exact = db.prepare("SELECT seq,plain FROM tasks WHERE id=?");
    const ids = (statement: typeof all, length: number) => ({ length, *[Symbol.iterator]() { for (const row of statement.iterate()) yield String(row.id); } });
    const held = db;
    const ownedDirectory = directory;
    let closed = false;
    const close = (): void => {
      if (closed) return;
      closed = true; openQueueSnapshots.delete(close);
      try { held.close(); } finally { rmSync(temporaryPath(ownedDirectory), { recursive: true, force: true }); }
    };
    openQueueSnapshots.add(close);
    return { format: HUNTER_QUEUE_FORMAT, writtenAt: meta.written_at,
      taskIds: ids(all, Number(count.total)), plainTaskIds: ids(plain, Number(count.plain)),
      rank: id => Number(exact.get(id)?.seq ?? Infinity), isPlain: id => exact.get(id)?.plain === 1,
      close };
  } catch (error) {
    try { db?.close(); } finally { if (directory) rmSync(temporaryPath(directory), { recursive: true, force: true }); }
    return { unread: (error as NodeJS.ErrnoException)?.code === "ENOENT" || (error as { errcode?: number }).errcode === 14
      ? "no round has written a queue yet" : "the round's queue is not in the expected form" };
  }
}

export interface HunterLaneLoopDeps {
  readonly clock: () => number;
  readonly sleep: (ms: number) => Promise<void>;
  readonly arm: () => Promise<ArmedHunterLane>;
  readonly readQueue: () => HunterQueue | { readonly unread: string };
  /**
   * One wave over the queue's tasks, under the lane's current guards. Paid tasks only while `paidOpen`.
   * `absorb` hands the wave a queue the round wrote since it started (at most every idle-read period, null otherwise),
   * so its tasks join the running workers instead of waiting for the slowest of them.
   */
  readonly runWave: (input: { readonly queue: HunterQueue; readonly paidOpen: boolean; readonly deadlineMs: number;
    readonly absorb: () => HunterQueue | null }) => Promise<LeaseWorkerSummary>;
  readonly stopRequested: () => boolean;
  readonly log: (line: string) => void;
  readonly lifeMs?: number;
  readonly refreshMs?: number;
}

export interface HunterLaneRun {
  readonly waves: number;
  readonly dispatched: number;
  readonly releaseFailures: readonly string[];
  readonly ended: string;
}

/**
 * The lane's loop. `current()` is the guards in force: the refresher replaces
 * them every refresh period, mid-wave, so a raised dial or a pause reaches the
 * next request, not the next wave.
 */
export function hunterLane(deps: HunterLaneLoopDeps) {
  const lifeMs = deps.lifeMs ?? HUNTER_LANE_LIFE_MS;
  const refreshMs = deps.refreshMs ?? HUNTER_LANE_REFRESH_MS;
  const pendingReleases: {holds: ArmedHunterLane["spendHolds"]; jobs: ReadonlySet<JobSpend>}[] = [];
  let current: ArmedHunterLane | null = null;
  const say = (armed: ArmedHunterLane): void => {
    deps.log(armed.closed === null ? `hunter lane: armed; paid work open under the $${armed.ceilingUsd.toFixed(2)} ceiling`
      : `hunter lane: armed; paid work held: ${armed.closed.reason}; plain-code tasks continue`);
  };
  const rearm = async (): Promise<ArmedHunterLane> => {
    const armed = await deps.arm();
    if (armed.guards) pendingReleases.push({holds: armed.spendHolds, jobs: armed.guards.pendingJobs});
    if (current === null || (current.closed?.reason ?? null) !== (armed.closed?.reason ?? null)) say(armed);
    const previous = current;
    current = armed;
    if (previous?.arming !== armed.arming) previous?.arming?.close();
    return armed;
  };
  /** Every request hold any guards of this lane took and never settled. */
  const releaseAll = async (at: string): Promise<readonly string[]> => {
    const failed: string[] = [];
    for (const pending of pendingReleases) failed.push(...await releaseOpenJobs(pending.holds, [...pending.jobs], at));
    return failed;
  };
  const run = async (): Promise<HunterLaneRun> => {
    const startMs = deps.clock();
    const untilMs = startMs + lifeMs;
    let stopped = false;
    await rearm();
    const refresher = (async () => {
      while (!stopped) {
        await deps.sleep(refreshMs);
        if (stopped) break;
        try { await rearm(); }
        catch (error) { deps.log(`hunter lane: refresh failed; keeping the guards in force: ${error instanceof Error ? error.message : String(error)}`); }
      }
    })();
    let waves = 0;
    let dispatched = 0;
    let lastQueue: string | null = null;
    let lastRanOpen = false;
    let lastSaidMs = startMs;
    let ended = "its life ended; the runner starts a fresh lane";
    try {
      while (deps.clock() < untilMs) {
        if (deps.stopRequested()) { ended = "a release asked it to drain"; break; }
        const queue = deps.readQueue();
        const paidOpen = current!.closed === null;
        const fresh = !("unread" in queue) && (queue.writtenAt !== lastQueue || (paidOpen && !lastRanOpen));
        if (!fresh) {
          if (!("unread" in queue)) queue.close();
          if (deps.clock() - lastSaidMs >= HUNTER_LANE_IDLE_SAY_MS) {
            deps.log(`hunter lane: waiting for the round's next queue (${"unread" in queue ? queue.unread : `last written ${queue.writtenAt}`})`);
            lastSaidMs = deps.clock();
          }
          await deps.sleep(HUNTER_LANE_IDLE_READ_MS);
          continue;
        }
        const q = queue as HunterQueue;
        lastQueue = q.writtenAt;
        lastRanOpen = paidOpen;
        deps.log(`hunter lane: wave ${waves + 1} over the queue written ${q.writtenAt}: ${q.taskIds.length} task(s), ${q.plainTaskIds.length} plain-code${paidOpen ? "" : "; paid tasks wait"}`);
        const opened = [q];
        let absorbReadMs = deps.clock();
        const absorb = (): HunterQueue | null => {
          if (deps.stopRequested() || deps.clock() >= untilMs || deps.clock() - absorbReadMs < HUNTER_LANE_IDLE_READ_MS) return null;
          absorbReadMs = deps.clock();
          const next = deps.readQueue();
          if ("unread" in next) return null;
          if (next.writtenAt === lastQueue) { next.close(); return null; }
          opened.push(next);
          lastQueue = next.writtenAt;
          deps.log(`hunter lane: the queue written ${next.writtenAt} joins the running wave: ${next.taskIds.length} task(s), ${next.plainTaskIds.length} plain-code`);
          return next;
        };
        let summary: LeaseWorkerSummary;
        try { summary = await deps.runWave({ queue: q, paidOpen, deadlineMs: untilMs, absorb }); }
        finally { for (const held of opened) held.close(); }
        waves += 1;
        dispatched += summary.dispatched;
        lastSaidMs = deps.clock();
      }
      if (deps.clock() >= untilMs) ended = "its life ended; the runner starts a fresh lane";
    } finally {
      stopped = true;
      current?.arming?.close();
      void refresher;
    }
    const releaseFailures = await releaseAll(new Date(deps.clock()).toISOString());
    for (const failure of releaseFailures) deps.log(`hunter lane: an open request hold could not be released (${failure}); it counts in full until it goes stale`);
    deps.log(`hunter lane: ended after ${waves} wave(s), ${dispatched} task result(s): ${ended}`);
    return { waves, dispatched, releaseFailures, ended };
  };
  return { run, current: (): ArmedHunterLane => { if (current === null) throw new Error("HUNTER_LANE_NOT_ARMED"); return current; }, releaseAll };
}
