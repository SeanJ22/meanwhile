/**
 * **THE STANDING HUNTER LANE (CH-24 part 2, Proposal A).**
 *
 * With WTP_CONTINUOUS_HUNTERS=1 the research round plans the hunt and writes
 * its queue (the tasks it planned, in its order) beside its Send and area
 * reading; it starts no lease worker and admits no paid request. This lane is
 * a standing child of the runner: it leases the queued tasks to worker
 * processes with no 15-minute slice, admits every paid request through the
 * guards it re-arms every five minutes (hunter-lane-arming.ts), and picks up
 * each new queue the round writes. While paid work is held, plain-code tasks
 * still run.
 *
 * The lane ends itself after `HUNTER_LANE_LIFE_MS` (or when a release asks
 * it to drain) once its current wave finishes, and the runner starts it again,
 * so new code loads within the hour and no request hold can outlive
 * `SPEND_HOLD_STALE_MS`. On every exit it can still act on, it releases the
 * request holds it never settled (`releaseOpenJobs`).
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
  /** One wave over the queue's tasks, under the lane's current guards. Paid tasks only while `paidOpen`. */
  readonly runWave: (input: { readonly queue: HunterQueue; readonly paidOpen: boolean; readonly deadlineMs: number }) => Promise<readonly DispatchResult[]>;
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
        const results = await deps.runWave({ queue: q, paidOpen, deadlineMs: untilMs });
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
