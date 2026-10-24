import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { buildStatePlaceMap, registeredPlaceIds } from "../lib/place-map/build.ts";
import { loadStatePlaceMap, type StatePlaceMap } from "../lib/place-map/load.ts";
import { placesAtPoint, placesForCode } from "../lib/place-map/read.ts";
import { divisionIdsAt, type GeoFeature } from "../lib/registry/resolve.ts";
import type { Query } from "../lib/facts/publish.ts";
import type { RegistrationReference } from "../lib/registration/reference.ts";
import { identitySourceTables, identityEventTables, readerIdentityMigration, placeBoundaryMigration } from "./helpers/reader-identity-db.ts";
import { ROUTINE_SOURCE_TASKS, routineTaskDue } from "../lib/civic-data/runner.ts";
import { geographicSpecialDistricts } from "../lib/place-map/special-districts.ts";
import { currentGrfPlaceEdges } from "../lib/place-map/grf-edges.ts";
import { MemoryEvidenceStore } from "../lib/control-plane/evidence/store.ts";
import { memoryLockManager } from "../lib/control-plane/repository/memory.ts";
import { censusGeographyCandidate } from "../lib/census-geography/candidate.ts";
import { processRegisteredRoutineCandidate } from "../lib/civic-data/promotion.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";

const date = "2026-10-24T08:00:00.000Z";
const state = "ocd-division/country:us/state:az", county = `${state}/county:pima`;
const square = (west: number, east: number): GeoFeature["geometry"] => ({ type: "Polygon", coordinates: [[[west, 32], [east, 32], [east, 33], [west, 33], [west, 32]]] });

test("20 real points within two miles of state lines resolve to their own state polygons", () => {
  const features = JSON.parse(readFileSync("public/geo/state-outlines.geojson", "utf8")).features as GeoFeature[];
  const points = JSON.parse(readFileSync("tests/fixtures/place-map-state-lines.json", "utf8")) as [number, number, string][];
  for (const [lng, lat, expected] of points) assert.deepEqual(divisionIdsAt([lng, lat], features), [`ocd-division/country:us/state:${expected}`], `${lng},${lat}`);
});

test("year-aware tables preserve ids on reload, separate ZIP from ZCTA and resolve a point in one query", async () => {
  const db = new PGlite();
  try {
    await db.exec(readFileSync("lib/db/migrations/0035_r1_fact_store.sql", "utf8"));
    await identitySourceTables(db);
    await identityEventTables(db);
    await db.exec(readerIdentityMigration());
    await db.exec(placeBoundaryMigration());
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
    await loadStatePlaceMap({ transaction }, { places: [], zipEdges: [], zctaEdges: [], boundaries: [{
      placeId: county, layer: "county", boundaryYear: 2026, version: "county:2026", geometry: square(-110, -109),
      countyAttachment: false, hostCountyId: null, sourceUrls: ["https://www.census.gov/"], checkedAt: date,
    }] });
    const moved = await placesAtPoint(query, [-111, 32.5]);
    assert.ok(!moved.memberships.some(m => m.placeId === county || m.countyAttachment));
  } finally { await db.close(); }
});

test("every state's place job is due on its next monthly cycle without routineTaskDue throwing", () => {
  const jobs = ROUTINE_SOURCE_TASKS.filter(task => task.id.startsWith("place-map-"));
  assert.equal(jobs.length, 56);
  for (const job of jobs) {
    assert.equal(routineTaskDue(job, undefined, Date.parse(date)), true);
    const clock = { lastAttemptedAt: date, lastSucceededAt: date, lastSucceededObservedAt: date, lastSucceededParserVersion: job.parserVersion };
    assert.equal(routineTaskDue(job, clock, Date.parse(date) + job.cadenceMs - 1), false);
    assert.equal(routineTaskDue(job, clock, Date.parse(date) + job.cadenceMs), true);
  }
});

test("the state builder preserves every legacy district and NCES/GEOID aliases", () => {
  const registration = JSON.parse(readFileSync("data/derived/registration/az.json", "utf8")) as RegistrationReference;
  const id = `${state}/cd:6`, tribal = "ocd-division/country:us/aiannh:2430";
  const map = buildStatePlaceMap({ registration, scopes: [], legacyZips: new Map([["85701", { ids: [state, county, id, tribal], partial: [id], samples: 100 }]]),
    legacyZctas: new Set(["85701"]), boundaries: [], checkedAt: date,
    postalLinks: [{ zip: "85798", zcta: "85701", addressRequired: false }, { zip: "85799", zcta: "85701", addressRequired: true }] });
  for (const placeId of [state, county, id, tribal]) assert.ok(map.zipEdges.some(edge => edge.placeId === placeId));
  assert.ok(map.zctaEdges.some(edge => edge.placeId === id && edge.boundaryYear === 2024));
  assert.ok(map.places.some(place => place.aliases.some(alias => alias.scheme === "nces") && place.aliases.some(alias => alias.scheme.startsWith("census-geoid:"))));
  assert.ok(map.places.every(place => place.aliases.every(alias => alias.value.length > 0)));
  assert.ok(map.zipEdges.some(edge => edge.code === "85798" && edge.placeId === id));
  assert.ok(!map.zipEdges.some(edge => edge.code === "85799" && edge.placeId === id));
  assert.ok(!map.zctaEdges.some(edge => edge.code === "85798" || edge.code === "85799"));
  assert.ok(map.boundaries.filter(boundary => boundary.layer === "district").every(boundary => boundary.sourceUrls.length > 0));
});

