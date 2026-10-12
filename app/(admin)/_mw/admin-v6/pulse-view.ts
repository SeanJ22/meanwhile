/** The pulse is a freshness read, not a progress feed: last useful progress and per-worker jobs stay unreported rather than inferred from a heartbeat. */
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

export function runnerStateWords(state: string | null): string {
  switch (state) {
    case "ALIVE":
      return "switched on";
    case "SILENT":
      return "silent";
    case "NEVER_BEAT":
      return "no check-in on record";
    case null:
      return "—";
    default:
      return state.toLowerCase().replace(/_/g, " ");
  }
}
