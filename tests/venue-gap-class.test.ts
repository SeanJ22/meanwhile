import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { readCuratedReaderProjection } from "../lib/civic-data/curated-reader-read-model.ts";
import {
  manualProjectionCandidate,
  type ManualProjectionPackage,
} from "../lib/civic-data/manual-projections.ts";
import { processRegisteredManualCandidate } from "../lib/civic-data/promotion.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import {
  VENUE_CACHE,
  currentVenueCache,
  reviewedVenueEntries,
  venueResolutionRecordId,
  type VenueEntry,
} from "../lib/meetings/venue-cache.ts";
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
const MESA = "ocd-division/country:us/state:az/place:mesa";
const PIMA_BODY = `${PIMA}#governing`;
const PIMA_CLERK = "Pima County Clerk of the Board";
const MESA_CLERK = "City of Mesa City Clerk";

/** The standing runner's own query (scripts/ingest.ts): the continental US. */
const RUNNER_QUERY = { lat: 39.5, lng: -98.35, radiusKm: 5000 };

/** The three Legistar/InSite rooms production's table left out. */
const LEGISTAR_ROOMS = VENUE_CACHE.filter((row) => row.sourceId === "legistar" || row.sourceId === "legistar-insite");

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

/** Promote through the registered manual door, then read through the canonical read; the door leaves out any row with no review time. */
async function promoteVenueTable(rows: readonly VenueEntry[]): Promise<readonly string[]> {
  const store = new MemoryRoutineDataStore();
  // Every row cites its address page and its geocoder call; the door admits a
  // row only when each URL it cites is in the reviewed receipt.
  const cited = new Map<string, "OFFICIAL_PUBLISHER" | "REFERENCE_PUBLISHER">();
  for (const row of rows) {
    cited.set(row.addressSourceUrl, "OFFICIAL_PUBLISHER");
    cited.set(row.coordinateSourceUrl, "REFERENCE_PUBLISHER");
  }
  const pkg: ManualProjectionPackage = {
    contractId: "venue-resolutions",
    version: AT,
    sourceThrough: AT,
    sourceReceipt: {
      contractVersion: 1,
      reviewedAt: AT,
      reviewedBy: "venue-gap-class-test",
      sources: [...cited].map(([url, sourceClass]) => ({
        requestedUrl: url,
        finalUrl: url,
        publisher: "The row's own cited publisher",
        sourceClass,
        retrievedAt: AT,
        httpStatus: 200,
        rawHash: "a".repeat(64),
        reviewedEvidence: "The venue table and its cited sources were reviewed together.",
      })),
    },
    payload: {
      kind: "venue-resolutions",
      records: rows.map((row) => ({ id: venueResolutionRecordId(row), ...row })),
    },
  };
  const outcome = await processRegisteredManualCandidate(
    store,
    "venue-resolutions",
    manualProjectionCandidate(pkg),
    AT,
  );
  assert.equal(outcome.candidate.state, "PROMOTED", "the venue table promoted");
  const read = await readCuratedReaderProjection("venue-resolutions", { store, bypassCache: true, now: AT });
  assert.equal(read.kind, "PROMOTED", "the canonical read answered");
  return read.kind === "PROMOTED" ? read.value.records.map((record) => record.id) : [];
}

/** Production's table: every reviewed row, and so not the three Legistar rooms. */
const promoteProductionTable = () => promoteVenueTable(VENUE_CACHE.filter((row) => row.verifiedAt !== null));
/** The same table with the three rooms reviewed. */
const promoteRestoredTable = () =>
  promoteVenueTable(VENUE_CACHE.map((row) => (LEGISTAR_ROOMS.includes(row) ? { ...row, verifiedAt: "2026-09-23" } : row)));

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

