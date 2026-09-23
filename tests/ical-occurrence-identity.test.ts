/**
 * **ONE SITTING OF A RECURRING iCALENDAR SERIES IS ONE RECORD.** (2026-09-23.)
 *
 * The defect, measured in production (read-only): a Google Calendar series is
 * one `UID` across a master and its overrides, and `ical` keyed a meeting on
 * the `UID` alone. Every sitting of the series competed for one id, the first
 * event in feed order won, and Google serves its `.ics` in a different order
 * on every request. Between 2026-09-14 and 09-23 the Town of Bradford
 * Conservation Commission's one record moved its start 51 times across five
 * sittings; Warner's Zoning Board record 39 times across three, alternating a
 * held meeting with a cancelled one. A reader saw one sitting or another, and
 * never all of them.
 *
 * No live calls. The fixtures are RECORDED reads of the towns' own public
 * calendars, trimmed to the named series:
 *
 * - `bradford-2026-09-23-read-1.ics` and `-read-2.ics`: two reads of
 *   `calendar.google.com/calendar/ical/bradfordnewhampshire%40gmail.com/
 *   public/basic.ics`, taken 2026-09-23T16:05:27Z and 16:06:09Z (full feeds
 *   277,516 bytes each, sha256 8293df6d… and e91c159f…). Kept: every event of
 *   the Conservation Commission series (`qnahpc95…`), of the Planning Board
 *   series (`64q7u3of…_R20240528T230000`), and one Budget Committee event
 *   outside any series (`2issdnlf…`).
 * - `warner-2026-09-23.ics`: one read of Warner's calendar
 *   (`4550fa96…%40group.calendar.google.com`), 2026-09-23T15:49:14Z, 260,603
 *   bytes, sha256 881c6862…. Kept: the Zoning Board series
 *   (`6p16gsvl…_R20250213T000000`), the Conservation Commission series
 *   (`4qfd6hqi…`) and one Select Board series (`42cp3onv…`).
 *
 * Each event block is byte-for-byte as served, in the order served, except
 * that `DESCRIPTION` is removed: the adapter never reads it, and Warner's
 * carries agenda links that name private variance applicants.
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
import { makeIcalSource, parseIcs, slotStamp } from "../lib/sources/ical/index.ts";
import type { Meeting } from "../lib/sources/types.ts";
import {
  promoteMeetingPartition,
  promoteMeetingPartitions,
  reconcileSuccessfulMeetingPartition,
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
    (row) => row.meetingSource === "ical" && row.wiring.config.slug === slug,
  );
  assert.ok(found, `no ${slug} partition is wired — this guard is stale`);
  return found;
}

function wiringFor(...slugs: string[]): BodySourceWiring[] {
  return slugs.map((slug) => partition(slug).wiring);
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

/* ------------------------------------------ the defect, from the bytes --- */

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

/* ----------------------------------------------------------- the fix --- */

test("ICAL-OCC · every sitting of the Conservation Commission series is its own record", () => {
  const { meetings, accounting, duplicateIdentity } = normalize(
    wiringFor("bradford-conservation-commission"),
    READ_1,
  );
  assert.deepEqual(
    meetings.map(({ id, startsAt, status }) => ({ id, startsAt, status })),
    [
      // The master: its own DTSTART is the slot of its first sitting.
      { id: `${CC_SERIES}/20260721T230000Z`, startsAt: "2026-07-21T23:00:00.000Z", status: "CONCLUDED" },
      { id: `${CC_SERIES}/20260915T230000Z`, startsAt: "2026-09-15T23:00:00.000Z", status: "CONCLUDED" },
      // Moved by the town from 13 to 20 October: the id is the SLOT it replaced.
      { id: `${CC_SERIES}/20261013T230000Z`, startsAt: "2026-10-20T23:00:00.000Z", status: "SCHEDULED" },
      // 10 November at 7pm Eastern (standard time) is 00:00Z on the 11th.
      { id: `${CC_SERIES}/20261111T000000Z`, startsAt: "2026-11-18T00:00:00.000Z", status: "SCHEDULED" },
      { id: `${CC_SERIES}/20261209T000000Z`, startsAt: "2026-12-16T00:00:00.000Z", status: "SCHEDULED" },
    ],
  );
  assert.deepEqual(duplicateIdentity, { exact: 0, weakIdCollision: 0 }, "no sitting competes for another's id");
  assert.equal(accounting.outcome, "CONSERVED");
});

