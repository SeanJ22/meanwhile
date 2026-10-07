import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { wiringForTypes } from "../lib/registry/source-wiring.ts";
import { makeSchedulePageSource, parseDatedList, parseDayEvents, parseStatedTime, scheduledOfDay, sliceSection } from "../lib/sources/schedulepage/index.ts";
import { destinyMonthUrl, destinyMonthsBetween, joinDestinyRows, parseDestinyMonth } from "../lib/sources/schedulepage/destiny-agenda.ts";

/** Recorded city pages; no live calls. The schedule table states no times, so none is claimed. */
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

const DESTINY = (m: string) => readFileSync(new URL(`./fixtures/schedulepage/chandler-destiny-cc-${m}.html`, import.meta.url), "utf8");
const DESTINY_BASE = "https://public.destinyhosted.com/agenda_publish.cfm?id=24263&mt=CC";
const destinyMonth = (m: string) => {
  const [y, mo] = m.split("-").map(Number);
  return { month: m, url: destinyMonthUrl(DESTINY_BASE, y, mo), html: DESTINY(m) };
};

test("DESTINY: the September list is seven Council sittings, each with its agenda page, and the results and video where posted", () => {
  const month = parseDestinyMonth(DESTINY("2026-09"), destinyMonthUrl(DESTINY_BASE, 2026, 9));
  assert.equal(month.read, true);
  assert.equal(month.undated, 0);
  assert.deepEqual(
    month.rows.map((r) => [r.date, r.title]),
    [
      ["2026-09-17", "City Council Regular Meeting"],
      ["2026-09-17", "City Council Special Meeting Executive Session"],
      ["2026-09-17", "City Council Work Session"],
      ["2026-09-14", "City Council Regular Meeting"],
      ["2026-09-14", "City Council Special Meeting Executive Session"],
      ["2026-09-14", "City Council Study Session"],
      ["2026-09-14", "City Council Work Session"],
    ],
  );
  const regular = month.rows[0];
  assert.equal(regular.agendaUrl, "https://public.destinyhosted.com/agenda_publish.cfm?id=24263&mt=CC&get_month=9&get_year=2026&dsp=ag&seq=2440", "the encoded href decodes to the agenda page");
  assert.deepEqual(regular.links, [
    { label: "Results", href: "https://public.destinyhosted.com/chanddocs/2026/CC/20260917_2444/2440_City-of-Chandler-City-Council-Regular-Meeting-Results-September-17-2026.pdf" },
    { label: "Video", href: "https://chandleraz.new.swagit.com/videos/401450" },
  ]);
  assert.deepEqual(month.rows[1].links, [], "an empty minutes cell is no link");
});

test("DESTINY: a month the list says is empty is read and empty; a page that is not the list is unread, never empty", () => {
  const october = parseDestinyMonth(DESTINY("2026-10"), destinyMonthUrl(DESTINY_BASE, 2026, 10));
  assert.deepEqual(october, { read: true, rows: [], undated: 0 });
  assert.equal(parseDestinyMonth("[]", DESTINY_BASE).read, false);
  assert.equal(parseDestinyMonth(PAGE, DESTINY_BASE).read, false, "the city's own page is not the Destiny list");
  const months = new Map([["2026-10", october]]);
  assert.equal(joinDestinyRows(months, "2026-10-12", null), "EMPTY");
  assert.equal(joinDestinyRows(months, "2026-11-09", null), null, "a month not read says nothing");
});

test("DESTINY: the months read run from the window's start to 35 days ahead, across a year's end", () => {
  assert.deepEqual(destinyMonthsBetween(Date.parse("2026-09-18T00:00:00Z"), Date.parse("2026-10-30T00:00:00Z")), [
    { year: 2026, month: 9 },
    { year: 2026, month: 10 },
  ]);
  assert.deepEqual(
    destinyMonthsBetween(Date.parse("2026-11-28T00:00:00Z"), Date.parse("2027-01-05T00:00:00Z")).map((m) => `${m.year}-${m.month}`),
    ["2026-11", "2026-12", "2027-1"],
  );
  assert.deepEqual(destinyMonthsBetween(2, 1), []);
  assert.equal(destinyMonthUrl(DESTINY_BASE, 2026, 9), `${DESTINY_BASE}&get_month=9&get_year=2026`);
});

