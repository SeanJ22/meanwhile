import type { Meeting } from "@/lib/sources/types";

/**
 * Meeting times render in the zone the meeting is held in, never the reader's.
 * Someone checking a Tucson agenda from Philadelphia needs the time they'll be
 * expected in the room.
 */

export function formatMeetingDate(meeting: Meeting): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: meeting.timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date(meeting.startsAt));
}

export function formatMeetingTime(meeting: Meeting): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: meeting.timeZone,
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(meeting.startsAt));
}

/** "in 3 days", "tomorrow", "12 days ago". */
export function formatRelativeDay(
  isoString: string,
  now: Date = new Date(),
): string {
  const days = Math.round(
    (Date.parse(isoString) - now.getTime()) / 86_400_000,
  );

  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";

  const rtf = new Intl.RelativeTimeFormat("en-US", { numeric: "auto" });
  return rtf.format(days, "day");
}

export const formatMiles = (km: number) => Math.round(km * 0.621371);

/**
 * Trim an OCD-ID to its last segment for display.
 * `ocd-division/country:us/state:az/place:tucson` → `place:tucson`
 */
export function shortOcdId(ocdId: string | null): string {
  // A division-less body (D28) has nothing to abbreviate; say so plainly.
  if (ocdId === null) return "no census division";
  const segments = ocdId.split("/");
  return segments[segments.length - 1] ?? ocdId;
}
