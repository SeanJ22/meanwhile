import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  makeBoardBookSource,
  parseOrganizationPage,
} from "../lib/sources/boardbook/index.ts";
import type { BodySourceWiring } from "../lib/registry/source-wiring.ts";

/**
 * The BoardBook adapter (item 2, the Amphitheater half) against the recorded
 * org-page fixture. Minimum row counts, never merely the absence of an error
 * — the parser returning [] on real markup must fail loudly here.
 */

const FIXTURE = readFileSync(
  join(import.meta.dirname, "fixtures", "boardbook-amphi-2065.html"),
  "utf8",
);

const WIRING: BodySourceWiring = {
  bodyId:
    "ocd-division/country:us/state:az/school_district:amphitheater_unified_district#board",
  ocdId:
    "ocd-division/country:us/state:az/school_district:amphitheater_unified_district",
  agendaSourceType: "BOARDBOOK",
  jurisdiction: "Amphitheater Unified School District, AZ",
  publishingOrg: "Amphitheater Unified School District Governing Board",
  timeZone: "America/Phoenix",
  config: {
    orgId: "2065",
    bodyName: "Amphitheater Unified School District Governing Board",
  },
  verifiedAt: "2026-08-14",
};

// A clock inside the fixture's coverage: Aug 11 concluded 3 days back,
// July 28 and July 14 inside the 30-day concluded window.
const NOW = new Date("2026-08-14T12:00:00-07:00");

test("the org page parses to at least 15 dated rows", () => {
  const { rows, undated } = parseOrganizationPage(FIXTURE);
  assert.ok(rows.length >= 15, `only ${rows.length} rows parsed`);
  assert.equal(undated, 0, `${undated} rows failed to date`);

  const aug11 = rows.find((r) => r.y === 2026 && r.mo === 8 && r.d === 11);
  assert.ok(aug11, "the Aug 11 regular meeting is missing");
  assert.equal(aug11!.h, 18);
  assert.equal(aug11!.mi, 0);
  assert.match(aug11!.title, /REGULAR PUBLIC MEETING/);
  assert.equal(aug11!.locationName, "Leadership and Professional Development Center");
  assert.equal(aug11!.addressLine, "701 W Wetmore Road");
  assert.ok(aug11!.meetingId, "meeting id missing");
  assert.ok(aug11!.hasAgenda, "agenda link missing");
});

test("normalize emits windowed meetings with cited venues and real agenda links", () => {
  const source = makeBoardBookSource([WIRING]);
  const raw = [{ wiring: WIRING, html: FIXTURE, collectedAt: "2026-08-14T12:00:00Z" }];
  const { meetings, drops } = source.normalizeWithDrops!(raw, NOW);

  // M76 (2026-08-15): the back window is now the SERVED window — 90 days,
  // not 30 — so the four sittings this adapter used to clip at the fetch are
  // in. Jul 14, previously "31 days back, one day outside", is one of them.
  // The 2018 row and the spring rows are still outside 90 days and are a
  // deliberate archive clip, not drops: the count says which is which.
  assert.equal(meetings.length, 6, `${meetings.length} meetings in window`);
  assert.equal(drops.unknownVenue, 0, "venue cache missed an observed venue");
  assert.equal(drops.unplaceableInTime, 0);

  for (const m of meetings) {
    assert.equal(m.ocdId, WIRING.ocdId);
    assert.ok(Number.isFinite(m.location!.lat) && Number.isFinite(m.location!.lng));
    assert.ok(m.location!.address, "venue address missing");
    if (m.agendaUrl) {
      assert.match(
        m.agendaUrl,
        /^https:\/\/meetings\.boardbook\.org\/Public\/Agenda\/2065\?meeting=\d+$/,
      );
    }
    assert.equal(
      m.provenance.sourceUrl,
      "https://meetings.boardbook.org/Public/Organization/2065",
    );
  }
});

test("an unobserved venue drops the meeting, counted, never guessed", () => {
  const source = makeBoardBookSource([WIRING]);
  const doctored = FIXTURE.replaceAll(
    "Leadership and Professional Development Center",
    "Some Room The Cache Has Never Seen",
  );
  const raw = [{ wiring: WIRING, html: doctored, collectedAt: "2026-08-14T12:00:00Z" }];
  const { meetings, drops } = source.normalizeWithDrops!(raw, NOW);
  assert.ok(drops.unknownVenue >= 1, "unknown venue was not counted");
  for (const m of meetings) {
    assert.notEqual(m.location!.name, "Some Room The Cache Has Never Seen");
  }
});
