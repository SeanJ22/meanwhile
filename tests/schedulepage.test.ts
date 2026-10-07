import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { wiringForTypes } from "../lib/registry/source-wiring.ts";
import {
  makeSchedulePageSource,
  monthPagesToWalk,
  parseAgendaList,
  parseDatedList,
  parseDocuments,
  parseEventTips,
  parseMonthTable,
  parseSchedule,
  parseStatedTime,
  sittingTitle,
  sliceSection,
} from "../lib/sources/schedulepage/index.ts";

/** Fixed so SCHEDULED/CONCLUDED and the window clip are deterministic; recorded pages, no live calls. */
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

  assert.deepEqual(
    meetings.map((m) => m.startsAt.slice(0, 10)),
    ["2026-04-27", "2026-05-11", "2026-06-15", "2026-08-17", "2026-09-28", "2026-10-26", "2026-11-16"],
  );
  assert.equal(drops.unknownVenue, 0);
  assert.equal(drops.placeless, 0);
  assert.equal(drops.unplaceableInTime, 0);

  for (const m of meetings) {
    assert.equal(m.bodyName, "Board of Education");
    assert.equal(m.jurisdiction, "Morris Hills Regional School District, NJ");
    assert.equal(m.location!.address, "48 Knoll Drive, Rockaway, NJ 07866");
    assert.ok(Number.isFinite(m.location!.lat) && Number.isFinite(m.location!.lng));
    // 6:30 P.M. Eastern in June/August/September is UTC-4.
    // -05:00 once the wider window crosses November — the zone, not a drift.
    assert.match(m.startsAt, /T18:30:00-0[45]:00$/);
    assert.equal(
      m.provenance.sourceUrl,
      "https://www.mhrd.org/administration/board-of-education/boe-meetings",
    );
    // A stated time means no DAY precision — the two must never both be set.
    assert.equal(m.startPrecision, undefined);
  }

  const aug = meetings.find((m) => m.startsAt.startsWith("2026-08-17"));
  assert.ok(aug);
  assert.equal(aug.status, "SCHEDULED");
  assert.match(aug.agendaUrl ?? "", /08172026AGENDAFINAL\.pdf/);

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
    // -04:00 through the summer and -05:00 once the wider window crosses the
    // DST boundary in November. The offset is the zone doing its job; what is
    // asserted is that the TIME is local midnight, never a guessed hour.
    assert.match(m.startsAt, /T00:00:00-0[45]:00$/);
  }
});

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

  assert.equal(meetings.length, 22, JSON.stringify(meetings.map((m) => m.startsAt)));
  assert.equal(meetings[0].startsAt.slice(0, 10), "2026-04-25");
  assert.equal(meetings[21].startsAt.slice(0, 10), "2026-12-10");
  assert.equal(drops.notConfigured, 3);
  assert.equal(drops.unknownVenue, 0);
  assert.equal(drops.unplaceableInTime, 0);

  for (const m of meetings) {
    assert.equal(m.bodyName, "School Board");
    assert.equal(m.location!.address, "114 Main Street, New London, NH 03257");
    assert.match(m.startsAt, /T18:30:00-0[45]:00$/, "6:30 PM, off the page bullet");
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

  assert.deepEqual(
    meetings.map((m) => m.startsAt.slice(0, 10)),
    ["2026-05-12", "2026-06-09", "2026-07-14", "2026-08-11", "2026-09-10", "2026-10-15", "2026-11-10", "2026-12-08"],
  );
  assert.equal(drops.unknownVenue, 0);

  for (const m of meetings) {
    assert.equal(m.bodyName, "Conservation Commission");
    assert.equal(m.title, "Conservation Commission");
    assert.equal(m.location!.address, "937 Route 103, Newbury, NH 03255");
    assert.match(m.startsAt, /T18:00:00-0[45]:00$/);
  }

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
    ["2026-04-21", "2026-05-19", "2026-06-16", "2026-07-21", "2026-08-18"],
  );
  assert.equal(drops.unknownVenue, 0);
  for (const m of meetings) {
    assert.equal(m.bodyName, "Planning Board");
    assert.equal(m.title, "Planning Board", "never the document's label");
    assert.equal(m.location!.name, "Newbury Town Office");
    assert.ok(m.agendaUrl?.startsWith("https://www.newbury.nh.gov/planning-board/"));
  }
});

