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
} from "../lib/sources/legistar/clients.ts";
import type {
  LegistarEvent,
  LegistarEventItem,
} from "../lib/sources/legistar/types.ts";

/**
 * The Legistar transform, against responses recorded from the live `pima`
 * client on 2026-08-12. No test here touches the network — the fixtures are the
 * contract, and if Granicus changes the shape these fail rather than the map
 * quietly emptying.
 *
 * What is worth pinning: this API sends a calendar date and a wall-clock time
 * with **no zone**, and **no coordinates at all**. Both are places where a
 * plausible guess would look right and be wrong.
 */

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

/**
 * `items` defaults to `null` — "this run did not read the agenda" — because
 * that is what the recorded events fixture actually represents. The item
 * fixtures are attached deliberately, per event, by the D19 tests below.
 */
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
  // EventId 1823: EventDate 2026-08-11, EventTime "1:30 PM", America/Phoenix.
  // Phoenix never observes DST, so this is UTC-7 year round: 20:30Z.
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

test("a meeting with no known venue is dropped, never given an approximate pin", () => {
  const invented: LegistarEvent = {
    ...EVENTS[0],
    EventId: 999_001,
    EventLocation: "Somewhere Nobody Has Mapped",
  };

  const { meetings, drops } = normalizeWithDrops(wrap([invented]), NOW);
  assert.equal(meetings.length, 0);
  assert.equal(drops.unknownVenue, 1);
});

test("a virtual meeting is KEPT, with no place and no invented pin (D18)", () => {
  const virtual = EVENTS.find((e) => e.EventLocation === "Virtual Meeting");
  assert.ok(virtual, "fixture must still contain a virtual meeting");

  const { meetings, drops } = normalizeWithDrops(wrap([virtual]), NOW);

  // It used to be DROPPED. It is a real public meeting a reader could have
  // attended, and the map's constraint was being applied to the reader.
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
  // The counter keeps its name and its meaning: it counts meetings with no
  // physical place, which is the same quantity it always counted.
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

  // A meeting held online has no coordinates at all, which satisfies this
  // rule in the strongest possible way (D18) — but `some()` over an empty
  // comparison would report it as a violation, so it is stated rather than
  // swept into the loop.
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

test("a meeting with no usable time is dropped rather than placed at midnight", () => {
  const base = EVENTS[0];
  const { meetings, drops } = normalizeWithDrops(
    wrap([{ ...base, EventId: 999_002, EventTime: null }]),
    NOW,
  );

  assert.equal(meetings.length, 0);
  assert.equal(drops.unplaceableInTime, 1);
});

test("ids are namespaced by source and client", () => {
  const { meetings } = normalizeWithDrops(wrap(EVENTS), NOW);
  assert.ok(meetings.every((m) => m.id.startsWith("legistar:pima:")));
});

test("detects the board sitting as another body — the 4.6.9 case, in real data", () => {
  // Pima's Board of Supervisors regular meeting of 2026-08-11 carries
  // "BOARD OF SUPERVISORS SITTING AS OTHER BOARDS" and a LIBRARY DISTRICT
  // BOARD heading. A special district's business inside a county feed.
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
  // Measured across nine slugs on 2026-08-12. A 500 here is a wrong slug, not
  // an outage, and retrying it asks the same wrong question again.
  assert.match(describeStatus(500), /not a Legistar client/i);
  assert.match(describeStatus(403), /token/i);
});
