import assert from "node:assert/strict";
import test from "node:test";
import { STANDING_MEETING_GEOGRAPHY } from "../lib/meetings/fetch-window.ts";
import { venuesWithinRadius, type LegistarVenue } from "../lib/sources/legistar/client-registry.ts";

const venue = (lat: number, lng: number): LegistarVenue => ({ match: "chamber", name: "Council Chamber", address: null,
  lat, lng, addressSourceUrl: "https://example.gov/chamber", coordinateSourceUrl: "https://example.gov/map", verifiedAt: null });

test("registered calendar acquisition reaches Alaska, Hawaii and every territory through the adapter's real distance filter", () => {
  const places = [venue(21.3069, -157.8583), venue(51.88, -176.65), venue(13.44, 144.79), venue(-14.275, -170.7), venue(18.46, -66.11)];
  assert.equal(venuesWithinRadius([places[0]!], { lat: 39.5, lng: -98.35, radiusKm: 5_000 }), false, "the previous continental query skipped Hawaii before any request");
  for (const place of places) assert.equal(venuesWithinRadius([place], STANDING_MEETING_GEOGRAPHY), true);
  assert.equal(venuesWithinRadius([venue(0, 180)], STANDING_MEETING_GEOGRAPHY), true, "even the maximum great-circle distance is covered");
  assert.equal(venuesWithinRadius([places[0]!], { lat: 39.5, lng: -98.35, radiusKm: 25 }), false, "a reader's local query still filters distant places");
});
