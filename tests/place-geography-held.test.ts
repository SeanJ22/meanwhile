import assert from "node:assert/strict";
import test from "node:test";
import { divisionsForZip, heldDivisionsForZip, type PlaceDivision } from "../lib/control-plane/expansion/national-geography.ts";
import { loadPublishedAreaLookupState } from "../lib/census-geography/area-lookup.ts";
import type { PublishedLookupState } from "../lib/census-geography/reader.ts";

test("held county display prefixes do not become division identities or lose split memberships", async () => {
  const counties = [
    { stateFips: "29", label: "MO Boone County", geoid: "29019", expected: "state:mo/county:boone" },
    { stateFips: "22", label: "LA St. James Parish", geoid: "22093", expected: "state:la/county:st_james" },
    { stateFips: "02", label: "AK North Slope Borough", geoid: "02185", expected: "state:ak/county:north_slope" },
    { stateFips: "29", label: "Boone County, Missouri", geoid: "29019", expected: "state:mo/county:boone" },
    { stateFips: "29", label: "MO Display County", geoid: "29001", ocdId: "ocd-division/country:us/state:mo/county:source_id", expected: "state:mo/county:source_id" },
  ];
  const published = { source: "published", lookup: {
    groupingsForZcta: async () => ({ status: { kind: "OK" }, memberships: counties.map(county => ({
      geography: { type: "county", version: "county:2020", ocdId: null, ...county },
    })) }), listVersions: async () => [],
  } } as unknown as PublishedLookupState;
  const result = await heldDivisionsForZip("12345", published);
  const held = result.filter(row => row.divisionType === "county");
  assert.equal(held.length, 4, "display variants share identity while distinct counties remain");
  for (const county of counties) {
    const row = held.find(row => row.id === `ocd-division/country:us/${county.expected}`);
    assert.ok(row);
    assert.equal(row.geoid, county.geoid);
    assert.equal(row.completeForZip, undefined, "an observed row is not proof of complete retrieval");
  }
  assert.equal(held.find(row => row.geoid === "22093")?.label, "LA St. James Parish", "display label is unchanged");
});

test("a place reuses all held serving districts and county before acquiring missing local layers", async () => {
  const held: PlaceDivision[] = [
    { id: "ocd-division/country:us/state:az", label: "Arizona", divisionType: "state", geoid: "04", sourceUrl: "https://www2.census.gov/held" },
    { id: "ocd-division/country:us/state:az/county:cochise", label: "Cochise County", divisionType: "county", geoid: "04003", sourceUrl: "https://www2.census.gov/held" },
    ...["cd", "sldu", "sldl"].map(type => ({ id: `ocd-division/country:us/state:az/${type}:6`, label: `District 6`, divisionType: type, geoid: "04006", sourceUrl: "https://www2.census.gov/held" })),
  ];
  const requests: string[] = [];
  for (const row of held) row.completeForZip = "85635";
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

test("partial held districts cannot suppress split ZIP intersections or another school layer", async () => {
  const zip = "12345", base = "ocd-division/country:us/state:mo";
  const held: PlaceDivision[] = [
    { id: base, label: "Missouri", divisionType: "state", geoid: "29", sourceUrl: "https://census.gov/held", completeForZip: zip },
    { id: `${base}/county:test`, label: "Test County", divisionType: "county", geoid: "29001", sourceUrl: "https://census.gov/held", completeForZip: zip },
    { id: `${base}/sldl:1`, label: "District 1", divisionType: "sldl", geoid: "29001", sourceUrl: "https://census.gov/held" },
    { id: `${base}/school_district:held`, label: "Held school", divisionType: "school", geoid: "2900001", sourceUrl: "https://census.gov/held", completeForZip: zip },
  ];
  const names = ["2020 Census ZIP Code Tabulation Areas", "119th Congressional Districts", "2024 State Legislative Districts - Upper",
    "2024 State Legislative Districts - Lower", "Incorporated Places", "County Subdivisions", "Unified School Districts",
    "Elementary School Districts", "Secondary School Districts"];
  const captures = new Map<string, string>();
  const schoolLayers = new Set<string>();
  const fetchImpl: typeof fetch = async (url, init) => {
    const address = String(url);
    if (address.endsWith("?f=json")) return Response.json({ layers: names.map((name, id) => ({ id, name, type: "Feature Layer" })) });
    const params = new URLSearchParams(String(init?.body));
    if (address.includes("ZCTA")) return Response.json({ features: [{ attributes: {}, geometry: { rings: [[[0, 0], [1, 0], [1, 1], [0, 0]]] } }] });
    assert.equal(params.get("where"), "STATE IN ('29')");
    assert.equal(params.get("spatialRel"), "esriSpatialRelIntersects");
    if (address.includes("/3/query")) {
      const secondPage = params.get("resultOffset") !== "0";
      return Response.json({ features: [{ attributes: { STATE: "29", GEOID: secondPage ? "29002" : "29001", SLDL: secondPage ? "2" : "1", NAME: secondPage ? "District 2" : "District 1" } }], exceededTransferLimit: !secondPage });
    }
    if (address.includes("School")) {
      const layer = address.split("/").at(-2)!; schoolLayers.add(layer);
      return Response.json({ features: [{ attributes: { STATE: "29", GEOID: `290000${layer}`, NAME: `School ${layer}` } }] });
    }
    return Response.json({ features: [] });
  };
  const found = await divisionsForZip(zip, { congress: 119, legislativeYear: 2024, readPublished: async () => held, fetchImpl,
    capture: async (url, text) => { captures.set(url, text); } });
  assert.ok(found.some(row => row.id === `${base}/sldl:2`), "a second intersecting district survives partial held data and paging");
  assert.deepEqual([...schoolLayers].sort(), ["6", "7", "8"]);
  assert.deepEqual(found.filter(row => row.censusLayer && row.divisionType === "school").map(row => row.censusLayer).sort(), ["elsd", "scsd", "unsd"]);
  const replayed = await divisionsForZip(zip, { congress: 119, legislativeYear: 2024, readPublished: async () => held,
    readHeld: async url => captures.get(url) ?? null, fetchImpl: async () => { throw Error("saved geometry must be reused"); } });
  assert.deepEqual(replayed, found);
});

test("a current subdivision's unheld parent county is read without refetching held counties", async () => {
  const base = "ocd-division/country:us/state:nj";
  const held: PlaceDivision[] = [
    { id: base, label: "New Jersey", divisionType: "state", geoid: "34", sourceUrl: "https://www2.census.gov/held" },
    { id: `${base}/county:essex`, label: "Essex County", divisionType: "county", geoid: "34013", sourceUrl: "https://www2.census.gov/held" },
    ...["cd", "sldu", "sldl"].map(type => ({ id: `${base}/${type}:1`, label: "District 1", divisionType: type, geoid: "34001", sourceUrl: "https://www2.census.gov/held" })),
  ];
  let countyReads = 0;
  for (const row of held) row.completeForZip = "07040";
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
