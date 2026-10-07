export const MEETING_LANES_SWITCH = "WTP_MEETING_LANES";

/** The ceiling is on silence, not length: a read that keeps finding records keeps its clock renewed. */
export const MEETING_LANE_QUIET_MS = 10 * 60_000;

export function meetingLanesOn(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[MEETING_LANES_SWITCH]?.trim().toLowerCase() === "on";
}

export function meetingReadQuietMs(env: NodeJS.ProcessEnv = process.env): number | undefined {
  return meetingLanesOn(env) ? MEETING_LANE_QUIET_MS : undefined;
}
