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
import { makeSchedulePageSource, parseDatedList, parseDayEvents, parseStatedTime, scheduledOfDay, sliceSection } from "../lib/sources/schedulepage/index.ts";

const PAGE = readFileSync(new URL("./fixtures/schedulepage/chandler-city-council-meetings.html", import.meta.url), "utf8");
const NOW = new Date("2026-09-24T12:00:00-07:00");
const DAY = (d: string) => readFileSync(new URL(`./fixtures/schedulepage/chandler-day-${d}.json`, import.meta.url), "utf8");
const DAY_URL = "https://www.chandleraz.gov/rest/events/day/";
const dayFile = (date: string) => ({ date, url: `${DAY_URL}${date.replace(/-/g, "")}`, json: DAY(date.replace(/-/g, "")) });

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

test("THE DAY FILE: each Council sitting the city posted for a scheduled date, with its own start and street address; the city's other events are not the Council's", () => {
  const { sittings, counts } = parseDayEvents(DAY("20260914"), "2026-09-14", "City Council", "https://www.chandleraz.gov");
  assert.deepEqual(
    sittings.map((x) => [x.title, x.time, x.address]),
    [
      ["City Council Special Meeting Executive Session", { hour: 16, minute: 0 }, "88 E. Chicago St."],
      ["City Council Work Session", { hour: 16, minute: 0 }, "88 E. Chicago St."],
      ["City Council Regular Meeting", { hour: 18, minute: 0 }, "88 E. Chicago St."],
      ["City Council Study Session", { hour: 18, minute: 0 }, "88 E. Chicago St."],
    ],
  );
  assert.deepEqual(counts, { notSittings: 3, undated: 0 }, "a garden workshop and a museum subcommittee are the city's, not the Council's");
  assert.equal(sittings[2].pageUrl, "https://www.chandleraz.gov/events/city-council-regular-meeting");
  assert.equal(scheduledOfDay(sittings)?.title, "City Council Regular Meeting", "the table's own sitting keeps the date's id");
  assert.deepEqual(parseDayEvents(DAY("20260914"), "2026-09-15", "City Council", "https://www.chandleraz.gov").sittings, [], "an item is never moved to a day it does not name");
  assert.deepEqual(parseDayEvents(DAY("20260914"), "2026-09-14", "", "https://www.chandleraz.gov").sittings, [], "no filter, no sittings");
  assert.deepEqual(parseDayEvents(DAY("20261012"), "2026-10-12", "City Council", "https://www.chandleraz.gov").sittings, [], "a day the city has not posted yet");
});

test("NORMALIZE: a scheduled date the day file answers becomes its Council sittings with time and place; one it does not stays date-only", () => {
  const row = wiring();
  const { meetings } = makeSchedulePageSource([row]).normalizeWithDrops(
    [{ wiring: row, schedule: PAGE, days: ["2026-09-14", "2026-09-17", "2026-10-12", "2026-10-15"].map(dayFile), collectedAt: NOW.toISOString() }],
    NOW,
  );
  const on = (date: string) => meetings.filter((m) => m.id.includes(`:${date}`));
  const sept14 = on("2026-09-14");
  assert.deepEqual(sept14.map((m) => [m.title, Date.parse(m.startsAt)]), [
    ["City Council Special Meeting Executive Session", Date.parse("2026-09-14T16:00:00-07:00")],
    ["City Council Work Session", Date.parse("2026-09-14T16:00:00-07:00")],
    ["City Council Regular Meeting", Date.parse("2026-09-14T18:00:00-07:00")],
    ["City Council Study Session", Date.parse("2026-09-14T18:00:00-07:00")],
  ]);
  const regular = sept14.find((m) => m.title === "City Council Regular Meeting")!;
  assert.equal(regular.id, "schedulepage:chandler-city-council:2026-09-14", "the date's own id stays with the table's sitting");
  assert.equal(Date.parse(regular.startsAt), Date.parse("2026-09-14T18:00:00-07:00"));
  assert.equal(regular.startPrecision, undefined, "a stated time is a time, not a day");
  assert.match(JSON.stringify(regular.venueGap ?? regular.location), /88 E\. Chicago St\./, "the city's own address, in its own words");
  assert.equal(regular.provenance.sourceUrl, "https://www.chandleraz.gov/events/city-council-regular-meeting");
  assert.equal(on("2026-09-17").length, 2);
  for (const date of ["2026-10-12", "2026-10-15"]) {
    const [only, ...rest] = on(date);
    assert.equal(rest.length, 0);
    assert.equal(only.startPrecision, "DAY", `${date} stays date-only until the city posts its events`);
    assert.equal(only.provenance.sourceUrl, row.config.schedulePage);
  }
  assert.equal(new Set(meetings.map((m) => m.id)).size, meetings.length, "every sitting has its own id");
});

test("FETCH: one day file per scheduled date inside the window, and a refused day keeps its sitting date-only", async () => {
  const row = wiring();
  const asked: string[] = [];
  const fetchImpl = (async (input: string | URL) => {
    const url = String(input);
    asked.push(url);
    if (url === row.config.schedulePage) return new Response(PAGE, { status: 200, headers: { "content-type": "text/html" } });
    if (url.endsWith("20260917")) return new Response("Forbidden", { status: 403 });
    const day = /day\/(\d{8})$/.exec(url)?.[1];
    const known = ["20260914", "20261012", "20261015"];
    return new Response(day && known.includes(day) ? DAY(day) : "[]", { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  const [raw] = await makeSchedulePageSource([row], fetchImpl).fetch({ startsAfter: "2026-09-10T00:00:00Z", startsBefore: "2026-10-20T00:00:00Z" } as never);
  const dayRequests = asked.filter((u) => u.startsWith(DAY_URL)).map((u) => u.slice(DAY_URL.length));
  assert.deepEqual(dayRequests.filter((d, i, all) => all.indexOf(d) === i), ["20260914", "20260917", "20261012", "20261015"], "only the table's dates in the window");
  assert.deepEqual(raw.days?.map((d) => d.date), ["2026-09-14", "2026-10-12", "2026-10-15"], "the refused day is absent, so its sitting stays date-only");
});