test("Idaho district type keys cannot become shared entity aliases", () => {
  const registration = JSON.parse(readFileSync("data/derived/registration/id.json", "utf8")) as RegistrationReference;
  const map = buildStatePlaceMap({ registration, scopes: [], legacyZips: new Map(), legacyZctas: new Set(), boundaries: [], checkedAt: date });
  for (const [id, layer] of registration.divisions) if (layer === "district") assert.ok(map.places.some(place => place.id === id), id);
  const aliases = new Map<string, string>();
  for (const place of map.places) for (const alias of place.aliases) {
    const key = `${alias.scheme}:${alias.value}`;
    assert.ok(!aliases.has(key) || aliases.get(key) === place.id, key);
    aliases.set(key, place.id);
  }
});

test("same-named New Jersey school districts keep separate GEOID and NCES identities", () => {
  const registration = JSON.parse(readFileSync("data/derived/registration/nj.json", "utf8")) as RegistrationReference;
  const byCode = registeredPlaceIds(registration);
  assert.notEqual(byCode.get("elsd:3416440"), byCode.get("unsd:3416500"));
  const map = buildStatePlaceMap({ registration, scopes: [], legacyZips: new Map(), legacyZctas: new Set(), boundaries: [], checkedAt: date });
  const elementary = map.places.find(place => place.aliases.some(alias => alias.scheme === "nces" && alias.value === "3416440"));
  const unified = map.places.find(place => place.aliases.some(alias => alias.scheme === "nces" && alias.value === "3416500"));
  assert.ok(elementary && unified);
  assert.notEqual(elementary.id, unified.id);
  assert.ok(registration.divisions.some(row => row[0] === elementary.id));
});

test("Census geographic FIPS, rather than the mailing state, supplies an unshaped district's county", async () => {
  const nm = await geographicSpecialDistricts(process.cwd(), "35"), az = await geographicSpecialDistricts(process.cwd(), "04");
  assert.equal(nm.find(d => d.pid === "190929")?.countyFips, "35023");
  assert.ok(!az.some(d => d.pid === "190929"));
});

test("current GRF parts produce measured school and county shares from one checked state source", async () => {
  const bytes = "CURSTATE|CURCOUNTY|COUSUBFP|PLACEFP|SDELMLEA|SDSECLEA|SDUNILEA|AIANNHCE|ZCTA5CE|AREALAND\n" +
    "04|019|99999|99999|99999|99999|00001|9999|85701|60\n04|019|99999|99999|99999|99999|00002|9999|85701|40\n";
  const edges = await currentGrfPlaceEdges("04", [
    { id: state, name: "Arizona", state: "AZ", aliases: [{ scheme: "census-geoid:state", value: "04" }] },
    { id: county, name: "Pima", state: "AZ", aliases: [{ scheme: "census-geoid:county", value: "04019" }] },
    ...[1, 2].map(n => ({ id: `school:${n}`, name: `School ${n}`, state: "AZ", aliases: [{ scheme: "census-geoid:unsd", value: `040000${n}` }] })),
  ], { cache: { store: new MemoryEvidenceStore(), locks: memoryLockManager() }, fetchImpl: async () => new Response(bytes) });
  assert.equal(edges.find(e => e.placeId === "school:1")?.share, 0.6);
  assert.equal(edges.find(e => e.placeId === "school:2")?.share, 0.4);
  assert.equal(edges.find(e => e.placeId === county)?.share, 1);
});

test("a state map refresh uses the existing Census publication path on a later run", async () => {
  const dataset = JSON.parse(readFileSync("lib/census-geography/bootstrap-az.json", "utf8"));
  const store = new MemoryRoutineDataStore();
  for (const builtAt of ["2026-10-24T08:00:00.000Z", "2026-11-23T08:00:00.000Z"]) {
    const candidate = censusGeographyCandidate({ ...dataset, builtAt }, "US-AZ:place-map");
    const result = await processRegisteredRoutineCandidate(store, "place-map-az", candidate, builtAt);
    assert.equal(result.candidate.state, "PROMOTED");
  }
});
