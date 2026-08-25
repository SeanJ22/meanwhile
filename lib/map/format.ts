import type { Meeting } from "@/lib/sources/types";
import { formatDateLong, spellOutDates } from "@/lib/text/format-date";

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
 * **The headline for a row inside a group that already names the
 * jurisdiction.** (`MTG-2`, third instance, 2026-08-23.)
 *
 * Read as an image at 430×932: the 48-meetings list grouped by jurisdiction
 * put **ROCKAWAY TOWNSHIP, NJ** on the group heading and then *Rockaway
 * Township, NJ — Township …* on every row beneath it, so the body name — the
 * one fact distinguishing nineteen rows from each other — was the part that
 * got the ellipsis.
 *
 * It is the doubled label one level up: the enclosing context said it, and the
 * row said it again. The rule is the same one `meetingSubline` applies, and it
 * applies at every level of nesting.
 *
 * `jurisdictionShown` false gives the full headline back, so the ungrouped
 * list and every other surface are untouched.
 */
export function meetingRowTitle(
  meeting: Meeting,
  { jurisdictionShown }: { jurisdictionShown: boolean },
): string {
  if (!jurisdictionShown) return meetingHeadline(meeting);
  const what = meeting.bodyName || meeting.title;
  /*
   * The body's OWN name, never a string surgery on the headline. Trimming
   * "Rockaway Township, NJ — " off the front would work until a source
   * publishes a body name that contains the jurisdiction, at which point it
   * would cut into the name itself.
   */
  return what;
}

/**
 * **The second line, carrying only what the headline does NOT already say.**
 * (`MTG-2`, 2026-08-23, the author's 8/22 walkthrough.)
 *
 * ## What the capture showed
 *
 * The 48-meetings list at 07866, twenty rows of Morris County, every one of
 * them:
 *
 *   Morris County, NJ — Board of County Commissioners
 *   Board of County Commissioners · Morris County, NJ
 *
 * The same two facts, in the same row, reordered. Nothing was wrong with
 * either line on its own: the headline is `meetingHeadline`, and the sub was
 * built as `bodyName · jurisdiction` guarded by `bodyName !== title`. The
 * guard was asking the wrong question — whether the sitting had a distinct
 * title — when the question that matters is whether the HEADLINE already
 * carries the words about to be printed under it.
 *
 * ## What it carries instead
 *
 * The part of the sitting title that is not the body's name — *Work Session*,
 * *Regular Meeting* — which is the one fact a reader scanning twenty rows of
 * one body actually needs, and the fact the doubled label was burying. Plus
 * the jurisdiction, but only where the headline left it out.
 *
 * An empty string is a legitimate answer and means the headline said
 * everything. The caller renders nothing rather than an empty line.
 */
