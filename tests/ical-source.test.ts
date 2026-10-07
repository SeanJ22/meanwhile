import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { makeIcalSource, parseDtStart, parseIcs } from "../lib/sources/ical/index.ts";
import { wiringForTypes } from "../lib/registry/source-wiring.ts";
import type { IcalRaw } from "../lib/sources/ical/index.ts";

/** The `ICAL` adapter over a recorded town feed. Counts are asserted as minimums, because a parser that returns nothing throws nothing. */

const FIXTURE = readFileSync(
  join(process.cwd(), "tests", "fixtures", "ical", "wilmot-2026-08-19.ics"),
  "utf8",
);

/** Every ICAL row reads its own wired feed; the query is not consulted. */
const QUERY = { zip: "03255" } as unknown as Parameters<
  ReturnType<typeof makeIcalSource>["fetch"]
>[0];

/** The middle of the fixture's window, so the same rows are in range always. */
const NOW = new Date("2026-08-19T12:00:00Z");

/** The fixture is one town's feed, and it goes only to that town's rows. */
function rawFor(): IcalRaw[] {
  return wiringForTypes(["ICAL"])
    .filter((wiring) => wiring.config.feedUrl?.includes("wilmotnh.org"))
    .map((wiring) => ({
      wiring,
      ics: FIXTURE,
      collectedAt: "2026-08-19T00:00:00.000Z",
      sourceUrl: wiring.config.feedUrl ?? "",
    }));
}

test("ICAL: the Wilmot fixture reaches Wilmot's rows and only those", () => {
  const rows = rawFor();
  assert.ok(rows.length >= 3, `expected Wilmot's wired boards, got ${rows.length}`);
  assert.ok(
    rows.every((r) => r.wiring.jurisdiction === "Wilmot, NH"),
    "a fixture belongs to the feed it was recorded from",
  );
  // The denominator, so a shrinking filter cannot pass as a clean run.
  assert.ok(
    wiringForTypes(["ICAL"]).length > rows.length,
    "other towns are wired on this adapter; this test deliberately excludes them",
  );
});

test("ICAL: the fixture parses to the events it actually contains", () => {
  const events = parseIcs(FIXTURE);
  assert.equal(events.length, 23, "the recorded feed holds 23 events");
  // Every one carries a start. A parser that silently produced empty events
  // would still return 23 objects, so check a field that must be there.
  assert.equal(events.filter((e) => e.dtstart).length, 23);
  assert.ok(events.some((e) => e.categories === "Select Board"));
  assert.ok(events.some((e) => e.categories === "Planning Board"));
  assert.ok(events.some((e) => e.categories === "Cemetery Trustees"));
});

test("ICAL: line folding is unfolded before the address is read", () => {
  // RFC 5545 folds any line past 75 octets, and a street address is routinely
  // longer. Parsing without unfolding truncates at a byte boundary and
  // produces a venue string that matches nothing — which would render as "we
  // could not place this meeting" about a meeting whose address the town
  // published in full.
  const events = parseIcs(FIXTURE);
  const withAddress = events.filter((e) =>
    (e.location ?? "").includes("Kearsarge Valley Road"),
  );
  assert.ok(withAddress.length >= 12, `only ${withAddress.length} full addresses`);
  for (const e of withAddress) {
    assert.ok(
      (e.location ?? "").includes("03287"),
      `an address stops short of its zip: ${e.location}`,
    );
  }
});

test("ICAL: escaped commas come back as commas", () => {
  const events = parseIcs(FIXTURE);
  const loc = events.find((e) => (e.location ?? "").includes("Kearsarge"))!.location!;
  assert.ok(!loc.includes("\\,"), "an escape survived into the venue string");
  assert.ok(loc.includes(", "), "the address lost its separators");
});

test("ICAL: a wall-clock time resolves through its own TZID, across DST", () => {
  // 6:30 PM in New York is 22:30Z in August and 23:30Z in January. A fixed
  // offset is right for half the year, which is the half nobody tests.
  const summer = parseDtStart("TZID=America/New_York:20260820T183000", "UTC");
  const winter = parseDtStart("TZID=America/New_York:20270121T183000", "UTC");
  assert.equal(summer?.iso, "2026-08-20T22:30:00.000Z");
  assert.equal(winter?.iso, "2027-01-21T23:30:00.000Z");
  assert.equal(summer?.dayOnly, false);
});

test("ICAL: a DATE-only value is DAY precision, never an invented hour", () => {
  const d = parseDtStart("VALUE=DATE:20260820", "America/New_York");
  assert.equal(d?.dayOnly, true);
  const bare = parseDtStart(":20260820", "America/New_York");
  assert.equal(bare?.dayOnly, true);
});

