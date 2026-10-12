"use client";

import type { Meeting } from "@/lib/sources/types";
import { meetingCalendarEvent } from "@/lib/calendar/event-links";

import { AddToCalendar } from "@/components/calendar/add-to-calendar";

/**
 * Add-to-calendar for meetings, built from the meeting record alone. The event
 * shape is `meetingCalendarEvent` in lib. `provenance` is omitted because a
 * calendar entry never reads it, so an Ask answer's sitting shape fits too.
 */
export type CalendarMeeting = Omit<Meeting, "provenance"> &
  Partial<Pick<Meeting, "provenance">>;

export function CalendarLinks({ meeting }: { meeting: CalendarMeeting }) {
  if (meeting.status !== "SCHEDULED") return null;
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return (
    <p className="mt-1.5 t-detail">
      <AddToCalendar event={meetingCalendarEvent(meeting, { origin })} />
    </p>
  );
}
