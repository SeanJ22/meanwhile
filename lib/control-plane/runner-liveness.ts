import { OWNER_SURFACE_FORMAT_VERSION, type RunnerHeartbeat } from "./owner-surface.ts";

/** The next heartbeat for a cycle the child did not record: advances `beatAt` with `lastCycleOk: false`, preserving the prior intake receipt and code identity. */
export function cycleLivenessBeat(
  prev: RunnerHeartbeat | null,
  input: {
    readonly cycleStartedAt: string;
    readonly finishedAt: string;
    readonly ok: boolean;
    readonly testedSha: string | null;
    readonly host: string;
    readonly intervalMin: number | null;
    readonly codeIdentity?: RunnerHeartbeat["codeIdentity"];
  },
): RunnerHeartbeat {
  const dueMs = Date.parse(input.finishedAt);
  return {
    formatVersion: OWNER_SURFACE_FORMAT_VERSION,
    beatAt: input.finishedAt,
    lastCycleStartedAt: input.cycleStartedAt,
    lastCycleFinishedAt: input.finishedAt,
    nextCycleDueAt:
      input.intervalMin === null || !Number.isFinite(input.intervalMin) || !Number.isFinite(dueMs)
        ? null
        : new Date(dueMs + input.intervalMin * 60_000).toISOString(),
    lastCycleOk: input.ok,
    testedSha: input.testedSha,
    host: input.host,
    pause: null,
    codeIdentity: input.codeIdentity ?? prev?.codeIdentity ?? null,
    intakeRuntime: prev?.intakeRuntime ?? null,
  };
}

/** The hang watchdog's decision (the Worker mirrors it inline). `killAfterMs <= 0` disables it; a missing or NaN reading never kills. */
export function hangShouldTerminate(lastPingMs: number, nowMs: number, killAfterMs: number): boolean {
  if (
    !Number.isFinite(lastPingMs) ||
    !Number.isFinite(nowMs) ||
    !Number.isFinite(killAfterMs) ||
    killAfterMs <= 0 ||
    lastPingMs <= 0
  ) {
    return false;
  }
  return nowMs - lastPingMs > killAfterMs;
}
