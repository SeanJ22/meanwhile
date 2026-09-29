/**
 * **WHAT THE LIVE PULSE CAN HONESTLY SAY ABOUT THE WORKERS.**
 *
 * `LivePulse` is a small freshness read: heartbeat, last round finished, next
 * round due, a few counts and whole-system lane gauges. It is NOT a progress
 * feed, so "last useful progress" and per-worker jobs stay unreported here
 * (DEP-WORKER-EVENTS) rather than being inferred from a heartbeat.
 *
 * PURE.
 */
import type { LivePulse } from "@/lib/control-plane/live-pulse.ts";

import type { WorkerStatus } from "./model.ts";

export function workerStatusFromPulse(pulse: LivePulse | null): WorkerStatus {
  return {
    lastCheckIn: pulse?.runner.beatAt ?? null,
    lastUsefulProgress: null,
    roundStartedAt: null,
    lastRoundFinishedAt: pulse?.runner.lastCycleFinishedAt ?? null,
    nextRoundDueAt: pulse?.runner.nextCycleDueAt ?? null,
    runnerState: pulse?.runner.state ?? null,
    lanes: pulse?.lanes?.gauges.map((g) => ({ name: g.name, active: g.active, waiting: g.waiting, blockedBy: g.blockedBy })) ?? null,
    unread: pulse?.unread ?? [],
  };
}

/** The runner liveness words the pulse carries, in plain English. */
export function runnerStateWords(state: string | null): string {
  switch (state) {
    case "ALIVE":
      return "switched on";
    case "SILENT":
      return "silent: no check-in for a while";
    case "NEVER_BEAT":
      return "no check-in on record";
    case null:
      return "not reported";
    default:
      return state.toLowerCase().replace(/_/g, " ");
  }
}
