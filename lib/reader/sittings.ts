import { meetingsFromFactRows, type MeetingBodyHeader } from "../facts/meeting-read.ts";
import { RETIRED_MEETING_ROUTES } from "../registry/source-wiring.ts";
import { collapseDuplicateSittings } from "../sources/composite/index.ts";
import { mergeDuplicateSittingFields, mergeReaderSittings } from "../meetings/sitting-merge.ts";
import type { Meeting } from "../sources/types.ts";

/**
 * The sittings a reader is shown, from the fact rows of a place's bodies: each listing read from its facts, a route a successor
 * has replaced hidden, duplicate listings collapsed, and one body's listings of the same day joined into one sitting.
 */
export function composeSittings(rows: readonly Record<string, unknown>[], header: (bodyId: string) => MeetingBodyHeader, now: Date) {
  const held = meetingsFromFactRows(rows, header, now);
  const hiddenRetired = (meeting: Meeting) => RETIRED_MEETING_ROUTES.some(route => meeting.bodyId === route.bodyId && meeting.id.startsWith(`${route.meetingSource}:`)
    && (route.successorAlreadyWired || held.some(other => other.bodyId === route.bodyId && other.id.startsWith(`${route.replacedBy}:`))));
  const exact = collapseDuplicateSittings(held.filter(meeting => !hiddenRetired(meeting)), mergeDuplicateSittingFields);
  const merged = mergeReaderSittings(exact.rows);
  return { meetings: merged.rows.sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt) || a.id.localeCompare(b.id)),
    aliases: merged.aliases, dropped: [...exact.dropped, ...merged.dropped] };
}
