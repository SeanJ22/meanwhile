import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { isPlacelessLocation } from "../lib/meetings/venue-cache.ts";
import { makeClerksBoardsSource, parseBoardPage, type ClerksBoardsRaw } from "../lib/sources/clerksboards/index.ts";
import type { BodySourceWiring } from "../lib/registry/source-wiring.ts";

const TUCSON = "ocd-division/country:us/state:az/place:tucson";
const page = readFileSync(join(import.meta.dirname, "fixtures", "clerksboards", "b49.html"), "utf8");
const wiring: BodySourceWiring = {
  bodyId: `${TUCSON}#public-art-and-community-design-committee`,
  ocdId: TUCSON,
  agendaSourceType: "CLERKSBOARDS",
  jurisdiction: "Tucson, AZ",
  publishingOrg: "City of Tucson Clerk",
  timeZone: "America/Phoenix",
  config: { boardId: "49" },
  verifiedAt: "2026-09-24",
};
const NOW = new Date("2026-09-24T09:00:00-07:00");

test("the recorded board 49 page states its meeting location as Zoom (Virtual)", () => {
  assert.equal(parseBoardPage(page).location, "Zoom (Virtual)");
  assert.equal(isPlacelessLocation("Zoom (Virtual)"), true);
  // A physical room named beside the video link is still a place.
  assert.equal(isPlacelessLocation("Zoom (Virtual) / City Hall, 255 W Alameda St"), false);
});

test("board 49's sittings are kept online, with no place, no pin and no venue gap", () => {
  const raw: ClerksBoardsRaw[] = [{ wiring, html: page, collectedAt: NOW.toISOString() }];
  const { meetings, drops } = makeClerksBoardsSource([wiring]).normalizeWithDrops(raw, NOW);
  assert.ok(meetings.length > 0, "the committee's recorded schedule produced no sittings");
  for (const m of meetings) {
    assert.equal(m.location, null);
    assert.equal(m.online?.label, "Zoom (Virtual)");
    assert.equal(m.venueGap ?? null, null, "an online sitting was filed as a place we could not pin");
  }
  assert.equal(drops.placeless, meetings.length);
  assert.equal(drops.unknownVenue, 0);
});
