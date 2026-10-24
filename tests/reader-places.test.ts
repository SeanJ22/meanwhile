import assert from "node:assert/strict";
import test from "node:test";
import { GET } from "../app/api/reader/places/route.ts";
import { installPlaceMapQuery } from "../lib/place-map/reader.ts";
import { installFactReader } from "../lib/facts/db.ts";
import { fixtureZipLocation } from "./helpers/zip-location.ts";

test("published-place discovery returns indexed county ZIPs and deduplicates shared counties", async () => {
  const query = async (sql:string) => sql.includes("FROM zip_location") ? [{...fixtureZipLocation("85701")!}] : sql.includes("SELECT DISTINCT m.zip") ? [{zip:"85701"}] : sql.includes("FROM zip_place m") ? [{zip:"85701",place_id:"ocd-division/country:us/state:az/county:pima",name:"Pima County",state:"AZ",layer:"county",version:"county:2020",boundary_year:2020,partial:false,fringe:false}] : [
    { place_id: "ocd-division/country:us/state:az/county:pima" },
    { place_id: "ocd-division/country:us/state:az/county:pima#board" },
    { place_id: "ocd-division/country:us/state:az/place:tucson" },
  ];
  installFactReader(query);
  installPlaceMapQuery(query);
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
  } finally { installPlaceMapQuery(undefined); installFactReader(undefined); }
});

test("published-place discovery reports an unavailable database as a failure", async () => {
  installPlaceMapQuery(null);
  installFactReader(null);
  try { assert.equal((await GET()).status, 503); }
  finally { installPlaceMapQuery(undefined); installFactReader(undefined); }
});
