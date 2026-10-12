/**
 * The standing hunter lane: a child of the runner that leases the round's queued tasks to worker processes,
 * admits every paid request through guards re-armed every refresh, and keeps running plain-code tasks while
 * paid work is held. It ends itself after `HUNTER_LANE_LIFE_MS` (or when a release asks it to drain),
 * releasing request holds it never settled. Each worker has its own progress clock and a stuck one is ended alone.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { DispatchResult } from "../scheduler/dispatch.ts";
import { releaseOpenJobs, SPEND_HOLD_STALE_MS } from "../expansion/spend-holds.ts";
import { HUNTER_LANE_REFRESH_MS, type ArmedHunterLane } from "./hunter-lane-arming.ts";

export const HUNTER_QUEUE_FORMAT = 1;
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
  readonly taskIds: readonly string[];
  readonly plainTaskIds: readonly string[];
}

/** The queue sits beside the round's reading. */
export function hunterQueuePath(armingPath: string): string {
  return join(dirname(armingPath), "queue.json");
}

export function writeHunterQueue(path: string, queue: Omit<HunterQueue, "format">): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify({ format: HUNTER_QUEUE_FORMAT, ...queue }));
  renameSync(temporary, path);
}

export function readHunterQueue(path: string): HunterQueue | { readonly unread: string } {
  try {
    const q = JSON.parse(readFileSync(path, "utf8")) as Partial<HunterQueue> | null;
    if (q === null || q.format !== HUNTER_QUEUE_FORMAT || typeof q.writtenAt !== "string" || !Array.isArray(q.taskIds) || !Array.isArray(q.plainTaskIds)) {
      return { unread: "the round's queue is not in the expected form" };
    }
    return q as HunterQueue;
  } catch (error) {
    return { unread: (error as NodeJS.ErrnoException)?.code === "ENOENT" ? "no round has written a queue yet" : `the round's queue could not be read (${error instanceof Error ? error.message : String(error)})` };
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
    readonly absorb: () => HunterQueue | null }) => Promise<readonly DispatchResult[]>;
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
  const armedAll: ArmedHunterLane[] = [];
  let current: ArmedHunterLane | null = null;
  const say = (armed: ArmedHunterLane): void => {
    deps.log(armed.closed === null ? `hunter lane: armed; paid work open under the $${armed.ceilingUsd.toFixed(2)} ceiling`
      : `hunter lane: armed; paid work held: ${armed.closed.reason}; plain-code tasks continue`);
  };
  const rearm = async (): Promise<ArmedHunterLane> => {
    const armed = await deps.arm();
    armedAll.push(armed);
    if (current === null || (current.closed?.reason ?? null) !== (armed.closed?.reason ?? null)) say(armed);
    current = armed;
    return armed;
  };
  /** Every request hold any guards of this lane took and never settled. */
  const releaseAll = async (at: string): Promise<readonly string[]> => {
    const failed: string[] = [];
    for (const armed of armedAll) {
      if (armed.guards === null) continue;
      failed.push(...await releaseOpenJobs(armed.spendHolds, armed.guards.openJobs(), at));
    }
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
        let absorbReadMs = deps.clock();
        const absorb = (): HunterQueue | null => {
          if (deps.stopRequested() || deps.clock() >= untilMs || deps.clock() - absorbReadMs < HUNTER_LANE_IDLE_READ_MS) return null;
          absorbReadMs = deps.clock();
          const next = deps.readQueue();
          if ("unread" in next || next.writtenAt === lastQueue) return null;
          lastQueue = next.writtenAt;
          deps.log(`hunter lane: the queue written ${next.writtenAt} joins the running wave: ${next.taskIds.length} task(s), ${next.plainTaskIds.length} plain-code`);
          return next;
        };
        const results = await deps.runWave({ queue: q, paidOpen, deadlineMs: untilMs, absorb });
        waves += 1;
        dispatched += results.length;
        lastSaidMs = deps.clock();
      }
      if (deps.clock() >= untilMs) ended = "its life ended; the runner starts a fresh lane";
    } finally {
      stopped = true;
      void refresher;
    }
    const releaseFailures = await releaseAll(new Date(deps.clock()).toISOString());
    for (const failure of releaseFailures) deps.log(`hunter lane: an open request hold could not be released (${failure}); it counts in full until it goes stale`);
    deps.log(`hunter lane: ended after ${waves} wave(s), ${dispatched} task result(s): ${ended}`);
    return { waves, dispatched, releaseFailures, ended };
  };
  return { run, current: (): ArmedHunterLane => { if (current === null) throw new Error("HUNTER_LANE_NOT_ARMED"); return current; }, releaseAll };
}
