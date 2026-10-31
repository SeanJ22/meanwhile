import { reportingWorkerSlots, routineProcessSlots, type WorkerProcessSlots } from "../control-plane/workers/worker-slots.ts";
import { passDeadlineFromEnv } from "./independent-runtime-pass.ts";
import { STANDING_NEON_REQUEST_DEADLINE_MS } from "./neon-request-deadline.ts";

/** A lane child ends its own turn, exit 0, after this long with nothing claimed; the runner starts it again. Well under the runner's 10-minute no-progress limit, which only a child holding work without progress should meet. */
export const IDLE_TURN_MS = 5 * 60_000;

/** The turn's end, asked by the runner's release drain or reached when idle. Each minute `beat` prints the lane's counts; the lane is busy while they change. */
export function laneTurn(line: () => string, now: () => number = Date.now) {
  let asked = false, last = line(), changedAt = now();
  return {
    ask: () => { asked = true; },
    asked: () => asked,
    begin: () => { changedAt = now(); },
    stop: () => asked || now() - changedAt >= IDLE_TURN_MS,
    beat: (print: (line: string) => void = console.log) => { const next = line(); if (next !== last) { last = next; changedAt = now(); } print(next); },
  };
}

/** A database request settles within STANDING_NEON_REQUEST_DEADLINE_MS: claiming stops two before the pass deadline, work still running one before (`turnEnd` cuts it off). */
export function laneEnds(turn: Pick<ReturnType<typeof laneTurn>, "stop">, deadline = passDeadlineFromEnv()) {
  const end = deadline - STANDING_NEON_REQUEST_DEADLINE_MS, claimEnd = end - STANDING_NEON_REQUEST_DEADLINE_MS;
  return { claimEnd, stopRequested: () => turn.stop() || Date.now() >= claimEnd, turnEnd: Number.isFinite(end) ? AbortSignal.timeout(Math.max(1, end - Date.now())) : undefined };
}

/** The runner's release drain and SIGTERM both ask the turn to finish what it holds and end. */
export function askOnRelease(ask: () => void): void {
  process.on("SIGTERM", ask);
  process.on("message", message => { if (message && typeof message === "object" && "kind" in message && message.kind === "RUNTIME_RELEASE_DRAIN") ask(); });
}

/** Waits for the lane's memory slot until `until`, saying so each minute (the runner counts that as progress); its work stays owed. A drain ends the turn clean; memory that never frees rejects with WORKER_MEMORY_DEADLINE, which the runner records. */
export async function slotOrLeave(turn: Pick<ReturnType<typeof laneTurn>, "asked" | "begin">, entry: string, until: number,
  slots: WorkerProcessSlots = routineProcessSlots({ admissionsOpen: () => !turn.asked() })): Promise<() => void> {
  try { const release = await reportingWorkerSlots(slots).acquire(entry, until); turn.begin(); return release; }
  catch (error) { if (String(error).includes("RUNTIME_RELEASE_DRAINED")) process.exit(0); throw error; }
}
