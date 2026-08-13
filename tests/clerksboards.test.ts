import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  expandSchedule,
  makeClerksBoardsSource,
  parseBoardPage,
  type ClerksBoardsRaw,
} from "../lib/sources/clerksboards/index.ts";
import type { BodySourceWiring } from "../lib/registry/source-wiring.ts";

/**
 * Against recorded pages from clerksboards.tucsonaz.gov (2026-08-14), never
 * the live host. Minimum row counts are asserted, not the absence of errors —
 * a parser that silently matches nothing must fail here.
 */

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
  // Board of Adjustment: `…, 12/30/2026, 1/27/2027; @ 12:30 p.m.`
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
  // CWAC: `1st Wednesday of each month @ 8:00 a.m.`
  const parsed = parseBoardPage(page("b23.html"));
  const out = expandSchedule(
    parsed.scheduleText!,
    new Date("2026-08-01T00:00:00Z"),
    new Date("2026-10-15T00:00:00Z"),
  );
  assert.ok(out, "the CWAC recurrence stopped parsing");
  // 1st Wednesdays: Aug 5, Sep 2, Oct 7 2026.
  assert.deepEqual(
    out.map((i) => `${i.y}-${i.mo}-${i.d}`),
    ["2026-8-5", "2026-9-2", "2026-10-7"],
  );
  assert.equal(out[0].h, 8);
});

test("an unknown schedule format produces zero meetings and a counted drop", () => {
  // Design Review Board is virtual; force the schedule question by feeding a
  // page whose schedule reads "Meets as required" (b26 has explicit dates, so
  // synthesize the unknown case from b23 with the schedule cut out).
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

  // Window [Jul 15, Oct 13] over the published dates 8/12, 9/2, 10/7.
  assert.equal(meetings.length, 3, JSON.stringify(meetings.map((m) => m.id)));
  assert.equal(drops.unknownVenue, 0);

  const aug = meetings.find((m) => m.id === "clerksboards:38:2026-08-12");
  assert.ok(aug, "the Aug 12 sitting is missing");
  // The Clerk's own agenda title says "(Canceled) 08-12-26" — that instance
  // and only that instance is canceled, and it carries the agenda PDF.
  assert.equal(aug.status, "CANCELED");
  assert.match(aug.agendaUrl ?? "", /assets\.tucsonaz\.gov/);

  const sep = meetings.find((m) => m.id === "clerksboards:38:2026-09-02");
  assert.ok(sep);
  assert.equal(sep.status, "SCHEDULED");
  assert.equal(sep.agendaUrl, null, "September must not inherit August's agenda");

  for (const m of meetings) {
    assert.equal(m.ocdId, TUCSON);
    assert.equal(m.bodyName, "Planning Commission");
    assert.equal(m.location.address, "255 W. Alameda St, Tucson, AZ 85701");
    assert.match(m.startsAt, /-07:00$/, "Phoenix never observes DST");
    assert.match(
      m.provenance.sourceUrl ?? "",
      /clerksboards\.tucsonaz\.gov\/boards\/\?board=38/,
    );
  }
});

test("a virtual-only board drops placeless, counted", () => {
  // Design Review Board publishes "Microsoft Teams (Virtual)" — a real body
  // with real sittings and no place on a map (D18).
  const source = makeClerksBoardsSource([wiringFor("26", "design-review-board")]);
  const raw: ClerksBoardsRaw[] = [
    {
      wiring: wiringFor("26", "design-review-board"),
      html: page("b26.html"),
      collectedAt: NOW.toISOString(),
    },
  ];
  const { meetings, drops } = source.normalizeWithDrops(raw, NOW);
  assert.equal(meetings.length, 0);
  assert.ok(drops.placeless > 0, "virtual sittings must count as placeless");
  assert.equal(drops.unknownVenue, 0);
});
