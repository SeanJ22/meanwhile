import assert from "node:assert/strict";
import test from "node:test";
import { divisionsForZip, type PlaceDivision } from "../lib/control-plane/expansion/national-geography.ts";
import { loadPublishedAreaLookupState } from "../lib/census-geography/area-lookup.ts";

test("a place reuses all held serving districts and county before acquiring missing local layers", async () => {
  const held: PlaceDivision[] = [
    { id: "ocd-division/country:us/state:az", label: "Arizona", divisionType: "state", geoid: "04", sourceUrl: "https://www2.census.gov/held" },
    { id: "ocd-division/country:us/state:az/county:cochise", label: "Cochise County", divisionType: "county", geoid: "04003", sourceUrl: "https://www2.census.gov/held" },
    ...["cd", "sldu", "sldl"].map(type => ({ id: `ocd-division/country:us/state:az/${type}:6`, label: `District 6`, divisionType: type, geoid: "04006", sourceUrl: "https://www2.census.gov/held" })),
  ];
  const requests: string[] = [];
  const found = await divisionsForZip("85635", { readPublished: async () => held,
    fetchImpl: async (url, options) => {
      const address = String(url); requests.push(address);
      assert.ok(!address.includes("Legislative") && !address.includes("State_County"), "held Census layers must never reach TigerWeb");
      if (address.endsWith("/query")) {
        if (!address.includes("ZCTA")) assert.equal(new URLSearchParams(String(options?.body)).get("where"), "STATE IN ('04')");
        return Response.json({ features: address.includes("ZCTA")
          ? [{ attributes: {}, geometry: { rings: [[[0, 0], [1, 0], [0, 0]]] } }]
          : address.includes("Places_CouSub") ? [{ attributes: { STATE: "06", COUNTY: "025", GEOID: "0602593760", NAME: "Winterhaven" } }] : [] });
      }
      assert.equal(options?.method, undefined);
      return Response.json({ layers: ["2020 Census ZIP Code Tabulation Areas", "Incorporated Places", "County Subdivisions",
        "Unified School Districts", "Elementary School Districts", "Secondary School Districts"].map((name, id) => ({ name, id, type: "Feature Layer" })) });
    } });
  assert.ok(held.every(row => found.some(division => division.id === row.id)));
  assert.ok(requests.some(url => url.includes("School")), "unheld local geography remains acquisition work");
  assert.ok(!found.some(row => row.id.includes("/state:ca")), "a touching county subdivision in another state is outside this job");
});

test("an unavailable promoted place has typed absence rather than a bootstrap or country payload", async () => {
  const state = await loadPublishedAreaLookupState(["85635"], async statements => {
    assert.deepEqual(statements[0].params, ["CENSUS_GEOGRAPHY", "US:zcta-geography-overlaps", ["85635"]]);
    return [[]];
  });
  assert.equal(state.source, "unavailable");
  assert.notEqual((await state.lookup.groupingsForZcta("85635")).status.kind, "OK");
});

test("a current subdivision's unheld parent county is read without refetching held counties", async () => {
  const base = "ocd-division/country:us/state:nj";
  const held: PlaceDivision[] = [
    { id: base, label: "New Jersey", divisionType: "state", geoid: "34", sourceUrl: "https://www2.census.gov/held" },
    { id: `${base}/county:essex`, label: "Essex County", divisionType: "county", geoid: "34013", sourceUrl: "https://www2.census.gov/held" },
    ...["cd", "sldu", "sldl"].map(type => ({ id: `${base}/${type}:1`, label: "District 1", divisionType: type, geoid: "34001", sourceUrl: "https://www2.census.gov/held" })),
  ];
  let countyReads = 0;
  const found = await divisionsForZip("07040", { readPublished: async () => held, fetchImpl: async (url, options) => {
    const address = String(url), parameters = new URLSearchParams(String(options?.body));
    if (!address.endsWith("/query")) return Response.json({ layers: ["2020 Census ZIP Code Tabulation Areas", "Incorporated Places", "County Subdivisions",
      "Unified School Districts", "Elementary School Districts", "Secondary School Districts", "Counties"].map((name, id) => ({ name, id, type: "Feature Layer" })) });
    if (address.includes("State_County")) {
      countyReads++; assert.equal(parameters.get("where"), "GEOID IN ('34039')");
      return Response.json({ features: [{ attributes: { STATE: "34", GEOID: "34039", NAME: "Union County", BASENAME: "Union" } }] });
    }
    return Response.json({ features: address.includes("ZCTA") ? [{ attributes: {}, geometry: { rings: [[[0, 0], [1, 0], [0, 0]]] } }]
      : address.includes("Places_CouSub") && address.includes("/2/query")
        ? [{ attributes: { STATE: "34", COUNTY: "039", GEOID: "3403974480", NAME: "Springfield township", LSAD: "44", FUNCSTAT: "A" } }] : [] });
  } });
  assert.equal(countyReads, 1);
  assert.ok(found.some(row => row.id === `${base}/county:union`));
  assert.ok(found.some(row => row.id === `${base}/county:essex`));
});
