/**
 * DB-58: a slow site holds up only its own reads.
 *
 * A meeting read of one host runs as its own child, one host at a time (the
 * failure domain), beside the other hosts' children. What a hung host used to
 * hold was the pass: its child kept the pass open for the whole no-progress
 * ceiling (`ROUTINE_CHILD_TIMEOUT_MS`, 30 minutes), and the Reader repair and
 * edge publication that every other host's facts wait for start only when the
 * pass's source reads have settled.
 *
 * With `WTP_MEETING_LANES=on` a meeting read is paused after a shorter quiet
 * period: no new records for `MEETING_LANE_QUIET_MS`. The ceiling is on
 * silence, not on length (a read that keeps finding records keeps its clock
 * renewed), and a paused read keeps what it retained and stays due, so the next
 * pass resumes that host alone. Off (the default) keeps the old ceiling until
 * the new one is checked live in Admin; then the switch goes.
 */
export const MEETING_LANES_SWITCH = "WTP_MEETING_LANES";

/** Ten minutes without a new record pauses one host's meeting read. */
export const MEETING_LANE_QUIET_MS = 10 * 60_000;

export function meetingLanesOn(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[MEETING_LANES_SWITCH]?.trim().toLowerCase() === "on";
}

/**
 * The no-progress ceiling for one meeting partition read, or `undefined` to
 * keep the pass's own (the old path).
 */
export function meetingReadQuietMs(env: NodeJS.ProcessEnv = process.env): number | undefined {
  return meetingLanesOn(env) ? MEETING_LANE_QUIET_MS : undefined;
}
