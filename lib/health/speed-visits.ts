/**
 * **FE-27 · SPEED IS MEASURED BY OUR OWN REGULAR TEST VISITS.**
 *
 * Sean decided (Oct 3, D8) not to collect real readers' page timing or errors.
 * Speed is instead measured by FE-02's worst-case pass run on a schedule: our
 * own browsers, fresh each visit, at ZIPs sampled from the published places.
 * This file is the schedule: a lane for the runner's independent scheduler, and
 * the question "is a visit due". The pass itself is scripts/worst-case-speed-pass.mts,
 * started as a child by scripts/speed-visits-runner.mts, so a slow visit never
 * holds up another lane. Plain code; no AI, no reader data.
 */
import type { IndependentRuntimeLane } from "../ops/independent-runtime-pass.ts";

/** The scheduler looks this often; a pass runs only when the last is older than `SPEED_VISITS_EVERY_MS`. */
export const SPEED_VISITS_TICK_MS = 15 * 60_000;
export const SPEED_VISITS_EVERY_MS = 6 * 3_600_000;
export const SPEED_VISITS_SINGLETON_PORT = 49_374;

/** The way back: off unless WTP_SPEED_VISITS=on, so the runner behaves as before until the first scheduled pass is checked live. */
export function speedVisitsEnabled(env: Readonly<Record<string, string | undefined>>): boolean {
  return env.WTP_SPEED_VISITS === "on";
}

/** Register on the runner's independent scheduler: `run` starts scripts/speed-visits-runner.mts as a child. */
export function speedVisitsLane(run: () => Promise<void>): IndependentRuntimeLane {
  return { id: "speed-visits", everyMs: SPEED_VISITS_TICK_MS, run };
}

/** A visit is due when none has been recorded, or the newest is at least `everyMs` old. */
export function speedVisitsDue(lastPassAt: string | null, nowIso: string, everyMs: number = SPEED_VISITS_EVERY_MS): boolean {
  if (lastPassAt === null) return true;
  const last = Date.parse(lastPassAt);
  return !Number.isFinite(last) || Date.parse(nowIso) - last >= everyMs;
}