test("NORMALIZE with DESTINY: each dated sitting carries its own agenda, results and video; a month read with nothing marks the slot empty", () => {
  const row = wiring();
  assert.equal(row.config.destinyAgenda, DESTINY_BASE);
  const { meetings } = makeSchedulePageSource([row]).normalizeWithDrops(
    [
      {
        wiring: row,
        schedule: PAGE,
        days: ["2026-09-14", "2026-09-17", "2026-10-12", "2026-10-15"].map(dayFile),
        destiny: [destinyMonth("2026-09"), destinyMonth("2026-10")],
        collectedAt: NOW.toISOString(),
      },
    ],
    NOW,
  );
  const on = (date: string, title: string) => meetings.find((m) => m.id.includes(`:${date}`) && m.title === title);
  const agendaSeq = (m: { agendaUrl: string | null } | undefined) => /seq=(\d+)$/.exec(m?.agendaUrl ?? "")?.[1];
  assert.equal(agendaSeq(on("2026-09-14", "City Council Regular Meeting")), "2410");
  assert.equal(agendaSeq(on("2026-09-14", "City Council Work Session")), "2409");
  assert.equal(agendaSeq(on("2026-09-14", "City Council Study Session")), "2373");
  assert.equal(agendaSeq(on("2026-09-14", "City Council Special Meeting Executive Session")), "2425");
  assert.equal(agendaSeq(on("2026-09-17", "City Council Regular Meeting")), "2440");
  const regular = on("2026-09-17", "City Council Regular Meeting")!;
  assert.deepEqual(regular.publishedLinks?.map((l) => l.label), ["Results", "Video"]);
  assert.match(regular.provenance.sourceUrl ?? "", /^https:\/\/www\.chandleraz\.gov\/events\/city-council-regular-meeting/, "the sitting is still the city's own; Destiny adds documents, not the sitting");
  for (const date of ["2026-10-12", "2026-10-15"]) {
    const only = meetings.filter((m) => m.id.includes(`:${date}`));
    assert.equal(only.length, 1);
    assert.equal(only[0].agendaUrl, null);
    assert.equal(only[0].agendaSlotObservedEmpty, true, `${date}: the Council's October list was read and names nothing yet`);
  }
});

test("NORMALIZE with DESTINY: a date-only sitting joins only a date the list gives one row; four rows on a date join none", () => {
  const row = wiring();
  const { meetings } = makeSchedulePageSource([row]).normalizeWithDrops(
    [{ wiring: row, schedule: PAGE, destiny: [destinyMonth("2026-09")], collectedAt: NOW.toISOString() }],
    NOW,
  );
  const sept14 = meetings.filter((m) => m.id.includes(":2026-09-14"));
  assert.equal(sept14.length, 1, "without the day file the table's date is one date-only sitting");
  assert.equal(sept14[0].agendaUrl, null, "four Council rows on 14 September: which agenda is this sitting's is not known");
  assert.equal(sept14[0].agendaSlotObservedEmpty, undefined, "an ambiguous date is not an empty slot");
});

test("FETCH with DESTINY: one list request per month in reach, and a refused month keeps the schedule", async () => {
  const row = wiring();
  const asked: string[] = [];
  const fetchImpl = (async (input: string | URL) => {
    const url = String(input);
    asked.push(url);
    if (url === row.config.schedulePage) return new Response(PAGE, { status: 200, headers: { "content-type": "text/html" } });
    if (url.startsWith(DESTINY_BASE)) {
      if (url.includes("get_month=10")) return new Response("Not Found", { status: 404 });
      return new Response(DESTINY("2026-09"), { status: 200, headers: { "content-type": "text/html" } });
    }
    return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  const [raw] = await makeSchedulePageSource([row], fetchImpl).fetch({ startsAfter: "2026-09-10T00:00:00Z", startsBefore: "2026-10-20T00:00:00Z" } as never);
  assert.deepEqual(
    asked.filter((u) => u.startsWith(DESTINY_BASE)),
    [`${DESTINY_BASE}&get_month=9&get_year=2026`, `${DESTINY_BASE}&get_month=10&get_year=2026`],
  );
  assert.equal(raw.error, undefined, "a refused Destiny month is not the row refused");
  assert.deepEqual(raw.destiny?.map((m) => m.month), ["2026-09"]);
});
