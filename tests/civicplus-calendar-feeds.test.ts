import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { categoryBodyOf } from "../lib/control-plane/discovery/auto-crosswalk.ts";
import { attestationFor, wiringShapeFor } from "../lib/control-plane/discovery/derived-wiring.ts";
import { walkMeetingsDiscoveryNeed, type DiscoveryRuntime } from "../lib/control-plane/discovery/meetings-discovery-executor.ts";
import type { Artifact } from "../lib/control-plane/evidence/artifact.ts";
import type { MeetingsDiscoveryNeed } from "../lib/hunt/meetings-discovery.ts";
import { civicPlusCategoryFeeds } from "../lib/hunt/meetings-site-discovery.ts";
import { parseIcs } from "../lib/sources/ical/index.ts";
import { recordedDiscoveryOpen, type RecordedReply } from "./helpers/recorded-discovery-open.ts";

const INDEX = readFileSync("tests/fixtures/civicplus-cochise-icalendar.html", "utf8");
const BOS_ICS = readFileSync("tests/fixtures/civicplus-cochise-board-of-supervisors.ics", "utf8");
const INDEX_URL = "https://www.cochise.az.gov/iCalendar.aspx";
const BOS_FEED = "https://www.cochise.az.gov/common/modules/iCalendar/iCalendar.aspx?catID=31&feed=calendar";
const COUNTY = "az:county:county-of-cochise";

test("THE INDEX: every category calendar feed the county lists, with the name it gives it, on its own host only", () => {
  const feeds = civicPlusCategoryFeeds(INDEX, INDEX_URL);
  assert.equal(feeds.length, 25, "the county's 25 category feeds");
  assert.deepEqual(feeds.find((f) => f.name === "Board of Supervisors"), { catId: "31", name: "Board of Supervisors", url: BOS_FEED });
  assert.ok(feeds.some((f) => f.name === "Engineering & Natural Resources"), "entities are decoded");
  const extra = civicPlusCategoryFeeds(
    `<a href="https://elsewhere.org/common/modules/iCalendar/iCalendar.aspx?catID=9&feed=calendar">Board of Supervisors</a>` +
      `<a href="/common/modules/iCalendar/iCalendar.aspx?catID=8&feed=news">News Flash</a>` +
      `<a href="/common/modules/iCalendar/iCalendar.aspx?catID=7&feed=calendar"></a>` +
      `<a href="/common/modules/iCalendar/iCalendar.aspx?feed=calendar&CATID=6">City Council</a>`,
    "https://www.example.gov/iCalendar.aspx",
  );
  assert.deepEqual(extra.map((f) => [f.catId, f.name]), [["6", "City Council"]], "another host's feed, a news feed and a nameless feed are not calendars to match");
});

