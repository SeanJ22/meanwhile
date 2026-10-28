import assert from "node:assert/strict";
import test from "node:test";
import { readDerivedFamilyMembers } from "../lib/civic-data/derived-meeting-acquisition.ts";
import type { DerivedWiringRecord } from "../lib/civic-data/derived-meeting-wiring.ts";
import type { VenueEntry } from "../lib/meetings/venue-cache.ts";

const division = "ocd-division/country:us/state:nh/place:testville", route = "https://testville.example.gov/council.ics";
const member: DerivedWiringRecord = { id: `ical:${division}#governing`, status: "ACTIVE", row: {
  bodyId: `${division}#governing`, ocdId: division, bodyName: "Council", kind: "ICAL", route, officialHost: "testville.example.gov",
  jurisdictionId: "nh:city:testville", state: "US-NH", publishingOrg: "City Clerk", timeZone: "America/New_York", crosswalkRowId: "crosswalk",
  reviewedAt: "2026-10-26T12:00:00Z", verifiedAt: "2026-10-26T12:00:00Z", config: { slug: "testville", bodyName: "Council", feedUrl: route, titleMatch: "Council" },
} };
const feed = ["BEGIN:VCALENDAR", "VERSION:2.0", "BEGIN:VEVENT", "UID:one", "DTSTART;TZID=America/New_York:20261028T190000",
  "SUMMARY:Council meeting", "LOCATION:Town Hall", "END:VEVENT", "END:VCALENDAR", ""].join("\r\n");
const venue: VenueEntry = { sourceId: "ical", bodyOcdId: division, match: "Town Hall", name: "Town Hall", address: "1 Main Street",
  lat: 43, lng: -71, addressSourceUrl: "https://testville.example.gov/town-hall", coordinateSourceUrl: "https://testville.example.gov/town-hall", verifiedAt: "2026-10-26" };

test("derived sources acquire first, then normalize using only their selected reviewed venue records", async () => {
  const events: string[] = [];
  const reads = await readDerivedFamilyMembers([member], async () => { events.push("source"); return new Response(feed, { headers: { "content-type": "text/calendar" } }); },
    undefined, new Date("2026-10-26T12:00:00Z"), async () => { events.push("selected-inputs"); return [venue]; });
  assert.deepEqual(events, ["source", "selected-inputs"]);
  assert.ok(reads[0]!.ok, reads[0]!.error ?? undefined);
  assert.equal(reads[0]!.freshMeetings[0]!.location?.name, "Town Hall");
  assert.equal(reads[0]!.freshMeetings[0]!.location?.lat, 43);
});

test("failed source acquisition does not load held normalization inputs", async () => {
  const reads = await readDerivedFamilyMembers([member], async () => new Response("unavailable", { status: 404 }), undefined,
    new Date("2026-10-26T12:00:00Z"), async () => { assert.fail("failed source loaded held registry/venues"); });
  assert.equal(reads[0]!.ok, false); assert.deepEqual(reads[0]!.freshMeetings, []);
});
