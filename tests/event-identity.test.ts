import assert from "node:assert/strict";
import test from "node:test";

import { localWallClock, weakEventIdentity } from "../lib/sources/event-identity.ts";
import { makeIcalSource } from "../lib/sources/ical/index.ts";
import type { BodySourceWiring } from "../lib/registry/source-wiring.ts";

const WIRING = {
  ocdId: "ocd-division/country:us/state:nh/county:merrimack/place:newbury_town",
  jurisdiction: "Newbury, NH",
  publishingOrg: "Town of Newbury",
  timeZone: "America/New_York",
  type: "ICAL",
  config: {
    feedUrl: "https://www.newburynh.org/events/list/?ical=1",
    slug: "newbury-ical-zoning-board-of-adjustment",
    titleMatch: "Zoning Board",
    venueMatch: "Newbury Town Office",
  },
} as unknown as BodySourceWiring;

/** Two UID-less events, same start, different summaries — the reproduction. */
const SAME_NIGHT = [
  "BEGIN:VCALENDAR",
  "BEGIN:VEVENT",
  "SUMMARY:Zoning Board of Adjustment",
  "DTSTART:20260908T230000Z",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "SUMMARY:Zoning Board of Adjustment Public Hearing",
  "DTSTART:20260908T230000Z",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

test("A-005 · two UID-less events at the same instant are two meetings, not one", () => {
  const source = makeIcalSource([WIRING]);
  const result = source.normalizeWithDrops(
    [
      {
        wiring: WIRING,
        ics: SAME_NIGHT,
        collectedAt: "2026-08-24T12:00:00.000Z",
        sourceUrl: "https://newburynh.org/events/list/?ical=1",
      },
    ],
    new Date("2026-08-24T12:00:00.000Z"),
  );

  const titles = result.meetings.map((m) => m.title).sort();
  assert.deepEqual(
    titles,
    ["Zoning Board of Adjustment", "Zoning Board of Adjustment Public Hearing"],
    "the second sitting was swallowed — this is A-005",
  );
  assert.equal(
    new Set(result.meetings.map((m) => m.id)).size,
    2,
    "they share an id, which is how the second disappeared",
  );
  assert.equal(result.duplicateIdentity?.weakIdCollision, 0);
  assert.equal(result.duplicateIdentity?.exact, 0);
});

test("A-005 · the same UID-less event published twice IS one meeting, and is COUNTED", () => {
  const twice = SAME_NIGHT.replace(
    "SUMMARY:Zoning Board of Adjustment Public Hearing",
    "SUMMARY:Zoning Board of Adjustment",
  );
  const source = makeIcalSource([WIRING]);
  const result = source.normalizeWithDrops(
    [
      {
        wiring: WIRING,
        ics: twice,
        collectedAt: "2026-08-24T12:00:00.000Z",
        sourceUrl: "https://newburynh.org/events/list/?ical=1",
      },
    ],
    new Date("2026-08-24T12:00:00.000Z"),
  );
  assert.equal(result.meetings.length, 1);
  assert.equal(
    result.duplicateIdentity?.weakIdCollision,
    1,
    "the collapse happened and nothing recorded it — the A-005 shape",
  );
  assert.equal(result.duplicateIdentity?.exact, 0, "no UID was involved, so this is OUR judgement");
});

test("A-005 · a repeated UID is the FEED's statement and is counted apart", () => {
  const withUids = [
    "BEGIN:VCALENDAR",
    "BEGIN:VEVENT",
    "UID:abc-123",
    "SUMMARY:Zoning Board of Adjustment",
    "DTSTART:20260908T230000Z",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "UID:abc-123",
    "SUMMARY:Zoning Board of Adjustment",
    "DTSTART:20260908T230000Z",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
  const source = makeIcalSource([WIRING]);
  const result = source.normalizeWithDrops(
    [
      {
        wiring: WIRING,
        ics: withUids,
        collectedAt: "2026-08-24T12:00:00.000Z",
        sourceUrl: "https://newburynh.org/events/list/?ical=1",
      },
    ],
    new Date("2026-08-24T12:00:00.000Z"),
  );
  assert.equal(result.meetings.length, 1);
  assert.equal(result.duplicateIdentity?.exact, 1);
  assert.equal(
    result.duplicateIdentity?.weakIdCollision,
    0,
    "an exact duplicate must never be reported as our judgement",
  );
});

test("A-005 · both counters are reported as ZEROES when nothing collapsed", () => {
  // A counter that only appears when it fires cannot be read as "we looked".
  const source = makeIcalSource([WIRING]);
  const result = source.normalizeWithDrops(
    [
      {
        wiring: WIRING,
        ics: SAME_NIGHT,
        collectedAt: "2026-08-24T12:00:00.000Z",
        sourceUrl: "https://newburynh.org/events/list/?ical=1",
      },
    ],
    new Date("2026-08-24T12:00:00.000Z"),
  );
  assert.deepEqual(result.duplicateIdentity, { exact: 0, weakIdCollision: 0, publisherRelisted: 0 });
});

test("A-005 · identity changes with every field the feed published", () => {
  const base = {
    slug: "newbury",
    startIso: "2026-09-08T23:00:00.000Z",
    summary: "Zoning Board",
    location: "Town Office Building",
    description: null,
  };
  const id = weakEventIdentity(base);
  assert.notEqual(weakEventIdentity({ ...base, summary: "Conservation Commission" }), id);
  assert.notEqual(weakEventIdentity({ ...base, location: "Fire Station" }), id);
  assert.notEqual(weakEventIdentity({ ...base, startIso: "2026-09-08T22:00:00.000Z" }), id);
  assert.notEqual(weakEventIdentity({ ...base, slug: "wilmot" }), id);
  assert.notEqual(weakEventIdentity({ ...base, description: "budget" }), id);
  assert.equal(weakEventIdentity({ ...base }), id, "and it is stable for identical input");
});

test("A-005 · identity carries no colon, because meeting ids are split on one", () => {
  const id = weakEventIdentity({
    slug: "newbury",
    startIso: "2026-09-08T23:00:00.000Z",
    summary: "Meeting: Budget Hearing (7:00)",
    location: "Town Hall: Room 2",
    description: null,
  });
  assert.equal(id.includes(":"), false, "a colon here would break `meeting.id.split(':')[0]`");
  assert.match(id, /^w-[0-9a-f]{16}$/, "and it says WEAK in the id itself");
});

test("A-005 · whitespace and case differences are the same sitting", () => {
  const a = weakEventIdentity({
    slug: "newbury",
    startIso: "2026-09-08T23:00:00.000Z",
    summary: "Zoning  Board",
    location: "Town Office Building",
    description: null,
  });
  const b = weakEventIdentity({
    slug: "newbury",
    startIso: "2026-09-08T23:00:00.000Z",
    summary: "zoning board",
    location: "town office building ",
    description: null,
  });
  assert.equal(a, b);
});

test("reused sitting formatters preserve midnight, DST transitions, zones and invalid inputs", () => {
  const cases = [
    ["2026-03-08T06:59:00Z", "America/New_York", "2026-03-08", "01:59"],
    ["2026-03-08T07:00:00Z", "America/New_York", "2026-03-08", "03:00"],
    ["2026-11-01T05:30:00Z", "America/New_York", "2026-11-01", "01:30"],
    ["2026-11-01T06:30:00Z", "America/New_York", "2026-11-01", "01:30"],
    ["2026-11-01T06:30:00Z", "America/Phoenix", "2026-10-31", "23:30"],
    ["2026-11-01T00:00:00Z", "UTC", "2026-11-01", "00:00"],
  ] as const;
  for (let pass = 0; pass < 3; pass++) for (const [instant, zone, date, time] of cases) {
    assert.deepEqual(localWallClock(instant, zone), { date, time });
  }
  assert.equal(localWallClock("not a date", "UTC"), null);
  assert.throws(() => localWallClock("2026-11-01T00:00:00Z", "Not/A_Zone"), RangeError);
});
