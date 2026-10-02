import assert from "node:assert/strict";
import test from "node:test";
import { allDistricts, districtLabelOfQuery } from "../lib/control-plane/admin-view/district-catalog.ts";
import { referencePlaces, type LiveReference } from "../app/(admin)/_mw/admin-v6/live-data.ts";
import { indexPlaces, pickerMatches } from "../app/(admin)/_mw/admin-v6/places.ts";
import { parseV6PlaceKey } from "../lib/control-plane/admin-view/v6-hunts-read.ts";

const ref: LiveReference = {
  states: [{ code: "az", name: "Arizona", tracked: true }, { code: "wy", name: "Wyoming", tracked: false }, { code: "dc", name: "District of Columbia", tracked: false }],
  definitions: [], profileVersion: "test", groupNames: {}, geo: null, observedAt: "2026-10-02T00:00:00.000Z",
};

test("every congressional district is a place: 435 voting seats, six delegates, Census GEOIDs, no duplicate", () => {
  const all = allDistricts();
  assert.equal(all.filter((d) => !d.geoid.endsWith("98")).length, 435, "435 voting seats");
  assert.equal(all.filter((d) => d.geoid.endsWith("98")).length, 6, "DC and five territories send one delegate each");
  assert.equal(new Set(all.map((d) => d.placeKey)).size, all.length);
  const az6 = all.find((d) => d.label === "AZ-06")!;
  assert.deepEqual([az6.state, az6.geoid, az6.placeKey], ["az", "0406", "geo:az.congressional_district.0406"]);
  assert.equal(all.find((d) => d.state === "wy")!.label, "WY-AL");
  assert.equal(all.find((d) => d.state === "dc")!.geoid, "1198");
  assert.equal(all.filter((d) => d.state === "ca").length, 52);
  for (const d of all) assert.ok(parseV6PlaceKey(d.placeKey)?.kind === "geo", `${d.placeKey} is a place key the reads accept`);
});

test("the picker finds a district without anyone having opened it, however it is typed", () => {
  const places = referencePlaces(ref);
  const find = (q: string) => pickerMatches(places, [], q).map((p) => p.name);
  assert.deepEqual(find("AZ-06"), ["AZ-06"]);
  assert.deepEqual(find("az6"), ["AZ-06"]);
  assert.deepEqual(find("AZ 6"), ["AZ-06"]);
  assert.deepEqual(find("az-6"), ["AZ-06"]);
  assert.deepEqual(find("wy-al"), ["WY-AL"]);
  assert.equal(districtLabelOfQuery("az-12"), null, "Arizona has nine seats");
  assert.equal(districtLabelOfQuery("85635"), null);
  const index = indexPlaces(places);
  const place = index.get("geo:az.congressional_district.0406")!;
  assert.deepEqual([place.kind, place.navParent, place.within], ["Area", "st:az", ["st:az"]], "filed under its state, so its breadcrumbs run United States > Arizona > AZ-06");
  assert.ok(pickerMatches(places, [], "az").some((p) => p.name === "AZ-09"), "a state name lists its districts too");
});

test("a district a visit or a hunt already put in the list is not listed twice", () => {
  const places = referencePlaces({ ...ref, geo: { key: "geo:az.congressional_district.0406", name: "AZ-06", kind: "Area", state: "az" } });
  assert.equal(places.filter((p) => p.key === "geo:az.congressional_district.0406").length, 1);
});
