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
import type { Meeting } from "../lib/sources/types.ts";

/**
 * A date-only meeting may never render a time. `startsAt` carries local midnight so the row orders and filters with
 * every other meeting; that midnight is an ordering artifact, never a claim.
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

test("M59: a date-only meeting renders the honest line where the clock goes", () => {
  const dayOnly = meeting({ startPrecision: "DAY" });

  assert.equal(startTimeIsKnown(dayOnly), false);
  assert.equal(formatMeetingTime(dayOnly), TIME_NOT_POSTED);

  // Midnight must not leak out as "12:00 AM EDT", which would read as a published start time.
  assert.ok(
    !/\d{1,2}:\d{2}/.test(formatMeetingTime(dayOnly)),
    `a date-only meeting rendered a clock: ${formatMeetingTime(dayOnly)}`,
  );

  // The date still renders in full, weekday included.
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
  // A meeting written with a UTC offset lands on the previous day if the date is sliced off the ISO string instead
  // of formatted in the zone.
  const tucson = meeting({
    startsAt: "2026-06-10T02:00:00Z",
    timeZone: "America/Phoenix",
    startPrecision: "DAY",
  });
  assert.equal(meetingLocalDate(tucson), "2026-06-09");
});

test("M59: the AgendaCenter parse reads only its own category, with a floor", () => {
  const html = readFileSync(
    join(FIXTURES, "civicplus-rockaway-agendacenter.html"),
    "utf8",
  );

  // Category 2 is the Township Council's own filter value. A minimum row count, because a selector that matched
  // nothing would otherwise pass as a clean run.
  const council = parseAgendaCenter(html, "2");
  assert.ok(
    council.length >= 13,
    `only ${council.length} archived sittings parsed for the council — the fixture holds 13`,
  );
  for (const sitting of council) {
    assert.match(sitting.date, /^\d{4}-\d{2}-\d{2}$/);
  }

  // The page carries several bodies; the Planning Board's meetings must not be filed under the Township Council.
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
