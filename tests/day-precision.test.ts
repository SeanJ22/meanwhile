import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { parseAgendaCenter } from "../lib/sources/civicplus/index.ts";
import { parseAgendaDocuments } from "../lib/sources/revize/index.ts";
import {
  TIME_NOT_POSTED,
  formatMeetingDate,
  formatMeetingTime,
  meetingLocalDate,
  startTimeIsKnown,
} from "../lib/map/format.ts";
import {
  googleCalendarUrl,
  icsDataHref,
  meetingCalendarEvent,
} from "../lib/calendar/event-links.ts";
import { readSnapshot } from "../lib/meetings/snapshot.ts";
import type { Meeting } from "../lib/sources/types.ts";

/**
 * M59 (2026-08-15) — "we know the day, not the hour".
 *
 * Two real archives publish a meeting's date and no start time: Rockaway
 * Township's AgendaCenter and Merrimack County's notices page. Before this,
 * both jurisdictions' pasts simply did not exist in the app, and the
 * Concluded filter said so honestly and uselessly. Ingesting them needed a
 * shape that can hold a date without a clock, because the alternative —
 * defaulting to the hour these bodies usually meet — would be right most of
 * the time and wrong exactly when it mattered, on the special sitting
 * somebody wanted to attend.
 *
 * The bargain that makes it safe is one line: **a date-only meeting may never
 * render a time.** `startsAt` still carries local midnight so the row can be
 * ordered and filtered with every other meeting, and that midnight is an
 * ordering artifact. These guards are what stop it becoming a claim.
 */

const ROOT = join(import.meta.dirname, "..");
const FIXTURES = join(ROOT, "tests", "fixtures");

function meeting(overrides: Partial<Meeting> = {}): Meeting {
  return {
    id: "test:1",
    ocdId: null,
    bodyName: "Township Council",
    title: "Regular Meeting",
    startsAt: "2026-06-09T00:00:00-04:00",
    timeZone: "America/New_York",
    location: { name: "Municipal Building", address: null, lat: 40.9, lng: -74.5 },
    agendaUrl: null,
    jurisdiction: "Rockaway Township, NJ",
    status: "CONCLUDED",
    provenance: {
      sourceUrl: "https://www.rockawaytownship.org/AgendaCenter",
      sourceOrg: "Rockaway Township",
      collectedAt: "2026-08-15",
      verifiedAt: null,
    },
    ...overrides,
  };
}

/* ------------------------------------------------------------- rendering --- */

test("M59: a date-only meeting renders the honest line where the clock goes", () => {
  const dayOnly = meeting({ startPrecision: "DAY" });

  assert.equal(startTimeIsKnown(dayOnly), false);
  assert.equal(formatMeetingTime(dayOnly), TIME_NOT_POSTED);

  // The specific failure this guards: midnight leaking out as "12:00 AM EDT",
  // which reads as a real published start time and is a fabricated fact about
  // a government meeting.
  assert.ok(
    !/\d{1,2}:\d{2}/.test(formatMeetingTime(dayOnly)),
    `a date-only meeting rendered a clock: ${formatMeetingTime(dayOnly)}`,
  );

  // The DATE still renders in full — that half is known and is the point.
  // BC-12 (2026-08-24): the author's convention is spelled out, product-wide.
  // The weekday stays: "is that a Tuesday" is half of deciding to attend.
  assert.match(formatMeetingDate(dayOnly), /^Tue, June 9th, 2026$/);
});

test("M59: a normal meeting is untouched by the new shape", () => {
  const timed = meeting({ startsAt: "2026-06-09T19:00:00-04:00" });
  assert.equal(startTimeIsKnown(timed), true);
  assert.match(formatMeetingTime(timed), /7:00\s?PM/);

  // Absent precision means MINUTE. Stated as a test so the default cannot be
  // quietly flipped to the permissive direction.
  assert.equal(timed.startPrecision, undefined);
});

test("M59: the calendar date is the meeting's own zone, not the reader's", () => {
  // A Tucson meeting written with a UTC offset lands on the previous day if
  // the date is sliced off the ISO string instead of formatted in the zone.
  const tucson = meeting({
    startsAt: "2026-06-10T02:00:00Z",
    timeZone: "America/Phoenix",
    startPrecision: "DAY",
  });
  assert.equal(meetingLocalDate(tucson), "2026-06-09");
});

/* ------------------------------------------------------------- ingestion --- */

test("M59: the AgendaCenter parse reads only its own category, with a floor", () => {
  const html = readFileSync(
    join(FIXTURES, "civicplus-rockaway-agendacenter.html"),
    "utf8",
  );

  // Category 2 is the Township Council's own filter value. Asserting a
  // minimum row count rather than "no error": a selector that matched nothing
  // would otherwise pass as a clean run.
  const council = parseAgendaCenter(html, "2");
  assert.ok(
    council.length >= 13,
    `only ${council.length} archived sittings parsed for the council — the fixture holds 13`,
  );
  for (const sitting of council) {
    assert.match(sitting.date, /^\d{4}-\d{2}-\d{2}$/);
  }

  // And the neighbours are NOT the council's. The page carries five bodies;
  // filing the Planning Board's meetings under the Township Council would be
  // a wrong claim about who met.
  const planning = parseAgendaCenter(html, "4");
  assert.ok(planning.length >= 7, `only ${planning.length} Planning Board sittings`);
  const councilDates = new Set(council.map((s) => s.date));
  const overlap = planning.filter((s) => councilDates.has(s.date));
  assert.deepEqual(
    overlap.map((s) => s.date),
    [],
    "a Planning Board sitting was filed under the Township Council",
  );

  // An unknown category is empty, not the whole page.
  assert.deepEqual(parseAgendaCenter(html, "999"), []);
});

