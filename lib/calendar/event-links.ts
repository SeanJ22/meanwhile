/**
 * Calendar-link builders (session item 4, wall clock 2026-08-14 second
 * session) — pure, shared by every surface that renders a date. Two
 * event shapes: a timed instant (meetings) and an all-day date
 * (election day, registration deadlines). Apple Calendar and Outlook
 * both consume the same .ics; only Google differs — so the popup is
 * presentation, not new plumbing.
 */

import {
  TIME_NOT_POSTED,
  locationLine,
  meetingHeadline,
  meetingLocalDate,
  startTimeIsKnown,
} from "../map/format.ts";
import type { Meeting } from "../sources/types.ts";
import { PRODUCT_NAME } from "../brand.ts";

export interface CalendarEventInput {
  /** Stable id for the ICS UID. */
  id: string;
  title: string;
  /** Timed event: ISO instant. Exactly one of these two is set. */
  startsAtIso?: string;
  /** All-day event: YYYY-MM-DD. */
  allDayDate?: string;
  /**
   * **The last day of a multi-day window, INCLUSIVE** — item 16, 2026-08-19.
   *
   * New Jersey's in-person early voting runs 10/24/2026 through 11/01/2026,
   * and it rendered with no calendar affordance at all because the shape here
   * could only hold one day. A window is the event a reader most needs in a
   * calendar: a deadline is a thing to remember, a window is a thing to miss.
   *
   * INCLUSIVE, because that is what the authority published — "through
   * November 1st". `.ics` and Google both want an EXCLUSIVE end, and that
   * conversion happens once, in `allDayStamps`, where the off-by-one belongs
   * rather than at every call site.
   *
   * Ignored unless `allDayDate` is set; a timed event with an end date would
   * be two different things at once.
   */
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

/**
 * YYYY-MM-DD → YYYYMMDD, and the exclusive day AFTER the last one for DTEND.
 *
 * `lastDate` is the inclusive final day of a window, or absent for a single
 * day — in which case the window is that day and the arithmetic is the same.
 *
 * **The arithmetic is deliberately in UTC and that is not the UTC bug.** An
 * all-day event carries a DATE and no time (`DTSTART;VALUE=DATE`), so it does
 * not sit in any zone and cannot be shifted by one: parsing `2026-11-01` at
 * `T00:00:00Z` and adding a UTC day yields `2026-11-02` in every timezone the
 * reader could be in.
 *
 * That is what makes the New Jersey window safe. `10/24 – 11/01` straddles
 * the end of Eastern daylight time — 11/01 IS the transition day — and a
 * timed event would need care there. A date-valued one needs none, which is
 * the reason a window is emitted as all-day rather than as a 00:00–23:59
 * pair.
 */
function allDayStamps(date: string, lastDate?: string): { start: string; end: string } {
  const start = date.replace(/-/g, "");
  const final = lastDate && lastDate >= date ? lastDate : date;
  const next = new Date(`${final}T00:00:00Z`);
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
        const { start, end } = allDayStamps(event.allDayDate, event.allDayEndDate);
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
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", `PRODID:-//${PRODUCT_NAME}//event//EN`, "BEGIN:VEVENT", `UID:${event.id}@wethepeople`];
  if (event.allDayDate) {
    const { start, end } = allDayStamps(event.allDayDate, event.allDayEndDate);
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

/**
 * A meeting as a calendar event (M59, 2026-08-15) — pure, so the rule that
 * decides timed-versus-all-day is testable without rendering a component.
 *
 * A meeting whose publisher never posted a start time becomes an ALL-DAY
 * event carrying the same sentence the card shows. The alternative — a timed
 * event at the midnight `startsAt` holds for ordering — would put a fabricated
 * hour into the reader's own calendar and ring an alarm at midnight, which is
 * the one place a wrong time does real damage.
 */
export function meetingCalendarEvent(
  meeting: Meeting,
  options: { origin?: string } = {},
): CalendarEventInput {
  const timed = startTimeIsKnown(meeting);
  const lines = [
    meeting.bodyName,
    timed ? null : TIME_NOT_POSTED,
    meeting.agendaUrl ? `Agenda: ${meeting.agendaUrl}` : null,
    options.origin ? `Found via ${PRODUCT_NAME}: ${options.origin}/` : null,
    timed ? "End time is an estimate — public bodies rarely publish one." : null,
  ].filter(Boolean) as string[];

  return {
    id: meeting.id,
    title: meetingHeadline(meeting),
    ...(timed
      ? { startsAtIso: meeting.startsAt }
      : { allDayDate: meetingLocalDate(meeting) }),
    /*
     * An online meeting's LOCATION line carries what the body published —
     * "Virtual Meeting" — and the join link when there is one (D18). It never
     * carries an address, because there is not one, and a calendar entry that
     * invented a building would send someone across town.
     */
    /*
     * **MTG-4 (2026-08-23) — through `locationLine`, not a join.**
     *
     * The venue was reaching the event; what it was reaching it as was
     * sometimes the same string twice. Several sources publish the ADDRESS as
     * the venue name, so `[name, address].join(", ")` produced *65 Mount Hope
     * Road, 65 Mount Hope Road* in the calendar entry — the author's Vail
     * defect, which every reader-facing surface has routed through
     * `locationLine` since 2026-08-16 and this one never did.
     *
     * A calendar entry is a reader-facing surface that outlives the tab it
     * was created in, and it is the one place a duplicated address is hardest
     * to notice and most annoying to fix.
     */
    location: meeting.location
      ? locationLine(meeting.location.name, meeting.location.address)
      : [meeting.online?.label, meeting.online?.joinUrl].filter(Boolean).join(" — "),
    description: lines.join("\n"),
  };
}
