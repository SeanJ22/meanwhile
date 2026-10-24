import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { placePublishedMeetingPins } from "../lib/meetings/publish-pins.ts";
import { buildCompositeSource } from "../lib/sources/composite/wiring.ts";
import { legistarClientsFromWiring } from "../lib/sources/legistar/client-registry.ts";
import {
  normalizeWithDrops as legistarNormalize,
  type LegistarEventWithClient,
} from "../lib/sources/legistar/index.ts";
import type { LegistarEvent } from "../lib/sources/legistar/types.ts";
import {
  parseGridNoRecords,
  parseGridPager,
  type InSiteRange,
} from "../lib/sources/legistar-insite/calendar.ts";
import {
  makeLegistarInSiteSource,
  normalizeWithDrops as insiteNormalize,
  type LegistarInSiteRaw,
} from "../lib/sources/legistar-insite/index.ts";
import { inSiteTenantsFromWiring } from "../lib/sources/legistar-insite/tenant-registry.ts";
import type { Meeting, MeetingLocation } from "../lib/sources/types.ts";

const FIXTURES = join(import.meta.dirname, "fixtures");
const fixture = (name: string) => readFileSync(join(FIXTURES, name), "utf8");

const AT = "2026-09-23T20:00:00.000Z";
const PIMA = "ocd-division/country:us/state:az/county:pima";
const PIMA_BODY = `${PIMA}#governing`;
const PIMA_CLERK = "Pima County Clerk of the Board";
const MESA_CLERK = "City of Mesa City Clerk";

/** The standing runner's own query (scripts/ingest.ts): the continental US. */
const RUNNER_QUERY = { lat: 39.5, lng: -98.35, radiusKm: 5000 };

const HEARING_ROOM: MeetingLocation = {
  name: "Pima County Administration Building, Board of Supervisors Hearing Room",
  address: "130 W. Congress St. 1st Floor, Tucson, AZ 85701",
  lat: 32.221618,
  lng: -110.974036,
};
const BROADWAY: MeetingLocation = {
  name: "1 E. Broadway Blvd, 4th Floor",
  address: "1 E. Broadway Blvd, Tucson, AZ 85701",
  lat: 32.221075,
  lng: -110.971059,
};
const MESA_CHAMBERS: MeetingLocation = {
  name: "Mesa City Hall, Council Chambers",
  address: "20 E. Main Street, Mesa, AZ 85201",
  lat: 33.415155,
  lng: -111.830942,
};

const EVENTS = JSON.parse(fixture("legistar-pima-events.json")) as LegistarEvent[];
const LEGISTAR_NOW = new Date("2026-08-12T22:00:00.000Z");

/** The Legistar partition as the runner builds it, acquiring the recorded /events response through a stubbed transport. */
async function pimaLegistarPartition(): Promise<{
  meetings: Meeting[];
  report: NonNullable<ReturnType<typeof buildCompositeSource>["lastReport"]>["children"][number];
  requested: string[];
}> {
  const composite = buildCompositeSource({
    sourceNames: ["legistar"],
    meetingPartitions: [{ sourceName: "legistar", bodyId: PIMA_BODY }],
  });
  const requested: string[] = [];
  const prior = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = input instanceof Request ? input.url : String(input);
    requested.push(url);
    const body = /\/v1\/pima\/events\?/.test(url)
      ? EVENTS
      : /\/v1\/pima\/events\/\d+\/eventitems/.test(url)
        ? []
        : null;
    if (body === null) throw new Error(`no recorded response for ${url}`);
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  try {
    const raw = await composite.fetch(RUNNER_QUERY);
    const meetings = composite.normalize(raw, LEGISTAR_NOW);
    const report = composite.lastReport?.children.find((child) => child.source === "legistar");
    assert.ok(report, "the partition reported");
    return { meetings, report, requested };
  } finally {
    globalThis.fetch = prior;
  }
}

function win(range: InSiteRange, html: string, pages: LegistarInSiteRaw["windows"][number]["pages"] = []) {
  return { range, rendered: range, html, pager: parseGridPager(html), pages, noRecords: parseGridNoRecords(html) };
}

