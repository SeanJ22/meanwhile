import { copy } from "../design/copy.ts";
import type { Meeting, MeetingLocation, MeetingVenueGap, OnlineAccess } from "@/lib/sources/types";

/**
 * Where a sitting is held, asked in one place. Four states: a building (`location` set); online (no building, the
 * body published online access); a named venue gap (no building, `venueGap` set, a physical sitting); place not
 * recorded (none of these), our own gap. `location === null` and `online` are meant to agree, but nothing mechanical
 * holds that, so this module reads `location` and asks for the online half separately.
 */

/** The shape any surface needs to answer the question. Meetings satisfy it. */
type OnlineShaped = Pick<Meeting, "location"> & { online?: OnlineAccess; venueGap?: MeetingVenueGap };

/** Whether this sitting happens online: no building, and an online access the body published. */
export function isOnlineOnly(meeting: OnlineShaped): boolean {
  // A named venue gap also has a null location and is not online.
  return meeting.location === null && meeting.online != null && !meeting.venueGap;
}

/** No building, no published online access and no named venue gap: we do not hold its place. */
export function isPlaceUnrecorded(meeting: OnlineShaped): boolean {
  return meeting.location === null && meeting.online == null && !meeting.venueGap;
}

/** The same question as a type predicate, so the venue gate narrows `location` rather than asserting it. */
export function hasPhysicalLocation<T extends OnlineShaped>(
  meeting: T,
): meeting is T & { location: MeetingLocation } {
  return meeting.location !== null;
}

/** The published online access for a sitting, or null for a physical meeting, an unrecorded place or a named venue gap. */
export function onlineAccessFor(meeting: OnlineShaped): OnlineAccess | null {
  if (!isOnlineOnly(meeting)) return null;
  return meeting.online ?? null;
}

/** Says there is no room, not merely that the meeting is online. */
export const ONLINE_ONLY_LINE = "Online only — there is no room to attend in person.";

/** What a sitting with no building and no published online access says about where it is held: our gap. */
export const PLACE_UNRECORDED_LINE = copy("copy.working");

/** A physical sitting whose room is a named gap, or null. Read only where there is no building. */
export function venueGapOf(meeting: OnlineShaped): MeetingVenueGap | null {
  return meeting.location === null && meeting.venueGap ? meeting.venueGap : null;
}

/** The publisher's page names no place: the gap is theirs, and the line says whose page it is. */
export function venueNotStatedLine(publisher: string): string {
  return `${publisher}'s page doesn't say where this meeting is held.`;
}

/** The place the publisher stated, verbatim, or null when its page states none. */
export function statedVenueText(gap: MeetingVenueGap): string | null {
  const stated = gap.kind === "STATED_NOT_PLACED" ? gap.publishedText?.trim() : "";
  return stated ? stated : null;
}

/** A stated place renders as the publisher's words, never a pin; a page that states none gets the publisher's gap. */
export function venueGapLine(gap: MeetingVenueGap): string {
  return statedVenueText(gap) ?? venueNotStatedLine(gap.publisher);
}

/** The "Where" row for a sitting with no building. */
export function placelessWhereLine(meeting: OnlineShaped): string {
  if (isOnlineOnly(meeting)) return ONLINE_ONLY_LINE;
  const gap = venueGapOf(meeting);
  return gap ? venueGapLine(gap) : PLACE_UNRECORDED_LINE;
}

/** What the "How to join" row says when the body published no link: the gap is theirs. */
export function joinLine(access: OnlineAccess): string {
  return `${access.label} — the body hasn't published a join link`;
}

/** The mark carries the product's own word, never the published label, which is free text with inconsistent case. */
export const ONLINE_MARK_WORD = "Online only";