test("THE MATCH: only a category that is exactly the governing body's name of its kind of government names a registered body; every other is unmatched, with its reason", () => {
  const feeds = civicPlusCategoryFeeds(INDEX, INDEX_URL);
  const matched = feeds.flatMap((f) => {
    const named = categoryBodyOf(f.name, COUNTY);
    return "role" in named ? [[f.name, named.role, named.name]] : [];
  });
  assert.deepEqual(matched, [["Board of Supervisors", "GOVERNING", "Board of Supervisors"]]);
  const why = (name: string): string => {
    const named = categoryBodyOf(name, COUNTY);
    assert.ok("unmatched" in named, `${name} is left unmatched`);
    return named.unmatched;
  };
  assert.match(why("Assessor"), /prints no body's name/);
  assert.match(why("Main Calendar"), /prints no body's name/);
  assert.match(why("Clerk of the Board"), /bare "Board"|more than one body's name/);
  assert.match(why("Housing Authority"), /another government's body/);
  assert.match(why("Cochise County Justice and Care Collective"), /prints no body's name/);
  assert.match(why("Planning and Zoning Commission"), /names a sub-body/);
  assert.match(why("Board of Supervisors Meetings"), /more than one body's name/, "a category saying more than the name is not guessed at");
  assert.match(why("City Council"), /another government's body/, "a city's governing name is not a county's");
  assert.deepEqual(categoryBodyOf("County Board of Supervisors", COUNTY), { role: "GOVERNING", name: "Board of Supervisors" });
  assert.deepEqual(categoryBodyOf("City Council", "az:city:city-of-sierra-vista"), { role: "GOVERNING", name: "City Council" });
});

function runtime(replies: Readonly<Record<string, RecordedReply>>, seen: string[]): DiscoveryRuntime & { vaulted: Artifact[] } {
  const vaulted: Artifact[] = [];
  const open = recordedDiscoveryOpen(replies);
  let tick = 0;
  return {
    open: async (input) => {
      seen.push(input.url);
      assert.match(input.headers["user-agent"] ?? "", /we-the-people/, "every request identifies the project");
      return open(input);
    },
    spaceOut: async () => {},
    vault: async (artifact) => {
      vaulted.push(artifact);
      return { stored: true, where: `vault/${artifact.id}`, why: "stored" };
    },
    now: () => new Date(Date.parse("2026-09-26T05:00:00.000Z") + (tick++) * 1000).toISOString(),
    budget: { spent: () => false },
    vaulted,
  };
}

const HOME = `<html><head><title>Cochise County, AZ | Official Website</title><script src="/Common/Modules/Calendar/calendar.js"></script></head>` +
  `<body><a href="/592/Agendas-Minutes">Agendas &amp; Minutes</a></body></html>`;
const AGENDA_CENTER = `<html><body><h2>Board of Supervisors</h2><a href="/AgendaCenter/ViewFile/Agenda/_09292026-2981">Agenda</a></body></html>`;
const ROBOTS: RecordedReply = { status: 200, body: "User-agent: *\nDisallow: /admin\nDisallow: /Search\n", contentType: "text/plain" };

for (const smallPublisher of [false, true]) test(`THE WALK: a CivicPlus site's category feeds retain attribution with ${smallPublisher ? "a known small publisher's ten-request cap" : "an unknown publisher's uncapped requests"}`, async () => {
  const seen: string[] = [];
  const feeds = civicPlusCategoryFeeds(INDEX, INDEX_URL);
  const department = feeds.find(f => f.name === "Development Services")!;
  const departmentIcs = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:planning-1\r\nDTSTART;TZID=America/Phoenix:20261014T160000\r\nSUMMARY:Cochise County Planning and Zoning Commission Meeting\r\nEND:VEVENT\r\nEND:VCALENDAR";
  const rt = runtime({
    ...Object.fromEntries(feeds.map(f => [f.url, { status: 200, body: "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR", contentType: "text/calendar" }])),
    "https://www.cochise.az.gov/robots.txt": ROBOTS,
    "https://www.cochise.az.gov/": { status: 200, body: HOME },
    "https://www.cochise.az.gov/AgendaCenter": { status: 200, body: AGENDA_CENTER },
    [INDEX_URL]: { status: 200, body: INDEX },
    [department.url]: { status: 200, body: departmentIcs, contentType: "text/calendar" },
    [BOS_FEED]: { status: 200, body: BOS_ICS, contentType: "text/calendar; charset=utf-8" },
  }, seen);
  const need: MeetingsDiscoveryNeed = {
    jurisdictionId: COUNTY, stateCode: "AZ", name: "COUNTY OF COCHISE", govClass: "COUNTY", ownWebAddress: "https://www.cochise.az.gov",
    basis: "SOURCE_DISCOVERY_OWED", sources: ["MEETINGS:THIS_JURISDICTION:this-government-itself"],
    addressSource: { source: "GAP_LEDGER", versionId: "b".repeat(64) },
  };
  const attempts: Awaited<ReturnType<typeof walkMeetingsDiscoveryNeed>>[] = [];
  for (let pass = 0; pass < 4; pass++) attempts.push(await walkMeetingsDiscoveryNeed(need, {
    ...rt,
    // Synthetic size metadata exercises both policies against the same recorded routes.
    websiteSize: smallPublisher ? () => ({ kind: "local-government", population: 9999 }) : undefined,
    priorAttempts: [...attempts],
  }));
  const attempt = attempts[0];
  if (smallPublisher) assert.ok(attempts.every(a => a.requestCount <= 10), "known small publishers retain the ten-request limit");
  else assert.ok(attempt.requestCount > 10, "unknown publishers can read beyond ten requests in one walk");
  assert.deepEqual(seen.slice(0, 3), ["https://www.cochise.az.gov/robots.txt", "https://www.cochise.az.gov/", INDEX_URL]);
  assert.ok(feeds.every(f => seen.includes(f.url)), "later walks read every category, including those beyond the original cutoffs");
  if (smallPublisher) assert.equal(attempt.recheckAfter, attempt.finishedAt, "unread source routes remain due instead of waiting for the successful feed's recheck");
  const departmentFind = attempts.flatMap(a => a.found).find(f => f.url === department.url);
  assert.ok(departmentFind, "a department calendar's named commission meeting remains discoverable");
  assert.match(departmentFind.evidence, /category is not a body attribution/);
  assert.equal(departmentFind.count, 1);
  assert.equal(attempt.outcome, "FOUND");
  const feed = attempt.found.find((f) => f.url === BOS_FEED);
  assert.ok(feed !== undefined, "the Board of Supervisors feed is a find");
  assert.equal(feed.vendor, "ical");
  assert.equal(feed.count, 5);
  assert.match(feed.evidence, /"Board of Supervisors" \(catID 31\).*governing body/);
  const indexStep = attempt.steps.find((s) => s.url === INDEX_URL)!;
  assert.deepEqual(feed.via, { page: INDEX_URL, artifactId: indexStep.artifactId }, "the feed names the index that linked it");
  const index = attempt.leads.find((l) => l.vendor === "civicplus-icalendar");
  assert.ok(index !== undefined, "the index is recorded, so the feed's attestation chains through it");
  assert.match(index.detail, /25 category feed\(s\); proposed as the governing body's: "Board of Supervisors" \(catID 31\)/);
  assert.match(index.detail, /"Housing Authority" reads as another government's body \(catID 41\)/);
  assert.match(index.detail, /"Assessor" prints no body's name/);

  const attested = attestationFor(attempt, feed);
  assert.ok("attestation" in attested, `attested: ${JSON.stringify(attested)}`);
  assert.equal(attested.attestation.kind, "LINKED_FROM_ATTESTED_PAGE");
  assert.deepEqual(wiringShapeFor(feed), { kind: "ICAL", endpoint: { feedUrl: BOS_FEED } }, "the ICAL wiring takes the feed");
  assert.equal(parseIcs(BOS_ICS).length, 5, "the ICAL adapter's own parser reads the feed's five events");
});

test("NOT CIVICPLUS, NO INDEX: a site whose markup shows no CivicPlus is never asked for /iCalendar.aspx", async () => {
  const seen: string[] = [];
  const rt = runtime({
    "https://www.plain.gov/robots.txt": ROBOTS,
    "https://www.plain.gov/": { status: 200, body: `<a href="/meetings.ics">Meetings</a>` },
    "https://www.plain.gov/meetings.ics": { status: 200, body: BOS_ICS, contentType: "text/calendar" },
  }, seen);
  const attempt = await walkMeetingsDiscoveryNeed({
    jurisdictionId: "az:city:city-of-plain", stateCode: "AZ", name: "CITY OF PLAIN", govClass: "CITY_OR_TOWN", ownWebAddress: "https://www.plain.gov",
    basis: "SOURCE_DISCOVERY_OWED", sources: [],
  }, rt);
  assert.ok(!seen.some((u) => /iCalendar\.aspx/i.test(u)));
  assert.ok(!attempt.leads.some((l) => l.vendor === "civicplus-icalendar"));
});

test("AN INDEX THAT CANNOT BE READ IS A LEAD THAT SAYS SO, AND THE WALK GOES ON", async () => {
  const seen: string[] = [];
  const rt = runtime({
    "https://www.cochise.az.gov/robots.txt": ROBOTS,
    "https://www.cochise.az.gov/": { status: 200, body: HOME },
    "https://www.cochise.az.gov/AgendaCenter": { status: 200, body: AGENDA_CENTER },
    [INDEX_URL]: { status: 500, body: "server error" },
  }, seen);
  const attempt = await walkMeetingsDiscoveryNeed({
    jurisdictionId: COUNTY, stateCode: "AZ", name: "COUNTY OF COCHISE", govClass: "COUNTY", ownWebAddress: "https://www.cochise.az.gov",
    basis: "SOURCE_DISCOVERY_OWED", sources: [],
  }, rt);
  assert.deepEqual(attempt.leads.filter((l) => l.vendor === "civicplus-icalendar").map((l) => l.detail), ["the route could not be read this walk"]);
  assert.deepEqual(attempt.found.map((f) => f.vendor), ["civicplus-agendacenter"], "the AgendaCenter is still confirmed");
});
