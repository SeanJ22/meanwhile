import type { Meeting } from "../sources/types.ts";

/**
 * **Upcoming first, then past** — g4 item 11, the author.
 *
 * ## The rule, and why it is not just "sort by date"
 *
 * A plain ascending sort by start time is what shipped, and with a serving
 * window of ninety days back and sixty forward that puts three months of
 * finished meetings above everything a reader could still attend. The reader
 * who opens this panel is asking what is happening; what already happened is
 * the second question, and it deserves the second half of the list.
 *
 * So the order is two blocks:
 *
 * - **Upcoming, soonest first.** The next thing a reader can go to is the
 *   first row.
 * - **Past, most recent first.** Looking backwards, "what happened last" is
 *   the near end, not the far one — the same instinct that puts the newest
 *   entry at the top of a history.
 *
 * The two orderings run in OPPOSITE directions on purpose, and both point at
 * NOW: the list reads outward from the present in both directions.
 *
 * ## Where it applies
 *
 * Everywhere meetings are listed — the panel, the map pin's card, and a body
 * battlecard's sittings — which is why it is a pure function here rather than
 * a comparator inside one component. Three surfaces that each sort their own
 * way is how the Concluded chip came to match nothing at all four zips.
 *
 * ## The boundary
 *
 * `now` is passed in rather than read, so a test can pin it and so every
 * surface on one render agrees about where the line falls. A meeting starting
 * exactly at `now` counts as UPCOMING: a body that is sitting right now is
 * something a reader can still walk into.
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

/**
 * Whether a meeting has already started, on the same boundary as the order
 * above — so the "Concluded" pill and the position in the list can never
 * disagree about which half a row is in.
 */
export function hasConcluded<T extends Pick<Meeting, "startsAt">>(
  meeting: T,
  now: number,
): boolean {
  const at = Date.parse(meeting.startsAt);
  return !Number.isNaN(at) && at < now;
}

/* ------------------------------------------- F01 3.1, the three groups --- */

/** The window that separates "soon" from "later". The author's number. */
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
 * **The three blocks, in the author's order** — F01 3.1, 2026-08-19.
 *
 * *"it should be meetings within the next 30 days and then upcoming meetings
 * after that and then canceled or concluded meetings."*
 *
 * ## What was actually broken
 *
 * `orderByUpcomingFirst` above has put upcoming ahead of past since g4 item 11,
 * and it is not the thing that failed. What failed is that only TWO of the
 * meeting surfaces called it: the body battlecard's own sections, and the list
 * overlay. The DIVISION battlecard's Meetings tab rendered `subject.meetings`
 * raw, and the venue panel behind a map pin rendered `venue.meetings` raw —
 * so both showed June and July sittings above everything a reader could still
 * attend. A shared ordering that two of four callers use is not a shared
 * ordering; it is a convention, and a convention is what this function stops
 * being possible to skip, because the surfaces now render GROUPS and a group
 * cannot be produced by forgetting to sort.
 *
 * ## The boundaries
 *
 * - `soon` — scheduled, starting between `now` and `now + 30 days` inclusive.
 * - `later` — scheduled, starting after that.
 * - `closed` — **canceled OR concluded**, and canceled counts even when the
 *   date is still in the future: a meeting that will not happen is not
 *   something a reader can attend, so it belongs with what is over. Within the
 *   block, most recent first — looking backwards, "what happened last" is the
 *   near end.
 *
 * A meeting starting exactly at `now` is UPCOMING, matching
 * `orderByUpcomingFirst`: a body sitting right now is one a reader can still
 * walk into. An unparseable start time sorts into `soon`, where a reader will
 * see it, rather than into the tail of history where a broken row is never
 * found — also matching the older function, deliberately.
 *
 * ## Empty groups are dropped, and the count is the caller's to state
 *
 * A returned group always has at least one meeting, so a surface cannot render
 * a header over nothing. The total is `meetings.length` and every meeting lands
 * in exactly one group — `tests/meeting-ordering.test.ts` asserts the partition
 * rather than trusting it, because a grouping that silently loses a row is the
 * "operation that can return nothing" CLAUDE.md names.
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
