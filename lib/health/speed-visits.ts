/**
 * Speed is measured by our own scheduled test visits, never by real readers'
 * timing: the worst-case speed pass, run as a child
 * (scripts/worst-case-speed-pass.mts) on the runner's independent scheduler,
 * at ZIPs sampled from the published places. This file is the schedule.
 */
import type { IndependentRuntimeLane } from "../ops/independent-runtime-pass.ts";

/** The scheduler looks this often; a pass runs only when the last is older than `SPEED_VISITS_EVERY_MS`. */
export const SPEED_VISITS_TICK_MS = 15 * 60_000;
export const SPEED_VISITS_EVERY_MS = 6 * 3_600_000;
export const SPEED_VISITS_SINGLETON_PORT = 49_374;

/** Off unless WTP_SPEED_VISITS=on. */
export function speedVisitsEnabled(env: Readonly<Record<string, string | undefined>>): boolean {
  return env.WTP_SPEED_VISITS === "on";
}

/** Register on the runner's independent scheduler; `run` starts the speed pass as a child. */
export function speedVisitsLane(run: () => Promise<void>): IndependentRuntimeLane {
  return { id: "speed-visits", everyMs: SPEED_VISITS_TICK_MS, run };
}

/** A visit is due when none has been recorded, or the newest is at least `everyMs` old. */
export function speedVisitsDue(lastPassAt: string | null, nowIso: string, everyMs: number = SPEED_VISITS_EVERY_MS): boolean {
  if (lastPassAt === null) return true;
  const last = Date.parse(lastPassAt);
  return !Number.isFinite(last) || Date.parse(nowIso) - last >= everyMs;
}
