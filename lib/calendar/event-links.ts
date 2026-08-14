/**
 * Calendar-link builders (session item 4, wall clock 2026-08-14 second
 * session) — pure, shared by every surface that renders a date. Two
 * event shapes: a timed instant (meetings) and an all-day date
 * (election day, registration deadlines). Apple Calendar and Outlook
 * both consume the same .ics; only Google differs — so the popup is
 * presentation, not new plumbing.
 */

export interface CalendarEventInput {
  /** Stable id for the ICS UID. */
  id: string;
  title: string;
  /** Timed event: ISO instant. Exactly one of these two is set. */
  startsAtIso?: string;
  /** All-day event: YYYY-MM-DD. */
  allDayDate?: string;
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

/** YYYY-MM-DD → YYYYMMDD, and the exclusive next day for DTEND. */
function allDayStamps(date: string): { start: string; end: string } {
  const start = date.replace(/-/g, "");
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return { start, end: next.toISOString().slice(0, 10).replace(/-/g, "") };
}

function timedStamps(iso: string): { start: string; end: string } {
  const startMs = Date.parse(iso);
  return {
    start: toCalStamp(new Date(startMs).toISOString()),
    end: toCalStamp(new Date(startMs + TIMED_BLOCK_MINUTES * 60_000).toISOString()),
  };
}

export function googleCalendarUrl(event: CalendarEventInput): string {
  const dates = event.allDayDate
    ? (() => {
        const { start, end } = allDayStamps(event.allDayDate);
        return `${start}/${end}`;
      })()
    : (() => {
        const { start, end } = timedStamps(event.startsAtIso ?? "");
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
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//We the People//event//EN", "BEGIN:VEVENT", `UID:${event.id}@wethepeople`];
  if (event.allDayDate) {
    const { start, end } = allDayStamps(event.allDayDate);
    lines.push(`DTSTAMP:${start}T000000Z`);
    lines.push(`DTSTART;VALUE=DATE:${start}`);
    lines.push(`DTEND;VALUE=DATE:${end}`);
  } else {
    const { start, end } = timedStamps(event.startsAtIso ?? "");
    lines.push(`DTSTAMP:${start}`, `DTSTART:${start}`, `DTEND:${end}`);
  }
  lines.push(`SUMMARY:${esc(event.title)}`);
  if (event.location) lines.push(`LOCATION:${esc(event.location)}`);
  if (event.description) lines.push(`DESCRIPTION:${esc(event.description)}`);
  lines.push("END:VEVENT", "END:VCALENDAR");
  return `data:text/calendar;charset=utf-8,${encodeURIComponent(lines.join("\r\n"))}`;
}

/** Filename for the .ics download. */
export function icsFileName(event: CalendarEventInput): string {
  return `${event.id.replace(/[^a-z0-9-]/gi, "-")}.ics`;
}
