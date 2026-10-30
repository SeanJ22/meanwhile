import type { RecordProjection } from "../repository/types.ts";

export const RUNNER_PROGRESS_HEARTBEAT_FIELDS = {
  beatAt: true, lastCycleStartedAt: true, lastCycleFinishedAt: true,
  lastCycleOk: true, nextCycleDueAt: true, testedSha: true,
  cycle: ["startedAt", "finishedAt", "exitCode", "signal", "lastError"],
} as const satisfies RecordProjection;

