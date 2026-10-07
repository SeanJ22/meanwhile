/**
 * One sitting of a recurring iCalendar series is one record: a Google Calendar series is one `UID` across a
 * master and its overrides, served in a different order on every request. The fixtures are recorded reads of
 * towns' public calendars trimmed to the named series, each event block as served except that `DESCRIPTION`
 * is removed (it can name private applicants).
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { MEETING_PARTITION_CONTRACTS } from "../lib/civic-data/meeting-partitions.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import type { RoutineRemovalEvidence } from "../lib/civic-data/types.ts";
import type { AgendaDocument } from "../lib/meetings/agenda-documents.ts";
import type { BodySourceWiring } from "../lib/registry/source-wiring.ts";
import {
  occurrenceId,
  occurrenceParts,
  occurrenceStampFromInstant,
  occurrenceStampInstant,
  supersedesSeriesRecord,
} from "../lib/sources/event-identity.ts";
import { makeIcalSource, parseDtStart, parseIcs, slotStamp } from "../lib/sources/ical/index.ts";
import { readRule } from "../lib/sources/ical/recurrence.ts";
import type { Meeting } from "../lib/sources/types.ts";
import {
  promoteMeetingPartition,
  promoteMeetingPartitions,
  reconcileSuccessfulMeetingPartition,
  recurrenceHeldFacts,
} from "../scripts/ingest.ts";

const FIXTURES = join(process.cwd(), "tests", "fixtures", "ical");
const READ_1 = readFileSync(join(FIXTURES, "bradford-2026-09-23-read-1.ics"), "utf8");
const READ_2 = readFileSync(join(FIXTURES, "bradford-2026-09-23-read-2.ics"), "utf8");
const WARNER = readFileSync(join(FIXTURES, "warner-2026-09-23.ics"), "utf8");

/** Between the reads, so every sitting's status is fixed. */
const NOW = "2026-09-23T16:10:00.000Z";

const BRADFORD_FEED =
  "https://calendar.google.com/calendar/ical/bradfordnewhampshire%40gmail.com/public/basic.ics";
const CC_SERIES = "ical:bradford-conservation-commission:qnahpc95shsi3o2o58ir07tup7@google.com";
const PB_SERIES =
  "ical:bradford-planning-board:64q7u3ofmjmndtm3l8vorqr3qr_R20240528T230000@google.com";
const ZBA_SERIES =
  "ical:warner-zoning-board:6p16gsvl1r6tdq7d6eco5vgqij_R20250213T000000@google.com";

function partition(slug: string) {
  const found = MEETING_PARTITION_CONTRACTS.find(
    (row) => row.meetingSource === "ical" && row.wiring!.config.slug === slug,
  );
  assert.ok(found, `no ${slug} partition is wired — this guard is stale`);
  return found;
}

function wiringFor(...slugs: string[]): BodySourceWiring[] {
  return slugs.map((slug) => partition(slug).wiring!);
}

function normalize(wiring: BodySourceWiring[], ics: string, now = NOW) {
  return makeIcalSource(wiring).normalizeWithDrops(
    wiring.map((row) => ({
      wiring: row,
      ics,
      collectedAt: now,
      sourceUrl: row.config.feedUrl ?? "",
    })),
    new Date(now),
  );
}

/** Every VEVENT block of a recorded feed, as served. */
function blocks(ics: string): string[] {
  return ics.split("BEGIN:VEVENT").slice(1).map((block) => `BEGIN:VEVENT${block.split("END:VEVENT")[0]}END:VEVENT\r\n`);
}

/** The same calendar with its events served in another order. */
function reordered(ics: string, order: (all: string[]) => string[]): string {
  const head = ics.slice(0, ics.indexOf("BEGIN:VEVENT"));
  return `${head}${order(blocks(ics)).join("")}END:VCALENDAR\r\n`;
}

test("ICAL-OCC · two recorded reads 42 seconds apart serve the same events in different orders", () => {
  const withoutStamp = (block: string) => block.replace(/^DTSTAMP:.*\r\n/m, "");
  const first = blocks(READ_1).map(withoutStamp);
  const second = blocks(READ_2).map(withoutStamp);
  assert.equal(first.length, 14);
  assert.deepEqual([...first].sort(), [...second].sort(), "the two reads hold the same events");
  assert.notDeepEqual(first, second, "and serve them in a different order");

  // Which Conservation Commission event comes FIRST is what the old id kept.
  const firstStart = (ics: string) =>
    parseIcs(ics).find((event) => event.uid === "qnahpc95shsi3o2o58ir07tup7@google.com")?.dtstart;
  assert.equal(firstStart(READ_1), ";TZID=America/New_York:20260915T190000");
  assert.equal(firstStart(READ_2), ";TZID=America/New_York:20260721T190000");
});

test("ICAL-OCC · the parser reads the recurrence fields it keys on", () => {
  const cc = parseIcs(READ_1).filter((event) => event.uid === "qnahpc95shsi3o2o58ir07tup7@google.com");
  assert.equal(cc.length, 5);
  const master = cc.filter((event) => event.recurs);
  assert.equal(master.length, 1, "one series master, carrying the RRULE");
  assert.equal(master[0]!.recurrenceId, null);
  assert.equal(master[0]!.sequence, 10);
  const overrides = cc.filter((event) => event.recurrenceId !== null);
  assert.equal(overrides.length, 4);
  assert.ok(overrides.every((event) => !event.recurs), "an override repeats nothing");
  assert.deepEqual(
    overrides.map((event) => event.recurrenceId).sort(),
    [
      ";TZID=America/New_York:20260915T190000",
      ";TZID=America/New_York:20261013T190000",
      ";TZID=America/New_York:20261110T190000",
      ";TZID=America/New_York:20261208T190000",
    ],
  );
  const budget = parseIcs(READ_1).find((event) => event.uid === "2issdnlfp8vip5jpceb86j6hhr@google.com");
  assert.equal(budget?.recurs, false);
  assert.equal(budget?.recurrenceId, null);
});

