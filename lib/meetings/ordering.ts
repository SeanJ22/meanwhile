import type { Meeting } from "../sources/types.ts";

/**
 * Upcoming first (soonest first), then past (most recent first): both blocks read outward from `now`. A meeting starting
 * exactly at `now` counts as upcoming.
 */
export function orderByUpcomingFirst<T extends Pick<Meeting, "startsAt">>(
  meetings: readonly T[],
  now: number,
): T[] {
  const upcoming: T[] = [];
  const past: T[] = [];

  for (const meeting of meetings) {
    const at = Date.parse(meeting.startsAt);
    // An unparseable start time is not silently dropped and not guessed at:
    // it sorts with the upcoming block, where a reader will see it, rather
    // than into the tail of history where a broken row would never be found.
    if (Number.isNaN(at) || at >= now) upcoming.push(meeting);
    else past.push(meeting);
  }

  upcoming.sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  past.sort((a, b) => Date.parse(b.startsAt) - Date.parse(a.startsAt));

  return [...upcoming, ...past];
}

/** Whether a meeting has started, on the same boundary as the order, so the pill and the position never disagree. */
export function hasConcluded<T extends Pick<Meeting, "startsAt">>(
  meeting: T,
  now: number,
): boolean {
  const at = Date.parse(meeting.startsAt);
  return !Number.isNaN(at) && at < now;
}

/** The window that separates "soon" from "later". */
export const SOON_DAYS = 30;
const SOON_MS = SOON_DAYS * 24 * 60 * 60 * 1000;

export type MeetingGroupId = "soon" | "later" | "closed";

export interface MeetingGroup<T> {
  id: MeetingGroupId;
  /** Reader-facing, plain language, level register — this is a claim surface. */
  label: string;
  meetings: T[];
}

const GROUP_LABEL: Record<MeetingGroupId, string> = {
  soon: `Meetings in the next ${SOON_DAYS} days`,
  later: "Upcoming meetings after that",
  closed: "Canceled or concluded",
};

/**
 * Three blocks: `soon` (within 30 days), `later`, and `closed` (canceled or concluded, canceled even when still
 * future). Every meeting lands in exactly one group, and empty groups are dropped.
 */
export function groupMeetingsForReading<
  T extends Pick<Meeting, "startsAt" | "status">,
>(meetings: readonly T[], now: number): MeetingGroup<T>[] {
  const soon: T[] = [];
  const later: T[] = [];
  const closed: T[] = [];

  for (const meeting of meetings) {
    const at = Date.parse(meeting.startsAt);
    if (meeting.status === "CANCELED" || (!Number.isNaN(at) && at < now)) {
      closed.push(meeting);
    } else if (Number.isNaN(at) || at <= now + SOON_MS) {
      soon.push(meeting);
    } else {
      later.push(meeting);
    }
  }

  const ascending = (a: T, b: T) => Date.parse(a.startsAt) - Date.parse(b.startsAt);
  soon.sort(ascending);
  later.sort(ascending);
  closed.sort((a, b) => Date.parse(b.startsAt) - Date.parse(a.startsAt));

  return (
    [
      { id: "soon" as const, meetings: soon },
      { id: "later" as const, meetings: later },
      { id: "closed" as const, meetings: closed },
    ] satisfies { id: MeetingGroupId; meetings: T[] }[]
  )
    .filter((group) => group.meetings.length > 0)
    .map((group) => ({ ...group, label: GROUP_LABEL[group.id] }));
}
