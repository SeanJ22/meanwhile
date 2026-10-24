import type { Meeting } from "@/lib/sources/types";
import { formatDateLong, spellOutDates } from "@/lib/text/format-date";

/**
 * The what of a meeting, jurisdiction-qualified: if the body/title text
 * already names the jurisdiction it stands alone; otherwise the jurisdiction
 * leads, joined with an em dash ("<District> — Governing Board Meeting").
 *
 * These read the sitting only (title, start, zone), not `provenance`, so a
 * surface holding a sitting without a retrieval record can use them.
 */
export type CalendarSafeMeeting = Omit<Meeting, "provenance"> &
  Partial<Pick<Meeting, "provenance">>;

export function meetingHeadline(meeting: CalendarSafeMeeting): string {
  const what = meeting.bodyName || meeting.title;
  const jurisdiction = meeting.jurisdiction?.trim();
  if (!jurisdiction) return what;
  if (what.toLowerCase().includes(jurisdiction.toLowerCase())) return what;
  return `${jurisdiction} — ${what}`;
}

/**
 * The headline for a row inside a group that already names the jurisdiction:
 * the row does not repeat it. `jurisdictionShown` false gives the full
 * headline back.
 */
export function meetingRowTitle(
  meeting: Meeting,
  { jurisdictionShown }: { jurisdictionShown: boolean },
): string {
  if (!jurisdictionShown) return meetingHeadline(meeting);
  const what = meeting.bodyName || meeting.title;
  /* The body's own name, never a trim of the headline, which could cut into a name that contains the jurisdiction. */
  return what;
}

/**
 * The second line, carrying only what the headline does not already say: the
 * part of the sitting title that is not the body's name ("Work Session",
 * "Regular Meeting"), plus the jurisdiction where the headline left it out.
 * An empty string means the headline said everything; the caller renders
 * nothing.
 */
export function meetingSubline(meeting: Meeting): string {
  const headline = meetingHeadline(meeting).toLowerCase();
  const body = (meeting.bodyName ?? "").trim();
  const title = (meeting.title ?? "").trim();
  const parts: string[] = [];

  /*
   * Strip the body's name off the sitting title wherever it sits: prefix,
   * prefix with a separator, or suffix ("Regular Meeting of the Township Council").
   */
  let sitting = title;
  if (body.length > 0) {
    const at = sitting.toLowerCase().indexOf(body.toLowerCase());
    if (at !== -1) {
      sitting = `${sitting.slice(0, at)} ${sitting.slice(at + body.length)}`;
    }
  }
  // Leading and trailing separators left behind by the strip, and the dangling
  // "of the" a suffix form leaves.
  sitting = sitting
    .replace(/\s+/g, " ")
    .replace(/^[\s–—·:,-]+/, "")
    .replace(/[\s–—·:,-]+$/, "")
    .replace(/\s+(?:of|for)\s+the\s*$/i, "")
    .trim();

  /*
   * A bare generic noun ("Meeting") says nothing about this sitting; "Regular
   * Meeting" and "Work Session" survive.
   */
  const GENERIC = /^(?:meeting|session|sitting|agenda)$/i;
  if (
    sitting.length > 0 &&
    !GENERIC.test(sitting) &&
    !headline.includes(sitting.toLowerCase())
  ) {
    parts.push(sitting);
  }

  const jurisdiction = meeting.jurisdiction?.trim();
  if (jurisdiction && !headline.includes(jurisdiction.toLowerCase())) parts.push(jurisdiction);

  return parts.join(" · ");
}

/**
 * Venue name and address as one line, never the same text twice: where one
 * contains the other, the longer renders once.
 */
export function locationLine(
  name: string | null | undefined,
  address: string | null | undefined,
): string {
  const n = (name ?? "").trim();
  const a = (address ?? "").trim();
  if (!n) return a;
  if (!a || n.includes(a)) return n;
  if (a.includes(n)) return a;
  return `${n} · ${a}`;
}

/**
 * A meeting card is titled by the body, never by the building. It descends:
 * the shared body name if every sitting shares one and it names an
 * institution, else the shared jurisdiction with its state suffix off, else
 * the building, reported as its own outcome.
 *
 * A shared `bodyName` that names an event rather than an institution
 * ("Governing Board Meeting") does not count as a body. The test is a shape,
 * not a list of known-bad names; `tests/meeting-card-title.test.ts` runs it
 * over every venue in the snapshot.
 */

/**
 * A name that describes an event rather than an institution. Deliberately
 * narrow; a body whose real name contains one of these words would need it in
 * a position this does not match.
 */
const SITTING_SHAPED = /\b(?:meeting|agenda|session|hearing|workshop)\b/i;

export function namesASitting(bodyName: string): boolean {
  return SITTING_SHAPED.test(bodyName);
}

