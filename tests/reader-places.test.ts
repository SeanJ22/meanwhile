import assert from "node:assert/strict";
import test from "node:test";
import { GET } from "../app/api/reader/places/route.ts";
import { installFactReader } from "../lib/facts/db.ts";

test("published-place discovery returns indexed county ZIPs and deduplicates shared counties", async () => {
  installFactReader(async () => [
    { place_id: "ocd-division/country:us/state:az/county:pima" },
    { place_id: "ocd-division/country:us/state:az/county:pima#board" },
    { place_id: "ocd-division/country:us/state:az/place:tucson" },
  ]);
  try {
    const response = await GET();
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.places.length, 1);
    assert.match(body.places[0].zip, /^\d{5}$/);
    assert.equal(typeof body.places[0].lat, "number");
    assert.equal(typeof body.places[0].lng, "number");
    assert.equal(body.skipped, 0);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
  } finally { installFactReader(undefined); }
});

test("published-place discovery reports an unavailable database as a failure", async () => {
  installFactReader(null);
  try { assert.equal((await GET()).status, 503); }
  finally { installFactReader(undefined); }
});
