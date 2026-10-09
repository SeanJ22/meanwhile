import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  detectSittingAs,
  normalizeWithDrops,
  type LegistarEventWithClient,
} from "../lib/sources/legistar/index.ts";
import { groupByVenue } from "../lib/meetings/venues.ts";
import { describeStatus } from "../lib/sources/legistar/client.ts";
import {
  findVenue,
  isPlaceless,
  LEGISTAR_CLIENTS,
} from "../lib/sources/legistar/client-registry.ts";
import type {
  LegistarEvent,
  LegistarEventItem,
} from "../lib/sources/legistar/types.ts";

function load<T>(name: string): T {
  return JSON.parse(
    readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"),
  ) as T;
}

const EVENTS = load<LegistarEvent[]>("legistar-pima-events.json");
const ITEMS_STUDY = load<LegistarEventItem[]>(
  "legistar-pima-eventitems-1823.json",
);
const ITEMS_REGULAR = load<LegistarEventItem[]>(
  "legistar-pima-eventitems-1824.json",
);

const COLLECTED_AT = "2026-08-12T22:00:00.000Z";
const NOW = new Date("2026-08-12T22:00:00.000Z");

/** `items` defaults to `null`: "this run did not read the agenda". */
function wrap(
  events: LegistarEvent[],
  itemsByEventId: Record<number, LegistarEventItem[]> = {},
): LegistarEventWithClient[] {
  return events.map((event) => ({
    event,
    slug: "pima",
    collectedAt: COLLECTED_AT,
    items: itemsByEventId[event.EventId] ?? null,
  }));
}

test("normalizes recorded Pima events into Meetings", () => {
  const { meetings } = normalizeWithDrops(wrap(EVENTS), NOW);

  assert.ok(meetings.length > 0, "expected meetings from the recorded window");
  assert.ok(
    meetings.every((m) => m.ocdId === "ocd-division/country:us/state:az/county:pima"),
    "every meeting joins on the county OCD-ID, never a name string",
  );
});

test("wall-clock time is reassembled against the body's zone, not UTC", () => {
  // Phoenix never observes DST, so a 1:30 PM local time is 20:30Z year round.
  const event = EVENTS.find((e) => e.EventId === 1823);
  assert.ok(event, "fixture must still contain event 1823");

  const { meetings } = normalizeWithDrops(wrap([event]), NOW);
  assert.equal(meetings.length, 1);
  assert.equal(meetings[0].timeZone, "America/Phoenix");
  assert.equal(new Date(meetings[0].startsAt).toISOString(), "2026-08-11T20:30:00.000Z");
});

test("every meeting carries real provenance, and the org is the body not the vendor", () => {
  const { meetings } = normalizeWithDrops(wrap(EVENTS), NOW);

  for (const meeting of meetings) {
    assert.equal(meeting.provenance.sourceOrg, "Pima County Clerk of the Board");
    assert.equal(meeting.provenance.collectedAt, COLLECTED_AT);
    assert.equal(
      meeting.provenance.verifiedAt,
      null,
      "nothing human has confirmed these rows",
    );
    assert.ok(
      meeting.provenance.sourceUrl?.startsWith("https://pima.legistar.com/"),
      "sourceUrl must be the observed InSite permalink",
    );
  }
});

test("a meeting with no known venue is published with the county's own words, never given an approximate pin", () => {
  const invented: LegistarEvent = {
    ...EVENTS[0],
    EventId: 999_001,
    EventLocation: "Somewhere Nobody Has Mapped",
  };

  const { meetings, drops, accounting } = normalizeWithDrops(wrap([invented]), NOW);
  assert.equal(meetings.length, 1, "the sitting is published, not withheld");
  assert.equal(meetings[0].location, null, "no coordinates, so no pin");
  assert.equal(meetings[0].online, undefined, "and never called online");
  assert.deepEqual(meetings[0].venueGap, {
    kind: "STATED_NOT_PLACED",
    publishedText: "Somewhere Nobody Has Mapped",
    publisher: "Pima County Clerk of the Board",
  });
  assert.equal(drops.unknownVenue, 1, "still counted, so the venue hunt sees the room");
  assert.equal(accounting.dropped, 0, "counted and kept, never a drop");
  assert.equal(accounting.outcome, "CONSERVED");
});

test("a meeting whose record states no location is published with the county's own gap", () => {
  const blank: LegistarEvent = { ...EVENTS[0], EventId: 999_003, EventLocation: "  " };
  const { meetings, drops, accounting } = normalizeWithDrops(wrap([blank]), NOW);
  assert.equal(meetings.length, 1);
  assert.equal(meetings[0].location, null);
  assert.equal(meetings[0].online, undefined);
  assert.deepEqual(meetings[0].venueGap, {
    kind: "NOT_STATED_BY_PUBLISHER",
    publishedText: null,
    publisher: "Pima County Clerk of the Board",
  });
  assert.equal(drops.unknownVenue, 1);
  assert.equal(accounting.dropped, 0);
});

test("a virtual meeting is KEPT, with no place and no invented pin (D18)", () => {
  const virtual = EVENTS.find((e) => e.EventLocation === "Virtual Meeting");
  assert.ok(virtual, "fixture must still contain a virtual meeting");

  const { meetings, drops } = normalizeWithDrops(wrap([virtual]), NOW);

  assert.equal(meetings.length, 1, "a virtual meeting is a meeting");
  assert.equal(meetings[0].location, null, "no building means no coordinates");
  assert.equal(
    meetings[0].online?.label,
    "Virtual Meeting",
    "the published location string, verbatim",
  );
  assert.equal(
    meetings[0].online?.joinUrl,
    null,
    "Legistar publishes no join link on the event, and nothing invents one",
  );
  assert.equal(drops.placeless, 1);
  assert.equal(
    drops.unknownVenue,
    0,
    "no place to put it is a different fact from not knowing the place",
  );
});

