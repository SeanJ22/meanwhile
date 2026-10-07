import type { CalendarSafeMeeting } from "../map/format.ts";
import {
  TIME_NOT_POSTED,
  locationLine,
  meetingHeadline,
  meetingLocalDate,
  startTimeIsKnown,
} from "../map/format.ts";
import type { Meeting } from "../sources/types.ts";
import { PRODUCT_NAME } from "../brand.ts";
import { statedVenueText } from "../meetings/online.ts";

export interface CalendarEventInput {
  id: string;
  title: string;
  /** Timed event: ISO instant. Exactly one of these two is set. */
  startsAtIso?: string;
  endsAtIso?: string;
  endEstimated?: boolean;
  /** All-day event: YYYY-MM-DD. */
  allDayDate?: string;
  /** Last day of a multi-day window, inclusive; ignored unless `allDayDate` is set. `allDayStamps` makes the exclusive end. */
  allDayEndDate?: string;
  location?: string;
  description?: string;
}

/** Timed events block 90 minutes — public bodies rarely publish end
 *  times, and a zero-length event renders uselessly. Stated as an
 *  estimate in the description by callers that use it. */
const TIMED_BLOCK_MINUTES = 90;

function toCalStamp(iso: string): string {
  return `${iso.slice(0, 19).replace(/[-:]/g, "")}Z`.replace(/\.\d+Z$/, "Z");
}

/** All-day events carry a date and no zone, so UTC date arithmetic is exact here. */
function allDayStamps(date: string, lastDate?: string): { start: string; end: string } {
  const start = date.replace(/-/g, "");
  const final = lastDate && lastDate >= date ? lastDate : date;
  const next = new Date(`${final}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return { start, end: next.toISOString().slice(0, 10).replace(/-/g, "") };
}

function timedStamps(iso: string, endIso?: string): { start: string; end: string } {
  const startMs = Date.parse(iso);
  const endMs = endIso ? Date.parse(endIso) : Number.NaN;
  const end = Number.isFinite(endMs) && endMs > startMs ? endMs : startMs + TIMED_BLOCK_MINUTES * 60_000;
  return {
    start: toCalStamp(new Date(startMs).toISOString()),
    end: toCalStamp(new Date(end).toISOString()),
  };
}

export function hasPublishedEnd(meeting: { startsAt: string; endsAt?: string | null }): boolean {
  if (!meeting.endsAt) return false;
  const start = Date.parse(meeting.startsAt);
  const end = Date.parse(meeting.endsAt);
  return Number.isFinite(start) && Number.isFinite(end) && end > start;
}

export function googleCalendarUrl(event: CalendarEventInput): string {
  const dates = event.allDayDate
    ? (() => {
        const { start, end } = allDayStamps(event.allDayDate, event.allDayEndDate);
        return `${start}/${end}`;
      })()
    : (() => {
        const { start, end } = timedStamps(event.startsAtIso ?? "", event.endsAtIso);
        return `${start}/${end}`;
      })();
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: event.title,
    dates,
    ...(event.location ? { location: event.location } : {}),
    ...(event.description ? { details: event.description } : {}),
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

export function icsDataHref(event: CalendarEventInput): string {
  const esc = (s: string) => s.replace(/([,;])/g, "\\$1");
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", `PRODID:-//${PRODUCT_NAME}//event//EN`, "BEGIN:VEVENT", `UID:${event.id}@wethepeople`];
  if (event.allDayDate) {
    const { start, end } = allDayStamps(event.allDayDate, event.allDayEndDate);
    lines.push(`DTSTAMP:${start}T000000Z`);
    lines.push(`DTSTART;VALUE=DATE:${start}`);
    lines.push(`DTEND;VALUE=DATE:${end}`);
  } else {
    const { start, end } = timedStamps(event.startsAtIso ?? "", event.endsAtIso);
    lines.push(`DTSTAMP:${start}`, `DTSTART:${start}`, `DTEND:${end}`);
  }
  lines.push(`SUMMARY:${esc(event.title)}`);
  if (event.location) lines.push(`LOCATION:${esc(event.location)}`);
  if (event.description) lines.push(`DESCRIPTION:${esc(event.description)}`);
  lines.push("END:VEVENT", "END:VCALENDAR");
  return `data:text/calendar;charset=utf-8,${encodeURIComponent(lines.join("\r\n"))}`;
}

export function icsFileName(event: CalendarEventInput): string {
  return `${event.id.replace(/[^a-z0-9-]/gi, "-")}.ics`;
}

/** A meeting with no published start time becomes an all-day event, never a timed one at midnight. */
export function meetingCalendarEvent(
  meeting: CalendarSafeMeeting,
  options: { origin?: string } = {},
): CalendarEventInput {
  const timed = startTimeIsKnown(meeting);
  const publishedEnd = timed && hasPublishedEnd(meeting);
  const lines = [
    meeting.bodyName,
    timed ? null : TIME_NOT_POSTED,
    meeting.agendaUrl ? `Agenda: ${meeting.agendaUrl}` : null,
    options.origin ? `Found via ${PRODUCT_NAME}: ${options.origin}/` : null,
    timed && !publishedEnd
      ? "End time was not published. This entry blocks 90 minutes as a placeholder."
      : null,
  ].filter(Boolean) as string[];

  return {
    id: meeting.id,
    title: meetingHeadline(meeting),
    ...(timed
      ? {
          startsAtIso: meeting.startsAt,
          ...(publishedEnd && meeting.endsAt
            ? { endsAtIso: meeting.endsAt }
            : { endEstimated: true }),
        }
      : { allDayDate: meetingLocalDate(meeting) }),
    location: meeting.location
      ? locationLine(meeting.location.name, meeting.location.address)
      : meeting.venueGap
        ? statedVenueText(meeting.venueGap) ?? ""
        : [meeting.online?.label, meeting.online?.joinUrl].filter(Boolean).join(" — "),
    description: lines.join("\n"),
  };
}