const INSITE_NOW = new Date("2026-08-28T12:00:00Z");
const PIMA_READING: LegistarInSiteRaw = {
  slug: "pima",
  calendarUrl: "https://pima.legistar.com/Calendar.aspx",
  windows: [
    win("Last Month", fixture("legistar-insite-pima-calendar-last-month.html")),
    win("This Month", fixture("legistar-insite-pima-calendar-this-month.html")),
    win("Next Month", fixture("legistar-insite-pima-calendar-next-month.html")),
    win("This Year", fixture("legistar-insite-pima-calendar-this-year.html")),
    win("Next Year", fixture("legistar-insite-pima-calendar-next-year.html")),
  ],
  feedXml: fixture("legistar-insite-pima-feed-this-year.xml"),
  feedUrl: "https://pima.legistar.com/Feed.ashx?M=Calendar",
  icalByInsiteId: {},
  clerkScheduleHtml: fixture("legistar-insite-pima-clerk-schedule.html"),
  clerkScheduleUrl: "https://www.pima.gov/2559/Board-of-Supervisors-Meeting-Schedule",
  collectedAt: "2026-08-28T18:30:00.000Z",
};
const MESA_NEXT_MONTH = fixture("legistar-insite-mesa-calendar-next-month.html");
const MESA_PAGE_2 = fixture("legistar-insite-mesa-calendar-this-year-page2.html");
const MESA_READING: LegistarInSiteRaw = {
  slug: "mesa",
  calendarUrl: "https://mesa.legistar.com/Calendar.aspx",
  windows: [
    win("Next Month", MESA_NEXT_MONTH),
    win("This Year", fixture("legistar-insite-mesa-calendar-this-year-paged.html"), [
      { page: 2, html: MESA_PAGE_2, pager: parseGridPager(MESA_PAGE_2) },
    ]),
  ],
  feedXml: null,
  feedUrl: null,
  icalByInsiteId: {},
  clerkScheduleHtml: null,
  clerkScheduleUrl: null,
  collectedAt: "2026-08-28T18:30:00.000Z",
};

/** Every sitting with no room is either online or carries a named venue gap. */
function assertNamedGaps(meetings: Meeting[], publisher: string): Meeting[] {
  const unplaced = meetings.filter((m) => m.location === null && !m.online);
  for (const m of unplaced) {
    assert.equal(m.venueGap?.kind, "STATED_NOT_PLACED", `${m.id} carries no stated venue gap`);
    assert.equal(m.venueGap?.publisher, publisher, m.id);
  }
  for (const m of meetings.filter((x) => x.online)) assert.equal(m.venueGap, undefined, `${m.id} is online AND a venue gap`);
  return unplaced;
}

test("(a) Pima County Legistar, rooms left out: the partition reads, publishes every sitting with the county's words, drops none", async () => {
  const { meetings, report, requested } = await pimaLegistarPartition();

  assert.ok(
    requested.some((url) => url.startsWith("https://webapi.legistar.com/v1/pima/events?")),
    "the client was read, not skipped for want of a reviewed coordinate",
  );
  assert.equal(report.ok, true, `the partition failed: ${report.error}`);
  assert.equal(report.fetched, EVENTS.length);
  assert.equal(report.normalized, EVENTS.length, "every sitting is published");
  assert.equal(meetings.length, EVENTS.length);
  assert.equal(report.drops.placeless, 4, "the four virtual sittings stay online");
  assert.equal(report.drops.unknownVenue, 14, "each unplaced room is counted for the venue hunt");

  const unplaced = assertNamedGaps(meetings, PIMA_CLERK);
  assert.equal(unplaced.length, 14);
  const byId = new Map(EVENTS.map((event) => [`legistar:pima:${event.EventId}`, event]));
  for (const m of unplaced) {
    assert.equal(m.venueGap?.publishedText, byId.get(m.id)!.EventLocation!.trim(), `${m.id}: not the county's words`);
  }
  assert.deepEqual(
    [...new Set(unplaced.map((m) => m.venueGap?.publishedText))].sort(),
    ["1 E. Broadway, 4th Floor", "Board of Supervisors' Hearing Room"],
  );

  // Conservation: counted and produced, never a drop.
  const clients = legistarClientsFromWiring();
  const raw: LegistarEventWithClient[] = EVENTS.map((event) => ({ event, slug: "pima", collectedAt: AT, items: null }));
  const { accounting } = legistarNormalize(raw, LEGISTAR_NOW, clients);
  assert.equal(accounting.outcome, "CONSERVED");
  assert.equal(accounting.dropped, 0, "0 dropped");
});

test("(a) Pima County Legistar InSite, rooms left out: every grid sitting is published with the grid's words, drops none", async () => {
  const tenants = inSiteTenantsFromWiring().filter((tenant) => tenant.slug === "pima");
  const result = insiteNormalize([PIMA_READING], INSITE_NOW, tenants);
  assert.equal(result.accounting.outcome, "CONSERVED");
  assert.equal(result.accounting.dropped, 0, "0 dropped");
  // The forward window is 120 days.
  assert.equal(result.meetings.length, 34, "the thirty sittings the 90-day window published, and the four the held window adds");
  const unplaced = assertNamedGaps(result.meetings, PIMA_CLERK);
  assert.equal(unplaced.length, 29);
  assert.equal(result.drops.unknownVenue, 29);
  assert.deepEqual(
    [...new Set(unplaced.map((m) => m.venueGap?.publishedText))].sort(),
    ["1 E. Broadway, 4th Floor", "Board of Supervisors' Hearing Room"],
  );
  // The adapter names its unresolved place; publication will try the source text and offices.
  assert.ok(result.openObligations.some((d) => d.verdict === "VENUE_NOT_RESOLVED"));
});