test("ICAL-OCC · the same events in any order produce the same meetings", () => {
  const wiring = wiringFor(
    "bradford-conservation-commission",
    "bradford-planning-board",
    "bradford-budget-committee",
  );
  const expected = normalize(wiring, READ_1).meetings;
  assert.equal(expected.length, 8);
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
    (row) => row.meetingSource === "ical" && (row.wiring.config.feedUrl ?? "").includes("wilmotnh.org"),
  ).map((row) => row.wiring);
  const events = parseIcs(wilmot);
  const produced = normalize(rows, wilmot, "2026-08-19T12:00:00.000Z").meetings;
  assert.ok(produced.length >= 10);
  for (const meeting of produced) {
    const uid = events.find((event) => meeting.id.endsWith(`:${event.uid}`))?.uid;
    assert.ok(uid, `${meeting.id} is not \`ical:<slug>:<UID>\``);
    assert.equal(occurrenceParts(meeting.id), null);
  }
});

test("ICAL-OCC · Warner's Zoning Board: the master is out of window and each in-window override is its own sitting", () => {
  const { meetings } = normalize(wiringFor("warner-zoning-board"), WARNER);
  assert.deepEqual(
    meetings.map(({ id, startsAt, status, title }) => ({ id, startsAt, status, title })),
    [
      { id: `${ZBA_SERIES}/20260708T230000Z`, startsAt: "2026-07-08T23:00:00.000Z", status: "CANCELED", title: "CANCELED Zoning Board Meeting" },
      { id: `${ZBA_SERIES}/20260812T230000Z`, startsAt: "2026-08-12T23:00:00.000Z", status: "CONCLUDED", title: "Zoning Board Meeting" },
      { id: `${ZBA_SERIES}/20260909T230000Z`, startsAt: "2026-09-09T23:00:00.000Z", status: "CANCELED", title: "CANCELED Zoning Board Meeting" },
    ],
    "the held meeting and the two cancelled ones are three records, never one alternating",
  );
});

test("ICAL-OCC · an override of a series' first sitting replaces it, whichever is listed first", () => {
  /*
   * Warner's Select Board series `42cp3onv…` starts 8 September, and the town
   * edited that first sitting to read "RESCHEDULED Select Brd -9/15". The old
   * adapter always produced "Select Board Meeting" on 8 September from the
   * master: a sitting the town had moved. The override now speaks for that
   * slot. Its own title is not this board's, so nothing is produced for it,
   * and the master's first sitting is a counted duplicate, not a meeting.
   */
  const wiring = wiringFor("warner-select-board");
  const selectBoard = (ics: string) =>
    normalize(wiring, ics).meetings.filter((meeting) => meeting.id.includes("42cp3onvveme22uorqju8uhu34"));
  assert.deepEqual(selectBoard(WARNER), []);
  assert.deepEqual(selectBoard(reordered(WARNER, (all) => [...all].reverse())), []);

  const result = normalize(wiring, WARNER);
  assert.equal(result.duplicateIdentity?.exact, 1, "the master's first sitting, published again by its override");
  assert.equal(result.accounting.outcome, "CONSERVED");
});

/* ------------------------------------- two events claiming one sitting --- */

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

/* ------------------------------------------------------- the helpers --- */

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

/* ------------------------------------ the first read under the new id --- */

function acquisitions(ics: string) {
  return [{
    source: "ical",
    requestedUrl: BRADFORD_FEED,
    finalUrl: BRADFORD_FEED,
    httpStatus: 200,
    rawHash: createHash("sha256").update(ics).digest("hex"),
    byteCount: Buffer.byteLength(ics),
  }];
}

