import assert from "node:assert/strict";
import { test } from "node:test";

import { automaticVenuePackage, placeMeetingsFromVerifiedVenues, retainPreviouslyVerifiedVenuePoints, verifiedCensusVenuePoint } from "../lib/meetings/automatic-venue-resolutions.ts";
import { derivedInputIssue } from "../lib/civic-data/derived-door.ts";
import { absoluteEventSourceUrl } from "../lib/sources/ical/index.ts";
import type { MeetingsSnapshot } from "../lib/meetings/snapshot.ts";

const NOW = "2026-09-28T08:30:00.000Z";
const FEED = "https://county.example.gov/common/modules/iCalendar/iCalendar.aspx?catID=31&feed=calendar";
const RAW = "- 1415 W Melody Ln Bldg G Bisbee AZ 85603";
const BODY = "ocd-division/country:us/state:az/county:cochise";
const ROUTES = new Map([["ical:county-governing", FEED]]);
const GEO = { result: { addressMatches: [{
  matchedAddress: "1415 W MELODY LN, BISBEE, AZ, 85603",
  coordinates: { x: -109.92566533383, y: 31.393935355772 },
  addressComponents: { city: "BISBEE", state: "AZ", zip: "85603", streetName: "MELODY", preDirection: "W", suffixType: "LN" },
}] } };

const snapshot = {
  generatedAt: NOW,
  meetings: [{
    id: "ical:county:meeting-1", ocdId: BODY, bodyId: "county-governing", location: null,
    venueGap: { kind: "STATED_NOT_PLACED", publishedText: RAW, publisher: "County" },
    provenance: { sourceUrl: "/calendar.aspx?EID=2980", sourceOrg: "County", collectedAt: NOW, verifiedAt: null },
  }],
  sources: [{ source: "ical", acquisitions: [{ source: "ical", requestedUrl: FEED, finalUrl: FEED,
    httpStatus: 200, rawHash: "a".repeat(64), byteCount: 3000 }] }],
} as unknown as MeetingsSnapshot;

test("one exact published address and Census match can place a meeting", async () => {
  const result = await automaticVenuePackage({ snapshot, existingIds: new Set(), memberRoutes: ROUTES, clock: () => NOW,
    fetchImpl: (async () => new Response(JSON.stringify(GEO), { status: 200 })) as typeof fetch });
  assert.deepEqual(result.held, []);
  assert.ok(result.package);
  const row = (result.package.payload as { records: readonly Record<string, unknown>[] }).records[0]!;
  assert.equal(row.addressSourceUrl, FEED);
  assert.equal(row.coordinateSourceUrl, result.package.sourceReceipt.sources[1]!.finalUrl);
  assert.equal(row.lat, 31.393935355772);
  const placed = placeMeetingsFromVerifiedVenues(snapshot.meetings, [row as unknown as Parameters<typeof placeMeetingsFromVerifiedVenues>[1][number]]);
  assert.equal(placed.placedCount, 1);
  assert.equal(placed.meetings[0]?.location?.lat, 31.393935355772);
  assert.equal(placed.meetings[0]?.venueGap, undefined);
});

test("a different city or an ambiguous response cannot create a pin", () => {
  assert.equal(verifiedCensusVenuePoint(RAW.replace("Bisbee", "Tucson"), GEO), null);
  assert.equal(verifiedCensusVenuePoint(RAW, { result: { addressMatches: [GEO.result.addressMatches[0], GEO.result.addressMatches[0]] } }), null);
});

test("a carried address cannot borrow a newer feed's acquisition receipt", async () => {
  const old = { ...snapshot, meetings: [{ ...snapshot.meetings[0]!, carried: { source: "ical", lastFreshAt: NOW } }] } as MeetingsSnapshot;
  const result = await automaticVenuePackage({ snapshot: old, existingIds: new Set(), memberRoutes: ROUTES, clock: () => NOW,
    fetchImpl: (async () => { throw new Error("a carried address must not be geocoded as fresh"); }) as typeof fetch });
  assert.equal(result.package, null);
  assert.match(result.held[0] ?? "", /not freshly read/);
});

test("an iCal event's relative URL becomes an absolute publisher link", () => {
  assert.equal(absoluteEventSourceUrl("/calendar.aspx?EID=2980", FEED), "https://county.example.gov/calendar.aspx?EID=2980");
  assert.equal(absoluteEventSourceUrl("javascript:alert(1)", FEED), FEED);
});

test("a retry retains only an exact previously verified sitting and address", () => {
  const fresh = snapshot.meetings[0]!;
  const prior = { ...fresh, location: { name: RAW, address: RAW, lat: 31.3939, lng: -109.9256 }, venueGap: undefined };
  assert.equal(retainPreviouslyVerifiedVenuePoints([fresh], [prior])[0]?.location?.lat, 31.3939);
  assert.equal(retainPreviouslyVerifiedVenuePoints([{ ...fresh, venueGap: { ...fresh.venueGap!, publishedText: "different address" } }], [prior])[0]?.location, null);
});

test("the derived family gate refuses a non-Census reference receipt", () => {
  const reference = { kind: "REFERENCE_ACQUISITION" as const,
    requestedUrl: "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=1415+W+Melody+Ln+Bisbee+AZ+85603&benchmark=Public_AR_Current&format=json",
    finalUrl: "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress",
    httpStatus: 200, rawHash: "a".repeat(64), retrievedAt: NOW };
  assert.equal(derivedInputIssue(reference), null);
  assert.match(derivedInputIssue({ ...reference, finalUrl: "https://example.com/geocoder/locations/onelineaddress" }) ?? "", /Census/);
});
