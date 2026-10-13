import { agendaSentenceFor } from "../ask/agenda-sentence.ts";
import type { CardGap } from "../design/card-gaps.ts";
import type { Meeting } from "../sources/types.ts";
import { onlineAccessFor, statedVenueText, venueGapOf } from "./online.ts";

/** Missing meeting facts collect once at the foot of the containing card. */
export function meetingCardGaps(meeting: Meeting): CardGap[] {
  const subject = meeting.bodyId ? { type: "BODY" as const, id: meeting.bodyId } : null;
  const gaps: CardGap[] = [];
  if (!meeting.agendaUrl) gaps.push({
    id: `meeting:${meeting.id}:agenda`, label: "agendas", count: 1, unit: "meeting", subject,
    kind: agendaSentenceFor(meeting).whose === "THEIRS" ? "not-posted" : "not-held",
  });
  const access = onlineAccessFor(meeting);
  const venueGap = venueGapOf(meeting);
  if (!meeting.location && !access && !(venueGap && statedVenueText(venueGap))) gaps.push({
    id: `meeting:${meeting.id}:place`, label: "meeting places", count: 1, unit: "meeting", subject,
    kind: venueGap?.kind === "NOT_STATED_BY_PUBLISHER" ? "not-posted" : "not-held",
  });
  if (access && !access.joinUrl) gaps.push({
    id: `meeting:${meeting.id}:join`, label: "online join links", count: 1, unit: "meeting", subject,
  });
  return gaps;
}