function report(ics: string, rows: number) {
  return {
    source: "ical",
    ok: true,
    error: null,
    fetched: rows,
    normalized: rows,
    drops: { placeless: 0, unknownVenue: 0, unplaceableInTime: 0, notConfigured: 0 },
    acquisitions: acquisitions(ics),
  };
}

/**
 * What production holds today: ONE row under the series' `UID`-only id,
 * showing whichever sitting its last read listed first (15 September at
 * 15:13Z), with the town's calendar page stored against it.
 */
async function seedLegacySeriesRecord(store: MemoryRoutineDataStore, sitting: Meeting, seededAt: string) {
  const legacy: Meeting = {
    ...sitting,
    id: CC_SERIES,
    provenance: { ...sitting.provenance, collectedAt: seededAt },
  };
  const page: AgendaDocument = {
    id: `${CC_SERIES}@${"a".repeat(64)}`,
    meetingId: CC_SERIES,
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
    partitions: [partition("bradford-conservation-commission")],
    meetings: [legacy],
    agendaDocuments: [page],
    reports: [report(READ_2, 1)],
    generatedAt: seededAt,
  });
  assert.equal(seeded?.outcome.candidate.state, "PROMOTED");
  return legacy;
}

test("ICAL-OCC · the first read under occurrence identity replaces the series record: no ghost, no false reschedule", async () => {
  const store = new MemoryRoutineDataStore();
  const cc = partition("bradford-conservation-commission");
  const fresh = normalize([cc.wiring], READ_1).meetings;
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
  assert.deepEqual(payload.meetings.map(({ id }) => id), fresh.map(({ id }) => id), "five sittings, none of them twice");
  assert.equal(payload.meetings.some((row) => row.carried), false, "no ghost of the old record");

  // The second read, in its own order, changes nothing at all.
  const second = normalize([cc.wiring], READ_2, "2026-09-23T16:12:00.000Z").meetings;
  const [again] = await promoteMeetingPartitions({
    store,
    partitions: [cc],
    meetings: second,
    agendaDocuments: [],
    reports: [report(READ_2, second.length)],
    generatedAt: "2026-09-23T16:12:00.000Z",
  });
  const repeat = again!.outcome.candidate.candidate.changeSet!;
  assert.deepEqual([repeat.added, repeat.changed, repeat.removed], [[], [], []], "the flip is gone");
});

test("ICAL-OCC · a series record whose fact no current occurrence holds is carried, never removed", () => {
  const cc = partition("bradford-conservation-commission");
  const fresh = normalize([cc.wiring], READ_1).meetings;
  const stale: Meeting = { ...fresh[0]!, id: CC_SERIES, startsAt: "2026-08-18T23:00:00.000Z" };
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
  const fresh = normalize([cc.wiring], READ_1).meetings;
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
    await seedLegacySeriesRecord(store, fresh[1]!, "2026-09-23T15:13:36.680Z");
    const before = (await store.readPromotion("MEETING", cc.scope))?.versionId;
    const refused = await promoteMeetingPartition(store, cc, snapshot, [], evidence);
    assert.equal(refused.outcome.candidate.state, "HORIZON_UNRESOLVED", label);
    assert.equal(refused.outcome.candidate.failureCode, "REMOVAL_EVIDENCE_MISMATCH", label);
    assert.equal((await store.readPromotion("MEETING", cc.scope))?.versionId, before, `${label} moved the pointer`);
  }

  // The honest claim, for contrast, promotes.
  const store = new MemoryRoutineDataStore();
  await seedLegacySeriesRecord(store, fresh[1]!, "2026-09-23T15:13:36.680Z");
  const accepted = await promoteMeetingPartition(store, cc, snapshot, [], claim({}));
  assert.equal(accepted.outcome.candidate.state, "PROMOTED", accepted.outcome.candidate.failureDetail ?? "");
});
