import type { DispatchResult } from "../scheduler/dispatch.ts";
import { releaseOpenJobs, SPEND_HOLD_STALE_MS } from "../expansion/spend-holds.ts";
import { HUNTER_LANE_REFRESH_MS, type ArmedHunterLane } from "./hunter-lane-arming.ts";

export const HUNTER_LANE_LIFE_MS = 55 * 60_000;

export const HUNTER_LANE_IDLE_READ_MS = 30_000;

export const HUNTER_LANE_IDLE_SAY_MS = 5 * 60_000;
if (HUNTER_LANE_LIFE_MS + 60 * 60_000 >= SPEND_HOLD_STALE_MS) throw new Error("a lane's life and its last wave must end before a hold goes stale");

export const HUNTER_JOB_QUIET_MS = 7 * 60_000;

export const HUNTER_WORKER_RETIRE_MS = 30 * 60_000;

export const HUNTER_WORKER_WALL_MS = 45 * 60_000;

export const HUNTER_LANE_PROGRESS_EVERY_MS = 60_000;
if (HUNTER_WORKER_WALL_MS > 60 * 60_000 || HUNTER_WORKER_RETIRE_MS >= HUNTER_WORKER_WALL_MS) throw new Error("a worker retires before its wall, and its wall fits the lane's last wave");

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

export function stuckWorkerLine(worker: { readonly pid: number; readonly taskId: string | null; readonly waitingOn: string;
  readonly lastMovedAt: string; readonly startedAt: string; readonly quietMs: number; readonly tasksDone: number }): string {
  return `hunter lane: stuck worker ended alone: pid ${worker.pid}; task ${worker.taskId ?? "none"}; waiting on ${worker.waitingOn}; ` +
    `last moved ${worker.lastMovedAt} (quiet ${Math.round(worker.quietMs / 60_000)} min); started ${worker.startedAt}; ` +
    `${worker.tasksDone} task(s) finished before it; its task remains owed and the other workers keep running`;
}

/** The tasks one claim of rows from the work list hands to the hunters' workers. */
export interface HunterQueue {
  readonly claimedAt: string;
  readonly taskIds: readonly string[];
  readonly plainTaskIds: readonly string[];
}

export interface HunterLaneLoopDeps {
  readonly clock: () => number;
  readonly sleep: (ms: number) => Promise<void>;
  readonly arm: () => Promise<ArmedHunterLane>;
  /** The state whose rows are worked next: the one with rows ready, or the current one when none has. */
  readonly selectState: () => Promise<string>;
  /** Claims the next rows of the current state from the work list; null when there are none. */
  readonly claim: (paidOpen: boolean) => Promise<HunterQueue | null>;
  /** Rows claimed but not reached by the wave go back to waiting. */
  readonly endWave: () => Promise<void>;

  readonly runWave: (input: { readonly queue: HunterQueue; readonly paidOpen: boolean; readonly deadlineMs: number;
    readonly absorb: () => HunterQueue | null }) => Promise<readonly DispatchResult[]>;
  readonly stopRequested: () => boolean;
  /** Paid work that is not a hunt, done between claims while paid work is open: the placement agent's turn. */
  readonly between?: () => Promise<unknown>;
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

  const releaseAll = async (at: string): Promise<readonly string[]> => {
    const failed: string[] = [];
    for (const armed of armedAll) {
      if (armed.guards === null) continue;
      failed.push(...await releaseOpenJobs(armed.spendHolds, armed.guards.openJobs(), at));
    }
    armedAll.length=0;
    return failed;
  };
  const run = async (): Promise<HunterLaneRun> => {
    const startMs = deps.clock();
    const untilMs = startMs + lifeMs;
    let stopped = false;
    let state = await deps.selectState();
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
    let lastSaidMs = startMs;
    let ended = "its life ended; the runner starts a fresh lane";
    try {
      while (deps.clock() < untilMs) {
        if (deps.stopRequested()) { ended = "a release asked it to drain"; break; }
        const selected = await deps.selectState();
        if (selected !== state) { state = selected; await rearm(); }
        const paidOpen = current!.closed === null;
        if (paidOpen) await deps.between?.().catch(error => deps.log(`hunter lane: the placement agent's turn failed (${error instanceof Error ? error.message : String(error)})`));
        const q = await deps.claim(paidOpen);
        if (q === null) {
          if (deps.clock() - lastSaidMs >= HUNTER_LANE_IDLE_SAY_MS) {
            deps.log(`hunter lane: waiting for hunts on the work list${paidOpen ? "" : " (paid work is held; only plain-code tasks are taken)"}`);
            lastSaidMs = deps.clock();
          }
          await deps.sleep(HUNTER_LANE_IDLE_READ_MS);
          continue;
        }
        deps.log(`hunter lane: wave ${waves + 1} over ${q.taskIds.length} task(s) claimed from the work list for ${state}, ${q.plainTaskIds.length} plain-code${paidOpen ? "" : "; paid tasks wait"}`);
        let absorbReadMs = deps.clock();
        let claimed: Promise<void> | null = null;
        let joining: HunterQueue | null = null;
        const absorb = (): HunterQueue | null => {
          if (claimed === null && !deps.stopRequested() && deps.clock() < untilMs && deps.clock() - absorbReadMs >= HUNTER_LANE_IDLE_READ_MS) {
            absorbReadMs = deps.clock();
            claimed = deps.claim(current!.closed === null).then(next => {
              if (next === null) return;
              deps.log(`hunter lane: ${next.taskIds.length} more task(s) from the work list join the running wave, ${next.plainTaskIds.length} plain-code`);
              joining = joining === null ? next : { claimedAt: next.claimedAt, taskIds: [...joining.taskIds, ...next.taskIds], plainTaskIds: [...joining.plainTaskIds, ...next.plainTaskIds] };
            }).catch(error => { deps.log(`hunter lane: more hunts could not be claimed (${error instanceof Error ? error.message : String(error)})`); })
              .finally(() => { claimed = null; });
          }
          const ready = joining;
          joining = null;
          return ready;
        };
        const results = await deps.runWave({ queue: q, paidOpen, deadlineMs: untilMs, absorb });
        await claimed;
        await deps.endWave();
        const unsettled=await releaseAll(new Date(deps.clock()).toISOString());
        for(const failure of unsettled)deps.log(`hunter lane: an open request hold could not be released (${failure})`);
        armedAll.push(current!);
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
