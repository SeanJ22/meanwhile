import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { MEETING_PARTITION_CONTRACTS } from "../lib/civic-data/meeting-partitions.ts";
import { makeIcalSource, movedOffItsDay, parseDtStart } from "../lib/sources/ical/index.ts";

/** A sitting the body moved off its day was not held on it: every rescheduled or postponed summary in the recorded feeds, as published. */

const FIXTURES = join(process.cwd(), "tests", "fixtures", "ical");
const ZONE = "America/New_York";

/** What each recorded summary says about the sitting it is on. */
const EXPECTED: Readonly<Record<string, "MOVED_OFF" | "HELD_HERE">> = {
  "RESCHEDULED Select Brd -9/15": "MOVED_OFF",
  "Rescheduled Select Board Mt 9/29": "MOVED_OFF",
  "P&R Rescheduled to 9/21": "MOVED_OFF",
  "Budget Mgts Rescheduled to 2/13": "MOVED_OFF",
  "RESCHEDULED Electricity Rural Areas To 2/28/26": "MOVED_OFF",
  "Postponed to 2/27 - Movie Night!": "MOVED_OFF",
  "Postponed-Cemetery Commission": "MOVED_OFF",
  // The moved sitting itself, on its new day.
  "Select Board (rescheduled from 10/13)": "HELD_HERE",
  "SB Rescheduled 12/15/25 SB Mtg": "HELD_HERE",
  "Select Board Meeting Rescheduled": "HELD_HERE",
  // Names no day, so it says nothing about which end this is.
  "Rescheduled Planning Board MTG": "HELD_HERE",
  // Canceled outright; the cancel check reads it before this rule does.
  "CANCEL SB Wk Sess RESCHEDULED 12/15 9pm": "MOVED_OFF",
};

interface RecordedEvent {
  readonly file: string;
  readonly summary: string;
  readonly startsAt: string;
}

function recordedMovedEvents(): RecordedEvent[] {
  const events: RecordedEvent[] = [];
  for (const file of readdirSync(FIXTURES).filter((name) => name.endsWith(".ics"))) {
    for (const block of readFileSync(join(FIXTURES, file), "utf8").split("BEGIN:VEVENT").slice(1)) {
      const summary = /^SUMMARY:(.*)$/m.exec(block)?.[1]?.replace(/\r$/, "").trim();
      const dtstart = /^DTSTART(.*)$/m.exec(block)?.[1]?.replace(/\r$/, "");
      if (!summary || !dtstart || !/reschedul|postpon/i.test(summary)) continue;
      const start = parseDtStart(dtstart, ZONE);
      assert.ok(start, `${file}: DTSTART${dtstart} cannot be placed`);
      events.push({ file, summary, startsAt: start.iso });
    }
  }
  return events;
}

test("every rescheduled or postponed summary in the recorded feeds is read for the day it names", () => {
  const events = recordedMovedEvents();
  assert.ok(events.length >= 12, `only ${events.length} recorded moved-sitting summaries`);
  for (const event of events) {
    const expected = EXPECTED[event.summary];
    assert.ok(expected, `${event.file}: "${event.summary}" has no stated expectation; add it`);
    if (/\bcancel/i.test(event.summary)) continue;
    assert.equal(
      movedOffItsDay(event.summary, event.startsAt, ZONE),
      expected === "MOVED_OFF",
      `${event.file}: "${event.summary}" on ${event.startsAt}`,
    );
  }
});

function wiring(slug: string) {
  const found = MEETING_PARTITION_CONTRACTS.find((row) => row.meetingSource === "ical" && row.wiring!.config.slug === slug);
  assert.ok(found, `no ${slug} partition is wired; this guard is stale`);
  return found.wiring!;
}

function read(slugs: readonly string[], file: string, readAt: string) {
  const rows = slugs.map(wiring);
  const ics = readFileSync(join(FIXTURES, file), "utf8");
  return makeIcalSource(rows).normalizeWithDrops(
    rows.map((row) => ({ wiring: row, ics, collectedAt: readAt, sourceUrl: row.config.feedUrl ?? "" })),
    new Date(readAt),
  ).meetings;
}

test("Warner's three moved sittings of September 2026 are served as not held; the moved-to sitting is scheduled", () => {
  const meetings = read(["warner-select-board", "warner-parks-and-recreation"], "warner-2026-09-23-full.ics", "2026-09-23T17:30:01.000Z");
  const byTitle = (title: string) => {
    const found = meetings.filter((meeting) => meeting.title === title);
    assert.equal(found.length, 1, `"${title}" is served ${found.length} times`);
    return found[0]!;
  };
  assert.equal(byTitle("RESCHEDULED Select Brd -9/15").status, "CANCELED");
  assert.equal(byTitle("Rescheduled Select Board Mt 9/29").status, "CANCELED");
  assert.equal(byTitle("P&R Rescheduled to 9/21").status, "CANCELED");
  assert.equal(byTitle("Select Board Meeting Rescheduled").status, "SCHEDULED");
});

test("a sitting whose summary says CANCEL, without the -ed, is served as canceled", () => {
  const meetings = read(["warner-select-board"], "warner-2026-09-23-full.ics", "2025-11-10T12:00:00.000Z");
  const sitting = meetings.find((meeting) => meeting.title === "CANCEL Select Board Meeting");
  assert.ok(sitting, "the recorded 2025-11-11 sitting is not in the read");
  assert.equal(sitting.status, "CANCELED");
});
