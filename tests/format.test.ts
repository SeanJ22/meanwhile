import assert from "node:assert/strict";
import { test } from "node:test";

import {
  formatDateMDY,
  formatMeetingDate,
  formatMeetingTime,
  locationLine,
  meetingHeadline,
} from "../lib/map/format.ts";
import { statedVenueText } from "../lib/meetings/online.ts";
import { isTestSitting } from "../lib/meetings/placeholder.ts";
import type { Meeting } from "../lib/sources/types.ts";
import { plainText } from "../lib/text/plain-text.ts";

/** A source that titles the sitting without a body name and publishes the address as the venue name renders one what-first headline over one address line. */

function meetingWith(fields: Partial<Meeting>): Meeting {
  return {
    id: "test:1",
    ocdId: null,
    bodyName: "Governing Board Meeting",
    title: "Governing Board Meeting",
    startsAt: "2026-08-20T00:00:00.000Z",
    timeZone: "America/Phoenix",
    location: { name: "x", address: "x", lat: 0, lng: 0 },
    agendaUrl: null,
    jurisdiction: "Vail Unified School District",
    status: "SCHEDULED",
    provenance: {
      sourceUrl: null,
      sourceOrg: "test",
      collectedAt: "2026-08-16",
      verifiedAt: null,
    },
    ...fields,
  } as Meeting;
}

test("a sitting title with no body name gets the jurisdiction in front", () => {
  assert.equal(
    meetingHeadline(meetingWith({})),
    "Vail Unified School District — Governing Board Meeting",
  );
});

test("a body name already carrying the jurisdiction stands alone", () => {
  assert.equal(
    meetingHeadline(
      meetingWith({
        bodyName: "Pima County Board of Supervisors",
        jurisdiction: "Pima County",
      }),
    ),
    "Pima County Board of Supervisors",
  );
});

test("the address renders once when the source publishes it as the venue name", () => {
  const addr = "Calvin Baker Leadership Center 13801 E Benson Hwy, Vail, AZ 85641";
  assert.equal(locationLine(addr, addr), addr);
  assert.equal(locationLine("City Hall", "City Hall, 255 W Alameda"), "City Hall, 255 W Alameda");
  assert.equal(locationLine("Hearing Room A", "33 N Stone Ave"), "Hearing Room A · 33 N Stone Ave");
});

/* Callers hand in annotated range strings; the formatter must convert those, not only a bare date. */
test("BC-12: dates spell out, including inside ranges", () => {
  assert.equal(formatDateMDY("2026-11-03"), "November 3rd, 2026");
  assert.equal(
    formatDateMDY("2026-10-24 – 2026-11-01"),
    "October 24th, 2026 – November 1st, 2026",
  );
});


test("a meeting reads on its own body's clock, with the zone, wherever the reader is", () => {
  const meeting = meetingWith({ startsAt: "2026-11-01T06:30:00.000Z", timeZone: "America/Los_Angeles" });
  assert.equal(formatMeetingDate(meeting), "Sat, October 31st, 2026");
  assert.equal(formatMeetingTime(meeting), "11:30 PM PDT");
  assert.equal(formatMeetingTime(meetingWith({ startsAt: "2026-08-11T16:30:00Z", timeZone: "America/Los_Angeles" })), "9:30 AM PDT");
  assert.equal(formatMeetingTime(meetingWith({ startsAt: "2026-11-18T23:00:00Z", timeZone: "America/Phoenix" })), "4:00 PM MST");
  const dayOnly = meetingWith({ startsAt: "2026-11-01T00:00:00.000Z", timeZone: "America/Los_Angeles", startPrecision: "DAY" });
  assert.equal(formatMeetingDate(dayOnly), "Sat, October 31st, 2026");
  assert.equal(formatMeetingTime(dayOnly), "Time not posted — check the agenda");
});

test("a venue pasted as markup reads as plain text, and a placeholder venue names no place", () => {
  const pasted = '<p data-pasted="true">Cochise County Complex<br>1415 W. Melody Lane<br>Bisbee, Arizona 85603</p><p>or virtually</p>'
    + '<div style=\'font-size: 20px;\'><a href="https://teams.microsoft.com/l/x" target="_blank"><u>Join the meeting now</u></a></div>';
  const line = locationLine(pasted, pasted);
  assert.ok(!/[<>]|style=|data-pasted/.test(line), line);
  assert.match(line, /Cochise County Complex, 1415 W\. Melody Lane, Bisbee, Arizona 85603, or virtually, Join the meeting now \(https:\/\/teams\.microsoft\.com\/l\/x\)/);
  assert.equal(plainText("Parks &amp; Recreation&nbsp;Board"), "Parks & Recreation Board");
  assert.equal(plainText("AT&T Park <5 minutes away"), "AT&T Park <5 minutes away");
  assert.equal(plainText("&lt;script&gt;x&lt;/script&gt;"), "<script>x</script>");
  assert.equal(plainText("<script>alert(1)</script>Room 4<style>p{}</style>"), "Room 4");
  assert.equal(statedVenueText({ kind: "STATED_NOT_PLACED", publishedText: "TEST", publisher: "x" }), null);
  assert.equal(statedVenueText({ kind: "STATED_NOT_PLACED", publishedText: "test test test", publisher: "x" }), null);
  assert.equal(statedVenueText({ kind: "STATED_NOT_PLACED", publishedText: "Testing Center, 4 Main St", publisher: "x" }), "Testing Center, 4 Main St");
});

test("a sitting the publisher titled as a test is not a meeting; a real title that contains the word is", () => {
  for (const title of ["Test", "TEST", "Test Meeting", "TEST MEETING", "testing", "Test."]) assert.equal(isTestSitting({ title }), true, title);
  for (const title of ["Testing Center Advisory Board", "Regular Meeting", "Contest Review Panel", "Board of Supervisors"]) assert.equal(isTestSitting({ title }), false, title);
});
