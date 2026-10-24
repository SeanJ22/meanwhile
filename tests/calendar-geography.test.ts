import assert from "node:assert/strict";
import test from "node:test";
import { STANDING_MEETING_GEOGRAPHY } from "../lib/meetings/fetch-window.ts";
import { haversineKm } from "../lib/geo/distance.ts";

test("standing calendar acquisition covers Alaska, Hawaii and every territory", () => {
  for (const [lat,lng] of [[21.3069,-157.8583],[51.88,-176.65],[13.44,144.79],[-14.275,-170.7],[18.46,-66.11],[0,180]]) {
    assert.ok(haversineKm(STANDING_MEETING_GEOGRAPHY.lat, STANDING_MEETING_GEOGRAPHY.lng, lat, lng) <= STANDING_MEETING_GEOGRAPHY.radiusKm);
  }
});