test("ICAL: a Z suffix is already UTC", () => {
  assert.equal(
    parseDtStart("TZID=America/New_York:20260820T223000Z", "UTC")?.iso,
    "2026-08-20T22:30:00.000Z",
  );
});

test("ICAL: a VCALENDAR with no VEVENT is refused, and does not empty the source", async () => {
  /* A document with no VEVENT is refused for its row, which routes it into carry-forward instead of failing the whole source. */
  const EMPTY_FEED =
    "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Test//EN\r\nEND:VCALENDAR\r\n";
  const wiring = wiringForTypes(["ICAL"]).filter((w) =>
    w.config.feedUrl?.includes("wilmotnh.org"),
  );
  assert.ok(wiring.length >= 3, `expected Wilmot's rows, got ${wiring.length}`);

  const stub: typeof fetch = async () =>
    new Response(EMPTY_FEED, {
      status: 200,
      headers: { "content-type": "text/calendar" },
    });
  const source = makeIcalSource(wiring, stub);
  const raw = await source.fetch(QUERY);

  assert.equal(raw.length, wiring.length, "every row still reports, with its own wiring");
  assert.equal(
    raw.filter((r) => r.refused).length,
    wiring.length,
    "an eventless calendar refuses every row on that feed — it is one retrieval and one wall",
  );
  const { meetings, drops } = source.normalizeWithDrops(raw, new Date("2026-08-19T12:00:00Z"));
  assert.equal(meetings.length, 0);
  assert.equal(drops.unknownVenue, 0, "a refusal is not a drop; nothing was examined");
});

test("ICAL: a calendar WITH events is not refused by the same check", async () => {
  /* The other half, so the guard cannot pass by refusing everything. */
  const wiring = wiringForTypes(["ICAL"])
    .filter((w) => w.config.feedUrl?.includes("wilmotnh.org"))
    .slice(0, 1);
  const stub: typeof fetch = async () =>
    new Response(FIXTURE, { status: 200, headers: { "content-type": "text/calendar" } });
  const source = makeIcalSource(wiring, stub);
  const raw = await source.fetch(QUERY);
  assert.equal(raw.filter((r) => r.refused).length, 0, "a real calendar is not a refusal");
  assert.ok(raw[0].ics.includes("BEGIN:VEVENT"), "and the document reaches normalize");
});

test("ICAL: the wired boards produce meetings, and the counts are stated", () => {
  const source = makeIcalSource(wiringForTypes(["ICAL"]));
  const { meetings, drops } = source.normalizeWithDrops(rawFor(), NOW);

  assert.ok(meetings.length >= 10, `only ${meetings.length} meetings`);
  // Three boards, all present. A row that produced nothing would leave its
  // board silently absent, which is exactly what this adapter exists to stop.
  for (const board of ["Selectboard", "Planning Board", "Cemetery Trustees"]) {
    assert.ok(
      meetings.some((m) => m.bodyName === board),
      `${board} produced no meetings`,
    );
  }
  assert.equal(
    drops.unknownVenue,
    0,
    "a wired board lost a sitting to an unresolved venue",
  );
  assert.equal(drops.unplaceableInTime, 0);
  // The cross-product: three rows each see all 23 events and keep only their
  // own category. `notConfigured` is that arithmetic, not a failure.
  assert.ok(drops.notConfigured > 0, "the category filter did nothing at all");
});

test("ICAL: CATEGORIES is what assigns a sitting to a board, not the title", () => {
  const source = makeIcalSource(wiringForTypes(["ICAL"]));
  const { meetings } = source.normalizeWithDrops(rawFor(), NOW);
  // Wilmot files a "Transfer Station Advisory Group meeting" under Select
  // Board. Assigning by title would have lost it; assigning by the town's own
  // category keeps it, under the board the town filed it under.
  assert.ok(
    meetings.some(
      (m) => m.bodyName === "Selectboard" && /Transfer Station/.test(m.title),
    ),
    "a sitting the town filed under Select Board did not land there",
  );
});

