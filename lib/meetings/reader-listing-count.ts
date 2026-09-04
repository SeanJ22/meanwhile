import type { Meeting } from "../sources/types.ts";
import type { MeetingListingIdentityReadback } from "./listing-identity.ts";

/** Scope the server's canonical diagnostic by native IDs only. Filtering one
 * sibling out does not establish that the remaining listing is a unique event. */
export function readerMeetingCount(meetings: readonly Meeting[], identity?: MeetingListingIdentityReadback | null) {
  const ids = new Set(meetings.map(meeting => meeting.id));
  const groups = identity?.groups.filter(group => group.sourceIds.some(id => ids.has(id))) ?? [];
  const unresolved = groups.length > 0;
  const count = meetings.length;
  return {
    count,
    groups,
    unresolved,
    heading: unresolved ? "Calendar listings" : "Meetings",
    unit: unresolved ? (count === 1 ? "calendar listing" : "calendar listings") : (count === 1 ? "meeting" : "meetings"),
    countNote: unresolved ? "Distinct meeting count unresolved." : null,
  };
}