test("(a) Mesa InSite, rooms left out: the tenant is read on the runner's own query, not skipped", async () => {
  const tenants = inSiteTenantsFromWiring().filter((tenant) => tenant.slug === "mesa");
  const hosts: string[] = [];
  const fetchImpl = (async (url: string | URL) => {
    hosts.push(new URL(String(url)).host);
    return new Response(MESA_NEXT_MONTH, { status: 200, headers: { "content-type": "text/html" } });
  }) as unknown as typeof fetch;
  const source = makeLegistarInSiteSource({ fetchImpl, tenants });
  const raw = await source.fetch(RUNNER_QUERY);
  assert.equal(raw.length, 1, "Mesa's tenant produced a reading");
  assert.ok(hosts.includes("mesa.legistar.com"));
  const meetings = source.normalize(raw, INSITE_NOW);
  assert.ok(meetings.length > 0);
  assertNamedGaps(meetings, MESA_CLERK);
  assert.ok(meetings.every((m) => m.location === null), "no reviewed room, so no pin");
});

test("(a) Mesa InSite, rooms left out: every City Council sitting is published with the grid's words, drops none", async () => {
  const tenants = inSiteTenantsFromWiring().filter((tenant) => tenant.slug === "mesa");
  const result = insiteNormalize([MESA_READING], INSITE_NOW, tenants);
  assert.equal(result.accounting.outcome, "CONSERVED");
  assert.equal(
    result.accounting.dropped,
    result.drops.notConfigured,
    "the only rows set aside are other bodies' on the shared grid",
  );
  assert.equal(result.drops.unplaceableInTime, 0);
  // The forward window is 120 days.
  assert.equal(result.meetings.length, 39, "the ten Council Chambers sittings and the twenty-nine held elsewhere");
  const unplaced = assertNamedGaps(result.meetings, MESA_CLERK);
  assert.equal(unplaced.length, 39);
  assert.equal(result.drops.unknownVenue, 39);
  assert.deepEqual(
    [...new Set(unplaced.map((m) => m.venueGap?.publishedText))].sort(),
    ["Council Chambers", "Inspirian Room at Gateway Library", "Piper Theater at the Mesa Arts Center", "Study Session"],
    "the grid's own location cells, verbatim",
  );
});

test("a fresh API read retains every previously published point for the same sitting and venue", async () => {
  const {meetings} = await pimaLegistarPartition();
  const previous = meetings.map(meeting=>meeting.online ? meeting : {...meeting,venueGap:undefined,
    location:meeting.id.endsWith(":1854") ? BROADWAY : HEARING_ROOM});
  const result = await placePublishedMeetingPins({meetings,previous,offices:new Map(),fetchImpl:async()=>{throw new Error("existing venue must retain its point");}});
  assert.deepEqual(result.meetings.map(meeting=>meeting.id),previous.map(meeting=>meeting.id));
  assert.deepEqual(result.meetings.map(meeting=>meeting.location),previous.map(meeting=>meeting.location));
  assert.equal(result.responses.length,0);
});

test("fresh InSite reads retain existing Pima and Mesa pins without rebuilding a venue list", async () => {
  const tenants = inSiteTenantsFromWiring();
  for(const reading of [PIMA_READING,MESA_READING]) {
    const {meetings} = insiteNormalize([reading],INSITE_NOW,tenants);
    const previous = meetings.map(meeting=>{
      const text=meeting.venueGap?.publishedText;
      const location = text==="Board of Supervisors' Hearing Room" ? HEARING_ROOM : text==="1 E. Broadway, 4th Floor" ? BROADWAY
        : text==="Council Chambers" ? MESA_CHAMBERS : null;
      return location ? {...meeting,location,venueGap:undefined} : meeting;
    });
    const result = await placePublishedMeetingPins({meetings,previous,offices:new Map(),fetchImpl:async()=>{throw new Error("no source address to geocode");}});
    assert.deepEqual(result.meetings.map(meeting=>meeting.id),previous.map(meeting=>meeting.id));
    assert.deepEqual(result.meetings.map(meeting=>meeting.location),previous.map(meeting=>meeting.location));
  }
});
