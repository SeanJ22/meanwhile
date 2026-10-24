import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { meetingPartitionForRow } from "../lib/civic-data/meeting-partitions.ts";
import { reviewedVenueEntries, resolveVenue, type VenueEntry } from "../lib/meetings/venue-cache.ts";
import type { LegistarEvent } from "../lib/sources/legistar/types.ts";
import type { LegistarInSiteRaw } from "../lib/sources/legistar-insite/index.ts";
import { scopedMeetingSource } from "../scripts/lib/scoped-meeting-source.ts";
import { FIXTURE_DOOR_ROWS } from "./helpers/meeting-doors-fixture.ts";

const venue: VenueEntry = { sourceId: "ical", bodyOcdId: "ocd-division/country:us/state:nh/place:example",
  match: "Council room", name: "Council room", address: "1 Public Square", lat: 43, lng: -71,
  addressSourceUrl: "https://example.gov/meetings", coordinateSourceUrl: "https://geocoding.geo.census.gov/", verifiedAt: "2026-10-20" };

test("the existing venue resolver accepts a verified empty projection without falling back to national venues", () => {
  assert.deepEqual(reviewedVenueEntries("ical", venue.bodyOcdId, null, []), []);
  assert.equal(resolveVenue("ical", venue.bodyOcdId, venue.match, null, []), undefined);
});

test("an explicit projection resolves only a matching source and body and never borrows another place's venue", () => {
  assert.equal(resolveVenue("ical", venue.bodyOcdId, venue.match, null, [venue]), venue);
  assert.equal(resolveVenue("ical", "ocd-division/country:us/state:az/place:example", venue.match, null, [venue]), undefined);
  assert.equal(resolveVenue("legistar", venue.bodyOcdId, venue.match, null, [venue]), undefined);
  assert.deepEqual(reviewedVenueEntries("ical", venue.bodyOcdId, null, [venue]), [venue]);
});

test("the exact Pima adapter preserves source text without consulting a venue table", () => {
  const row = FIXTURE_DOOR_ROWS.find(row => row.agendaSourceType === "LEGISTAR" && row.config.slug === "pima")!;
  const partition = meetingPartitionForRow("legistar", row.bodyId);
  const event = (JSON.parse(readFileSync(new URL("./fixtures/legistar-pima-events.json", import.meta.url), "utf8")) as LegistarEvent[])[0]!;
  const raw = [{ source: "legistar", raw: { event, slug: "pima", collectedAt: "2026-09-25T12:00:00.000Z", items: [] } }];
  const empty = scopedMeetingSource(partition)!.normalize(raw);
  assert.equal(empty.length, 1);
  assert.equal(empty[0]!.bodyId, row.bodyId);
  assert.equal(empty[0]!.location, null, "publication places the published text");
  assert.equal(empty[0]!.venueGap?.publishedText, event.EventLocation);
});

test("the exact Mesa InSite adapter retains the body's calendar before placement", () => {
  const row = FIXTURE_DOOR_ROWS.find(row => row.agendaSourceType === "LEGISTAR" && row.config.slug === "mesa")!;
  const partition = meetingPartitionForRow("legistar-insite", row.bodyId);
  const raw: LegistarInSiteRaw = { slug: "mesa", calendarUrl: "https://mesa.legistar.com/Calendar.aspx",
    windows: [{ range: "This Year", rendered: "This Year", html: readFileSync(new URL("./fixtures/legistar-insite-mesa-minutes/calendar-2026-09-25.html", import.meta.url), "utf8"),
      pager: null, pages: [], noRecords: false }], feedXml: null, feedUrl: null, icalByInsiteId: {},
    clerkScheduleHtml: null, clerkScheduleUrl: null, collectedAt: "2026-09-25T12:00:00.000Z" };
  const source = scopedMeetingSource(partition)!;
  const meetings = source.normalize([{ source: "legistar-insite", raw }], new Date("2026-09-25T12:00:00.000Z"));
  assert.ok(meetings.length > 0, JSON.stringify(source.lastReport));
  assert.ok(meetings.every(meeting => meeting.bodyId === row.bodyId && meeting.location === null));
  assert.ok(source.lastReport!.children[0]!.drops.unknownVenue > 0, "unplaced locations stay named gaps beside the verified calendar");
});
