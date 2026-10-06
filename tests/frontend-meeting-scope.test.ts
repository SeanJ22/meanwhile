import assert from "node:assert/strict";
import test from "node:test";
import { groupByVenue } from "../lib/meetings/venues.ts";
import { readerMeetingScope } from "../lib/meetings/reader-scope.ts";
import type { Meeting } from "../lib/sources/types.ts";
import type { CoveredBody } from "../lib/registry/coverage.ts";

const provenance = { sourceUrl: "https://example.gov/calendar", sourceOrg: "Public body", collectedAt: "2026-10-05T00:00:00Z", verifiedAt: null };
const own = "ocd-division/country:us/state:az/place:one";
const make = (id: string, fields: Partial<Meeting> = {}): Meeting => ({ id, ocdId: own, bodyId: "body:one", bodyName: "Council", title: "Public meeting", startsAt: "2026-10-15T10:00:00Z", timeZone: "America/Phoenix", location: null, agendaUrl: null, jurisdiction: "One", status: "SCHEDULED", provenance, ...fields });

test("online-only venues use only the exact body's published office, without changing the meeting", () => {
  const online = make("online", { online: { label: "Zoom", joinUrl: "https://example.gov/join" } });
  const unknown = make("unknown");
  const office = { bodyId: "body:one", name: "Council office", address: "1 Public Street", lat: 32.2, lng: -110.9, provenance };
  assert.deepEqual(groupByVenue([online, unknown]), []);
  const venues = groupByVenue([online, unknown], undefined, [office]);
  assert.equal(venues.length, 1);
  assert.equal(venues[0].kind, "ONLINE_ONLY");
  assert.deepEqual(venues[0].meetings.map(meeting => meeting.id), ["online"]);
  assert.equal(venues[0].officeAddressSource, provenance);
  assert.equal(online.location, null);
  assert.equal(online.online?.joinUrl, "https://example.gov/join");
  assert.deepEqual(groupByVenue([online], undefined, [{ ...office, bodyId: "body:other" }]), []);
  const physical = make("physical", { location: { name: office.name, address: office.address, lat: office.lat, lng: office.lng } });
  assert.equal(groupByVenue([physical, online], undefined, [office]).length, 2);
});

test("a widened search counts each own government's held calendar apart from nearby results and agendas", () => {
  const ownMeeting = make("own");
  const nearby = make("nearby", { ocdId: "ocd-division/country:us/state:az/place:other", bodyId: "body:other", agendaUrl: "https://example.gov/agenda" });
  const bodies = [{ bodyId: "body:one", name: "Council", ocdId: own }, { bodyId: "body:empty", name: "School board", ocdId: own }] as CoveredBody[];
  const args = { heldMeetings: [ownMeeting, nearby], shownMeetings: [nearby], bodies, ownDivisionIds: new Set([own]), radiusKm: 150, requestedRadiusKm: 25, now: new Date("2026-10-05T00:00:00Z") };
  const scope = readerMeetingScope(args);
  assert.deepEqual(scope.nearbyMeetingIds, ["nearby"]);
  assert.deepEqual(scope.governments, [{ bodyId: "body:one", name: "Council", upcoming: 1, agendasLinked: 0 }, { bodyId: "body:empty", name: "School board", upcoming: 0, agendasLinked: 0 }]);
  assert.equal(readerMeetingScope({ ...args, ownDivisionIds: null }).governments, null);
  assert.deepEqual(readerMeetingScope({ ...args, radiusKm: 25 }).nearbyMeetingIds, []);
});