test("ICAL-OCC · every sitting of the Conservation Commission series is its own record", () => {
  const { meetings, accounting, duplicateIdentity, recurrence } = normalize(
    wiringFor("bradford-conservation-commission"),
    READ_1,
  );
  assert.deepEqual(
    meetings.map(({ id, startsAt, status, title }) => ({ id, startsAt, status, title })),
    [
      // The series' rule (every fourth Tuesday at 7pm from 21 July) places
      // each unedited sitting; each edited sitting is its override.
      { id: `${CC_SERIES}/20260721T230000Z`, startsAt: "2026-07-21T23:00:00.000Z", status: "CONCLUDED", title: "Conservation Commission" },
      { id: `${CC_SERIES}/20260818T230000Z`, startsAt: "2026-08-18T23:00:00.000Z", status: "CONCLUDED", title: "Conservation Commission" },
      { id: `${CC_SERIES}/20260915T230000Z`, startsAt: "2026-09-15T23:00:00.000Z", status: "CONCLUDED", title: "Conservation Commission" },
      // Moved by the town from 13 to 20 October: the id is the SLOT it replaced.
      { id: `${CC_SERIES}/20261013T230000Z`, startsAt: "2026-10-20T23:00:00.000Z", status: "SCHEDULED", title: "Conservation Commission" },
      // 10 November at 7pm Eastern (standard time) is 00:00Z on the 11th.
      { id: `${CC_SERIES}/20261111T000000Z`, startsAt: "2026-11-18T00:00:00.000Z", status: "SCHEDULED", title: "Conservation Commission" },
      { id: `${CC_SERIES}/20261209T000000Z`, startsAt: "2026-12-16T00:00:00.000Z", status: "SCHEDULED", title: "Conservation Commission" },
      // The held window reaches 120 days ahead, so the January sitting is in.
      { id: `${CC_SERIES}/20270106T000000Z`, startsAt: "2027-01-06T00:00:00.000Z", status: "SCHEDULED", title: "Conservation Commission" },
    ],
  );
  // The four sittings the town edited are stated twice, by the rule and by
  // their overrides; the override is the sitting, and the rule's copy is not.
  assert.deepEqual(duplicateIdentity, { exact: 4, weakIdCollision: 0, publisherRelisted: 0 });
  assert.equal(accounting.outcome, "CONSERVED");
  assert.deepEqual(recurrence, { expandedSeries: 1, exclusions: [], notExpanded: [] });
});

test("ICAL-OCC · the same events in any order produce the same meetings", () => {
  const wiring = wiringFor(
    "bradford-conservation-commission",
    "bradford-planning-board",
    "bradford-budget-committee",
  );
  const expected = normalize(wiring, READ_1).meetings;
  assert.equal(expected.length, 16, "the 120-day window (DB-03) holds four sittings the 90-day window did not");
  for (const [label, ics] of [
    ["the second recorded read", READ_2],
    ["the first read reversed", reordered(READ_1, (all) => [...all].reverse())],
    ["the first read rotated", reordered(READ_1, (all) => [...all.slice(5), ...all.slice(0, 5)])],
  ] as const) {
    assert.deepEqual(normalize(wiring, ics).meetings, expected, `${label} changed what a record says`);
  }
});

test("ICAL-OCC · an event outside any series keeps its id exactly", () => {
  const { meetings } = normalize(wiringFor("bradford-budget-committee"), READ_1);
  assert.deepEqual(meetings.map(({ id }) => id), [
    "ical:bradford-budget-committee:2issdnlfp8vip5jpceb86j6hhr@google.com",
  ]);

  // Wilmot's feed carries no recurrence at all: every id is `ical:<slug>:<UID>`.
  const wilmot = readFileSync(join(FIXTURES, "wilmot-2026-08-19.ics"), "utf8");
  const rows = MEETING_PARTITION_CONTRACTS.filter(
    (row) => row.meetingSource === "ical" && (row.wiring!.config.feedUrl ?? "").includes("wilmotnh.org"),
  ).map((row) => row.wiring!);
  const events = parseIcs(wilmot);
  const produced = normalize(rows, wilmot, "2026-08-19T12:00:00.000Z").meetings;
  assert.ok(produced.length >= 10);
  for (const meeting of produced) {
    const uid = events.find((event) => meeting.id.endsWith(`:${event.uid}`))?.uid;
    assert.ok(uid, `${meeting.id} is not \`ical:<slug>:<UID>\``);
    assert.equal(occurrenceParts(meeting.id), null);
  }
});

test("ICAL-OCC · Warner's Zoning Board: each edited and each unedited sitting of the series is its own record", () => {
  const { meetings } = normalize(wiringFor("warner-zoning-board"), WARNER);
  assert.deepEqual(
    meetings.map(({ id, startsAt, status, title }) => ({ id, startsAt, status, title })),
    [
      // The held window reaches 120 days back and ahead, so 10 June and 14 January are in.
      { id: `${ZBA_SERIES}/20260610T230000Z`, startsAt: "2026-06-10T23:00:00.000Z", status: "CONCLUDED", title: "Zoning Board Meeting" },
      { id: `${ZBA_SERIES}/20260708T230000Z`, startsAt: "2026-07-08T23:00:00.000Z", status: "CANCELED", title: "CANCELED Zoning Board Meeting" },
      { id: `${ZBA_SERIES}/20260812T230000Z`, startsAt: "2026-08-12T23:00:00.000Z", status: "CONCLUDED", title: "Zoning Board Meeting" },
      { id: `${ZBA_SERIES}/20260909T230000Z`, startsAt: "2026-09-09T23:00:00.000Z", status: "CANCELED", title: "CANCELED Zoning Board Meeting" },
      // The second Wednesday at 7pm, which no one edited: the rule's own sittings.
      { id: `${ZBA_SERIES}/20261014T230000Z`, startsAt: "2026-10-14T23:00:00.000Z", status: "SCHEDULED", title: "Zoning Board Meeting" },
      { id: `${ZBA_SERIES}/20261112T000000Z`, startsAt: "2026-11-12T00:00:00.000Z", status: "SCHEDULED", title: "Zoning Board Meeting" },
      { id: `${ZBA_SERIES}/20261210T000000Z`, startsAt: "2026-12-10T00:00:00.000Z", status: "SCHEDULED", title: "Zoning Board Meeting" },
      { id: `${ZBA_SERIES}/20270114T000000Z`, startsAt: "2027-01-14T00:00:00.000Z", status: "SCHEDULED", title: "Zoning Board Meeting" },
    ],
    "the held meeting and the two cancelled ones are three records, never one alternating",
  );
});

const SB_SERIES = "ical:warner-select-board:42cp3onvveme22uorqju8uhu34@google.com";

test("ICAL-OCC · an edited sitting belongs to its series' body, and replaces the series' own copy of it", () => {
  /*
   * A series' edited first sitting is decided by the series for its body, by its own DTSTART for when, and
   * shown with its title as written; the series' own copy of that sitting is a counted duplicate. A title saying
   * the sitting moved means it was not held on its original day.
   */
  const wiring = wiringFor("warner-select-board");
  const selectBoard = (ics: string) =>
    normalize(wiring, ics)
      .meetings.filter((meeting) => meeting.id.includes("42cp3onvveme22uorqju8uhu34"))
      .map(({ id, bodyId, startsAt, status, title }) => ({ id, bodyId, startsAt, status, title }));
  const body = "ocd-division/country:us/state:nh/county:merrimack/place:warner_town#select-board";
  const unedited = (slot: string, startsAt: string) =>
    ({ id: `${SB_SERIES}/${slot}`, bodyId: body, startsAt, status: "SCHEDULED", title: "Select Board Meeting" });
  const expected = [
    {
      id: `${SB_SERIES}/20260908T220000Z`,
      bodyId: body,
      startsAt: "2026-09-08T22:00:00.000Z",
      status: "CANCELED",
      title: "RESCHEDULED Select Brd -9/15",
    },
    // The second Tuesday at 6pm, as the series states it after its first sitting.
    unedited("20261013T220000Z", "2026-10-13T22:00:00.000Z"),
    unedited("20261110T230000Z", "2026-11-10T23:00:00.000Z"),
    unedited("20261208T230000Z", "2026-12-08T23:00:00.000Z"),
    unedited("20270112T230000Z", "2027-01-12T23:00:00.000Z"),
  ];
  assert.deepEqual(selectBoard(WARNER), expected);
  assert.deepEqual(selectBoard(reordered(WARNER, (all) => [...all].reverse())), expected);

  const result = normalize(wiring, WARNER);
  assert.equal(result.duplicateIdentity?.exact, 1, "the series' own copy of the edited sitting");
  assert.equal(result.accounting.outcome, "CONSERVED");
});

