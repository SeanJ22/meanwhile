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
