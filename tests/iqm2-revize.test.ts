import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { makeIqm2Source, parseCalendarRows } from "../lib/sources/iqm2/index.ts";
import {
  makeRevizeSource,
  parseAgendaDocuments,
  parseUpcomingBlock,
} from "../lib/sources/revize/index.ts";
import { wiringForTypes } from "../lib/registry/source-wiring.ts";

/**
 * The two county adapters, against recorded fixtures — no live calls.
 *
 * Fixtures were captured 2026-08-13 from the real portals
 * (morriscountynj.iqm2.com Calendar.aspx; merrimackcounty.net homepage and
 * BOC notices page). What is pinned is the *parse*: a vendor template change
 * should fail here with a count, never silently return zero rows — the
 * NovusAgenda 200-with-zero-meetings miss recorded as a HIT is the shape
 * these counts guard against.
 */

const FIXTURES = join(process.cwd(), "tests", "fixtures");

const iqm2Html = () =>
  readFileSync(join(FIXTURES, "iqm2", "morris-calendar.html"), "utf8");
const revizeHome = () =>
  readFileSync(join(FIXTURES, "revize", "merrimack-home.html"), "utf8");
const revizeAgendas = () =>
  readFileSync(join(FIXTURES, "revize", "merrimack-agendas.html"), "utf8");

// Mid-August 2026, when the fixtures were recorded.
const NOW = new Date("2026-08-13T16:00:00Z");

test("iqm2: the calendar parse states its count, and it is not zero", () => {
  const rows = parseCalendarRows(iqm2Html());
  assert.ok(
    rows.length >= 8,
    `expected the recorded calendar to parse to at least 8 rows, got ${rows.length}`,
  );
  for (const row of rows) {
    assert.ok(row.detailId, "a row lost its Detail_Meeting id");
    assert.equal(row.board, "Board of County Commissioners");
    assert.match(row.when, /2026/);
    assert.ok(row.location.includes("10 Court Street"), row.location);
  }
});

test("iqm2: normalize places every row, resolves both venues, keeps agenda links honest", () => {
  const wiring = wiringForTypes(["IQM2"]);
  assert.equal(wiring.length, 1, "exactly one IQM2 body is wired");

  const source = makeIqm2Source(wiring);
  const { meetings, drops } = source.normalizeWithDrops(
    [{ wiring: wiring[0], html: iqm2Html(), collectedAt: NOW.toISOString() }],
    NOW,
  );

  assert.ok(meetings.length >= 8, `normalized ${meetings.length}`);
  assert.equal(drops.unknownVenue, 0, "both published venues must resolve");

  const venues = new Set(meetings.map((m) => m.location.name));
  assert.equal(venues.size, 2, "work sessions and regular meetings sit in two rooms");

  for (const m of meetings) {
    assert.ok(m.id.startsWith("iqm2:morriscountynj:"), m.id);
    assert.equal(m.ocdId, "ocd-division/country:us/state:nj/county:morris");
    assert.equal(m.timeZone, "America/New_York");
    // The agenda link is observed (FileOpen), never constructed from Detail id.
    if (m.agendaUrl) {
      assert.match(m.agendaUrl, /FileOpen\.aspx\?Type=14&ID=\d+/);
    }
    assert.ok(m.provenance.sourceUrl?.includes("Detail_Meeting.aspx?ID="));
  }

  // The recorded page holds published agendas for the Aug 12 sittings and
  // none yet for the far future — both states must exist or the honesty of
  // agendaUrl:null is untested.
  assert.ok(meetings.some((m) => m.agendaUrl !== null), "no published agenda parsed");
  assert.ok(meetings.some((m) => m.agendaUrl === null), "every future meeting claims an agenda");
});

test("revize: the homepage block parse states its count, and it is not zero", () => {
  const items = parseUpcomingBlock(revizeHome());
  assert.ok(items.length >= 2, `expected at least 2 upcoming items, got ${items.length}`);
  const boc = items.find((i) => i.title.includes("Board of Commissioners"));
  assert.ok(boc, "the Board of Commissioners row is missing");
  assert.equal(boc.venueText, "OCH - Concord");
});

test("revize: dated documents parse from both filename spellings", () => {
  const docs = parseAgendaDocuments(
    revizeAgendas(),
    "Board of Commissioners/Public Notices, Agenda, Minutes/",
  );
  assert.ok(docs.length >= 20, `expected a season of documents, got ${docs.length}`);
  // "8.10.26" numeric spelling and "August 10" worded spelling both occur.
  assert.ok(docs.some((d) => d.month === 8 && d.day === 10 && d.kind === "notice"));
  assert.ok(docs.some((d) => d.month === 8 && d.day === 10 && d.kind === "agenda"));
});

test("revize: normalize wires the BOC, drops the delegation's committee counted", () => {
  const wiring = wiringForTypes(["REVIZE"]);
  assert.equal(wiring.length, 1, "exactly one REVIZE body is wired");

  const source = makeRevizeSource(wiring);
  const { meetings, drops } = source.normalizeWithDrops(
    [
      {
        wiring: wiring[0],
        homepageHtml: revizeHome(),
        agendaPageHtml: revizeAgendas(),
        collectedAt: NOW.toISOString(),
      },
    ],
    NOW,
  );

  assert.equal(meetings.length, 1, "one BOC meeting in the recorded block");
  assert.equal(
    drops.notConfigured,
    1,
    "the Executive Committee is a different government and must drop counted",
  );

  const m = meetings[0];
  assert.equal(m.ocdId, "ocd-division/country:us/state:nh/county:merrimack");
  assert.equal(m.bodyName, "Merrimack County Board of Commissioners");
  assert.equal(m.status, "SCHEDULED");
  assert.equal(m.location.name, "OCH, 163 N. Main St., Concord");
  // No agenda posted for 8/24 when the fixture was recorded; the field must
  // say so rather than pointing at a constructed URL.
  assert.equal(m.agendaUrl, null);
  // Starts 10:00 AM Eastern.
  assert.match(m.startsAt, /^2026-08-24T10:00:00.*-04:00$/);
});
