import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { wiringForTypes } from "../lib/registry/source-wiring.ts";
import {
  makeSchedulePageSource,
  parseAgendaList,
  parseDatedList,
  parseDocuments,
  parseMonthTable,
  parseSchedule,
  parseStatedTime,
  sittingTitle,
  sliceSection,
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

/**
 * The browser rung's three new shapes — M79, 2026-08-15.
 *
 * Fixtures recorded from kearsarge.org and newbury.nh.gov on 2026-08-15,
 * through the browser profile in `lib/sources/http.ts` (both hosts answer 403
 * to the civic-index client). No live calls here either.
 */
const KEARSARGE = fixture("kearsarge-school-board-schedule.html");
const KEARSARGE_DOCS = fixture("kearsarge-school-board-agendas.html");
const NEWBURY_PLANNING = fixture("newbury-planning-board.html");
const NEWBURY_ZONING = fixture("newbury-zoning-board.html");
const NEWBURY_CONSERVATION = fixture("newbury-conservation-commission.html");

const wiringFor = (slug: string) => {
  const row = wiringForTypes(["SCHEDULEPAGE"]).find((w) => w.config.slug === slug);
  assert.ok(row, `the ${slug} wiring row is missing`);
  return row;
};

test("the month table carries its year forward, and its own words with it", () => {
  const section = sliceSection(KEARSARGE, "field-name-body");
  assert.ok(section.length > 0 && section.length < KEARSARGE.length);

  const { sittings, counts } = parseMonthTable(section);

  // The board publishes 39 sittings, April 2026 through June 2027. Exact,
  // not a minimum: a selector that matched three would pass a minimum and
  // read as a clean run, which is the failure shape this repo has recorded
  // four times.
  assert.equal(sittings.length, 39, JSON.stringify(sittings.map((s) => s.date)));
  assert.equal(sittings[0].date, "2026-04-02");
  assert.equal(sittings[38].date, "2027-06-17");

  // THE YEAR IS THE WHOLE PROBLEM in this shape. Only the first month cell
  // and the January cell state one; every other row inherits. A schedule
  // filed twelve months early is invisible until a reader shows up at an
  // empty room, so both mechanisms are pinned: the December→January roll and
  // the months after it.
  assert.ok(sittings.some((s) => s.date === "2026-12-17"));
  assert.ok(sittings.some((s) => s.date === "2027-01-07"));
  assert.ok(sittings.some((s) => s.date === "2027-03-11"));

  for (let i = 1; i < sittings.length; i++) {
    assert.ok(sittings[i].date > sittings[i - 1].date, "dates out of order");
  }

  // Three rows on this table are not sittings of this body — the town
  // election and two filing deadlines, all written in exactly the meeting
  // shape. Dropped, and COUNTED: a silent skip and a real absence must never
  // look alike.
  assert.equal(counts.notSittings, 3);
  assert.equal(counts.undated, 0, "the header row is not an undated sitting");
  assert.ok(!sittings.some((s) => s.date === "2027-03-09"), "election day");

  // The board's own words survive the parse.
  const budget = sittings.find((s) => s.date === "2026-09-10");
  assert.match(budget?.note ?? "", /Budget Presentations/);

  // A row that states its own hour keeps it — the blanket 6:30 sentence is
  // for the rows that do not.
  const deliberative = sittings.find((s) => s.date === "2027-01-09");
  assert.deepEqual(deliberative?.time, { hour: 9, minute: 0 });
});

test("Kearsarge normalizes with the page's time, place and documents", () => {
  const row = wiringFor("kearsarge");
  const source = makeSchedulePageSource([row]);
  const { meetings, drops } = source.normalizeWithDrops(
    [
      {
        wiring: row,
        schedule: KEARSARGE,
        documents: KEARSARGE_DOCS,
        collectedAt: NOW.toISOString(),
      },
    ],
    NOW,
  );

  // 15 of the 39 fall inside [May 17, Oct 14]. The rest are a window clip,
  // which is why nothing lands in the drop columns except the three rows the
  // table carries that are not meetings at all.
  assert.equal(meetings.length, 15, JSON.stringify(meetings.map((m) => m.startsAt)));
  assert.equal(meetings[0].startsAt.slice(0, 10), "2026-05-21");
  assert.equal(meetings[14].startsAt.slice(0, 10), "2026-10-08");
  assert.equal(drops.notConfigured, 3);
  assert.equal(drops.unknownVenue, 0);
  assert.equal(drops.unplaceableInTime, 0);

  for (const m of meetings) {
    assert.equal(m.bodyName, "School Board");
    assert.equal(m.location.address, "114 Main Street, New London, NH 03257");
    assert.match(m.startsAt, /T18:30:00-04:00$/, "6:30 PM, off the page's bullet");
    assert.equal(m.startPrecision, undefined);
    assert.equal(
      m.provenance.sourceUrl,
      "https://www.kearsarge.org/district/school-board-mbc/pages/school-board-meeting-schedule",
    );
  }

  // The sitting's own name, where the board wrote one; the body's name where
  // it did not. "Agenda" must never become a title, and neither must
  // "(tentative)".
  const sept = meetings.find((m) => m.startsAt.startsWith("2026-09-10"));
  assert.equal(sept?.title, "Budget Presentations");
  const plain = meetings.find((m) => m.startsAt.startsWith("2026-08-20"));
  assert.equal(plain?.title, "School Board");
  assert.equal(sittingTitle("(tentative)", "School Board"), "School Board");
  assert.equal(sittingTitle("(Saturday) Workshop", "School Board"), "Workshop");

  // Documents join on the date the district wrote in its own link text.
  const aug6 = meetings.find((m) => m.startsAt.startsWith("2026-08-06"));
  assert.ok(aug6?.agendaUrl, "the August 6 agenda link is missing");
  assert.match(aug6.agendaUrl, /^https:\/\/www\.kearsarge\.org\//);
});

test("Newbury's boards read their own dc:date, and one board's rows stay one board's", () => {
  const planning = parseAgendaList(NEWBURY_PLANNING, "/planning-board/");
  const zoning = parseAgendaList(NEWBURY_ZONING, "/zoning-board-adjustment/");

  assert.equal(planning.sittings.length, 7);
  assert.equal(zoning.sittings.length, 7);

  // The town's template puts every board's blocks in identical markup. A
  // prefix-free parse would file one board's Thursday under another's, so the
  // two sets are asserted disjoint on the dates that differ.
  const planningDates = new Set(planning.sittings.map((s) => s.date));
  assert.ok(planningDates.has("2026-08-18"), "the Planning Board's own sitting");
  assert.ok(!planningDates.has("2026-08-13"), "that is the Zoning Board's");
  assert.ok(zoning.sittings.some((s) => s.date === "2026-08-13"));

  // Times come off the town's own offset-bearing timestamp; nothing is
  // inferred. A row timed at exactly local midnight is a document date, not a
  // meeting time, and ships DAY precision.
  const aug = planning.sittings.find((s) => s.date === "2026-08-18");
  assert.deepEqual(aug?.time, { hour: 19, minute: 0 });
  const minutesOnly = planning.sittings.find((s) => s.date === "2026-03-17");
  assert.equal(minutesOnly?.time, null);

  // The link text names the DOCUMENT. It never becomes the sitting's title —
  // but it is read for the one thing this town publishes in it.
  assert.equal(aug?.note, null);
  const canceled = zoning.sittings.find((s) => s.date === "2026-04-08");
  assert.equal(canceled?.canceled, true, "April Meeting is Cancelled");
});

test("the Conservation Commission's two shapes union by date", () => {
  const section = sliceSection(NEWBURY_CONSERVATION, "field-name-field-description");
  const schedule = parseDatedList(section);

  // The commission writes its whole year in its own block: twelve sittings,
  // each with an hour. It also writes "June 9,2026" with no space and puts
  // two dates in one paragraph, which is why the scan is per-match.
  assert.equal(schedule.sittings.length, 12, JSON.stringify(schedule.sittings));
  assert.ok(schedule.sittings.some((s) => s.date === "2026-06-09"));
  assert.ok(schedule.sittings.some((s) => s.date === "2026-11-10"));
  for (const s of schedule.sittings) {
    assert.deepEqual(s.time, { hour: 18, minute: 0 });
  }

  // Scoping is load-bearing: the page also carries a news block, a minutes
  // archive and a document list, all full of dates. Unscoped, this parser
  // would turn a document's publication date into a meeting.
  assert.ok(
    parseDatedList(NEWBURY_CONSERVATION).sittings.length >
      schedule.sittings.length,
    "the unscoped page really does carry more dates — that is why we scope",
  );

  const row = wiringFor("newbury-conservation-commission");
  const source = makeSchedulePageSource([row]);
  const { meetings, drops } = source.normalizeWithDrops(
    [{ wiring: row, schedule: NEWBURY_CONSERVATION, collectedAt: NOW.toISOString() }],
    NOW,
  );

  // June 9, July 14, August 11, September 10 — four inside the window.
  // October 15 is one day past it.
  assert.deepEqual(
    meetings.map((m) => m.startsAt.slice(0, 10)),
    ["2026-06-09", "2026-07-14", "2026-08-11", "2026-09-10"],
  );
  assert.equal(drops.unknownVenue, 0);

  for (const m of meetings) {
    assert.equal(m.bodyName, "Conservation Commission");
    assert.equal(m.title, "Conservation Commission");
    assert.equal(m.location.address, "937 Route 103, Newbury, NH 03255");
    assert.match(m.startsAt, /T18:00:00-04:00$/);
  }

  // August 11 is the one date both shapes carry: the schedule block gives the
  // hour, the agenda block gives the link. The union keeps both.
  const aug = meetings.find((m) => m.startsAt.startsWith("2026-08-11"));
  assert.match(aug?.agendaUrl ?? "", /^https:\/\/www\.newbury\.nh\.gov\//);
});

test("the Planning Board normalizes to the venue its own agenda states", () => {
  const row = wiringFor("newbury-planning-board");
  const source = makeSchedulePageSource([row]);
  const { meetings, drops } = source.normalizeWithDrops(
    [{ wiring: row, schedule: NEWBURY_PLANNING, collectedAt: NOW.toISOString() }],
    NOW,
  );

  assert.deepEqual(
    meetings.map((m) => m.startsAt.slice(0, 10)),
    ["2026-05-19", "2026-06-16", "2026-07-21", "2026-08-18"],
  );
  assert.equal(drops.unknownVenue, 0);
  for (const m of meetings) {
    assert.equal(m.bodyName, "Planning Board");
    assert.equal(m.title, "Planning Board", "never the document's label");
    assert.equal(m.location.name, "Newbury Town Office");
    assert.ok(m.agendaUrl?.startsWith("https://www.newbury.nh.gov/planning-board/"));
  }
});

test("the Zoning Board is deliberately unwired, and the reason is the venue", () => {
  // Its schedule is in hand — the same parser reads it today — and the town
  // publishes its meeting PLACE nowhere. Taking the Town Office from its two
  // siblings would be the guess the venue table exists to refuse, so the body
  // stays KNOWN_UNCOVERED with its ladder recorded. This test exists so that
  // wiring it LATER is a deliberate act rather than a drift: when a venue is
  // curated, this assertion is the thing that has to change.
  const wired = wiringForTypes(["SCHEDULEPAGE"]).map((w) => w.config.slug);
  assert.ok(!wired.includes("newbury-zoning-board-of-adjustment"));
  assert.equal(parseAgendaList(NEWBURY_ZONING, "/zoning-board-adjustment/").sittings.length, 7);
});
