/**
 * Runner liveness: the two decisions that keep a stale projection from reading
 * as a dead runner, and a hung runner from staying dead until a human notices.
 *
 * Both are pure so they can be tested without the live control plane or a Worker.
 */
import { OWNER_SURFACE_FORMAT_VERSION, type RunnerHeartbeat } from "./owner-surface.ts";

/**
 * Build the next runner heartbeat for a cycle the CHILD did not record.
 *
 * `freshness-shadow` writes a beat with `lastCycleOk: true` only when it reaches
 * the end of a healthy cycle; a crash, a 15-minute wall kill, or a provider
 * circuit break returns to the parent with no beat, so `cp_runner_heartbeat.beatAt`
 * stays frozen at the last SUCCESS. A monitor keyed on `beatAt` then reads a
 * live, cycling runner as dead — the false "hang" that cost real time on
 * 2026-09-18 and triggered an unnecessary restart. This advances `beatAt` on the
 * failure too and carries `lastCycleOk: false`, so the projection says "alive,
 * last cycle did not pass" rather than "gone".
 *
 * The prior `intakeRuntime` receipt and (as a fallback) `codeIdentity` are
 * preserved: a failed cycle must never erase the last durable intake reading.
 */
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
    /* A non-paused beat: a failed cycle is not the owner's PAUSE_RUNNER (ADM-5). */
    pause: null,
    codeIdentity: input.codeIdentity ?? prev?.codeIdentity ?? null,
    intakeRuntime: prev?.intakeRuntime ?? null,
    runtimeRelease: prev?.runtimeRelease ?? null,
  };
}

/**
 * The hang watchdog's decision, isolated for testing (the Worker mirrors this
 * one-line rule inline, because an eval Worker cannot import). The main thread
 * pings a shared timestamp on a timer that keeps firing while it awaits a
 * bounded cycle child or sleeps between cycles — those are async awaits, so the
 * event loop is free. Only a genuinely BLOCKED event loop lets the ping go stale
 * past the threshold, and only then must the process be killed for relaunch.
 *
 * `killAfterMs <= 0` disables the watchdog; a missing/NaN reading never kills.
 */
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
