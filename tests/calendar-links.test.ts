import assert from "node:assert/strict";
import test from "node:test";

import {
  googleCalendarUrl,
  icsDataHref,
  icsFileName,
} from "../lib/calendar/event-links.ts";

/** The shared calendar builders behind the add-to-calendar control: timed (meetings) and all-day (election dates, deadlines). */

test("an all-day event builds VALUE=DATE ics with an exclusive end", () => {
  const href = icsDataHref({
    id: "election-day-nj-2026-11-03",
    title: "Election Day — vote (NJ)",
    allDayDate: "2026-11-03",
  });
  const ics = decodeURIComponent(href.replace("data:text/calendar;charset=utf-8,", ""));
  assert.ok(ics.includes("DTSTART;VALUE=DATE:20261103"));
  assert.ok(ics.includes("DTEND;VALUE=DATE:20261104"), "end is exclusive next day");
  assert.ok(ics.includes("SUMMARY:Election Day — vote (NJ)"));
});

test("an all-day event crossing a month boundary ends on the right day", () => {
  const href = icsDataHref({ id: "x", title: "t", allDayDate: "2026-10-31" });
  const ics = decodeURIComponent(href.replace("data:text/calendar;charset=utf-8,", ""));
  assert.ok(ics.includes("DTEND;VALUE=DATE:20261101"));
});

test("a timed event keeps the 90-minute block", () => {
  const href = icsDataHref({
    id: "meeting-1",
    title: "City Council meets",
    startsAtIso: "2026-08-20T01:00:00.000Z",
  });
  const ics = decodeURIComponent(href.replace("data:text/calendar;charset=utf-8,", ""));
  assert.ok(ics.includes("DTSTART:20260820T010000Z"));
  assert.ok(ics.includes("DTEND:20260820T023000Z"));
});

test("the google url carries the same dates", () => {
  const url = googleCalendarUrl({
    id: "x",
    title: "Election Day",
    allDayDate: "2026-11-03",
  });
  assert.ok(url.startsWith("https://calendar.google.com/calendar/render?"));
  assert.ok(url.includes("20261103%2F20261104"));
});

test("filenames are safe", () => {
  assert.equal(
    icsFileName({ id: "ballot-az:governor|x", title: "t", allDayDate: "2026-11-03" }),
    "ballot-az-governor-x.ics",
  );
});
