"use client";

import type { Meeting } from "@/lib/sources/types";
import { meetingHeadline } from "@/lib/map/format";
import type { CalendarEventInput } from "@/lib/calendar/event-links";

import { AddToCalendar } from "@/components/calendar/add-to-calendar";

/**
 * Add-to-calendar for meetings (6b, 2026-08-17; consolidated to the ONE
 * control in session item 4, 2026-08-14 second session). Built from the
 * meeting record alone — the what-first headline as the title, the
 * meeting's own instant, the venue, and the agenda link (when one
 * exists) plus this app's page in the description. The 90-minute block
 * is stated as an estimate in the description, because public bodies
 * rarely publish end times.
 */
function meetingEvent(meeting: Meeting): CalendarEventInput {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const lines = [
    meeting.bodyName,
    meeting.agendaUrl ? `Agenda: ${meeting.agendaUrl}` : null,
    origin ? `Found via We the People: ${origin}/` : null,
    "End time is an estimate — public bodies rarely publish one.",
  ].filter(Boolean);
  return {
    id: meeting.id,
    title: meetingHeadline(meeting),
    startsAtIso: meeting.startsAt,
    location: [meeting.location.name, meeting.location.address]
      .filter(Boolean)
      .join(", "),
    description: lines.join("\n"),
  };
}

export function CalendarLinks({ meeting }: { meeting: Meeting }) {
  if (meeting.status !== "SCHEDULED") return null;
  return (
    <p className="mt-1.5 text-[0.75rem]">
      <AddToCalendar event={meetingEvent(meeting)} />
    </p>
  );
}
