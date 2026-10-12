import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { MEETING_PARTITION_CONTRACTS } from "../lib/civic-data/meeting-partitions.ts";
import { makeIcalSource } from "../lib/sources/ical/index.ts";

/**
 * An EXDATE equal to DTSTART strikes the sitting the series is anchored on, on both the expanded path and
 * a refused rule's first-only path. The event is a town's recorded series event, read as a read before
 * that sitting would have read it.
 */

const BRADFORD_FULL = readFileSync(join(process.cwd(), "tests", "fixtures", "ical", "bradford-2026-09-23-full.ics"), "utf8");
const READ_AT = "2021-11-10T12:00:00.000Z";
const ORIGINAL = "ical:bradford-energy-committee:03tpdgk3pk8t5fdia85sh9uqhj@google.com";
const FIRST_SLOT = "20211116T220000Z";
const STATED_BY = ";TZID=America/New_York:20211116T170000";

const energyCommittee = MEETING_PARTITION_CONTRACTS.find(
  (row) => row.meetingSource === "ical" && row.wiring!.config.slug === "bradford-energy-committee",
);

function read(ics: string) {
  assert.ok(energyCommittee, "no bradford-energy-committee partition is wired; this guard is stale");
  const wiring = energyCommittee.wiring!;
  return makeIcalSource([wiring]).normalizeWithDrops(
    [{ wiring, ics, collectedAt: READ_AT, sourceUrl: wiring.config.feedUrl ?? "" }],
    new Date(READ_AT),
  );
}

/** The recorded series event, exactly as the town serves it. */
function originalSeriesEvent(): string {
  const block = BRADFORD_FULL.split("BEGIN:VEVENT").slice(1)
    .map((body) => `BEGIN:VEVENT${body.split("END:VEVENT")[0]}END:VEVENT\r\n`)
    .find((event) => event.includes("UID:03tpdgk3pk8t5fdia85sh9uqhj@google.com") && event.includes("RRULE:"));
  assert.ok(block, "the recorded feed no longer holds the Energy Committee's first series");
  assert.match(block, /^DTSTART;TZID=America\/New_York:20211116T170000\r?$/m);
  assert.match(block, /^EXDATE;TZID=America\/New_York:20211116T170000\r?$/m);
  return block;
}

function feedOf(...events: string[]): string {
  return `${BRADFORD_FULL.slice(0, BRADFORD_FULL.indexOf("BEGIN:VEVENT"))}${events.join("")}END:VCALENDAR\r\n`;
}

test("an expanded series whose EXDATE is its first sitting publishes from the second, and names the first", () => {
  const result = read(feedOf(originalSeriesEvent()));
  const ids = result.meetings.map(({ id }) => id);
  assert.ok(!ids.includes(`${ORIGINAL}/${FIRST_SLOT}`), "the struck first sitting was published");
  assert.ok(ids.includes(`${ORIGINAL}/20211221T220000Z`), "the next third Tuesday was not published");
  assert.deepEqual(result.recurrence?.exclusions, [{
    bodyId: energyCommittee!.wiring!.bodyId,
    seriesId: ORIGINAL,
    slot: FIRST_SLOT,
    meetingId: `${ORIGINAL}/${FIRST_SLOT}`,
    statedBy: STATED_BY,
  }]);
  assert.deepEqual(result.recurrence?.notExpanded, []);
});

test("a refused rule whose EXDATE is its first sitting publishes nothing for the series, and names both", () => {
  const refused = originalSeriesEvent()
    .replace(/^RRULE:.*$/m, "RRULE:FREQ=YEARLY;UNTIL=20240618T035959Z");
  const result = read(feedOf(refused));
  assert.deepEqual(result.meetings.filter(({ id }) => id.startsWith(ORIGINAL)).map(({ id }) => id), [],
    "a refused series published its struck first sitting");
  assert.deepEqual(result.recurrence?.exclusions.map(({ seriesId, slot, statedBy }) => ({ seriesId, slot, statedBy })), [
    { seriesId: ORIGINAL, slot: FIRST_SLOT, statedBy: STATED_BY },
  ]);
  assert.deepEqual(result.recurrence?.notExpanded.map(({ seriesId, reason }) => ({ seriesId, reason })), [
    { seriesId: ORIGINAL, reason: "UNSUPPORTED_RULE" },
  ]);
});
