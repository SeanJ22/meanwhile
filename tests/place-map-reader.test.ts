import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { installFactReader } from "../lib/facts/db.ts";
import { readerRoute } from "../lib/api/reader-route.ts";
import { readerLocation } from "../lib/reader/location.ts";
import { readPointPlace, readZipPlace, withPlaceMapReads } from "../lib/place-map/reader.ts";
import { divisionIdsForZipArea } from "../lib/ballot/zip-divisions.ts";

const state = (code: string) => `ocd-division/country:us/state:${code.toLowerCase()}`;
const row = (id: string, code: string, layer: string, version: string, extra: Record<string, unknown> = {}) => ({
  place_id: id, name: id, state: code, layer, version, boundary_year: Number(version.split(":")[1]),
  county_attachment: false, host_county_id: null, partial: false, fringe: false, ...extra,
});

test("a map request uses one exact point lookup for its state and every downstream place read", async () => {
  const features = JSON.parse(readFileSync("public/geo/state-outlines.geojson", "utf8")).features;
  const points = [
    ["NM",32.1,-108.95], ["AZ",32.1,-109.06], ["OK",36.99,-100.5], ["KS",37.01,-100.5],
    ["NE",40.01,-101], ["KS",39.99,-101], ["WY",41.01,-107], ["CO",40.99,-107],
    ["OR",42.01,-122], ["CA",41.99,-122],
  ] as const;
  try {
    for (const [expected, lat, lng] of points) {
      let calls = 0;
      installFactReader(async (sql, params) => {
        calls++;
        assert.match(sql, /place_boundary/);
        assert.deepEqual(params, [lng,lat]);
        return features.map((feature: {properties:{ocdId:string};geometry:object}) => {
          const code = feature.properties.ocdId.split(":").at(-1)!.toUpperCase();
          return row(feature.properties.ocdId, code, "state", "state:2023", {geometry:feature.geometry});
        });
      });
      const handler = readerRoute("/api/meetings", async (_request: Request) => {
        const first = await readerLocation(lat,lng), second = await readerLocation(lat,lng);
        assert.equal(first.state,expected);
        assert.equal(second.state,expected);
        assert.equal(first.zip,null);
        assert.ok(first.divisionIds.includes(state(expected)));
      });
      await handler(new Request(`https://example.test/api/meetings?lat=${lat}&lng=${lng}`));
      assert.equal(calls,1, `${expected}: request selection and both readers must share the exact point answer`);
    }
  } finally { installFactReader(undefined); }
});

test("one set of point source rows answers current representation and the selected election plan", async () => {
  let calls = 0;
  const geometry = {type:"Polygon",coordinates:[[[-102,30],[-100,30],[-100,32],[-102,32],[-102,30]]]};
  installFactReader(async () => { calls++; return [
    row(state("TX"),"TX","state","state:2023",{geometry}),
    row(`${state("TX")}/cd:1`,"TX","cd","cd:119",{geometry,boundary_year:2024}),
    row(`${state("TX")}/cd:2`,"TX","cd","cd:120",{geometry,boundary_year:2026}),
  ]; });
  try {
    await withPlaceMapReads(async () => {
      const serving = await readPointPlace(31,-101,{purpose:"representation",asOf:"2026-10-24"});
      const election = await readPointPlace(31,-101,{purpose:"election",asOf:"2026-10-24",electionDate:"2026-11-03"});
      assert.ok(serving.ids.includes(`${state("TX")}/cd:1`));
      assert.ok(!serving.ids.includes(`${state("TX")}/cd:2`));
      assert.ok(election.ids.includes(`${state("TX")}/cd:2`));
      assert.ok(!election.ids.includes(`${state("TX")}/cd:1`));
    });
    assert.equal(calls,1);
  } finally { installFactReader(undefined); }
});

test("ZIP ballots retain every selected race including fringe membership without adding a point's other districts", async () => {
  const base = state("AZ"), county = `${base}/county:pima`, district = `${base}/sldl:20`, fringe = `${base}/sldl:21`;
  let calls = 0;
  installFactReader(async () => {calls++;return [
    row(county,"AZ","county","county:2020"),
    row(district,"AZ","sldl","sldl:2024",{partial:true}),
    row(fringe,"AZ","sldl","sldl:2024",{partial:true,fringe:true}),
  ];});
  try {
    await withPlaceMapReads(async () => {
      const entry = await readZipPlace("85701");
      assert.deepEqual(entry?.ids,[county,district]);
      assert.deepEqual(entry?.partial,[district]);
      assert.deepEqual(entry?.fringe,[fringe]);
      assert.deepEqual(await divisionIdsForZipArea("85701",[`${base}/sldl:1`]),[county,district,fringe]);
    });
    assert.equal(calls,1);
  } finally { installFactReader(undefined); }
});
