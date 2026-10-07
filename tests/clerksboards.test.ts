import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  concludedSittingsFromPastAgendas,
  expandSchedule,
  makeClerksBoardsSource,
  parseBoardPage,
  parsePastAgendaList,
  pastAgendaListUrl,
  type ClerksBoardsRaw,
} from "../lib/sources/clerksboards/index.ts";
import type { BodySourceWiring } from "../lib/registry/source-wiring.ts";

const FIXTURES = join(import.meta.dirname, "fixtures", "clerksboards");
const page = (name: string) => readFileSync(join(FIXTURES, name), "utf8");

const TUCSON = "ocd-division/country:us/state:az/place:tucson";

function wiringFor(boardId: string, slot: string): BodySourceWiring {
  return {
    bodyId: `${TUCSON}#${slot}`,
    ocdId: TUCSON,
    agendaSourceType: "CLERKSBOARDS",
    jurisdiction: "Tucson, AZ",
    publishingOrg: "City of Tucson Clerk",
    timeZone: "America/Phoenix",
    config: { boardId },
    verifiedAt: "2026-08-14",
  };
}

// A fixed clock inside the fixtures' era, so the recorded schedules resolve
// the same way forever.
const NOW = new Date("2026-08-14T12:00:00-07:00");

test("parses the recorded Planning Commission page", () => {
  const parsed = parseBoardPage(page("b38.html"));
  assert.equal(parsed.boardName, "Planning Commission (PC)");
  assert.match(parsed.location ?? "", /Mayor and Council Chambers; 255 W Alameda/);
  assert.match(parsed.scheduleText ?? "", /12\/2\/2026 @ 6:00 p\.m\./);
  assert.match(parsed.agendaTitle ?? "", /Canceled.*08-12-26/);
  assert.match(parsed.agendaPdfUrl ?? "", /^https:\/\/assets\.tucsonaz\.gov\//);
});

test("expands an enumerated date list, years assigned right to left", () => {
  const parsed = parseBoardPage(page("b8.html"));
  const all = expandSchedule(
    parsed.scheduleText!,
    new Date("2026-01-01T00:00:00Z"),
    new Date("2027-02-15T00:00:00Z"),
  );
  assert.ok(all, "the BAJ schedule stopped parsing");
  assert.equal(all.length, 13, "BAJ publishes 13 dates");
  assert.deepEqual(all[0], { y: 2026, mo: 1, d: 28, h: 12, mi: 30 });
  assert.deepEqual(all[all.length - 1], { y: 2027, mo: 1, d: 27, h: 12, mi: 30 });
});

test("expands an Nth-weekday recurrence", () => {
  const parsed = parseBoardPage(page("b23.html"));
  const out = expandSchedule(
    parsed.scheduleText!,
    new Date("2026-08-01T00:00:00Z"),
    new Date("2026-10-15T00:00:00Z"),
  );
  assert.ok(out, "the CWAC recurrence stopped parsing");
  assert.deepEqual(
    out.map((i) => `${i.y}-${i.mo}-${i.d}`),
    ["2026-8-5", "2026-9-2", "2026-10-7"],
  );
  assert.equal(out[0].h, 8);
});

test("an unknown schedule format produces zero meetings and a counted drop", () => {
  const html = page("b23.html").replace(
    /1st Wednesday of each month[^<]*/,
    "Meets as required",
  );
  const source = makeClerksBoardsSource([wiringFor("23", "citizens-water-advisory-committee")]);
  const raw: ClerksBoardsRaw[] = [
    { wiring: wiringFor("23", "citizens-water-advisory-committee"), html, collectedAt: NOW.toISOString() },
  ];
  const { meetings, drops } = source.normalizeWithDrops(raw, NOW);
  assert.equal(meetings.length, 0);
  assert.equal(drops.unplaceableInTime, 1);
});

test("normalizes Planning Commission meetings with venue, agenda and cancellation", () => {
  const source = makeClerksBoardsSource([wiringFor("38", "planning-commission")]);
  const raw: ClerksBoardsRaw[] = [
    {
      wiring: wiringFor("38", "planning-commission"),
      html: page("b38.html"),
      collectedAt: NOW.toISOString(),
    },
  ];
  const { meetings, drops } = source.normalizeWithDrops(raw, NOW);

  assert.deepEqual(
    meetings.map((m) => m.id),
    [
      "clerksboards:38:2026-06-03",
      "clerksboards:38:2026-07-01",
      "clerksboards:38:2026-08-12",
      "clerksboards:38:2026-09-02",
      "clerksboards:38:2026-10-07",
      "clerksboards:38:2026-11-11",
    ],
  );
  assert.equal(drops.unknownVenue, 0);

  const aug = meetings.find((m) => m.id === "clerksboards:38:2026-08-12");
  assert.ok(aug, "the Aug 12 sitting is missing");
  assert.equal(aug.status, "CANCELED");
  assert.match(aug.agendaUrl ?? "", /assets\.tucsonaz\.gov/);

  const sep = meetings.find((m) => m.id === "clerksboards:38:2026-09-02");
  assert.ok(sep);
  assert.equal(sep.status, "SCHEDULED");
  assert.equal(sep.agendaUrl, null, "September must not inherit August's agenda");

  for (const m of meetings) {
    assert.equal(m.ocdId, TUCSON);
    assert.equal(m.bodyName, "Planning Commission");
    assert.equal(m.location!.address, "255 W. Alameda St, Tucson, AZ 85701");
    assert.match(m.startsAt, /-07:00$/, "Phoenix never observes DST");
    assert.match(
      m.provenance.sourceUrl ?? "",
      /clerksboards\.tucsonaz\.gov\/boards\/\?board=38/,
    );
  }
});

test("a virtual-only board is KEPT, with no place and no invented pin (D18)", () => {
  const source = makeClerksBoardsSource([wiringFor("26", "design-review-board")]);
  const raw: ClerksBoardsRaw[] = [
    {
      wiring: wiringFor("26", "design-review-board"),
      html: page("b26.html"),
      collectedAt: NOW.toISOString(),
    },
  ];
  const { meetings, drops } = source.normalizeWithDrops(raw, NOW);
  assert.ok(meetings.length > 0, "a virtual-only board still has meetings");
  for (const m of meetings) {
    assert.equal(m.location, null, "no building means no coordinates");
    assert.equal(m.online?.label, "Microsoft Teams (Virtual)");
    assert.equal(m.online?.joinUrl, null, "the Clerk publishes no join link");
  }
  assert.equal(
    drops.placeless,
    meetings.length,
    "the counter counts meetings with no physical place — same quantity, now kept",
  );
  assert.equal(drops.unknownVenue, 0);
});

const G19_START = new Date(Date.UTC(2026, 7, 18));
const G19_END = new Date(Date.UTC(2027, 7, 18));

test("grammar C: a quarterly rule with its months named expands to those months", () => {
  const out = expandSchedule(
    "Quarterly basis: every 3 months on the 3rd Monday (Jan, Apr, Jul, and Oct) @ 5:30 p.m.",
    G19_START,
    G19_END,
  );
  assert.ok(out, "a fully determined recurrence must not be declined");
  assert.equal(out.length, 4, "four quarters fall inside a one-year window");
  assert.deepEqual(
    out.map((i) => [i.mo, i.d]),
    [
      [10, 19],
      [1, 18],
      [4, 19],
      [7, 19],
    ],
    "the 3rd Monday of each named month, and no other month",
  );
  for (const i of out) {
    assert.equal(i.h, 17);
    assert.equal(i.mi, 30);
  }
});

test("grammar C declines a quarterly rule that names no months", () => {
  // "Quarterly" alone does not say which quarter, and a guess would put a
  // real body's meeting on a day it does not meet.
  assert.equal(
    expandSchedule(
      "Quarterly basis: every 3 months on the 3rd Monday @ 5:30 p.m.",
      G19_START,
      G19_END,
    ),
    null,
  );
});

test("grammar D reads month-name dates, and a TBD month yields no date", () => {
  const text = "January 22, April 16, 2026 and July and October 2026 TBD @ 9:30 a.m.";

  const y2026 = expandSchedule(
    text,
    new Date(Date.UTC(2026, 0, 1)),
    new Date(Date.UTC(2026, 11, 31)),
  );
  assert.ok(y2026);
  assert.equal(y2026.length, 2, "exactly the two dates the body has set");
  assert.deepEqual(
    y2026.map((i) => [i.y, i.mo, i.d]),
    [
      [2026, 1, 22],
      [2026, 4, 16],
    ],
  );

  // July and October are named but undated. Neither may become a date — the
  // trap is a greedy day group eating the first two digits of "2026" and
  // inventing "October 20".
  assert.ok(!y2026.some((i) => i.mo === 7 || i.mo === 10), "no TBD month becomes a date");

  const serving = expandSchedule(text, G19_START, G19_END);
  assert.ok(serving, "a readable calendar with nothing ahead is not a parse failure");
  assert.equal(serving.length, 0);
});

test("grammar B accepts 'of the month', which is the same rule as 'of each month'", () => {
  const the = expandSchedule("4th Wednesday of the month @ 5:30 p.m.", G19_START, G19_END);
  const each = expandSchedule(
    "4th Wednesday of each month @ 5:30 p.m.",
    G19_START,
    G19_END,
  );
  assert.ok(the);
  assert.ok(the.length >= 4, "a monthly rule yields at least four dates in a year");
  assert.deepEqual(the, each, "one word of wording must not change the calendar");
});

test("a body that publishes no schedule is still declined", () => {
  for (const text of [
    "Meets as required",
    "Meets as required.",
    "Meets as Required",
    "To be provided.",
  ]) {
    assert.equal(expandSchedule(text, G19_START, G19_END), null, text);
  }
});

const YEAR_START = new Date(Date.UTC(2026, 0, 1));
const YEAR_END = new Date(Date.UTC(2026, 11, 31));

test("a season restriction removes the months the body does not sit", () => {
  const out = expandSchedule(
    "2nd Tuesday of each month September through May @ 6:00 p.m.",
    YEAR_START,
    YEAR_END,
  );
  assert.ok(out);
  const months = [...new Set(out.map((i) => i.mo))].sort((a, b) => a - b);

  for (const summer of [6, 7, 8]) {
    assert.ok(
      !months.includes(summer),
      `month ${summer} is outside "September through May" and was emitted anyway`,
    );
  }
  // The range WRAPS the year end. Read as an ascending span it would be empty.
  assert.deepEqual(months, [1, 2, 3, 4, 5, 9, 10, 11, 12]);
  assert.equal(out.length, 9);
});

test("a published per-month date override wins over the recurrence", () => {
  const out = expandSchedule(
    "1st Thursday of each month @ 9:00 a.m. (except January it will be 01/08/26 and July will be 07/09/26)",
    YEAR_START,
    YEAR_END,
  );
  assert.ok(out);
  const byMonth = new Map(out.map((i) => [i.mo, i.d]));

  assert.equal(byMonth.get(1), 8, "January must be the published 01/08, not the 1st Thursday");
  assert.equal(byMonth.get(7), 9, "July must be the published 07/09, not the 1st Thursday");
  assert.equal(byMonth.get(2), 5);
  assert.equal(byMonth.get(12), 3);
  assert.equal(out.length, 12);
});

test("an override written for one year is not carried into another", () => {
  const out = expandSchedule(
    "1st Thursday of each month @ 9:00 a.m. (except January it will be 01/08/26 and July will be 07/09/26)",
    new Date(Date.UTC(2027, 0, 1)),
    new Date(Date.UTC(2027, 2, 31)),
  );
  assert.ok(out);
  assert.ok(
    !out.some((i) => i.mo === 1),
    "a 2026 override was applied to, or overridden in, 2027",
  );
  assert.deepEqual([...new Set(out.map((i) => i.mo))].sort(), [2, 3]);
});

test("a qualifier the parser cannot read declines the board, never expands around it", () => {
  for (const text of [
    "2nd Tuesday of each month except in the summer @ 6:00 p.m.",
    "2nd Tuesday of each month, September through the spring @ 6:00 p.m.",
    "1st Thursday of each month @ 9:00 a.m. (except as announced)",
  ]) {
    assert.equal(
      expandSchedule(text, YEAR_START, YEAR_END),
      null,
      `expanded around a qualifier it did not read: ${text}`,
    );
  }
});

test("an exception parenthetical is never read as a month restriction", () => {
  // Grammar C reads a month SET out of a parenthetical. An exception
  // parenthetical also names months and means the opposite — reading one as
  // a set would cut a monthly board to two sittings a year.
  const out = expandSchedule(
    "1st Thursday of each month @ 9:00 a.m. (except January it will be 01/08/26 and July will be 07/09/26)",
    YEAR_START,
    YEAR_END,
  );
  assert.ok(out);
  assert.equal(out.length, 12, "the board meets monthly, not in January and July only");
});

test("the recurrence walks the WINDOW, and stops dropping its last sitting", () => {
  const now = new Date(Date.UTC(2026, 7, 19));
  const start = new Date(now.getTime() - 90 * 86_400_000); // 2026-05-21
  const end = new Date(now.getTime() + 60 * 86_400_000); // 2026-10-18
  const plain = expandSchedule("1st Wednesday of each month @ 8:00 a.m.", start, end);
  assert.ok(plain);

  assert.deepEqual(
    plain.map((i) => `${i.mo}/${i.d}`),
    ["6/3", "7/1", "8/5", "9/2", "10/7"],
  );
  for (const inst of plain) {
    const t = Date.UTC(inst.y, inst.mo - 1, inst.d);
    assert.ok(
      t >= start.getTime() - 86_400_000 && t <= end.getTime(),
      `${inst.mo}/${inst.d} is outside the serving window`,
    );
  }
});

const R8_NOW = new Date("2026-09-25T10:00:00-07:00");
const IDA = wiringFor("43", "industrial-development-authority");
const TCCC = wiringFor("15", "tucson-convention-center-commission");

test("the recorded IDA and TCCC schedules place no sitting in the served window", () => {
  const start = new Date(R8_NOW.getTime() - 90 * 86_400_000);
  const end = new Date(R8_NOW.getTime() + 120 * 86_400_000);
  for (const name of ["b43.html", "b15.html"]) {
    const parsed = parseBoardPage(page(name));
    assert.ok(parsed.scheduleText, `${name} publishes a schedule`);
    assert.deepEqual(expandSchedule(parsed.scheduleText!, start, end), [], `${name}: zero in-window sittings from the schedule`);
  }
});

test("only the board's own agendas date its sittings; committees and notices do not", () => {
  const entries = parsePastAgendaList(page("b43-pastagenda.html"));
  assert.ok(entries.length >= 40, `the recorded IDA list holds ${entries.length} documents`);
  assert.equal(entries[0].title, "IDA Agenda (Canceled) 09-17-26");
  assert.equal(entries[0].pdfUrl, "https://assets.tucsonaz.gov/share/bcc/43004.pdf");
  const start = new Date(R8_NOW.getTime() - 90 * 86_400_000);
  const sittings = concludedSittingsFromPastAgendas(entries, "Industrial Development Authority (IDA)", start, R8_NOW, "America/Phoenix");
  assert.deepEqual(
    sittings.map((s) => `${s.y}-${s.mo}-${s.d}|${s.qualifier ?? ""}|${s.canceled}|${s.pdfUrl.split("/").at(-1)}`),
    [
      "2026-7-16||false|42448.pdf",
      "2026-7-28|Special Meeting|false|42558.pdf",
      "2026-8-20|Revised|false|42774.pdf",
      // The newest-listed document for the date is the cancellation, not the notice.
      "2026-9-17|Canceled|true|43004.pdf",
    ],
    "the Property Committee (08-05) and the Public Notice are other documents, and 06-18 is before the window",
  );
});

test("a board whose schedule places nothing yields its concluded sittings from the Past Agendas list", () => {
  const source = makeClerksBoardsSource([IDA, TCCC]);
  const raw: ClerksBoardsRaw[] = [
    { wiring: IDA, html: page("b43.html"), pastAgendaHtml: page("b43-pastagenda.html"), collectedAt: R8_NOW.toISOString() },
    { wiring: TCCC, html: page("b15.html"), pastAgendaHtml: page("b15-pastagenda.html"), collectedAt: R8_NOW.toISOString() },
  ];
  const { meetings, accounting } = source.normalizeWithDrops(raw, R8_NOW);
  assert.deepEqual(meetings.map((m) => m.id), [
    "clerksboards:43:2026-06-18",
    "clerksboards:43:2026-07-16",
    "clerksboards:43:2026-07-28",
    "clerksboards:43:2026-08-20",
    "clerksboards:43:2026-09-17",
    "clerksboards:15:2026-07-16",
  ]);
  for (const m of meetings) {
    assert.equal(m.startPrecision, "DAY", `${m.id}: the list publishes no start time, and none is claimed`);
    assert.match(m.startsAt, /T00:00:00-07:00$/);
    assert.match(m.agendaUrl ?? "", /^https:\/\/assets\.tucsonaz\.gov\/share\/bcc\/\d+\.pdf$/, `${m.id} cites its agenda PDF`);
    assert.equal(m.provenance.sourceUrl, pastAgendaListUrl(m.id.split(":")[1]));
    assert.notEqual(m.status, "SCHEDULED");
  }
  const byId = new Map(meetings.map((m) => [m.id, m]));
  assert.equal(byId.get("clerksboards:43:2026-09-17")?.status, "CANCELED");
  assert.equal(byId.get("clerksboards:43:2026-07-16")?.status, "CONCLUDED");
  assert.equal(byId.get("clerksboards:43:2026-07-28")?.title, "Industrial Development Authority — Special Meeting");
  assert.equal(byId.get("clerksboards:43:2026-08-20")?.title, "Industrial Development Authority");
  assert.equal(byId.get("clerksboards:15:2026-07-16")?.bodyName, "Tucson Convention Center Commission");
  assert.equal(byId.get("clerksboards:15:2026-07-16")?.agendaUrl, "https://assets.tucsonaz.gov/share/bcc/42419.pdf");
  assert.equal(accounting.logicalInput, 18, "17 before the held window added IDA's 18 June agenda from the list (DB-05)");
  assert.equal(accounting.outOfWindow, 10);

  const bare = source.normalizeWithDrops(raw.map(({ pastAgendaHtml: _list, ...row }) => row), R8_NOW);
  assert.equal(bare.meetings.length, 0);
  assert.equal(bare.accounting.outOfWindow, 10);
  assert.equal(bare.drops.unplaceableInTime, 2, "the two TBD months are counted, never read as a board that meets twice a year");
  assert.equal(bare.accounting.outcome, "CONSERVED");
});

test("the Past Agendas list is requested only for a board whose schedule places nothing", async () => {
  const requested: string[] = [];
  const bodies = new Map([
    ["https://clerksboards.tucsonaz.gov/boards/?board=43", page("b43.html")],
    ["https://clerksboards.tucsonaz.gov/boards/?run=pastagenda&board=43", page("b43-pastagenda.html")],
    ["https://clerksboards.tucsonaz.gov/boards/?board=38", page("b38.html")],
  ]);
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input instanceof Request ? input.url : input);
    requested.push(url);
    const body = bodies.get(url);
    return body === undefined
      ? new Response("not recorded", { status: 404 })
      : new Response(body, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
  };
  const source = makeClerksBoardsSource([IDA, wiringFor("38", "planning-commission")], fetchImpl, () => R8_NOW);
  const raw = await source.fetch({ lat: 32.22, lng: -110.97, radiusKm: 25 } as Parameters<typeof source.fetch>[0]);
  assert.deepEqual(requested, [
    "https://clerksboards.tucsonaz.gov/boards/?board=43",
    "https://clerksboards.tucsonaz.gov/boards/?run=pastagenda&board=43",
    "https://clerksboards.tucsonaz.gov/boards/?board=38",
  ], "the Planning Commission's schedule still places sittings, so its list is not read");
  assert.equal(raw[0].pastAgendaHtml?.includes("IDA Agenda 07-16-26"), true);
  assert.equal(raw[1].pastAgendaHtml, undefined);
});