export function venueBodyTitle(
  meetings: Pick<Meeting, "bodyName" | "jurisdiction">[],
  venueName: string,
): { title: string; basis: "body" | "jurisdiction" | "venue" } {
  const bodies = new Set(
    meetings.map((m) => (m.bodyName ?? "").trim()).filter(Boolean),
  );
  if (bodies.size === 1 && !namesASitting([...bodies][0]!)) {
    return { title: [...bodies][0]!, basis: "body" };
  }

  const jurisdictions = new Set(
    meetings.map((m) => (m.jurisdiction ?? "").trim()).filter(Boolean),
  );
  if (jurisdictions.size === 1) {
    return { title: bodyFromJurisdiction([...jurisdictions][0]!), basis: "jurisdiction" };
  }

  return { title: venueName, basis: "venue" };
}

/**
 * "<District>, AZ" → "<District>". A trailing two-letter state code only,
 * anchored to a comma and the end, so it never bites into a name.
 */
export function bodyFromJurisdiction(jurisdiction: string): string {
  return jurisdiction.replace(/,\s*[A-Z]{2}\s*$/, "").trim() || jurisdiction;
}

/**
 * The row carries the sitting when the card above already carries the body.
 * `titleShown` false hands the full headline back.
 */
export function meetingEntryTitle(
  meeting: Meeting,
  { bodyShown }: { bodyShown: boolean },
): string {
  if (!bodyShown) return meetingHeadline(meeting);
  const what = (meeting.bodyName ?? "").trim() || (meeting.title ?? "").trim();
  return what || meetingHeadline(meeting);
}

/**
 * Every plain date spells out: ISO dates in, "August 16th, 2026" out, via
 * `lib/text/format-date.ts`, the one formatter.
 */
export function formatDateMDY(iso: string): string {
  return spellOutDates(iso);
}

/**
 * Meeting times render in the zone the meeting is held in, never the
 * reader's: the time they will be expected in the room.
 */

type MeetingFormatters = {
  weekday: Intl.DateTimeFormat;
  date: Intl.DateTimeFormat;
  time: Intl.DateTimeFormat;
};
const meetingFormatters = new Map<string, MeetingFormatters>();

/** Grouping and drawing a list reuse the zone's compiled formats, never a meeting's values. */
function formatsForZone(timeZone: string): MeetingFormatters {
  const existing = meetingFormatters.get(timeZone);
  if (existing) return existing;
  const formats = {
    weekday: new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }),
    date: new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }),
    time: new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit", timeZoneName: "short" }),
  };
  // A page normally uses a handful of zones; bound unusual mixed-source lists too.
  if (meetingFormatters.size >= 64) meetingFormatters.delete(meetingFormatters.keys().next().value!);
  meetingFormatters.set(timeZone, formats);
  return formats;
}

export function formatMeetingDate(
  // Widened to the two fields it reads so other row types share this formatter.
  meeting: Pick<Meeting, "startsAt" | "timeZone">,
): string {
  /*
   * The date spells out here too, with the weekday. The calendar date is
   * resolved in the meeting's zone; slicing the ISO string would read whatever
   * offset it carries and can land an evening meeting on the previous day.
   */
  const d = new Date(meeting.startsAt);
  const formats = formatsForZone(meeting.timeZone);
  const weekday = formats.weekday.format(d);
  const local = formats.date.format(d);
  return `${weekday}, ${formatDateLong(local) ?? local}`;
}

/**
 * The line shown where the clock would go when the publisher never posted a
 * start time. Describes the posting, not the meeting; never "TBD".
 */
export const TIME_NOT_POSTED = "Time not posted — check the agenda";

/** True when the publisher gave a start time. See `Meeting.startPrecision`. */
export function startTimeIsKnown(meeting: CalendarSafeMeeting): boolean {
  return meeting.startPrecision !== "DAY";
}

/**
 * The meeting's calendar date in its own zone, `YYYY-MM-DD`, computed through
 * `Intl` rather than sliced off the ISO string.
 */
export function meetingLocalDate(meeting: CalendarSafeMeeting): string {
  return formatsForZone(meeting.timeZone).date.format(new Date(meeting.startsAt));
}

export function formatMeetingTime(meeting: Meeting): string {
  // The single choke point for a meeting's clock.
  if (!startTimeIsKnown(meeting)) return TIME_NOT_POSTED;
  return formatsForZone(meeting.timeZone).time.format(new Date(meeting.startsAt));
}

/** "in 3 days", "tomorrow", "12 days ago". */
export function formatRelativeDay(
  isoString: string,
  now: Date = new Date(),
): string {
  const days = Math.round(
    (Date.parse(isoString) - now.getTime()) / 86_400_000,
  );

  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";

  const rtf = new Intl.RelativeTimeFormat("en-US", { numeric: "auto" });
  return rtf.format(days, "day");
}

export const formatMiles = (km: number) => Math.round(km * 0.621371);