test("production's table: the three Legistar rooms cannot pass the door, and an empty scope is a list, never a throw", async () => {
  // The door refuses a package that holds an unreviewed row, whole — which is
  // why production's table was promoted without the three rooms.
  await assert.rejects(promoteVenueTable(VENUE_CACHE), /the venue table promoted/);
  assert.deepEqual(
    LEGISTAR_ROOMS.map((room) => room.verifiedAt),
    [null, null, null],
    "the three rooms are the unreviewed ones",
  );
  const ids = await promoteProductionTable();
  for (const room of LEGISTAR_ROOMS) {
    assert.ok(!ids.includes(venueResolutionRecordId(room)), `${room.match} reached the promoted table`);
  }
  assert.equal(ids.length, VENUE_CACHE.length - LEGISTAR_ROOMS.length, "every reviewed row did");
  assert.equal(currentVenueCache().length, ids.length, "the canonical read serves the promoted table");

  assert.deepEqual(reviewedVenueEntries("legistar", PIMA), []);
  assert.deepEqual(reviewedVenueEntries("legistar-insite", MESA), []);
  const pima = legistarClientsFromWiring().find((client) => client.slug === "pima")!;
  assert.doesNotThrow(() => pima.venues, "the old VENUE_RESOLUTIONS_MISSING throw");
  assert.equal(pima.venues.length, 0);
  for (const tenant of inSiteTenantsFromWiring()) {
    assert.doesNotThrow(() => tenant.venues, tenant.slug);
    assert.equal(tenant.venues.length, 0, tenant.slug);
  }
});

test("(a) Pima County Legistar, rooms left out: the partition reads, publishes every sitting with the county's words, drops none", async () => {
  await promoteProductionTable();
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
  await promoteProductionTable();
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
  // The disposition stays an OPEN obligation: the room still owes a reviewed row.
  assert.ok(result.openObligations.some((d) => d.verdict === "VENUE_NOT_RESOLVED"));
});

test("(a) Mesa InSite, rooms left out: the tenant is read on the runner's own query, not skipped", async () => {
  await promoteProductionTable();
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
  await promoteProductionTable();
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

test("(b) Pima County Legistar, rooms restored: the same sittings are placed exactly as before", async () => {
  await promoteRestoredTable();
  const { meetings, report } = await pimaLegistarPartition();
  assert.equal(report.ok, true);
  assert.equal(report.drops.unknownVenue, 0);
  const placed = Object.fromEntries(meetings.filter((m) => m.location).map((m) => [m.id.split(":").pop(), m.location]));
  const expected: Record<string, MeetingLocation> = Object.fromEntries([
    ...["1801", "1802", "1803", "1804", "1816", "1817", "1820", "1821", "1822", "1823", "1824", "1858", "1869"]
      .map((id) => [id, HEARING_ROOM] as const),
    ["1854", BROADWAY] as const,
  ]);
  assert.deepEqual(placed, expected, "the pre-change placements, pinned");
  assert.ok(meetings.every((m) => m.venueGap === undefined), "no gap where a reviewed room exists");
  assert.equal(meetings.filter((m) => m.online).length, 4);
});

test("(b) Pima County and Mesa InSite, rooms restored: the same sittings are placed exactly as before", async () => {
  await promoteRestoredTable();
  const tenants = inSiteTenantsFromWiring();

  const pima = insiteNormalize([PIMA_READING], INSITE_NOW, tenants);
  const pimaPlaced = pima.meetings.filter((m) => m.location);
  assert.equal(pimaPlaced.length, 29, "twenty-six in the 90-day window and three more the held window adds (DB-03)");
  assert.equal(pimaPlaced.filter((m) => m.id === "legistar-insite:pima:1417572").length, 1);
  for (const m of pimaPlaced) {
    assert.deepEqual(m.location, m.id === "legistar-insite:pima:1417572" ? BROADWAY : HEARING_ROOM, m.id);
  }
  assert.equal(pima.drops.unknownVenue, 0);
  assert.ok(pima.meetings.every((m) => m.venueGap === undefined));

  const mesa = insiteNormalize([MESA_READING], INSITE_NOW, tenants);
  const mesaPlaced = mesa.meetings.filter((m) => m.location);
  assert.deepEqual(
    mesaPlaced.map((m) => m.id.split(":").pop()).sort(),
    ["1336055", "1336056", "1336057", "1336058", "1336059", "1336060", "1336061", "1336063", "1336064", "1336065", "1336069", "1408112"],
    "the ten Council Chambers sittings the recorded grid placed before this change, and 1336063 and 1336064 the held window (DB-03) adds",
  );
  for (const m of mesaPlaced) assert.deepEqual(m.location, MESA_CHAMBERS, m.id);
  // The twenty sittings held in unreviewed rooms are still published, with the grid's own words.
  assert.equal(mesa.meetings.length - mesaPlaced.length, 27);
  assert.equal(mesa.drops.unknownVenue, 27);
});
