"use client";

import type { Meeting } from "@/lib/sources/types";
import { meetingCalendarEvent } from "@/lib/calendar/event-links";

import { AddToCalendar } from "@/components/calendar/add-to-calendar";

/**
 * Add-to-calendar for meetings (6b, 2026-08-17; consolidated to the ONE
 * control in session item 4, 2026-08-14 second session). Built from the
 * meeting record alone — the what-first headline as the title, the
 * meeting's own instant, the venue, and the agenda link (when one
 * exists) plus this app's page in the description.
 *
 * The event shape itself is `meetingCalendarEvent` in lib, because M59
 * (2026-08-15) made it a decision rather than a mapping: a meeting whose
 * publisher never posted a start time becomes an all-day event carrying the
 * "time not posted" line, and that rule needs a test that does not have to
 * render a component to reach it.
 */
/**
 * The shape this control actually reads.
 *
 * `provenance` is REQUIRED on `Meeting` and is never read here — a calendar
 * entry cites the meeting, not the run that retrieved it. Declaring the real
 * dependency lets an Ask answer offer the same control from its own sitting
 * shape (ASK-20) without either inventing a provenance it does not have or
 * casting one away at the boundary.
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