test("a virtual meeting is never a pin", () => {
  const virtual = EVENTS.find((e) => e.EventLocation === "Virtual Meeting")!;
  const { meetings } = normalizeWithDrops(wrap([virtual]), NOW);
  // groupByVenue is the one gate that decides what becomes a marker.
  assert.deepEqual(groupByVenue(meetings), [], "no venue, therefore no pin");
});

test("coordinates only ever come from the curated venue table", () => {
  const { meetings } = normalizeWithDrops(wrap(EVENTS), NOW);
  const known = LEGISTAR_CLIENTS[0].venues;

  // An online meeting has no coordinates, so it is checked apart from the venue-table loop.
  const online = meetings.filter((m) => m.location === null);
  assert.ok(online.length > 0, "the fixture still contains a virtual meeting");
  for (const meeting of online) assert.equal(meeting.online?.joinUrl, null);

  for (const meeting of meetings.filter((m) => m.location !== null)) {
    assert.ok(
      known.some(
        (v) => v.lat === meeting.location!.lat && v.lng === meeting.location!.lng,
      ),
      `${meeting.location!.name} has coordinates from outside the venue table`,
    );
  }
});

test("every venue in the table cites where its address and coordinates came from", () => {
  for (const client of LEGISTAR_CLIENTS) {
    for (const venue of client.venues) {
      assert.ok(
        venue.addressSourceUrl.startsWith("https://"),
        `${venue.name} must cite an address source`,
      );
      assert.ok(
        venue.coordinateSourceUrl.startsWith("https://"),
        `${venue.name} must cite a coordinate source`,
      );
      assert.equal(venue.verifiedAt, null);
    }
  }
});

test("venue matching survives inconsistent punctuation", () => {
  const client = LEGISTAR_CLIENTS[0];
  // The API sends "Board of Supervisors' Hearing Room"; the table spells it
  // without the apostrophe. Both must resolve to one room.
  assert.ok(findVenue(client, "Board of Supervisors' Hearing Room"));
  assert.ok(findVenue(client, "board of supervisors hearing room"));
  assert.equal(findVenue(client, "Council Chambers"), undefined);
});

test("placeless venues are recognised regardless of case", () => {
  assert.ok(isPlaceless("Virtual Meeting"));
  assert.ok(isPlaceless("virtual meeting"));
  assert.equal(isPlaceless("Board of Supervisors' Hearing Room"), false);
});

test("cancellation is only claimed on an explicit word", () => {
  const base = EVENTS.find((e) => e.EventId === 1823)!;

  // The observed comments on this client — none of them mean canceled.
  for (const comment of [null, "Study Session", "Special Meeting", "Joint Meeting"]) {
    const { meetings } = normalizeWithDrops(
      wrap([{ ...base, EventComment: comment }]),
      NOW,
    );
    assert.notEqual(meetings[0].status, "CANCELED", `"${comment}" is not a cancellation`);
  }

  const { meetings } = normalizeWithDrops(
    wrap([{ ...base, EventComment: "CANCELLED - rescheduled to August" }]),
    NOW,
  );
  assert.equal(meetings[0].status, "CANCELED");
});

test("status is decided against the passed clock, not the wall clock", () => {
  const past = normalizeWithDrops(wrap(EVENTS), new Date("2027-01-01T00:00:00Z"));
  assert.ok(
    past.meetings.every((m) => m.status !== "SCHEDULED"),
    "everything in the fixture is behind a 2027 clock",
  );
});

test("a sourced meeting date publishes while its start time remains unknown", () => {
  const base = EVENTS[0];
  const { meetings, drops } = normalizeWithDrops(
    wrap([{ ...base, EventId: 999_002, EventTime: null }]),
    NOW,
  );

  assert.equal(meetings.length, 1);
  assert.equal(meetings[0].startPrecision, "DAY");
  assert.equal(drops.unplaceableInTime, 0);
});

test("a sibling body on the same tenant cannot inherit the bound body's identity", () => {
  const { meetings, drops } = normalizeWithDrops(wrap([{ ...EVENTS[0], EventBodyId: 999, EventBodyName: "Planning Commission" }]), NOW);
  assert.equal(meetings.length, 0);
  assert.equal(drops.notConfigured, 1);
});

test("ids are namespaced by source and client", () => {
  const { meetings } = normalizeWithDrops(wrap(EVENTS), NOW);
  assert.ok(meetings.every((m) => m.id.startsWith("legistar:pima:")));
});

test("detects the board sitting as another body — the 4.6.9 case, in real data", () => {
  const found = detectSittingAs(ITEMS_REGULAR);

  assert.ok(found.length > 0, "expected a sitting-as heading in the regular meeting");
  assert.ok(
    found.some((t) => /sitting as other boards/i.test(t)),
    `expected the other-boards heading, got: ${found.join(" | ")}`,
  );
});

test("a study session with no other-body business reports none", () => {
  assert.deepEqual(detectSittingAs(ITEMS_STUDY), []);
});

test("status codes are described the way the API actually behaves", () => {
  // A 500 here is a wrong slug, not an outage.
  assert.match(describeStatus(500), /not a Legistar client/i);
  assert.match(describeStatus(403), /token/i);
});