test("M59: the Merrimack notices page still parses its dated documents", () => {
  const html = readFileSync(join(FIXTURES, "revize", "merrimack-agendas.html"), "utf8");
  const docs = parseAgendaDocuments(
    html,
    "Board of Commissioners/Public Notices, Agenda, Minutes/",
  );
  assert.ok(docs.length >= 33, `only ${docs.length} dated documents parsed`);

  const dates = new Set(
    docs.map((d) => `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`),
  );
  assert.ok(dates.size >= 14, `only ${dates.size} distinct meeting dates`);
});

/* ------------------------------------------------------- calendar links --- */

test("M59: a date-only meeting exports as an all-day event, with the note", () => {
  const dayOnly = meeting({
    startPrecision: "DAY",
    status: "SCHEDULED",
    agendaUrl: "https://www.rockawaytownship.org/AgendaCenter/ViewFile/Agenda/_06092026-1016",
  });
  const event = meetingCalendarEvent(dayOnly, { origin: "https://example.test" });

  assert.equal(event.allDayDate, "2026-06-09");
  assert.equal(event.startsAtIso, undefined);
  assert.ok(
    event.description?.includes(TIME_NOT_POSTED),
    "the all-day event does not say why it has no time",
  );
  // The 90-minute end-time estimate is meaningless on an all-day event and
  // would read as a claim about length.
  assert.ok(!event.description?.includes("End time is an estimate"));

  const ics = icsDataHref(event);
  const decoded = decodeURIComponent(ics.slice("data:text/calendar;charset=utf-8,".length));
  assert.match(decoded, /DTSTART;VALUE=DATE:20260609/);
  assert.ok(
    !/DTSTART:\d{8}T\d{6}Z/.test(decoded),
    "the .ics carries a timed DTSTART for a meeting with no published time",
  );

  const google = googleCalendarUrl(event);
  assert.match(google, /dates=20260609%2F20260610/);
});

test("M59: a timed meeting still exports as a timed event", () => {
  const timed = meeting({ startsAt: "2026-06-09T19:00:00-04:00", status: "SCHEDULED" });
  const event = meetingCalendarEvent(timed, {});
  assert.equal(event.allDayDate, undefined);
  assert.equal(event.startsAtIso, "2026-06-09T19:00:00-04:00");
  assert.ok(!event.description?.includes(TIME_NOT_POSTED));
});

/* -------------------------------------------------- the committed snapshot --- */

test("M59: the shipped snapshot carries day-only meetings and none of them shows a time", () => {
  const snapshot = readSnapshot(ROOT);
  assert.ok(snapshot, "no committed snapshot to check");

  const dayOnly = snapshot.meetings.filter((m) => m.startPrecision === "DAY");

  // Counts with their denominator, per jurisdiction, so a source that stops
  // producing shows up as a number rather than as a quietly shorter list.
  const byJurisdiction = new Map<string, number>();
  for (const m of dayOnly) {
    byJurisdiction.set(m.jurisdiction, (byJurisdiction.get(m.jurisdiction) ?? 0) + 1);
  }
  console.log(
    `\n  day-only  ${dayOnly.length} of ${snapshot.meetings.length} meeting(s): ` +
      [...byJurisdiction].map(([j, n]) => `${j} ${n}`).join(", ") +
      "\n",
  );

  assert.ok(
    dayOnly.length >= 27,
    `only ${dayOnly.length} day-only meetings in the snapshot — M59 ingested 27`,
  );
  assert.ok(
    (byJurisdiction.get("Rockaway Township, NJ") ?? 0) >= 13,
    "Rockaway Township's archive is not in the snapshot",
  );
  assert.ok(
    (byJurisdiction.get("Merrimack County, NH") ?? 0) >= 14,
    "Merrimack County's archive is not in the snapshot",
  );

  for (const m of dayOnly) {
    assert.equal(
      formatMeetingTime(m),
      TIME_NOT_POSTED,
      `${m.id} would render a start time it does not have`,
    );
    // Local midnight is the ordering position these rows are supposed to
    // hold. Anything else means a real time was thrown away.
    assert.match(
      m.startsAt,
      /T00:00:00/,
      `${m.id} is day-only but carries a time in startsAt`,
    );
  }

  // Nothing that DOES have a time may be marked day-only by accident.
  for (const m of snapshot.meetings) {
    if (m.startPrecision === "DAY") continue;
    assert.ok(startTimeIsKnown(m), `${m.id} lost its time`);
  }
});
