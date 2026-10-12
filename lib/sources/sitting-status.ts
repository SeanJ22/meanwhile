import type { MeetingStatus } from "./types.ts";

/**
 * A sitting's status from the two facts a publisher's own page states: whether
 * it says the sitting was called off, and when the sitting starts. Shared so
 * "cancelled" is never a per-adapter spelling.
 */
export function sittingStatus(startsAt: string, canceled: boolean, now: Date): MeetingStatus {
  if (canceled) return "CANCELED";
  return Date.parse(startsAt) < now.getTime() ? "CONCLUDED" : "SCHEDULED";
}

/** The publisher's own word for a called-off sitting, in its title or its row. */
export function saysCanceled(text: string): boolean {
  return /\bcancell?ed\b/i.test(text);
}
