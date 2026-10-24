import { fixtureCodeRows } from "./helpers/place-map.ts";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { installPlaceMapQuery } from "../lib/place-map/reader.ts";
import { readerRoute } from "../lib/api/reader-route.ts";
import { readerLocation } from "../lib/reader/location.ts";
import { readPointPlace, readZipPlace, withPlaceMapReads } from "../lib/place-map/reader.ts";
import { divisionIdsForZipArea } from "../lib/ballot/zip-divisions.ts";
import { PGlite } from "@electric-sql/pglite";
import { loadStatePlaceMap, type StatePlaceMap } from "../lib/place-map/load.ts";
import type { Query } from "../lib/facts/publish.ts";
import { readZipLocation } from "../lib/place-map/locations.ts";

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
      installPlaceMapQuery(async (sql, params) => {
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
  } finally { installPlaceMapQuery(undefined); }
});

test("one set of point source rows answers current representation and the selected election plan", async () => {
  let calls = 0;
  const geometry = {type:"Polygon",coordinates:[[[-102,30],[-100,30],[-100,32],[-102,32],[-102,30]]]};
  installPlaceMapQuery(async () => { calls++; return [
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
  } finally { installPlaceMapQuery(undefined); }
});

test("ZIP ballots retain every selected race including fringe membership without adding a point's other districts", async () => {
  const base = state("AZ"), county = `${base}/county:pima`, district = `${base}/sldl:20`, fringe = `${base}/sldl:21`;
  let calls = 0;
  installPlaceMapQuery(async sql => {if(sql.includes("FROM zip_location"))return [];calls++;return fixtureCodeRows([
    row(base,"AZ","state","state:2023"),
    row(county,"AZ","county","county:2020"),
    row(district,"AZ","sldl","sldl:2024",{partial:true}),
    row(fringe,"AZ","sldl","sldl:2024",{partial:true,fringe:true}),
  ]);});
  try {
    await withPlaceMapReads(async () => {
      const entry = await readZipPlace("85701");
      assert.deepEqual(entry?.ids,[base,county,district]);
      assert.deepEqual(entry?.partial,[district]);
      assert.deepEqual(entry?.fringe,[fringe]);
      assert.deepEqual(await divisionIdsForZipArea("85701",[`${base}/sldl:1`]),[base,county,district,fringe]);
    });
    assert.equal(calls,1);
  } finally { installPlaceMapQuery(undefined); }
});

test("the next map refresh changes point and ZIP membership while preserving the place's id and older boundaries", async () => {
  const db = new PGlite(), county = `${state("AZ")}/county:fixture`;
  try {
    await db.exec(`CREATE TABLE entity(id text PRIMARY KEY,kind text,name text,state char(2));
      CREATE TABLE entity_external_id(entity_id text REFERENCES entity(id),scheme text,value text,PRIMARY KEY(scheme,value));
      CREATE TABLE zip_place(zip text,place_id text REFERENCES entity(id),share float8 CHECK(share>0 AND share<=1),boundary_year integer,PRIMARY KEY(zip,place_id,boundary_year));
      CREATE TABLE zcta_place(zcta text,place_id text REFERENCES entity(id),share float8 CHECK(share>0 AND share<=1),boundary_year integer,PRIMARY KEY(zcta,place_id,boundary_year));`);
    await db.exec(readFileSync("lib/db/migrations/RB-A2_place_boundaries.sql","utf8"));
    await db.exec(readFileSync("lib/db/migrations/RB-A10_zip_locations.sql","utf8"));
    const square = (west:number,east:number):import("../lib/registry/resolve.ts").GeoFeature["geometry"] => ({type:"Polygon",coordinates:[[[west,30],[east,30],[east,34],[west,34],[west,30]]]});
    const map = (year:number,west:number,east:number,zip:string):StatePlaceMap => ({
      places:[state("AZ"),county].map(id=>({id,name:id,state:"AZ",aliases:[]})),
      boundaries:[{placeId:state("AZ"),layer:"state",boundaryYear:2023,version:"state:2023",geometry:square(-116,-110)},
        {placeId:county,layer:"county",boundaryYear:year,version:`county:${year}`,geometry:square(west,east)}]
        .map(value=>({...value,countyAttachment:false,hostCountyId:null,sourceUrls:["https://www.census.gov/"],checkedAt:`${year}-01-01T00:00:00Z`})),
      zipEdges:[{code:zip,placeId:county,boundaryYear:year,share:1,shareBasis:"area",partial:false,fringe:false},
        {code:zip,placeId:state("AZ"),boundaryYear:2023,share:1,shareBasis:"area",partial:false,fringe:false}],zctaEdges:[],
      zipLocations:[{zip:"85701",lat:32,lng:west,boundaryYear:year,sourceUrls:["https://www.census.gov/"],checkedAt:`${year}-01-01T00:00:00Z`}],
    });
    const query:Query=async(sql,params=[]) => (await db.query(sql,[...params])).rows as Record<string,unknown>[];
    const transaction=<T,>(read:(query:Query)=>Promise<T>)=>db.transaction(tx=>read(async(sql,params=[]) => (await tx.query(sql,[...params])).rows as Record<string,unknown>[]));
    installPlaceMapQuery(query);
    await loadStatePlaceMap({transaction},map(2023,-112,-110,"85701"));
    await withPlaceMapReads(async()=>{
      assert.ok((await readPointPlace(32,-111)).ids.includes(county));
      assert.ok((await readZipPlace("85701"))?.ids.includes(county));
      assert.equal((await readZipLocation("85701"))?.lng,-112);
    });
    await loadStatePlaceMap({transaction},map(2026,-116,-114,"86001"));
    await withPlaceMapReads(async()=>{
      assert.ok(!(await readPointPlace(32,-111)).ids.includes(county),"a removed point membership cannot revive its older boundary");
      assert.ok(!(await readZipPlace("85701"))?.ids.includes(county),"a removed ZIP membership cannot revive its older boundary");
      assert.ok((await readZipPlace("86001"))?.ids.includes(county));
      assert.equal((await readZipLocation("85701"))?.lng,-116,"the next import updates the ZIP's display point without a build-time projection");
    });
    assert.equal((await query("SELECT count(*)::int n FROM entity WHERE id=$1",[county]))[0].n,1);
    assert.equal((await query("SELECT count(*)::int n FROM place_boundary WHERE place_id=$1",[county]))[0].n,2);
  } finally {installPlaceMapQuery(undefined);await db.close();}
});