export function meetingSubline(meeting: Meeting): string {
  const headline = meetingHeadline(meeting).toLowerCase();
  const body = (meeting.bodyName ?? "").trim();
  const title = (meeting.title ?? "").trim();
  const parts: string[] = [];

  /*
   * Strip the body's name off the sitting title wherever it sits. Sources
   * write it three ways — "Township Council Regular Meeting" (prefix),
   * "Board of County Commissioners – Work Session" (prefix with a separator),
   * and "Regular Meeting of the Township Council" (suffix) — and all three
   * leave the same words on the screen twice.
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
   * A bare generic noun is not a fact about this sitting. "Board of Adjustment
   * Meeting" reduces to "Meeting", which tells a reader looking at a list of
   * meetings nothing at all — it is the doubled label again, shorter. "Regular
   * Meeting" and "Work Session" survive, because those distinguish one sitting
   * of a body from another.
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

/**
 * **MTG-6 / MTG-8 (2026-08-24, the author's captures 11-59-24 and 12-01-44) —
 * A MEETING CARD IS TITLED BY THE BODY, NEVER BY THE BUILDING.**
 *
 * His finding, in the captures: the Duffy Community Center card headlined
 * *Duffy Community Center, Multipurpose Room* over ten sittings of the Tucson
 * Unified School District — so the card read as though the MEETING WERE ABOUT
 * THE BUILDING. The Parks and Recreation card is his named reference pattern:
 * body as the title, venue and address in gray beneath. Its one flaw, struck
 * through in red in `12-01-44`, is the jurisdiction prefix — *Tucson, AZ —*
 * comes off, and the title is the body name alone.
 *
 * Why the venue ever won, which is the part worth keeping: the card asked
 * whether every sitting shared one `bodyName`, and at TUSD they do not. The
 * source publishes a DIFFERENT `bodyName` per sitting — "GOVERNING BOARD
 * AGENDA SPECIAL MEETING", "AGENDA FOR AUDIT COMMITTEE MEETING" — while the
 * `jurisdiction` is the district on every one of them. The distinct-body count
 * was answering a question about the source's naming habits and being read as
 * a question about who is meeting.
 *
 * So it descends: the shared body name if there is one, else the shared
 * jurisdiction with its state suffix off, else — and only else — the building.
 * The last rung is a real case (a civic centre hosting two governments) and it
 * is the one shape where the building genuinely IS the only true common
 * subject. It is reported as its own outcome rather than folded in, because
 * "we titled this by the venue" and "this venue hosts one body" are different
 * facts and a card that ran them together is what this fixes.
 */
export function venueBodyTitle(
  meetings: Pick<Meeting, "bodyName" | "jurisdiction">[],
  venueName: string,
): { title: string; basis: "body" | "jurisdiction" | "venue" } {
  const bodies = new Set(
    meetings.map((m) => (m.bodyName ?? "").trim()).filter(Boolean),
  );
  if (bodies.size === 1) {
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
 * "Tucson Unified School District, AZ" → "Tucson Unified School District".
 *
 * A TRAILING two-letter state code only. Anchored to the end and to a comma so
 * it can never bite into a name — "Washington, DC" is the shape this strips,
 * and "District of Columbia" is not, because the pattern requires the comma
 * and the two letters and the end of the string all at once.
 */
export function bodyFromJurisdiction(jurisdiction: string): string {
  return jurisdiction.replace(/,\s*[A-Z]{2}\s*$/, "").trim() || jurisdiction;
}

/**
 * **MTG-7 (2026-08-24, confirmed by the author) — the row carries the SITTING,
 * because the card above it already carries the body.**
 *
 * "Meetings in the next 30 days" stays as the header; the entry beneath is the
 * actual meeting name — *Governing Board Agenda Special Meeting*, not *Tucson
 * Unified School District, AZ — GOVERNING BOARD AGENDA SPECIAL MEETING*. This
 * is `meetingRowTitle`'s rule (a row inside a context that already names the
 * jurisdiction does not name it again) applied one level up: the card title is
 * now that context.
 *
 * `titleShown` false hands the full headline back, so every surface that does
 * NOT carry a body title above its rows is untouched.
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
 * **BC-12 (2026-08-24): every plain date SPELLS OUT.** ISO dates in,
 * "August 16th, 2026" out.
 *
 * It rendered `mm/dd/yyyy` from 3h until the author's 8/24 walkthrough. The
 * NAME is deliberately kept rather than renamed across twenty-odd call sites:
 * what changed is a convention, not a contract, and a rename would have put
 * the convention change inside a diff of import churn. The work happens in
 * `lib/text/format-date.ts` — the ONE formatter, which `inSeatUntil` now calls
 * too. See that file for the duplicate implementation this closed (RULING 103).
 */
export function formatDateMDY(iso: string): string {
  return spellOutDates(iso);
}

/**
 * Meeting times render in the zone the meeting is held in, never the reader's.
 * Someone checking a Tucson agenda from Philadelphia needs the time they'll be
 * expected in the room.
 */

export function formatMeetingDate(
  // Widened to the two fields it reads (A02, 2026-08-17) so the digest's own
  // row type can be formatted by the SAME function the map uses rather than by
  // a second date formatter that would drift from the author's convention.
  meeting: Pick<Meeting, "startsAt" | "timeZone">,
): string {
  /*
   * **BC-12 (2026-08-24): the date SPELLS OUT here too.** The author's rule is
   * product-wide, and a meetings list is where a reader meets the most dates —
   * exempting the densest surface would leave the convention true everywhere
   * it did not matter.
   *
   * The weekday stays, because "is that a Tuesday" is half of deciding to
   * attend, and the calendar date is resolved in the MEETING'S zone before it
   * is spelled out. Slicing the ISO string instead would read whatever offset
   * the string happens to carry and put a Tucson evening meeting on the
   * previous day.
   */
  const d = new Date(meeting.startsAt);
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: meeting.timeZone,
    weekday: "short",
  }).format(d);
  const local = new Intl.DateTimeFormat("en-CA", {
    timeZone: meeting.timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
  return `${weekday}, ${formatDateLong(local) ?? local}`;
}

/**
 * The line a meeting shows where the clock would go when its publisher never
 * posted one (M59, 2026-08-15). Plain enough for the 15-year-old test, and it
 * describes the POSTING rather than the meeting — we know it happened that
 * day; what is missing is the hour, and the agenda is where the reader can go
 * looking. Never "TBD", which reads as the body being undecided.
 */
export const TIME_NOT_POSTED = "Time not posted — check the agenda";

/** True when the publisher gave a start time. See `Meeting.startPrecision`. */
export function startTimeIsKnown(meeting: Meeting): boolean {
  return meeting.startPrecision !== "DAY";
}

/**
 * The meeting's calendar date in its OWN zone, `YYYY-MM-DD` — what an all-day
 * calendar event needs. Computed through `Intl` in the meeting's zone rather
 * than sliced off the ISO string, because a slice reads the offset the string
 * happens to carry and a Tucson meeting written in UTC would land a day early.
 */
export function meetingLocalDate(meeting: Meeting): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: meeting.timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(meeting.startsAt));
  return parts;
}

export function formatMeetingTime(meeting: Meeting): string {
  // The single choke point for a meeting's clock, which is why the honest
  // line lives here rather than at five call sites that could each forget it.
  if (!startTimeIsKnown(meeting)) return TIME_NOT_POSTED;
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