test("the Zoning Board is wired, on a venue the town publishes in markup", () => {
  const wired = wiringForTypes(["SCHEDULEPAGE"]).map((w) => w.config.slug);
  assert.ok(wired.includes("newbury-zoning-board-of-adjustment"));

  const parsed = parseAgendaList(NEWBURY_ZONING, "/zoning-board-adjustment/");
  assert.equal(parsed.sittings.length, 7);

  const row = wiringFor("newbury-zoning-board-of-adjustment");
  const source = makeSchedulePageSource([row]);
  const { meetings, drops } = source.normalizeWithDrops(
    [{ wiring: row, schedule: NEWBURY_ZONING, collectedAt: NOW.toISOString() }],
    NOW,
  );

  assert.deepEqual(
    meetings.map((m) => m.startsAt.slice(0, 10)),
    ["2026-05-13", "2026-08-13"],
  );
  // Zero, not "no error": the venue resolves, so nothing drops for want of a
  // place. The other six sittings are outside the window, which is a different
  // fact from being unplaceable.
  assert.equal(drops.unknownVenue, 0);

  const aug = meetings.find((m) => m.startsAt.startsWith("2026-08-13"))!;
  assert.equal(aug.bodyName, "Zoning Board of Adjustment");
  assert.equal(aug.title, "Zoning Board of Adjustment", "never the document's label");
  assert.equal(aug.location!.name, "Newbury Offices");
  assert.equal(aug.location!.address, "937 Route 103, Newbury, NH 03255");
  assert.match(aug.startsAt, /T19:00:00-04:00$/);
  assert.ok(
    aug.agendaUrl?.startsWith("https://www.newbury.nh.gov/zoning-board-adjustment/"),
  );

  assert.equal(
    parsed.sittings.find((s) => s.date === "2026-04-08")?.canceled,
    true,
  );
});

const NEWLONDON = fixture("newlondon-calendar-2026-08.html");

test("event-tip: a board's own sittings come out of a town-wide calendar", () => {
  const { sittings, counts } = parseEventTips(NEWLONDON, "Board of Selectmen");
  // Minimums against a recorded fixture, never merely "no error thrown": a
  // parser that matched nothing returns an empty list and throws nothing.
  assert.ok(sittings.length >= 2, `only ${sittings.length} sittings`);
  assert.ok(
    sittings.every((s) => /Board of Selectmen/.test(s.note ?? "")),
    "a sitting landed that the town did not file under this board",
  );
  assert.ok(counts.notSittings > 10, "the title filter did nothing at all");
});

test("event-tip: the time comes off the event's own line", () => {
  const { sittings } = parseEventTips(NEWLONDON, "Board of Selectmen");
  const august = sittings.find((s) => s.date === "2026-08-06");
  assert.ok(august, "the fixture's 6 August sitting is missing");
  assert.deepEqual(august.time, { hour: 17, minute: 30 });
});

test("event-tip: a band concert is not a meeting of the Planning Board", () => {
  // The whole safety of this shape. The town's calendar carries concerts,
  // transfer-station hours and eleven boards on one page.
  const { sittings } = parseEventTips(NEWLONDON, "Planning Board");
  assert.ok(sittings.length > 0);
  assert.ok(
    !sittings.some((s) => /Band Concert/i.test(s.note ?? "")),
    "a band concert was filed as a Planning Board sitting",
  );
});

test("event-tip: an empty titleMatch matches NOTHING rather than everything", () => {
  // The failure this guards is the one that ships quietly: a row missing its
  // `titleMatch` filing every event in the town as a sitting of one board.
  const { sittings } = parseEventTips(NEWLONDON, "");
  assert.equal(sittings.length, 0);
  assert.equal(parseEventTips(NEWLONDON, " , ").sittings.length, 0, "a list of blanks is no match either");
});

