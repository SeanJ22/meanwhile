import type { Meeting } from "@/lib/sources/types";

/**
 * The WHAT of a meeting, jurisdiction-qualified (3a, 2026-08-16).
 *
 * Some sources publish only a sitting title ("Governing Board Meeting") with
 * no body name, so a card headlining `bodyName` reads as a mystery — WHOSE
 * governing board? The rule: if the body/title text already names the
 * jurisdiction, it stands alone; otherwise the jurisdiction leads, joined
 * with an em dash — "Vail Unified School District — Governing Board Meeting".
 */
export function meetingHeadline(meeting: Meeting): string {
  const what = meeting.bodyName || meeting.title;
  const jurisdiction = meeting.jurisdiction?.trim();
  if (!jurisdiction) return what;
  if (what.toLowerCase().includes(jurisdiction.toLowerCase())) return what;
  return `${jurisdiction} — ${what}`;
}

/**
 * Venue name and address as ONE line, never the same text twice (3a). Some
 * sources publish the address as the venue name, so the two fields can be
 * identical or one can contain the other — in either case the longer string
 * renders once.
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

/** Every plain date renders mm/dd/yyyy (3h). ISO dates in, 08/16/2026 out. */
export function formatDateMDY(iso: string): string {
  // Replace each ISO date token so ranges ("2026-10-24 – 2026-11-01") and
  // annotated strings pass through with every date converted.
  return iso.replace(
    /(\d{4})-(\d{2})-(\d{2})/g,
    (_, y: string, m: string, d: string) => `${m}/${d}/${y}`,
  );
}

/**
 * Meeting times render in the zone the meeting is held in, never the reader's.
 * Someone checking a Tucson agenda from Philadelphia needs the time they'll be
 * expected in the room.
 */

export function formatMeetingDate(meeting: Meeting): string {
  // Weekday plus mm/dd/yyyy — the author's date convention (3h), with the
  // weekday kept because "is that a Tuesday" is half of deciding to attend.
  const d = new Date(meeting.startsAt);
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: meeting.timeZone,
    weekday: "short",
  }).format(d);
  const mdy = new Intl.DateTimeFormat("en-US", {
    timeZone: meeting.timeZone,
    month: "2-digit",
    day: "2-digit",
    year: "numeric",
  }).format(d);
  return `${weekday} ${mdy}`;
}

export function formatMeetingTime(meeting: Meeting): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: meeting.timeZone,
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(meeting.startsAt));
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

/**
 * Trim an OCD-ID to its last segment for display.
 * `ocd-division/country:us/state:az/place:tucson` → `place:tucson`
 */
export function shortOcdId(ocdId: string | null): string {
  // A division-less body (D28) has nothing to abbreviate; say so plainly.
  if (ocdId === null) return "no census division";
  const segments = ocdId.split("/");
  return segments[segments.length - 1] ?? ocdId;
}
