import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { buildStatePlaceMap } from "../lib/place-map/build.ts";
import { loadStatePlaceMap, type StatePlaceMap } from "../lib/place-map/load.ts";
import { placesAtPoint, placesForCode } from "../lib/place-map/read.ts";
import { divisionIdsAt, type GeoFeature } from "../lib/registry/resolve.ts";
import type { Query } from "../lib/facts/publish.ts";
import type { RegistrationReference } from "../lib/registration/reference.ts";

const date = "2026-10-24T08:00:00.000Z";
const state = "ocd-division/country:us/state:az", county = `${state}/county:pima`;
const square = (west: number, east: number): GeoFeature["geometry"] => ({ type: "Polygon", coordinates: [[[west, 32], [east, 32], [east, 33], [west, 33], [west, 32]]] });

test("20 real points within two miles of state lines resolve to their own state polygons", () => {
  const features = JSON.parse(readFileSync("public/geo/state-outlines.geojson", "utf8")).features as GeoFeature[];
  const points: [number, number, string][] = [
    [-109.06, 34, "az"], [-109.03, 34, "nm"], [-109.06, 39, "ut"], [-109.03, 39, "co"],
    [-102.07, 39, "co"], [-102.03, 39, "ks"], [-104.07, 44, "wy"], [-104.03, 44, "sd"],
    [-106, 41.01, "wy"], [-106, 40.99, "co"], [-106, 37.01, "co"], [-106, 36.99, "nm"],
    [-108, 45.01, "mt"], [-108, 44.99, "wy"], [-114.06, 39, "nv"], [-114.02, 39, "ut"],
    [-99, 40.01, "ne"], [-99, 39.99, "ks"], [-100, 45.95, "nd"], [-100, 45.93, "sd"],
  ];
  for (const [lng, lat, expected] of points) assert.deepEqual(divisionIdsAt([lng, lat], features), [`ocd-division/country:us/state:${expected}`], `${lng},${lat}`);
});

test("year-aware tables preserve ids on reload, separate ZIP from ZCTA and resolve a point in one query", async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE TABLE entity(id text PRIMARY KEY,kind text,name text,state char(2));
      CREATE TABLE entity_external_id(entity_id text REFERENCES entity(id),scheme text,value text,PRIMARY KEY(scheme,value));
      CREATE TABLE zip_place(zip text,place_id text REFERENCES entity(id),share float8,boundary_year integer,PRIMARY KEY(zip,place_id,boundary_year));
      CREATE TABLE zcta_place(zcta text,place_id text REFERENCES entity(id),share float8,boundary_year integer,PRIMARY KEY(zcta,place_id,boundary_year));`);
    await db.exec(readFileSync("lib/db/migrations/RB-A2_place_boundaries.sql", "utf8"));
    let calls = 0;
    const query: Query = async (sql, params = []) => { calls++; return (await db.query(sql, [...params])).rows as Record<string, unknown>[]; };
    const map: StatePlaceMap = {
      places: [state, county, `${state}/cd:6`, `${state}/cd:7`, `${state}/special_district:test`].map(id => ({ id, name: id, state: "AZ", aliases: [] })),
      boundaries: [
        { placeId: state, layer: "state", boundaryYear: 2023, version: "state:2023", geometry: square(-112, -110) },
        { placeId: county, layer: "county", boundaryYear: 2023, version: "county:2023", geometry: square(-112, -110) },
        { placeId: `${state}/cd:6`, layer: "cd", boundaryYear: 2024, version: "cd:119", geometry: square(-112, -110) },
        { placeId: `${state}/cd:7`, layer: "cd", boundaryYear: 2026, version: "cd:120", geometry: square(-112, -110) },
        { placeId: `${state}/special_district:test`, layer: "district", boundaryYear: 2022, version: "district:2022", geometry: null, countyAttachment: true, hostCountyId: county },
      ].map(row => ({ countyAttachment: false, hostCountyId: null, sourceUrls: ["https://www.census.gov/"], checkedAt: date, ...row })),
      zipEdges: [2024, 2026].map(year => ({ code: "85701", placeId: `${state}/cd:${year === 2024 ? 6 : 7}`, boundaryYear: year, share: 0.5, shareBasis: "area", partial: true, fringe: false })),
      zctaEdges: [],
    };
    const transaction = <T>(run: (q: Query) => Promise<T>) => db.transaction(tx => run(async (sql, params = []) => (await tx.query(sql, [...params])).rows as Record<string, unknown>[]));
    await loadStatePlaceMap({ transaction }, map);
    await loadStatePlaceMap({ transaction }, map);
    assert.equal((await query("SELECT count(*)::int n FROM zip_place"))[0].n, 2);
    const before = calls;
    assert.deepEqual((await placesForCode(query, "zip", "85701", { purpose: "representation", asOf: "2026-10-24" })).memberships.map(m => m.placeId), [`${state}/cd:6`]);
    assert.equal(calls - before, 1);
    assert.deepEqual((await placesForCode(query, "zip", "85701", { purpose: "election", asOf: "2026-10-24", electionDate: "2026-11-03" })).memberships.map(m => m.placeId), [`${state}/cd:7`]);
    assert.equal((await placesForCode(query, "zcta", "85701")).memberships.length, 0);
    const start = calls, point = await placesAtPoint(query, [-111, 32.5], { purpose: "representation", asOf: "2026-10-24" });
    assert.equal(calls - start, 1);
    assert.deepEqual(point.states, ["AZ"]);
    assert.ok(point.memberships.some(m => m.countyAttachment && m.hostCountyId === county));
  } finally { await db.close(); }
});

test("the state builder preserves every legacy district and NCES/GEOID aliases", () => {
  const registration = JSON.parse(readFileSync("data/derived/registration/az.json", "utf8")) as RegistrationReference;
  const id = `${state}/cd:6`;
  const map = buildStatePlaceMap({ registration, scopes: [], legacyZips: new Map([["85701", { ids: [state, county, id], partial: [id], samples: 100 }]]),
    legacyZctas: new Set(["85701"]), boundaries: [], checkedAt: date });
  for (const placeId of [state, county, id]) assert.ok(map.zipEdges.some(edge => edge.placeId === placeId));
  assert.ok(map.zctaEdges.some(edge => edge.placeId === id && edge.boundaryYear === 2024));
  assert.ok(map.places.some(place => place.aliases.some(alias => alias.scheme === "nces") && place.aliases.some(alias => alias.scheme.startsWith("census-geoid:"))));
});