test("ICAL-OCC · an edited sitting is never claimed by a body its own title happens to name", () => {
  const planning = {
    ...SELECT_BOARD_WIRING,
    bodyId: "ocd-division/country:us/state:nh/county:merrimack/place:warner_town#planning-board",
    config: { ...SELECT_BOARD_WIRING.config, slug: "warner-planning-board", titleMatch: "Planning Board" },
  } as unknown as BodySourceWiring;
  const ics = [
    "BEGIN:VCALENDAR",
    "BEGIN:VEVENT",
    "UID:series-2@example.org",
    "DTSTART;TZID=America/New_York:20260908T180000",
    "RRULE:FREQ=MONTHLY;COUNT=1;BYDAY=2TU",
    "SUMMARY:Select Board Meeting",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "UID:series-2@example.org",
    "RECURRENCE-ID;TZID=America/New_York:20260908T180000",
    "DTSTART;TZID=America/New_York:20260908T190000",
    "SUMMARY:Joint session with the Planning Board",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
  const result = normalize([SELECT_BOARD_WIRING, planning], ics);
  assert.deepEqual(
    result.meetings.map(({ id, bodyId, startsAt }) => ({ id, bodyId, startsAt })),
    [{
      id: "ical:warner-select-board:series-2@example.org/20260908T220000Z",
      bodyId: SELECT_BOARD_WIRING.bodyId,
      startsAt: "2026-09-08T23:00:00.000Z",
    }],
  );
  assert.equal(result.accounting.outcome, "CONSERVED");
});

const SELECT_BOARD_WIRING = {
  bodyId: "ocd-division/country:us/state:nh/county:merrimack/place:warner_town#select-board",
  ocdId: "ocd-division/country:us/state:nh/county:merrimack/place:warner_town",
  jurisdiction: "Warner, NH",
  publishingOrg: "Town of Warner",
  timeZone: "America/New_York",
  agendaSourceType: "ICAL",
  config: {
    slug: "warner-select-board",
    feedUrl: "https://calendar.google.com/calendar/ical/example/public/basic.ics",
    titleMatch: "Select Board",
    venueMatch: "Warner Town Hall",
  },
} as unknown as BodySourceWiring;

function twoClaims(first: string[], second: string[]): string {
  return ["BEGIN:VCALENDAR", ...first, ...second, "END:VCALENDAR"].join("\r\n");
}

const REVISION_1 = [
  "BEGIN:VEVENT",
  "UID:series-1@example.org",
  "RECURRENCE-ID;TZID=America/New_York:20260908T180000",
  "DTSTART;TZID=America/New_York:20260908T180000",
  "SEQUENCE:1",
  "SUMMARY:Select Board Meeting",
  "END:VEVENT",
];
const REVISION_2 = [
  "BEGIN:VEVENT",
  "UID:series-1@example.org",
  "RECURRENCE-ID;TZID=America/New_York:20260908T180000",
  "DTSTART;TZID=America/New_York:20260915T180000",
  "SEQUENCE:2",
  "SUMMARY:Select Board Meeting (moved)",
  "END:VEVENT",
];

test("ICAL-OCC · two events on one sitting: the later revision keeps it, in either order", () => {
  for (const ics of [twoClaims(REVISION_1, REVISION_2), twoClaims(REVISION_2, REVISION_1)]) {
    const result = normalize([SELECT_BOARD_WIRING], ics);
    assert.deepEqual(
      result.meetings.map(({ id, startsAt, title }) => ({ id, startsAt, title })),
      [{
        id: "ical:warner-select-board:series-1@example.org/20260908T220000Z",
        startsAt: "2026-09-15T22:00:00.000Z",
        title: "Select Board Meeting (moved)",
      }],
    );
    assert.equal(result.duplicateIdentity?.exact, 1);
    assert.equal(result.accounting.outcome, "CONSERVED");
  }
});

test("ICAL-OCC · two copies at the same revision are settled on content, never on position", () => {
  const same = (lines: string[]) => lines.map((line) => (line.startsWith("SEQUENCE") ? "SEQUENCE:1" : line));
  const forward = normalize([SELECT_BOARD_WIRING], twoClaims(same(REVISION_1), same(REVISION_2))).meetings;
  const backward = normalize([SELECT_BOARD_WIRING], twoClaims(same(REVISION_2), same(REVISION_1))).meetings;
  assert.equal(forward.length, 1);
  assert.deepEqual(forward, backward);
});

test("ICAL-OCC · an occurrence stamp is the slot in UTC, or the date of an all-day slot", () => {
  assert.equal(occurrenceStampFromInstant("2026-09-15T23:00:00.000Z"), "20260915T230000Z");
  assert.equal(occurrenceStampFromInstant("not a time"), null);
  assert.equal(occurrenceStampInstant("20260915T230000Z"), "2026-09-15T23:00:00.000Z");
  assert.equal(occurrenceStampInstant("20260915"), null, "a day is not an instant");
  // One instant spelled in two zones is one slot.
  assert.equal(
    slotStamp(";TZID=America/New_York:20260915T190000", "UTC"),
    slotStamp(":20260915T230000Z", "America/New_York"),
  );
  assert.equal(slotStamp(";VALUE=DATE:20260915", "America/New_York"), "20260915");
  assert.equal(slotStamp(";TZID=Not/AZone:20260915T190000", "America/New_York"), null);
  assert.equal(occurrenceId(CC_SERIES, "20260915T230000Z"), `${CC_SERIES}/20260915T230000Z`);
  assert.throws(() => occurrenceId(CC_SERIES, "2026-09-15"), /OCCURRENCE_STAMP_INVALID/);
  assert.deepEqual(occurrenceParts(`${CC_SERIES}/20260915T230000Z`), {
    seriesId: CC_SERIES,
    stamp: "20260915T230000Z",
  });
  assert.equal(occurrenceParts(CC_SERIES), null);
  assert.equal(occurrenceParts("ical:wilmot-selectboard:10001-1-2@www.wilmotnh.org"), null);
});

test("ICAL-OCC · a series record is replaced only by an occurrence holding its fact", () => {
  const body = "ocd-division/country:us/state:nh/county:merrimack/place:bradford_town#conservation-commission";
  const prior = { id: CC_SERIES, bodyId: body, startsAt: "2026-10-20T23:00:00.000Z" };
  // The same sitting under its own id.
  assert.equal(supersedesSeriesRecord(prior, { id: `${CC_SERIES}/20261013T230000Z`, bodyId: body, startsAt: "2026-10-20T23:00:00.000Z" }), true);
  // The same instance, since moved: its slot is the old record's start.
  assert.equal(supersedesSeriesRecord(
    { ...prior, startsAt: "2026-10-13T23:00:00.000Z" },
    { id: `${CC_SERIES}/20261013T230000Z`, bodyId: body, startsAt: "2026-10-20T23:00:00.000Z" },
  ), true);
  // Anything else is not a replacement.
  assert.equal(supersedesSeriesRecord(prior, { id: `${CC_SERIES}/20260915T230000Z`, bodyId: body, startsAt: "2026-09-15T23:00:00.000Z" }), false, "another sitting");
  assert.equal(supersedesSeriesRecord(prior, { id: `${PB_SERIES}/20261013T230000Z`, bodyId: body, startsAt: "2026-10-20T23:00:00.000Z" }), false, "another series");
  assert.equal(supersedesSeriesRecord(prior, { id: `${CC_SERIES}/20261013T230000Z`, bodyId: "elsewhere", startsAt: "2026-10-20T23:00:00.000Z" }), false, "another body");
  assert.equal(supersedesSeriesRecord(prior, { id: CC_SERIES, bodyId: body, startsAt: "2026-10-20T23:00:00.000Z" }), false, "not an occurrence");
});

/** The 15 September sitting of the Conservation Commission series. */
const fifteenth = (rows: readonly Meeting[]): Meeting => {
  const found = rows.find((row) => row.id === `${CC_SERIES}/20260915T230000Z`);
  assert.ok(found, "the 15 September sitting is produced");
  return found;
};

const WARNER_FEED =
  "https://calendar.google.com/calendar/ical/4550fa96f9a1e211bad70b5ea77be1c4e926eeeb164d25bd76571e7de8251fcd%40group.calendar.google.com/public/basic.ics";

function acquisitions(ics: string, feed = BRADFORD_FEED) {
  return [{
    source: "ical",
    requestedUrl: feed,
    finalUrl: feed,
    httpStatus: 200,
    rawHash: createHash("sha256").update(ics).digest("hex"),
    byteCount: Buffer.byteLength(ics),
  }];
}

function report(ics: string, rows: number, feed = BRADFORD_FEED) {
  return {
    source: "ical",
    ok: true,
    error: null,
    fetched: rows,
    normalized: rows,
    drops: { placeless: 0, unknownVenue: 0, unplaceableInTime: 0, notConfigured: 0 },
    acquisitions: acquisitions(ics, feed),
  };
}

/** A held row under the series' `UID`-only id, showing whichever sitting its last read listed first. */
async function seedLegacySeriesRecord(
  store: MemoryRoutineDataStore,
  sitting: Meeting,
  seededAt: string,
  slug = "bradford-conservation-commission",
  seriesId = CC_SERIES,
  feed = BRADFORD_FEED,
) {
  const legacy: Meeting = {
    ...sitting,
    id: seriesId,
    provenance: { ...sitting.provenance, collectedAt: seededAt },
  };
  const page: AgendaDocument = {
    id: `${seriesId}@${"a".repeat(64)}`,
    meetingId: seriesId,
    ocdId: legacy.ocdId,
    documentUrl: "https://bradfordnh.gov/pages/calendar",
    contentHash: "a".repeat(64),
    retrievedAt: seededAt,
    contentType: "text/html",
    text: "Calendar",
    extraction: "html",
    extractionNote: null,
    sourceUrl: "https://bradfordnh.gov/pages/calendar",
    sourceOrg: "Town of Bradford",
    collectedAt: seededAt,
    verifiedAt: null,
  };
  const [seeded] = await promoteMeetingPartitions({
    store,
    partitions: [partition(slug)],
    meetings: [legacy],
    agendaDocuments: slug === "bradford-conservation-commission" ? [page] : [],
    reports: [report(READ_2, 1, feed)],
    generatedAt: seededAt,
  });
  assert.equal(seeded?.outcome.candidate.state, "PROMOTED");
  return legacy;
}

test("ICAL-OCC · Warner's 8 September record is replaced by the edited sitting: not duplicated, not carried", async () => {
  const store = new MemoryRoutineDataStore();
  const sb = partition("warner-select-board");
  const fresh = normalize([sb.wiring!], WARNER).meetings;
  const edited = fresh.find((row) => row.id === `${SB_SERIES}/20260908T220000Z`);
  assert.ok(edited, "the edited 8 September sitting is produced for the Select Board");
  // Production's record: the series' unedited copy, "Select Board Meeting", 8 September.
  const legacy = await seedLegacySeriesRecord(
    store,
    { ...edited, title: "Select Board Meeting" },
    "2026-09-23T15:13:36.680Z",
    "warner-select-board",
    SB_SERIES,
    WARNER_FEED,
  );
  const [first] = await promoteMeetingPartitions({
    store,
    partitions: [sb],
    meetings: fresh,
    agendaDocuments: [],
    reports: [report(WARNER, fresh.length, WARNER_FEED)],
    generatedAt: NOW,
  });
  assert.equal(first?.outcome.candidate.state, "PROMOTED", first?.outcome.candidate.failureDetail ?? "");
  const changeSet = first!.outcome.candidate.candidate.changeSet!;
  assert.deepEqual(changeSet.added.map(({ key }) => key), fresh.map(({ id }) => `meeting:${id}`));
  assert.ok(changeSet.added.some(({ key }) => key === `meeting:${edited.id}`));
  assert.deepEqual(changeSet.changed, []);
  assert.deepEqual(changeSet.removed.map(({ key }) => key), [`meeting:${legacy.id}`]);
  assert.deepEqual(
    (first!.candidate.removalEvidence ?? []).map((row) => ({ key: row.key, code: row.code })),
    [{ key: `meeting:${legacy.id}`, code: "SUPERSEDED_BY_OCCURRENCE_IDENTITY" }],
  );
  const payload = first!.outcome.promoted!.payload as { meetings: Meeting[] };
  assert.deepEqual(
    payload.meetings.filter(({ startsAt }) => startsAt === "2026-09-08T22:00:00.000Z").map(({ id, title }) => ({ id, title })),
    [{ id: edited.id, title: "RESCHEDULED Select Brd -9/15" }],
    "one 8 September record, the edited one",
  );
  assert.equal(payload.meetings.some((row) => row.carried), false);
});

test("ICAL-OCC · the first read under occurrence identity replaces the series record: no ghost, no false reschedule", async () => {
  const store = new MemoryRoutineDataStore();
  const cc = partition("bradford-conservation-commission");
  const fresh = normalize([cc.wiring!], READ_1).meetings;
  const legacy = await seedLegacySeriesRecord(
    store,
    fresh.find((row) => row.startsAt === "2026-09-15T23:00:00.000Z")!,
    "2026-09-23T15:13:36.680Z",
  );

  const [first] = await promoteMeetingPartitions({
    store,
    partitions: [cc],
    meetings: fresh,
    agendaDocuments: [],
    reports: [report(READ_1, fresh.length)],
    generatedAt: NOW,
  });
  assert.equal(first?.outcome.candidate.state, "PROMOTED", first?.outcome.candidate.failureDetail ?? "");
  const changeSet = first!.outcome.candidate.candidate.changeSet!;
  assert.deepEqual(changeSet.added.map(({ key }) => key), fresh.map(({ id }) => `meeting:${id}`));
  assert.deepEqual(changeSet.changed, [], "no record reads as rescheduled or cancelled");
  assert.deepEqual(changeSet.removed.map(({ key }) => key).sort(), [
    `agenda-document:${legacy.id}`,
    `meeting:${legacy.id}`,
  ]);
  const evidence = first!.candidate.removalEvidence ?? [];
  assert.deepEqual(
    evidence.map((row) => ({ key: row.key, code: row.code, successorKey: (row as { successorKey?: string }).successorKey })),
    [
      { key: `meeting:${legacy.id}`, code: "SUPERSEDED_BY_OCCURRENCE_IDENTITY", successorKey: `meeting:${CC_SERIES}/20260915T230000Z` },
      { key: `agenda-document:${legacy.id}`, code: "SUPERSEDED_BY_OCCURRENCE_IDENTITY", successorKey: `meeting:${CC_SERIES}/20260915T230000Z` },
    ],
  );
  const payload = first!.outcome.promoted!.payload as { meetings: Meeting[] };
  assert.deepEqual(payload.meetings.map(({ id }) => id), fresh.map(({ id }) => id), "each sitting once, none of them twice");
  assert.equal(payload.meetings.some((row) => row.carried), false, "no ghost of the old record");

  // The second read, in its own order, changes nothing at all.
  const second = normalize([cc.wiring!], READ_2, "2026-09-23T16:12:00.000Z").meetings;
  const [again] = await promoteMeetingPartitions({
    store,
    partitions: [cc],
    meetings: second,
    agendaDocuments: [],
    reports: [report(READ_2, second.length)],
    generatedAt: "2026-09-23T16:12:00.000Z",
  });
  // A validated no-change is confirmed on the pointed version, not republished.
  assert.ok(again!.outcome.confirmed, "the unchanged second read is a confirmation");
  const repeat = again!.outcome.confirmed.recheck.changeSet!;
  assert.deepEqual([repeat.added, repeat.changed, repeat.removed], [[], [], []], "the flip is gone");
});

test("ICAL-OCC · a series record whose fact no current occurrence holds is carried, never removed", () => {
  const cc = partition("bradford-conservation-commission");
  const fresh = normalize([cc.wiring!], READ_1).meetings;
  const stale: Meeting = { ...fresh[0]!, id: CC_SERIES, startsAt: "2026-08-04T23:00:00.000Z" };
  const reconciled = reconcileSuccessfulMeetingPartition({
    sourceName: "ical",
    generatedAt: NOW,
    freshMeetings: fresh,
    freshAgendaDocuments: [],
    previous: {
      formatVersion: 1,
      generatedAt: "2026-09-23T15:13:36.680Z",
      counts: { fresh: 1, carried: 0, total: 1 },
      sources: [{ ...report(READ_2, 1), error: null }],
      meetings: [stale],
      agendaDocuments: [],
    },
  });
  assert.deepEqual(reconciled.removalEvidence, []);
  assert.deepEqual(reconciled.carriedMeetingIds, [CC_SERIES]);
});

test("ICAL-OCC · the promotion door re-derives a supersession claim and refuses one the candidate does not hold", async () => {
  const cc = partition("bradford-conservation-commission");
  const fresh = normalize([cc.wiring!], READ_1).meetings;
  const snapshot = {
    formatVersion: 1 as const,
    generatedAt: NOW,
    counts: { fresh: fresh.length, carried: 0, total: fresh.length },
    sources: [{ ...report(READ_1, fresh.length), error: null }],
    meetings: fresh,
    agendaDocuments: [],
  };
  const claim = (overrides: Partial<{ successorKey: string; priorStartsAt: string }>): RoutineRemovalEvidence[] => [
    {
      key: `meeting:${CC_SERIES}`,
      code: "SUPERSEDED_BY_OCCURRENCE_IDENTITY",
      successorKey: `meeting:${CC_SERIES}/20260915T230000Z`,
      priorStartsAt: "2026-09-15T23:00:00.000Z",
      ...overrides,
    },
    {
      key: `agenda-document:${CC_SERIES}`,
      code: "SUPERSEDED_BY_OCCURRENCE_IDENTITY",
      successorKey: `meeting:${CC_SERIES}/20260915T230000Z`,
      priorStartsAt: "2026-09-15T23:00:00.000Z",
      parentMeetingKey: `meeting:${CC_SERIES}`,
      ...overrides,
    },
  ];
  for (const [label, evidence] of [
    ["another sitting of the series", claim({ successorKey: `meeting:${CC_SERIES}/20260721T230000Z` })],
    ["a key this candidate does not hold", claim({ successorKey: `meeting:${CC_SERIES}/20270105T000000Z` })],
    ["another series", claim({ successorKey: `meeting:${PB_SERIES}/20260922T230000Z` })],
    ["a start the old record never had", claim({ priorStartsAt: "2026-10-20T23:00:00.000Z" })],
  ] as const) {
    const store = new MemoryRoutineDataStore();
    await seedLegacySeriesRecord(store, fifteenth(fresh), "2026-09-23T15:13:36.680Z");
    const before = (await store.readPromotion("MEETING", cc.scope))?.versionId;
    const refused = await promoteMeetingPartition(store, cc, snapshot, [], evidence);
    assert.equal(refused.outcome.candidate.state, "HORIZON_UNRESOLVED", label);
    assert.equal(refused.outcome.candidate.failureCode, "REMOVAL_EVIDENCE_MISMATCH", label);
    assert.equal((await store.readPromotion("MEETING", cc.scope))?.versionId, before, `${label} moved the pointer`);
  }

  // The honest claim, for contrast, promotes.
  const store = new MemoryRoutineDataStore();
  await seedLegacySeriesRecord(store, fifteenth(fresh), "2026-09-23T15:13:36.680Z");
  const accepted = await promoteMeetingPartition(store, cc, snapshot, [], claim({}));
  assert.equal(accepted.outcome.candidate.state, "PROMOTED", accepted.outcome.candidate.failureDetail ?? "");
});

/*
 * Full recorded feeds (DESCRIPTION, ATTENDEE and ORGANIZER removed) and the agenda Google renders for October
 * 2026 of the same calendars, which each town's calendar page embeds. Every listed sitting carries Google's
 * instance id, `<series>_<UTC slot>`: the same slot this adapter keys on.
 */
const BRADFORD_FULL = readFileSync(join(FIXTURES, "bradford-2026-09-23-full.ics"), "utf8");
const WARNER_FULL = readFileSync(join(FIXTURES, "warner-2026-09-23-full.ics"), "utf8");
const NEWBURY_SELECTBOARD = readFileSync(join(FIXTURES, "newbury-2026-09-23-selectboard.ics"), "utf8");
const FULL_READ_AT = "2026-09-23T17:30:01.000Z";

function rowsOn(feedNeedle: string): BodySourceWiring[] {
  return MEETING_PARTITION_CONTRACTS
    .filter((row) => row.meetingSource === "ical" && (row.wiring!.config.feedUrl ?? "").includes(feedNeedle))
    .map((row) => row.wiring!);
}

/** "Tue Oct 20, 2026" and "7pm" / "6:30pm", exactly as the published view writes them. */
function asPublished(iso: string): { date: string; time: string } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    })
      .formatToParts(new Date(iso))
      .map((part) => [part.type, part.value]),
  );
  const minute = parts.minute === "00" ? "" : `:${parts.minute}`;
  return {
    date: `${parts.weekday} ${parts.month} ${parts.day}, ${parts.year}`,
    time: `${parts.hour}${minute}${String(parts.dayPeriod).toLowerCase()}`,
  };
}

