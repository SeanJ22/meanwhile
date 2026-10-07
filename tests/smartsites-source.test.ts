import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  calendarApiUrl,
  makeSmartSitesSource,
  type SmartSitesEvent,
} from "../lib/sources/smartsites/index.ts";
import type { BodySourceWiring } from "../lib/registry/source-wiring.ts";

/**
 * ParentSquare SmartSites, against a recorded district calendar
 * (tests/fixtures/smartsites/retrieval.json). Built and NOT wired: this proves
 * what the route carries and what it does not (no per-sitting place).
 */

const FIXTURES = join(import.meta.dirname, "fixtures", "smartsites");
const RETRIEVAL = JSON.parse(readFileSync(join(FIXTURES, "retrieval.json"), "utf8")) as Record<string, { url: string }>;
const BODY = JSON.parse(readFileSync(join(FIXTURES, "susd12-calendar-150042-events.json"), "utf8")) as {
  success: boolean;
  data: { events: SmartSitesEvent[]; site_timezone: string };
};

// Built for the test only — no SOURCE_WIRING row names this adapter.
const WIRING: BodySourceWiring = {
  bodyId: "ocd-division/country:us/state:az/school_district:sunnyside_unified_district#board",
  ocdId: "ocd-division/country:us/state:az/school_district:sunnyside_unified_district",
  agendaSourceType: "SMARTSITES",
  jurisdiction: "Sunnyside Unified School District, AZ",
  publishingOrg: "Sunnyside Unified School District Governing Board",
  timeZone: "America/Phoenix",
  config: {
    slug: "susd12",
    siteBase: "https://www.susd12.org",
    calendarApiId: "150042",
    titlePattern: "Governing Board",
    titleExcludePattern: "Employee Benefits? Trust",
    bodyName: "Governing Board",
    venueSourceId: "diligent",
  },
  verifiedAt: "2026-09-23",
};
const NOW = new Date("2026-09-23T13:00:00-07:00");
const RAW = [{
  wiring: WIRING,
  url: RETRIEVAL["susd12-calendar-150042-events.json"].url,
  collectedAt: "2026-09-23T20:07:00.000Z",
  events: BODY.data.events,
}];

/**
 * The twelve sittings held from the district's Diligent tenant, as Phoenix wall
 * clocks. The calendar must carry each one.
 */
const HELD_FROM_DILIGENT = [
  "2026-07-07T16:30", "2026-07-28T18:30", "2026-08-04T11:30", "2026-08-11T18:30",
  "2026-08-25T18:15", "2026-09-08T11:30", "2026-09-29T18:30", "2026-10-13T18:30",
  "2026-10-27T18:30", "2026-11-10T18:30", "2026-11-24T18:30", "2026-12-08T18:30",
];

test("the recorded payload is a success envelope configured in the wrong zone", () => {
  assert.equal(BODY.success, true);
  assert.equal(BODY.data.site_timezone, "America/Denver", "the tenant setting this adapter refuses to trust");
  const jul7 = BODY.data.events.find((e) => e.start_date === "2026-07-07")! as SmartSitesEvent & { start_datetime?: string };
  assert.equal(jul7.start_time, "16:30:00");
  assert.equal(jul7.start_datetime, "2026-07-07T16:30:00-06:00", "the payload's offset is MDT, not Arizona");
});

test("the API URL is the calendar component's own call on the district origin", () => {
  assert.equal(
    calendarApiUrl(WIRING.config, new Date("2026-06-25T00:00:00Z"), new Date("2026-12-31T00:00:00Z")),
    "https://www.susd12.org/api/calendars/150042/events?start_date=2026-06-25&end_date=2026-12-31&view_source=event-slider",
  );
});

test("every sitting the disallowed tenant carried is on the permitted calendar, at the same wall clock", () => {
  const boardEvents = BODY.data.events.filter((e) => /Governing Board/i.test(e.title) && !/Employee Benefits? Trust/i.test(e.title));
  const clocks = new Set(boardEvents.map((e) => `${e.start_date}T${e.start_time!.slice(0, 5)}`));
  for (const held of HELD_FROM_DILIGENT) assert.ok(clocks.has(held), `${held} is not on the district calendar`);
  // One more entry than Diligent: Aug 25 lists the 6:15 public hearing and the 6:30 meeting separately.
  assert.equal(boardEvents.length, 13);
});

/*
 * A missing place never suppresses a verified meeting: the sittings publish with
 * no pin and the district's silence as their named gap, and the standing
 * sentence never places them.
 */
test("a sitting whose own event states no place is published with the district's gap, counted, never placed by the standing sentence", () => {
  const source = makeSmartSitesSource([WIRING]);
  const { meetings, drops, accounting } = source.normalizeWithDrops(RAW, NOW);
  assert.equal(accounting.outcome, "CONSERVED");
  assert.equal(accounting.dropped, 32 - 13, "only the calendar's other bodies and events are set aside");
  assert.equal(meetings.length, 13, "every Governing Board sitting on the calendar is published");
  // The one sitting whose own title says Virtual is online, as before.
  const virtual = meetings.find((m) => m.id === "smartsites:susd12:1254002")!;
  assert.deepEqual(virtual.online, { label: "Virtual", joinUrl: null });
  assert.equal(Date.parse(virtual.startsAt), Date.parse("2026-08-04T11:30:00-07:00"), "wall clock read in the body's zone");
  const unplaced = meetings.filter((m) => m.id !== virtual.id);
  assert.equal(unplaced.length, 12);
  for (const m of unplaced) {
    assert.equal(m.location, null, "never placed by the standing sentence");
    assert.equal(m.online, undefined);
    assert.deepEqual(m.venueGap, { kind: "NOT_STATED_BY_PUBLISHER", publishedText: null, publisher: WIRING.publishingOrg });
  }
  assert.equal(drops.unknownVenue, 12, "twelve Governing Board events publish an empty address, each counted");
  assert.equal(drops.notConfigured, 32 - 13, "the other bodies and events sharing the district calendar");
});
