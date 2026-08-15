import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { wiringForTypes } from "../lib/registry/source-wiring.ts";
import {
  makeSchedulePageSource,
  parseDocuments,
  parseSchedule,
  parseStatedTime,
} from "../lib/sources/schedulepage/index.ts";

/**
 * The published-annual-schedule shape — M78, 2026-08-15.
 *
 * Against pages recorded from mhrd.org on 2026-08-15. No live calls.
 *
 * `NOW` is fixed so SCHEDULED/CONCLUDED and the window clip are deterministic.
 * The window is [NOW − 90d, NOW + 60d] = [2026-05-17, 2026-10-14], which is
 * what makes the count assertions below meaningful rather than incidental.
 */
const NOW = new Date("2026-08-15T12:00:00-04:00");

const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/schedulepage/${name}`, import.meta.url), "utf8");

const SCHEDULE = fixture("mhrd-boe-meetings.html");
const DOCUMENTS = fixture("mhrd-board-agendas.html");

const wiring = () => {
  const row = wiringForTypes(["SCHEDULEPAGE"]).find(
    (w) => w.config.slug === "mhrd",
  );
  assert.ok(row, "the Morris Hills wiring row is missing");
  return row;
};

test("the schedule page's whole year parses, and only the schedule", () => {
  const sittings = parseSchedule(SCHEDULE);

  // The district publishes twelve sittings: Jan 26 2026 through Jan 4 2027.
  // A minimum would let a selector that matched three pass as a clean run,
  // so this is the exact count and the exact endpoints.
  assert.equal(sittings.length, 12, JSON.stringify(sittings.map((s) => s.date)));
  assert.equal(sittings[0].date, "2026-01-26");
  assert.equal(sittings[11].date, "2027-01-04");

  // Every date is well-formed and strictly ascending — no duplicates from the
  // page's own repeated navigation.
  for (let i = 1; i < sittings.length; i++) {
    assert.match(sittings[i].date, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(sittings[i].date > sittings[i - 1].date, "dates out of order");
  }

  // The weekday prefix is required precisely so a footer date or a news
  // teaser cannot become a meeting. A bare date must not parse.
  assert.deepEqual(parseSchedule("<p>August 17, 2026</p>"), []);
});

test("the start time is read from the page's own sentence, never defaulted", () => {
  const stated = parseStatedTime(SCHEDULE);
  assert.deepEqual(stated, { hour: 18, minute: 30 }, "6:30 P.M.");

  // A page with no such sentence yields null — which is what makes the
  // day-only shape honest instead of a 10am guess.
  assert.equal(parseStatedTime("<p>Monday, January 26, 2026</p>"), null);
  // Noon and midnight are the two the 12-hour clock gets wrong.
  assert.deepEqual(parseStatedTime("meetings begin at 12:00 P.M."), {
    hour: 12,
    minute: 0,
  });
  assert.deepEqual(parseStatedTime("meetings begin at 12:30 A.M."), {
    hour: 0,
    minute: 30,
  });
});

test("documents join by the date the body wrote in the link text", () => {
  const docs = parseDocuments(DOCUMENTS);
  assert.ok(docs.size >= 20, `only ${docs.size} dated documents`);

  const aug = docs.get("2026-08-17");
  assert.ok(aug, "the August 17 agenda is missing");
  assert.match(aug, /08172026AGENDAFINAL\.pdf/);

  // A page date with no document must not inherit a neighbour's.
  assert.equal(docs.get("2026-09-28"), undefined);
});

test("normalize windows the year, times it from the page, and cites its source", () => {
  const row = wiring();
  const source = makeSchedulePageSource([row]);
  const { meetings, drops } = source.normalizeWithDrops(
    [
      {
        wiring: row,
        schedule: SCHEDULE,
        documents: DOCUMENTS,
        collectedAt: NOW.toISOString(),
      },
    ],
    NOW,
  );

  // Of the twelve published sittings, three fall inside [May 17, Oct 14]:
  // June 15, August 17, September 28. The other nine are a deliberate window
  // clip, not drops — which is why the drop counts are all zero.
  assert.deepEqual(
    meetings.map((m) => m.startsAt.slice(0, 10)),
    ["2026-06-15", "2026-08-17", "2026-09-28"],
  );
  assert.equal(drops.unknownVenue, 0);
  assert.equal(drops.placeless, 0);
  assert.equal(drops.unplaceableInTime, 0);

  for (const m of meetings) {
    assert.equal(m.bodyName, "Board of Education");
    assert.equal(m.jurisdiction, "Morris Hills Regional School District, NJ");
    assert.equal(m.location.address, "48 Knoll Drive, Rockaway, NJ 07866");
    assert.ok(Number.isFinite(m.location.lat) && Number.isFinite(m.location.lng));
    // 6:30 P.M. Eastern in June/August/September is UTC-4.
    assert.match(m.startsAt, /T18:30:00-04:00$/);
    // The page it was read from, not a constructed permalink.
    assert.equal(
      m.provenance.sourceUrl,
      "https://www.mhrd.org/administration/board-of-education/boe-meetings",
    );
    // A stated time means no DAY precision — the two must never both be set.
    assert.equal(m.startPrecision, undefined);
  }

  // Aug 17 is two days AFTER NOW and its agenda is already published — the
  // useful case, and the one a reader can still act on.
  const aug = meetings.find((m) => m.startsAt.startsWith("2026-08-17"));
  assert.ok(aug);
  assert.equal(aug.status, "SCHEDULED");
  assert.match(aug.agendaUrl ?? "", /08172026AGENDAFINAL\.pdf/);

  // June 15 is inside the 90-day lookback, so the past half of the window is
  // being exercised too and not merely assumed.
  const jun = meetings.find((m) => m.startsAt.startsWith("2026-06-15"));
  assert.ok(jun);
  assert.equal(jun.status, "CONCLUDED");

  const sep = meetings.find((m) => m.startsAt.startsWith("2026-09-28"));
  assert.ok(sep);
  assert.equal(sep.status, "SCHEDULED");
  assert.equal(sep.agendaUrl, null, "September must not inherit August's agenda");
});

test("a page with dates but no stated time ships DAY precision, not a guess", () => {
  const row = wiring();
  const source = makeSchedulePageSource([row]);
  const timeless = SCHEDULE.replace(/begin at 6:30\s*P\.M\./i, "begin in the evening");
  assert.equal(parseStatedTime(timeless), null, "the fixture edit did not land");

  const { meetings } = source.normalizeWithDrops(
    [{ wiring: row, schedule: timeless, collectedAt: NOW.toISOString() }],
    NOW,
  );

  assert.ok(meetings.length >= 3);
  for (const m of meetings) {
    assert.equal(m.startPrecision, "DAY");
    // Local midnight is an ordering position and never a claim about when
    // the meeting starts — the card says the time was not posted.
    assert.match(m.startsAt, /T00:00:00-04:00$/);
  }
});