test("event-tip: titleMatch is a list of the body's spellings, and apostrophes do not decide a match (2026-09-25)", () => {
  const wired = (slug: string) => {
    const row = wiringForTypes(["SCHEDULEPAGE"]).find((r) => r.config.slug === `new-london-${slug}`);
    assert.ok(row, `new-london-${slug} is wired`);
    return row.config.titleMatch ?? "";
  };
  const firewards = parseEventTips(NEWLONDON, wired("board-of-firewards")).sittings;
  assert.equal(firewards.length, 2, "both spellings are read");
  assert.ok(firewards.some((s) => /Fire Wards/.test(s.note ?? "")) && firewards.some((s) => /Firewards/.test(s.note ?? "")));
  const trustees = parseEventTips(NEWLONDON, wired("trustees-of-the-trust-funds")).sittings;
  assert.equal(trustees.length, 1, "'Trustees of the Trust Fund' is the town's spelling");
  assert.deepEqual(trustees[0].time, { hour: 10, minute: 0 });

  const tip = (title: string, when: string) => `<div class="eventTip"><div class="tipTitle">${title}</div>${when}</div>`;
  const page = [
    tip("Citizens Committee - 7:30 AM - Whipple Memorial Hall", "Saturday, June 6, 2026 at 7:30 AM"),
    tip("Citizen&#039;s Advisory Committee - Whipple Memorial Town Hall - 7:30am", "Saturday, October 3, 2026 at 7:30 AM"),
    tip("Bike &amp; Pedestrian Advisory Committee - Whipple Memorial Town Hall", "Thursday, July 9, 2026 at 5:00 PM"),
    tip("Bicycles and Pedestrian Committee - 5:00 PM - Whipple Memorial Hall", "Thursday, September 10, 2026 at 5:00 PM"),
  ].join("");
  assert.deepEqual(parseEventTips(page, wired("citizens-committee")).sittings.map((s) => s.date), ["2026-06-06", "2026-10-03"]);
  assert.deepEqual(parseEventTips(page, wired("bicycle-pedestrian-advisory-committee")).sittings.map((s) => s.date), ["2026-07-09", "2026-09-10"]);
});

test("event-tip: a sitting in the Syd Crook Room or at the Fire Department is its own room, never the hall", () => {
  const row = wiringForTypes(["SCHEDULEPAGE"]).find((r) => r.config.slug === "new-london-trustees-of-the-trust-funds");
  assert.ok(row);
  const { meetings } = makeSchedulePageSource([row]).normalizeWithDrops(
    [{ wiring: row, schedule: NEWLONDON, collectedAt: "2026-08-19T12:00:00Z" }],
    new Date("2026-08-19T12:00:00-04:00"),
  );
  assert.equal(meetings.length, 1);
  assert.equal(meetings[0].location, null, "the Whipple Memorial Town Hall pin is not inherited");
  assert.match(JSON.stringify(meetings[0].venueGap), /Syd Crook/);
});

test("event-tip: four New London boards are wired, each with its own match", () => {
  const rows = wiringForTypes(["SCHEDULEPAGE"]).filter((r) =>
    (r.config.shapes ?? "").includes("event-tip"),
  );
  assert.ok(rows.length >= 4, `only ${rows.length} event-tip rows`);
  for (const row of rows) {
    assert.ok(
      (row.config.titleMatch ?? "").length > 0,
      `${row.config.slug} has no titleMatch — it would file the whole town's calendar`,
    );
    // A month grid serves ONE month. A row that reads only the default view
    // reports this month as the body's whole calendar, which reads exactly
    // like a body with nothing scheduled.
    assert.ok(
      Number(row.config.monthsAhead ?? 0) > 0,
      `${row.config.slug} reads one month and calls it a calendar`,
    );
  }
  const matches = rows.map((r) => r.config.titleMatch);
  assert.equal(
    new Set(matches).size,
    matches.length,
    "two boards share a titleMatch — one town calendar, two bodies, same rows",
  );
});