/** Each sitting of a series the published view lists: `<stem>_<slot>|date|time|title`. */
function publishedSeriesSittings(html: string): string[] {
  const listed: string[] = [];
  for (const section of html.split('<div class="date-section').slice(1)) {
    const date = /<div class="date">([^<]*)<\/div>/.exec(section)?.[1] ?? "";
    for (const row of section.split('<tr class="event">').slice(1)) {
      const time = /<td class="event-time">([^<]*)<\/td>/.exec(row)?.[1] ?? "";
      const title = (/<span class="event-summary">([^<]*)<\/span>/.exec(row)?.[1] ?? "").replace(/&amp;/g, "&").trim();
      const eid = /eid=([A-Za-z0-9_-]+)/.exec(row)?.[1];
      if (!eid) continue;
      const instance = Buffer.from(eid.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8").split(" ")[0];
      if (!/_\d{8}T\d{6}Z$/.test(instance)) continue;
      listed.push(`${instance}|${date}|${time}|${title}`);
    }
  }
  return listed.sort();
}

/** Google's instance stem for one of our series ids: the UID without `@google.com` or a split's `_R…`. */
function stemOf(seriesId: string): string {
  const uid = seriesId.split(":").slice(2).join(":");
  return uid.replace(/@google\.com$/, "").replace(/_R\d{8}T\d{6}$/, "");
}

for (const [town, feed, needle, view, atLeast] of [
  ["Bradford", BRADFORD_FULL, "bradfordnewhampshire", "bradford-view-2026-10.html", 7],
  ["Warner", WARNER_FULL, "4550fa96", "warner-view-2026-10.html", 7],
] as const) {
  test(`ICAL-OCC · ${town}: every October sitting of a wired series matches the town's published view, both ways`, () => {
    const result = normalize(rowsOn(needle), feed, FULL_READ_AT);
    assert.equal(result.accounting.outcome, "CONSERVED");
    const series = result.meetings
      .map((meeting) => ({ meeting, parts: occurrenceParts(meeting.id) }))
      .filter((row) => row.parts !== null);
    const wiredStems = new Set(series.map(({ parts }) => stemOf(parts!.seriesId)));
    const ours = series
      .filter(({ meeting }) => /Oct \d+, 2026$/.test(asPublished(meeting.startsAt).date))
      .map(({ meeting, parts }) => {
        const shown = asPublished(meeting.startsAt);
        return `${stemOf(parts!.seriesId)}_${parts!.stamp}|${shown.date}|${shown.time}|${meeting.title}`;
      })
      .sort();
    const theirs = publishedSeriesSittings(readFileSync(join(FIXTURES, view), "utf8"))
      .filter((row) => wiredStems.has(row.split("|")[0].replace(/_\d{8}T\d{6}Z$/, "")));
    assert.ok(ours.length >= atLeast, `only ${ours.length} October sittings of wired series`);
    assert.deepEqual(ours, theirs);
  });
}

test("ICAL-OCC · a series keeps its wall clock across the daylight-saving change, and a zone without DST keeps its offset", () => {
  const zba = normalize(wiringFor("bradford-zoning-board"), BRADFORD_FULL, FULL_READ_AT).meetings
    .filter((meeting) => meeting.id.includes("0t8vhcepakgloa5f8dldojgfdh_R20240605T230000"))
    .map(({ startsAt }) => startsAt);
  // First Wednesday at 7pm: EDT until 1 November 2026, EST after it.
  assert.ok(zba.includes("2026-10-07T23:00:00.000Z"));
  assert.ok(zba.includes("2026-11-05T00:00:00.000Z"));
  assert.ok(zba.includes("2026-12-03T00:00:00.000Z"));

  // Hours beside the change itself resolve as RFC 5545 §3.3.5 says.
  assert.equal(parseDtStart("TZID=America/New_York:20261101T030000", "UTC")?.iso, "2026-11-01T08:00:00.000Z");
  assert.equal(parseDtStart("TZID=America/New_York:20261101T013000", "UTC")?.iso, "2026-11-01T05:30:00.000Z", "a repeated hour is its first occurrence");
  assert.equal(parseDtStart("TZID=America/New_York:20260308T023000", "UTC")?.iso, "2026-03-08T07:30:00.000Z", "a skipped hour takes the offset before the gap");

  const phoenix = [
    "BEGIN:VCALENDAR",
    "BEGIN:VEVENT",
    "UID:phoenix-1@example.org",
    "DTSTART;TZID=America/Phoenix:20261021T190000",
    "RRULE:FREQ=WEEKLY;COUNT=3;BYDAY=WE",
    "SUMMARY:Select Board Meeting",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
  assert.deepEqual(
    normalize([SELECT_BOARD_WIRING], phoenix).meetings.map(({ startsAt }) => startsAt),
    ["2026-10-22T02:00:00.000Z", "2026-10-29T02:00:00.000Z", "2026-11-05T02:00:00.000Z"],
    "7pm in Phoenix is 02:00Z on both sides of 1 November",
  );
});

const EC_SERIES = "ical:bradford-energy-committee:03tpdgk3pk8t5fdia85sh9uqhj_R20240618T210000@google.com";

test("ICAL-OCC · a sitting the publisher struck out (EXDATE) is not published, and is named", () => {
  const result = normalize(wiringFor("bradford-energy-committee"), BRADFORD_FULL, FULL_READ_AT);
  const starts = result.meetings.map(({ startsAt }) => startsAt);
  assert.ok(starts.includes("2026-07-21T21:00:00.000Z"));
  assert.ok(!starts.includes("2026-08-18T21:00:00.000Z"), "the struck third Tuesday of August");
  assert.ok(starts.includes("2026-09-15T21:00:00.000Z"));
  assert.deepEqual(result.recurrence?.exclusions, [{
    bodyId: "ocd-division/country:us/state:nh/county:merrimack/place:bradford_town#energy-committee",
    seriesId: EC_SERIES,
    slot: "20260818T210000Z",
    meetingId: `${EC_SERIES}/20260818T210000Z`,
    statedBy: ";TZID=America/New_York:20260818T170000",
  }]);
});

test("ICAL-OCC · a published sitting the publisher later strikes out is removed under EXCLUDED_BY_PUBLISHER, and only then", async () => {
  const ec = partition("bradford-energy-committee");
  const result = normalize([ec.wiring!], BRADFORD_FULL, FULL_READ_AT);
  const fresh = result.meetings;
  const struck: Meeting = {
    ...fresh[0]!,
    id: `${EC_SERIES}/20260818T210000Z`,
    startsAt: "2026-08-18T21:00:00.000Z",
    provenance: { ...fresh[0]!.provenance, collectedAt: "2026-09-20T12:00:00.000Z" },
  };
  const seed = async (store: MemoryRoutineDataStore) => {
    const [seeded] = await promoteMeetingPartitions({
      store,
      partitions: [ec],
      meetings: [struck],
      agendaDocuments: [],
      reports: [report(READ_2, 1)],
      generatedAt: "2026-09-20T12:00:00.000Z",
    });
    assert.equal(seeded?.outcome.candidate.state, "PROMOTED");
  };

  // With the publisher's statement in hand: removed, on that authority.
  const store = new MemoryRoutineDataStore();
  await seed(store);
  const [next] = await promoteMeetingPartitions({
    store,
    partitions: [ec],
    meetings: fresh,
    agendaDocuments: [],
    reports: [{ ...report(BRADFORD_FULL, fresh.length), recurrence: result.recurrence }],
    generatedAt: FULL_READ_AT,
  });
  assert.equal(next?.outcome.candidate.state, "PROMOTED", next?.outcome.candidate.failureDetail ?? "");
  const changeSet = next!.outcome.candidate.candidate.changeSet!;
  assert.deepEqual(changeSet.removed.map(({ key }) => key), [`meeting:${struck.id}`]);
  assert.deepEqual(changeSet.changed, []);
  assert.deepEqual(
    (next!.candidate.removalEvidence ?? []).map((row) => ({ key: row.key, code: row.code })),
    [{ key: `meeting:${struck.id}`, code: "EXCLUDED_BY_PUBLISHER" }],
  );
  assert.ok(changeSet.held.some((fact) => fact.code === "MEETING_EXCLUDED_BY_PUBLISHER" && fact.key === `meeting:${struck.id}`));

  // Without it: an unexplained disappearance, carried and never removed.
  const blind = new MemoryRoutineDataStore();
  await seed(blind);
  const [carried] = await promoteMeetingPartitions({
    store: blind,
    partitions: [ec],
    meetings: fresh,
    agendaDocuments: [],
    reports: [report(BRADFORD_FULL, fresh.length)],
    generatedAt: FULL_READ_AT,
  });
  assert.deepEqual(carried!.outcome.candidate.candidate.changeSet!.removed, []);
  const payload = carried!.outcome.promoted!.payload as { meetings: Meeting[] };
  assert.equal(payload.meetings.find(({ id }) => id === struck.id)?.carried?.reason, "UNEXPLAINED_DISAPPEARANCE");

  // A claim the read did not make is refused at the door.
  const forged = new MemoryRoutineDataStore();
  await seed(forged);
  const before = (await forged.readPromotion("MEETING", ec.scope))?.versionId;
  const refused = await promoteMeetingPartition(forged, ec, {
    formatVersion: 1,
    generatedAt: FULL_READ_AT,
    counts: { fresh: fresh.length, carried: 0, total: fresh.length },
    sources: [{ ...report(BRADFORD_FULL, fresh.length), error: null }],
    meetings: fresh,
    agendaDocuments: [],
  }, [], [{
    key: `meeting:${struck.id}`,
    code: "EXCLUDED_BY_PUBLISHER",
    seriesId: EC_SERIES,
    slot: "20260818T210000Z",
    priorStartsAt: struck.startsAt,
  }]);
  assert.equal(refused.outcome.candidate.state, "HORIZON_UNRESOLVED");
  assert.equal(refused.outcome.candidate.failureCode, "REMOVAL_EVIDENCE_MISMATCH");
  assert.equal((await forged.readPromotion("MEETING", ec.scope))?.versionId, before);

  // The same for a series' UID-only record at the struck slot: removed only
  // on this read's own held statement, refused without it.
  const legacyStore = async () => {
    const store = new MemoryRoutineDataStore();
    const [seeded] = await promoteMeetingPartitions({
      store,
      partitions: [ec],
      meetings: [{ ...struck, id: EC_SERIES }],
      agendaDocuments: [],
      reports: [report(READ_2, 1)],
      generatedAt: "2026-09-20T12:00:00.000Z",
    });
    assert.equal(seeded?.outcome.candidate.state, "PROMOTED");
    return store;
  };
  const snapshot = {
    formatVersion: 1 as const,
    generatedAt: FULL_READ_AT,
    counts: { fresh: fresh.length, carried: 0, total: fresh.length },
    sources: [{ ...report(BRADFORD_FULL, fresh.length), error: null }],
    meetings: fresh,
    agendaDocuments: [],
  };
  const legacyClaim: RoutineRemovalEvidence[] = [{
    key: `meeting:${EC_SERIES}`,
    code: "EXCLUDED_BY_PUBLISHER",
    seriesId: EC_SERIES,
    slot: "20260818T210000Z",
    priorStartsAt: struck.startsAt,
  }];
  const unstated = await promoteMeetingPartition(await legacyStore(), ec, snapshot, [], legacyClaim);
  assert.equal(unstated.outcome.candidate.failureCode, "REMOVAL_EVIDENCE_MISMATCH", "no held statement, no removal");
  const statedHeld = recurrenceHeldFacts(result.recurrence, ec.bodyId).held;
  const stated = await promoteMeetingPartition(await legacyStore(), ec, snapshot, [], legacyClaim, [], statedHeld);
  assert.equal(stated.outcome.candidate.state, "PROMOTED", stated.outcome.candidate.failureDetail ?? "");
});

test("ICAL-OCC · a rule part not supported is a named failure: the series' own sittings publish and nothing is guessed", async () => {
  const sb = partition("warner-select-board");
  const ics = [
    "BEGIN:VCALENDAR",
    "BEGIN:VEVENT",
    "UID:monthday-1@example.org",
    "DTSTART;TZID=America/New_York:20261015T190000",
    "RRULE:FREQ=MONTHLY;BYMONTHDAY=15",
    "SUMMARY:Select Board Meeting",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "UID:monthday-1@example.org",
    "RECURRENCE-ID;TZID=America/New_York:20261115T190000",
    "DTSTART;TZID=America/New_York:20261116T190000",
    "SUMMARY:Select Board Meeting",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
  const result = normalize([sb.wiring!], ics);
  const series = "ical:warner-select-board:monthday-1@example.org";
  assert.deepEqual(result.meetings.map(({ id, startsAt }) => ({ id, startsAt })), [
    { id: `${series}/20261015T230000Z`, startsAt: "2026-10-15T23:00:00.000Z" },
    { id: `${series}/20261116T000000Z`, startsAt: "2026-11-17T00:00:00.000Z" },
  ], "the series' own first sitting and its edited sitting; no 15 December is inferred");
  assert.equal(result.recurrence?.expandedSeries, 0);
  assert.equal(result.recurrence?.notExpanded.length, 1);
  assert.equal(result.recurrence?.notExpanded[0]?.reason, "UNSUPPORTED_RULE");
  assert.equal(result.recurrence?.notExpanded[0]?.seriesId, series);
  assert.match(result.recurrence?.notExpanded[0]?.detail ?? "", /^BYMONTHDAY is not supported/);

  // It reaches the partition's candidate as a held fact, and the partition still promotes.
  const store = new MemoryRoutineDataStore();
  const [promoted] = await promoteMeetingPartitions({
    store,
    partitions: [sb],
    meetings: result.meetings,
    agendaDocuments: [],
    reports: [{ ...report(ics, result.meetings.length, WARNER_FEED), recurrence: result.recurrence }],
    generatedAt: NOW,
  });
  assert.equal(promoted?.outcome.candidate.state, "PROMOTED", promoted?.outcome.candidate.failureDetail ?? "");
  const held = promoted!.outcome.candidate.candidate.changeSet!.held;
  assert.ok(held.some((fact) =>
    fact.code === "ICAL_SERIES_RULE_UNSUPPORTED" && fact.key === `meeting-series:${series}` && /BYMONTHDAY/.test(fact.detail)));
});

test("ICAL-OCC · an RDATE adds a sitting to its series; an RDATE period is refused by name", () => {
  const withRdate = (rdate: string) => [
    "BEGIN:VCALENDAR",
    "BEGIN:VEVENT",
    "UID:rdate-1@example.org",
    "DTSTART;TZID=America/New_York:20261006T180000",
    "RRULE:FREQ=WEEKLY;COUNT=2;BYDAY=TU",
    rdate,
    "SUMMARY:Select Board Meeting",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
  const series = "ical:warner-select-board:rdate-1@example.org";
  const added = normalize([SELECT_BOARD_WIRING], withRdate("RDATE;TZID=America/New_York:20261029T180000"));
  assert.deepEqual(added.meetings.map(({ id, startsAt }) => ({ id, startsAt })), [
    { id: `${series}/20261006T220000Z`, startsAt: "2026-10-06T22:00:00.000Z" },
    { id: `${series}/20261013T220000Z`, startsAt: "2026-10-13T22:00:00.000Z" },
    { id: `${series}/20261029T220000Z`, startsAt: "2026-10-29T22:00:00.000Z" },
  ]);
  assert.equal(added.accounting.outcome, "CONSERVED");

  const period = normalize([SELECT_BOARD_WIRING], withRdate("RDATE;VALUE=PERIOD:20261029T220000Z/PT2H"));
  assert.deepEqual(period.meetings.map(({ id }) => id), [`${series}/20261006T220000Z`], "the series' own first sitting only");
  assert.equal(period.recurrence?.notExpanded[0]?.detail.startsWith("RDATE as a period is not supported"), true);
});

test("ICAL-OCC · the rule reader names every part it refuses", () => {
  for (const [rule, part] of [
    ["FREQ=DAILY;COUNT=3", "FREQ=DAILY"],
    ["FREQ=MONTHLY;BYDAY=2TU;BYSETPOS=1", "BYSETPOS"],
    ["FREQ=MONTHLY;COUNT=12;BYDAY=+2TU;BYMONTH=1,2", "BYMONTH"],
    ["FREQ=WEEKLY;BYDAY=2TU", "BYDAY=2TU under FREQ=WEEKLY"],
    ["FREQ=WEEKLY;BYDAY=TU;COUNT=3;UNTIL=20261231T000000Z", "UNTIL together with COUNT"],
    ["FREQ=WEEKLY;BYDAY=TU;UNTIL=20261231T000000", "UNTIL=20261231T000000 on a date-time series"],
    ["FREQ=MONTHLY", "FREQ=MONTHLY without BYDAY"],
  ] as const) {
    const reading = readRule(rule, false);
    assert.equal(reading.ok, false, rule);
    if (!reading.ok) assert.equal(reading.unsupported, part, rule);
  }
  for (const rule of [
    "FREQ=WEEKLY;WKST=SU;INTERVAL=4;BYDAY=TU",
    "FREQ=MONTHLY;UNTIL=20240805T035959Z;BYDAY=3WE",
    "FREQ=WEEKLY;COUNT=3;BYDAY=TH",
    "FREQ=WEEKLY;UNTIL=20240805T035959Z;BYDAY=FR,MO,TH,TU,WE",
  ]) {
    assert.equal(readRule(rule, false).ok, true, rule);
  }
  assert.equal(readRule("FREQ=MONTHLY;UNTIL=20260414;BYDAY=3WE", true).ok, true, "a date UNTIL on an all-day series");
});

test("ICAL-OCC · a feed that restates the series' rule on every sitting is read event by event", () => {
  const governing = partition("newbury-ical-governing");
  const result = normalize([governing.wiring!], NEWBURY_SELECTBOARD, FULL_READ_AT);
  const uids = new Set(parseIcs(NEWBURY_SELECTBOARD).map((event) => event.uid));
      // 24 events in the held 120-day window select, and sittings listed twice under two series with every published field identical are one: 17 sittings.
  assert.equal(result.meetings.length, 17);
  assert.equal(result.duplicateIdentity?.publisherRelisted, 7);
  for (const meeting of result.meetings) {
    assert.equal(occurrenceParts(meeting.id), null, `${meeting.id} kept its single-event id`);
    assert.ok(uids.has(meeting.id.slice("ical:newbury-ical-governing:".length)));
  }
  assert.equal(result.recurrence?.expandedSeries, 0);
  assert.deepEqual(result.recurrence?.notExpanded.map(({ reason, seriesId }) => ({ reason, seriesId })), [
    { reason: "RULE_RESTATED_ON_PUBLISHED_SITTINGS", seriesId: null },
  ]);
  assert.equal(result.accounting.outcome, "CONSERVED");
});
