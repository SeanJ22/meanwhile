import assert from "node:assert/strict";
import { test } from "node:test";

import { absolutePublisherMeetingUrl, automaticVenuePackage, normalizeFamilyMeetingCitations, placeMeetingsFromVerifiedVenues, retainPreviouslyVerifiedVenuePoints, verifiedCensusVenuePoint } from "../lib/meetings/automatic-venue-resolutions.ts";
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

test("a named venue's street address is queried while its complete original wording remains the address evidence", async () => {
  const published = "Community Library at 1415 W Melody Ln Bldg G Bisbee AZ 85603 (use the rear entrance)";
  const named = { ...snapshot, meetings: [{ ...snapshot.meetings[0]!, venueGap: { kind: "STATED_NOT_PLACED", publishedText: published, publisher: "County" } }] } as MeetingsSnapshot;
  const result = await automaticVenuePackage({ snapshot: named, existingIds: new Set(), memberRoutes: ROUTES, clock: () => NOW,
    fetchImpl: async request => {
      assert.equal(new URL(String(request)).searchParams.get("address"), "1415 W Melody Ln Bldg G Bisbee AZ 85603");
      return new Response(JSON.stringify(GEO));
    } });
  const row = (result.package?.payload as { records: readonly (Readonly<Record<string, unknown>> & { id: string })[] }).records[0];
  assert.equal(row.address, published);
  assert.equal(row.match, published);
  assert.equal(verifiedCensusVenuePoint(published.replace("Bisbee", "Tucson"), GEO), null);
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
  assert.equal(absolutePublisherMeetingUrl("/calendar.aspx?EID=2980", FEED), "https://county.example.gov/calendar.aspx?EID=2980");
  assert.equal(absolutePublisherMeetingUrl("javascript:alert(1)", FEED), FEED);
  assert.equal(normalizeFamilyMeetingCitations(snapshot.meetings, ROUTES)[0]?.provenance.sourceUrl,
    "https://county.example.gov/calendar.aspx?EID=2980");
});

test("a retry retains only an exact previously verified sitting and address", () => {
  const fresh = snapshot.meetings[0]!;
  const prior = { ...fresh, location: { name: RAW, address: RAW, lat: 31.3939, lng: -109.9256 }, venueGap: undefined };
  assert.equal(retainPreviouslyVerifiedVenuePoints([fresh], [prior])[0]?.location?.lat, 31.3939);
  assert.equal(retainPreviouslyVerifiedVenuePoints([{ ...fresh, venueGap: { ...fresh.venueGap!, publishedText: "different address" } }], [prior])[0]?.location, null);
});

test("BX-08: a published address without a ZIP matches; a wrong published ZIP does not", () => {
  const noZip = "- 1415 W Melody Ln Bldg G Bisbee AZ";
  assert.ok(verifiedCensusVenuePoint(noZip, GEO));
  assert.equal(verifiedCensusVenuePoint(RAW.replace("85603", "85604"), GEO), null);
});

test("BX-08: every new address in a pass is matched, with no per-pass cap", async () => {
  const many = { ...snapshot, meetings: Array.from({ length: 45 }, (_, i) => ({
    ...snapshot.meetings[0]!, id: `ical:county:meeting-${i}`, venueGap: { kind: "STATED_NOT_PLACED", publishedText: `${RAW} #${i}`, publisher: "County" },
  })) } as unknown as MeetingsSnapshot;
  let calls = 0;
  const result = await automaticVenuePackage({ snapshot: many, existingIds: new Set(), memberRoutes: ROUTES, clock: () => NOW,
    fetchImpl: (async () => { calls++; return new Response(JSON.stringify(GEO), { status: 200 }); }) as typeof fetch });
  assert.equal(calls, 45);
  assert.equal((result.package?.payload as unknown as { records: unknown[] }).records.length, 45);
});

test("BX-08: spelled-out directions, street types and state names match the Census abbreviations", () => {
  const warner = { result: { addressMatches: [{ matchedAddress: "55 W JOPPA RD, WARNER, NH, 03278",
    coordinates: { x: -71.8, y: 43.3 },
    addressComponents: { city: "WARNER", state: "NH", zip: "03278", streetName: "JOPPA", preDirection: "W", suffixType: "RD" } }] } };
  assert.ok(verifiedCensusVenuePoint("55 West Joppa Rd. Warner, NH 03278", warner));
  const tucson = { result: { addressMatches: [{ matchedAddress: "220 W 6TH ST, TUCSON, AZ, 85701",
    coordinates: { x: -110.97, y: 32.22 },
    addressComponents: { city: "TUCSON", state: "AZ", zip: "85701", streetName: "6TH", preDirection: "W", suffixType: "ST" } }] } };
  assert.ok(verifiedCensusVenuePoint("B-1 MPR 220 W. 6th Street Tucson, Arizona 85701", tucson));
  assert.equal(verifiedCensusVenuePoint("B-1 MPR 220 E. 6th Street Tucson, Arizona 85701", tucson), null);
  const nh = { result: { addressMatches: [{ matchedAddress: "5 MAIN ST, CONCORD, NH, 03301", coordinates: { x: -71.5, y: 43.2 },
    addressComponents: { city: "CONCORD", state: "NH", zip: "03301", streetName: "MAIN", suffixType: "ST" } }] } };
  assert.ok(verifiedCensusVenuePoint("5 Main Street, Concord, New Hampshire 03301", nh));
  assert.equal(verifiedCensusVenuePoint("5 Main Street, Concord, Maine 03301", nh), null);
});
