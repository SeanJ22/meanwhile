/**
 * **CHANDLER'S CITY COUNCIL, FROM THE CITY'S OWN SCHEDULE TABLE.** (C14, 2026-09-24.)
 *
 * Against the City Clerk's page recorded from www.chandleraz.gov on 2026-09-24
 * (`pnpm research:fetch`, robots.txt read first). No live calls.
 *
 * Every Chandler agenda, result and minutes set is published only on
 * destinyhosted.com, which reads as disallow-all and is never requested. The
 * city's own page publishes the year's sittings as the "2026 City Council
 * Meeting Dates" table (Resolution No. 5937, Exhibit A). What these tests
 * hold: the section scope reads the table's 33 dates and nothing else on a page
 * full of news and archive dates; no time is claimed, because the table
 * states none; and each served sitting is the Council's, on the city's own
 * host, cited to that page.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { wiringForTypes } from "../lib/registry/source-wiring.ts";
import { makeSchedulePageSource, parseDatedList, parseStatedTime, sliceSection } from "../lib/sources/schedulepage/index.ts";

const PAGE = readFileSync(new URL("./fixtures/schedulepage/chandler-city-council-meetings.html", import.meta.url), "utf8");
const NOW = new Date("2026-09-24T12:00:00-07:00");

const wiring = () => {
  const row = wiringForTypes(["SCHEDULEPAGE"]).find((w) => w.config.slug === "chandler-city-council");
  assert.ok(row, "the Chandler City Council wiring row is missing");
  return row;
};

test("the section scope reads the schedule table's 33 dates, and only them", () => {
  const row = wiring();
  const section = sliceSection(PAGE, row.config.sectionMatch ?? "");
  assert.match(section, /2026 City Council Meeting Dates/);
  assert.match(section, /Resolution No\. 5937, Exhibit A/);
  const { sittings, counts } = parseDatedList(section);
  assert.equal(sittings.length, 33, JSON.stringify(sittings.map((s) => s.date)));
  assert.equal(sittings[0].date, "2026-01-05");
  assert.equal(sittings.at(-1)?.date, "2026-12-10");
  assert.deepEqual(counts, { notSittings: 0, undated: 0 });
  for (let i = 1; i < sittings.length; i++) assert.ok(sittings[i].date > sittings[i - 1].date, "dates out of order or repeated");
  assert.equal(sliceSection("<p>2026 City Council Meeting Dates, January 5, 2026</p>", row.config.sectionMatch ?? ""), "", "without the city's section the scope reads nothing, never the whole page");
});

test("no time is claimed: the table states none, and the page's 'usually' sentence is not the section's", () => {
  assert.equal(parseStatedTime(sliceSection(PAGE, wiring().config.sectionMatch ?? "")), null);
});

test("normalize serves the Council's sittings in the window, on the city's own host, cited to its page", () => {
  const row = wiring();
  const { meetings, drops } = makeSchedulePageSource([row]).normalizeWithDrops(
    [{ wiring: row, schedule: PAGE, collectedAt: NOW.toISOString() }],
    NOW,
  );
  assert.ok(meetings.length > 0, "the window holds sittings");
  assert.equal(drops.unplaceableInTime, 0);
  const days = meetings.map((m) => m.startsAt.slice(0, 10));
  for (const d of ["2026-09-14", "2026-09-17", "2026-10-12", "2026-10-15", "2026-11-09", "2026-11-12", "2026-12-07", "2026-12-10"]) {
    assert.ok(days.includes(d), `${d} is served (${days.join(", ")})`);
  }
  for (const m of meetings) {
    assert.equal(m.bodyId, row.bodyId);
    assert.equal(m.bodyName, "City Council");
  }
  const cited = JSON.stringify(meetings[0]);
  assert.match(cited, /www\.chandleraz\.gov\/government\/departments\/city-clerks-office\/city-council-meetings/);
  assert.doesNotMatch(cited, /destinyhosted/);
});
