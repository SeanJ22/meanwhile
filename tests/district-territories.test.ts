import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { shardEntry, ZIP_RESIDENT_SHARE_SHOWN, type ZipDivisionShard } from "../lib/geo/zip-division-index.ts";
import { districtNameKey } from "../lib/registration/district-sources.ts";
import { loadRegistrationReference } from "../lib/registration/reference.ts";
import { referenceGovernmentListings } from "../lib/registration/listings.ts";
import { zipDivisionEntry } from "../lib/geo/zip-division-index.ts";

const ROOT = join(import.meta.dirname, "..");

test("a ZIP shows the divisions its residents live in, names the ones a few live in, and is whole only where all do", () => {
  const shard: ZipDivisionShard = {
    divisions: ["ocd-division/country:us/state:az", "ocd-division/country:us/state:az/county:pima", "ocd-division/country:us/state:az/place:tucson",
      "ocd-division/country:us/state:az/place:vail", "ocd-division/country:us/state:az/place:new_town"],
    zips: { "85641": [0, 1, 2, 3, 4], "85999": [1, 2] },
    partial: {}, zipSamples: { "85641": 857, "85999": 4 },
    residents: { "85641": [1000, 1000, 40, 600, -1] },
    zipResidents: { "85641": 1000 },
  };
  const entry = shardEntry(shard, "85641")!;
  assert.ok(40 / 1000 < ZIP_RESIDENT_SHARE_SHOWN);
  assert.deepEqual(entry.ids, ["ocd-division/country:us/state:az", "ocd-division/country:us/state:az/county:pima",
    "ocd-division/country:us/state:az/place:vail", "ocd-division/country:us/state:az/place:new_town"]);
  assert.deepEqual(entry.fringe, ["ocd-division/country:us/state:az/place:tucson"]);
  assert.deepEqual(entry.partial, ["ocd-division/country:us/state:az/place:vail", "ocd-division/country:us/state:az/place:new_town"],
    "the county holds every resident; a division the blocks never measured keeps the hedge");
  const unmeasured = shardEntry(shard, "85999")!;
  assert.deepEqual(unmeasured.ids, shard.zips["85999"].map(i => shard.divisions[i]));
  assert.deepEqual(unmeasured.partial, unmeasured.ids, "a ZIP without resident counts keeps every division hedged");
  assert.equal(unmeasured.fringe, undefined);
});

test("a district's own layer and its Census listing name it the same way, whatever the house style", () => {
  assert.equal(districtNameKey("RINCON VALLEY", "fire"), districtNameKey("RINCON VALLEY FIRE DISTRICT", "fire"));
  assert.equal(districtNameKey("MESCAL-J6", "fire"), districtNameKey("MESCAL-J6 FIRE DISTRICT", "fire"));
  assert.equal(districtNameKey("MOUNT LEMMON", "fire"), districtNameKey("MT LEMMON FIRE DISTRICT", "fire"));
  assert.equal(districtNameKey("Harris County MUD No. 5", "water"), districtNameKey("HARRIS CO MUNICIPAL UTILITY DIST 5", "water"));
  assert.notEqual(districtNameKey("Harris County MUD No. 5", "water"), districtNameKey("HARRIS CO MUNICIPAL UTILITY DIST 50", "water"));
});

test("85641 shows Vail's fire districts and school district, and names Tucson only as a small part of it", async () => {
  const entry = await zipDivisionEntry("85641");
  assert.ok(entry);
  for (const id of ["ocd-division/country:us/state:az/special_district:rincon_valley_fire_district",
    "ocd-division/country:us/state:az/special_district:corona_de_tucson_fire_district",
    "ocd-division/country:us/state:az/school_district:vail_unified_district"]) assert.ok(entry.ids.includes(id), id);
  assert.ok(!entry.ids.includes("ocd-division/country:us/state:az/place:tucson"));
  assert.ok(entry.fringe?.includes("ocd-division/country:us/state:az/place:tucson"));
});

test("a special district an official layer draws, and a tribal area, are listed on their own territory", () => {
  const az = referenceGovernmentListings(loadRegistrationReference(ROOT, "AZ"));
  const rincon = az.find(row => row.name === "RINCON VALLEY FIRE DISTRICT")!;
  assert.deepEqual(rincon.associations.map(a => [a.divisionId, a.basis]),
    [["ocd-division/country:us/state:az/special_district:rincon_valley_fire_district", "SOURCE_BOUNDARY"]]);
  const alpine = az.find(row => row.name === "ALPINE SANITARY DISTRICT")!;
  assert.deepEqual(alpine.associations, [], "a district no layer draws is never placed on its office's county");
  const tohono = az.find(row => row.nativeIds.census_aiannh === "4200")!;
  assert.equal(tohono.governmentClass, "TRIBAL AREA");
  assert.deepEqual(tohono.associations.map(a => a.divisionId), ["ocd-division/country:us/aiannh:4200"]);
  assert.match(tohono.provenance.sourceUrl ?? "", /national_aiannh2020\.txt$/);
});