test("SEEDED: a one-month calendar is walked BEHIND the current month, to the window's back edge", () => {
  const pages = monthPagesToWalk({
    now: new Date("2026-09-02T15:00:00Z"),
    startsAfter: "2026-06-04T15:00:00Z",
    startsBefore: "2026-11-01T15:00:00Z",
    monthsAhead: 2,
  });
  assert.deepEqual(pages, [
    { year: 2026, month: 6 },
    { year: 2026, month: 7 },
    { year: 2026, month: 8 },
    { year: 2026, month: 10 },
    { year: 2026, month: 11 },
  ]);
  // September is the default view and is never fetched twice.
  assert.ok(!pages.some((p) => p.year === 2026 && p.month === 9));
  assert.ok(
    pages.some((p) => p.year * 12 + p.month - 1 < 2026 * 12 + 8),
    "no month behind the current one was walked — the calendar's history rolls off again",
  );
});

test("without a window the walk still reaches the serving window's back edge, and the year boundary holds", () => {
  const pages = monthPagesToWalk({ now: new Date("2027-01-15T12:00:00Z"), monthsAhead: 2 });
  // MEETING_HELD_LOOKBACK_DAYS (120) back from 15 January is 17 September;
  // MEETING_HELD_HORIZON_DAYS (120) ahead is 15 May.
  assert.deepEqual(pages, [
    { year: 2026, month: 9 },
    { year: 2026, month: 10 },
    { year: 2026, month: 11 },
    { year: 2026, month: 12 },
    { year: 2027, month: 2 },
    { year: 2027, month: 3 },
    { year: 2027, month: 4 },
    { year: 2027, month: 5 },
  ]);
});

test("monthsAhead stays a floor when the window asked for is shorter than it", () => {
  const pages = monthPagesToWalk({
    now: new Date("2026-09-02T15:00:00Z"),
    startsAfter: "2026-09-01T00:00:00Z",
    startsBefore: "2026-09-30T00:00:00Z",
    monthsAhead: 2,
  });
  assert.deepEqual(pages, [
    { year: 2026, month: 10 },
    { year: 2026, month: 11 },
  ]);
});

test("event-tip: fetch asks the calendar for every month in the window it was given, behind and ahead", async () => {
  const rows = wiringForTypes(["SCHEDULEPAGE"]).filter(
    (r) => (r.config.shapes ?? "").includes("event-tip") && r.config.slug === "new-london-board-of-selectmen",
  );
  assert.equal(rows.length, 1, "the New London Board of Selectmen row is the subject");

  const asked: string[] = [];
  const fakeFetch = (async (input: string | URL | Request) => {
    asked.push(String(input));
    return new Response(NEWLONDON, { status: 200, headers: { "content-type": "text/html" } });
  }) as unknown as typeof fetch;

  const query = {
    lat: 43.4,
    lng: -72.0,
    radiusKm: 40,
    startsAfter: "2026-05-17T00:00:00.000Z",
    startsBefore: "2026-10-14T00:00:00.000Z",
  };
  const source = makeSchedulePageSource(rows, fakeFetch);
  await source.fetch(query);

  const expected = monthPagesToWalk({
    now: new Date(),
    startsAfter: query.startsAfter,
    startsBefore: query.startsBefore,
    monthsAhead: Number(rows[0]!.config.monthsAhead),
  });
  assert.ok(expected.length >= 4, `the window spans ${expected.length} month page(s) — the fixture window lost its months`);
  for (const page of expected) {
    assert.ok(
      asked.some((u) => u.includes(`month=${page.month}`) && u.includes(`year=${page.year}`)),
      `the fetch never asked for ${page.year}-${page.month}: ${asked.join(", ")}`,
    );
  }
  const now = new Date();
  const currentKey = now.getUTCFullYear() * 12 + now.getUTCMonth();
  assert.ok(
    expected.some((p) => p.year * 12 + p.month - 1 < currentKey),
    "the window given reaches behind the current month, and the walk must too",
  );
  // The default view is read once, first, and every month page carries the
  // page's own navigation query rather than a bare `?month=`.
  assert.equal(asked[0], rows[0]!.config.schedulePage);
  for (const u of asked.slice(1)) assert.ok(u.includes("Type=B_EV"), `month page lost its section query: ${u}`);
});