test("ICAL: every meeting carries a placed venue and its provenance", () => {
  const source = makeIcalSource(wiringForTypes(["ICAL"]));
  const { meetings } = source.normalizeWithDrops(rawFor(), NOW);
  for (const m of meetings) {
    assert.ok(m.location, `${m.title} has no location`);
    assert.ok(Number.isFinite(m.location.lat) && Number.isFinite(m.location.lng));
    assert.ok(m.provenance.sourceOrg.length > 0);
    assert.match(m.provenance.sourceUrl ?? "", /^https:\/\//);
    assert.equal(m.provenance.verifiedAt, null);
  }
});

test("ICAL: a refused row reports as unreachable and empties nothing else", () => {
  const rows = wiringForTypes(["ICAL"]);
  const source = makeIcalSource(rows);
  const raw: IcalRaw[] = rows.map((wiring, i) => ({
    wiring,
    ics: i === 0 ? "" : FIXTURE,
    collectedAt: "2026-08-19T00:00:00.000Z",
    refused: i === 0,
    sourceUrl: wiring.config.feedUrl ?? "",
  }));
  const { meetings, unreachableOcdIds } = source.normalizeWithDrops(raw, NOW);
  assert.ok(unreachableOcdIds && unreachableOcdIds.length === 1);
  // The refusal corollary at the adapter: the other rows still produced.
  assert.ok(
    meetings.some((m) => m.bodyName === "Planning Board"),
    "one row's refusal emptied a different body",
  );
  assert.ok(
    !meetings.some((m) => m.bodyName === (rows[0].config.bodyName ?? "")),
    "a refused row produced meetings out of an empty body",
  );
});

test("ICAL: every wired feed names the LIST view, never the default view", () => {
  // `/events/?ical=1` returns the current VIEW. On this town that is the
  // month: four events, HTTP 200, well-formed, and nineteen public meetings
  // missing. The empty-success shape wearing a healthier face. A wiring row
  // that names the default URL is a five-fold silent clip.
  /* The rule is the full calendar, not one vendor's spelling of it: the URL is a calendar feed that names the full calendar rather than a view. */
  let checked = 0;
  for (const row of wiringForTypes(["ICAL"])) {
    const url = row.config.feedUrl ?? "";
    checked += 1;
    assert.match(
      url,
      /^https?:\/\//,
      `${row.config.slug}'s feed url is not absolute`,
    );
    assert.ok(
      /\.ics(\?|$)/.test(url) || /ical=1/.test(url) || /format=ical/.test(url),
      `${row.config.slug} does not name a calendar feed: ${url}`,
    );
    if (/wilmotnh\.org/.test(url)) {
      assert.match(
        url,
        /\/events\/list\//,
        `${row.config.slug} names the default view, which returns a fifth of the calendar`,
      );
    }
    if (/newbury\.nh\.gov/.test(url)) {
      // Drupal's calendar serves `/calendar/month/YYYY-MM` as the view and
      // `/calendar/ical/export.ics` as the whole thing — 1,157 events against
      // one month's handful. Same trap, different vendor.
      assert.match(
        url,
        /\/calendar\/ical\/export\.ics$/,
        `${row.config.slug} names a month view rather than the export`,
      );
    }
  }
  assert.ok(checked >= 13, `only ${checked} ICAL rows were checked`);
});

/** A zone we could not interpret produces no timestamp: zero is not a missing offset, it is UTC. */

test("A-007 · an uninterpretable TZID yields no timestamp at all", () => {
  assert.equal(
    parseDtStart("TZID=Not/AZone:20260908T190000", "America/New_York"),
    null,
    "a zone Intl refuses used to be silently treated as UTC",
  );
});

test("A-007 · a valid zone is unaffected, including across a DST boundary", () => {
  // In New York, 8 September is EDT (UTC-4) and 8 December is EST (UTC-5).
  assert.equal(
    parseDtStart("TZID=America/New_York:20260908T190000", "America/New_York")?.iso,
    "2026-09-08T23:00:00.000Z",
  );
  assert.equal(
    parseDtStart("TZID=America/New_York:20261208T190000", "America/New_York")?.iso,
    "2026-12-09T00:00:00.000Z",
  );
  // Arizona does not observe DST, so both dates take the same offset.
  assert.equal(
    parseDtStart("TZID=America/Phoenix:20260908T190000", "America/Phoenix")?.iso,
    "2026-09-09T02:00:00.000Z",
  );
  assert.equal(
    parseDtStart("TZID=America/Phoenix:20261208T190000", "America/Phoenix")?.iso,
    "2026-12-09T02:00:00.000Z",
  );
});

test("A-007 · the DATE-BOUNDARY case, which is the one that misleads a reader", () => {
  // 1am on the 8th as UTC renders in New York as 9pm on the 7th.
  assert.equal(parseDtStart("TZID=Bad/Zone:20260908T010000", "America/New_York"), null);
  assert.equal(
    parseDtStart("TZID=America/New_York:20260908T010000", "America/New_York")?.iso,
    "2026-09-08T05:00:00.000Z",
    "and the correct answer is still an instant on the 8th",
  );
});

test("A-007 · an unreadable zone is counted as unplaceableInTime, not dropped silently", () => {
  const wiring = wiringForTypes(["ICAL"]).find((w) =>
    w.config.feedUrl?.includes("wilmotnh.org"),
  );
  assert.ok(wiring, "no Wilmot row wired — this guard is stale");

  const ics = [
    "BEGIN:VCALENDAR",
    "BEGIN:VEVENT",
    "UID:bad-zone-1",
    "SUMMARY:Selectboard",
    "DTSTART;TZID=Not/AZone:20260908T190000",
    "LOCATION:Wilmot Town Office Building",
    "CATEGORIES:Select Board",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");

  const source = makeIcalSource([wiring]);
  const result = source.normalizeWithDrops(
    [{ wiring, ics, collectedAt: "2026-08-24T12:00:00.000Z", sourceUrl: "x" }],
    new Date("2026-08-24T12:00:00.000Z"),
  );
  assert.equal(result.meetings.length, 0, "a meeting was minted from a zone we could not read");
  assert.equal(
    result.drops.unplaceableInTime,
    1,
    "and the record must say so — a silent skip loses a meeting without a trace",
  );
  assert.equal(result.accounting.outcome, "CONSERVED");
});

/*
 * A library's events calendar and a town calendar, trimmed to the named bodies' events and the ones whose
 * rules once stopped expansion. DESCRIPTION lines are removed (private contact details); every other byte is as served.
 */
const WARNER_EVENTS = readFileSync(join(import.meta.dirname, "fixtures", "ical", "warner-events-2026-09-25-trimmed.ics"), "utf8");
const WARNER_TOWN = readFileSync(join(import.meta.dirname, "fixtures", "ical", "warner-2026-09-23-full.ics"), "utf8");
const warnerRow = (slug: string) => {
  const row = wiringForTypes(["ICAL"]).find((w) => w.config.slug === slug);
  assert.ok(row, slug + " is wired");
  return row;
};

test("the river committee's every-other-month series is expanded: another body's split series is no evidence about this one", () => {
  const row = warnerRow("warner-warner-river-local-advisory-committee");
  assert.match(row.config.feedUrl ?? "", /mq5sbbdfvg3le9ddpc76qpo5d8/, "the library's calendar, not the town's");
  const readAt = "2026-09-25T22:25:56.000Z";
  const { meetings } = makeIcalSource([row]).normalizeWithDrops(
    [{ wiring: row, ics: WARNER_EVENTS, collectedAt: readAt, sourceUrl: row.config.feedUrl ?? "" }],
    new Date(readAt),
  );
  assert.deepEqual(
    meetings.map((m) => new Date(m.startsAt).toISOString()),
    ["2026-06-18T21:30:00.000Z", "2026-07-22T23:00:00.000Z", "2026-09-23T23:00:00.000Z", "2026-11-19T00:00:00.000Z"],
    "18 June (inside the held 120 days back, DB-03), 22 July and 23 September at 7 PM from the series, and 25 November as the library moved it to 18 November",
  );
  assert.ok(meetings.every((m) => m.bodyId === row.bodyId && m.title === "WRLAC"));
  assert.match(JSON.stringify(meetings[0].location ?? meetings[0].venueGap), /Pillsbury Free Library/, "the library's own place, never the town hall");
});

test("the Village Water District's commissioners sit at the treatment plant, never pinned at the town hall", () => {
  const row = warnerRow("warner-warner-village-water-district");
  const readAt = "2026-09-23T17:30:01.000Z";
  const { meetings } = makeIcalSource([row]).normalizeWithDrops(
    [{ wiring: row, ics: WARNER_TOWN, collectedAt: readAt, sourceUrl: row.config.feedUrl ?? "" }],
    new Date(readAt),
  );
  const commissioners = meetings.filter((m) => m.title === "Precinct Commissioners");
  assert.ok(commissioners.length >= 10, "the 2nd- and 4th-Wednesday series, " + commissioners.length + " in the window");
  for (const m of commissioners) {
    assert.equal(m.location, null, "no pin at Warner Town Hall");
    assert.match(JSON.stringify(m.venueGap), /55 West Joppa/, "the feed's own words for the place");
  }
  const upcoming = commissioners.filter((m) => Date.parse(m.startsAt) > Date.parse(readAt)).map((m) => new Date(m.startsAt).toISOString().slice(0, 10));
  assert.deepEqual(upcoming.slice(0, 3), ["2026-09-23", "2026-10-14", "2026-10-28"]);
});
