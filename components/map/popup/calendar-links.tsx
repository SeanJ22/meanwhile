"use client";

import type { Meeting } from "@/lib/sources/types";
import { meetingHeadline } from "@/lib/map/format";

/**
 * Add-to-calendar (6b, 2026-08-17): every upcoming meeting offers an .ics
 * download (Apple/Outlook) and a Google Calendar link. Both are built from
 * the meeting record alone — the what-first headline as the title, the
 * meeting's own instant, the venue, and the agenda link (when one exists)
 * plus this app's page in the description.
 *
 * The end time is the start plus 90 minutes — a calendar block, stated as
 * an estimate in the description, because public bodies rarely publish end
 * times and a zero-length event renders uselessly in every calendar app.
 */

function toCalStamp(iso: string): string {
  // 2026-08-20T01:00:00.000Z → 20260820T010000Z (both formats accept UTC).
  return `${iso.slice(0, 19).replace(/[-:]/g, "")}Z`.replace(/\.\d+Z$/, "Z");
}

function eventTimes(meeting: Meeting): { start: string; end: string } {
  const startMs = Date.parse(meeting.startsAt);
  const endMs = startMs + 90 * 60 * 1000;
  return {
    start: toCalStamp(new Date(startMs).toISOString()),
    end: toCalStamp(new Date(endMs).toISOString()),
  };
}

function eventDetails(meeting: Meeting): {
  title: string;
  location: string;
  description: string;
} {
  const origin =
    typeof window !== "undefined" ? window.location.origin : "";
  const lines = [
    meeting.bodyName,
    meeting.agendaUrl ? `Agenda: ${meeting.agendaUrl}` : null,
    origin ? `Found via We the People: ${origin}/` : null,
    "End time is an estimate — public bodies rarely publish one.",
  ].filter(Boolean);
  return {
    title: meetingHeadline(meeting),
    location: [meeting.location.name, meeting.location.address]
      .filter(Boolean)
      .join(", "),
    description: lines.join("\\n"),
  };
}

function googleUrl(meeting: Meeting): string {
  const { start, end } = eventTimes(meeting);
  const { title, location, description } = eventDetails(meeting);
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: title,
    dates: `${start}/${end}`,
    location,
    details: description.replace(/\\n/g, "\n"),
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

function icsHref(meeting: Meeting): string {
  const { start, end } = eventTimes(meeting);
  const { title, location, description } = eventDetails(meeting);
  const esc = (s: string) => s.replace(/([,;])/g, "\\$1");
  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//We the People//meeting//EN",
    "BEGIN:VEVENT",
    `UID:${meeting.id}@wethepeople`,
    `DTSTAMP:${start}`,
    `DTSTART:${start}`,
    `DTEND:${end}`,
    `SUMMARY:${esc(title)}`,
    `LOCATION:${esc(location)}`,
    `DESCRIPTION:${esc(description)}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
  return `data:text/calendar;charset=utf-8,${encodeURIComponent(ics)}`;
}

export function CalendarLinks({ meeting }: { meeting: Meeting }) {
  if (meeting.status !== "SCHEDULED") return null;
  return (
    <p className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[0.75rem]">
      <a
        href={icsHref(meeting)}
        download={`${meeting.id.replace(/[^a-z0-9-]/gi, "-")}.ics`}
        className="text-signal underline decoration-dotted hover:no-underline"
      >
        Add to calendar (.ics)
      </a>
      <a
        href={googleUrl(meeting)}
        target="_blank"
        rel="noreferrer"
        className="text-muted underline decoration-dotted hover:text-signal"
      >
        Google Calendar
      </a>
    </p>
  );
}
