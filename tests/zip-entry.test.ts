import { installFactReader } from "../lib/facts/db.ts";
import { fixturePlaceMapQuery } from "./helpers/place-map.ts";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import centroidFile from "../lib/geo/zcta-centroids.json" with { type: "json" };
import postalFile from "../lib/geo/postal-zips.json" with { type: "json" };
import { fixtureZipLocation, fixtureZipResolution } from "./helpers/zip-location.ts";
import { lookupIn, resolveIn } from "../lib/geo/zcta-core.ts";
import { resolveReaderZip } from "../lib/reader/zip.ts";
import { stateZipLocations } from "../lib/place-map/location-import.ts";
import { US_JURISDICTIONS } from "../lib/coverage/states.ts";
import { postalAreaMessage, ZIP_AREA_MISSING, type PostalTable } from "../lib/geo/postal-core.ts";
import { assertGovernmentZipCoverage, parseGazetteer, parseGeoNames, parsePostalTypes } from "../lib/geo/zip-source.ts";
import { areaLookup, buildPostalTable } from "../lib/geo/build-postal-table.ts";
import type { Feature } from "../lib/geo/shapefile.ts";
import { readZipPlace } from "../lib/place-map/reader.ts";
import { zipCertainty } from "../lib/geo/zip-certainty.ts";
import { readZipDivisions } from "../lib/place-map/reader.ts";
import { divisionIdsForZipArea } from "../lib/ballot/zip-divisions.ts";
import { locateAddressInZip, parseCensusPoint, sampleStreetPoints } from "../lib/geo/census-geocoder.ts";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/zip-entry/${name}`, import.meta.url), "utf8");

installFactReader(fixturePlaceMapQuery());

test("the map import preserves every acquired Census ZIP display coordinate and source", async () => {
  const rows=(await Promise.all(US_JURISDICTIONS.map(state=>stateZipLocations(process.cwd(),state.usps,"2026-10-24T00:00:00Z")))).flat();
  const byZip=new Map(rows.map(row=>[row.zip,row]));
  for(const [zip,point] of Object.entries(centroidFile.centroids)){
    const row=byZip.get(zip);assert.ok(row,zip);assert.deepEqual([row.lat,row.lng],point,zip);
    assert.ok(row.sourceUrls.includes(centroidFile.source));
  }
  const states=new Set(US_JURISDICTIONS.map(state=>state.usps));
  for(const [zip,row] of Object.entries(postalFile.zips))if(states.has(row[5] as typeof US_JURISDICTIONS[number]["usps"])){
    const imported=byZip.get(zip);assert.ok(imported,zip);
    assert.deepEqual(imported.postal,{type:row[2],zcta:row[3],place:row[4],state:row[5],county:row[6],countyFips:row[7],placeGeoid:row[8]},zip);
  }
});

test("ZIP-01: every government-index ZIP resolves in the complete 2020 ZCTA table", () => {
  const governments = JSON.parse(readFileSync(new URL("../data/derived/zip-governments.json", import.meta.url), "utf8")) as { zips: Record<string, unknown> };
  const zips = Object.keys(governments.zips);
  assert.equal(zips.length, 33791);
  assert.equal(Object.keys(centroidFile.centroids).length, 33791);
  assertGovernmentZipCoverage(centroidFile.centroids as unknown as Record<string, [number, number]>, zips);
  assert.deepEqual(zips.filter(zip => !fixtureZipResolution(zip).ok), []);
  assert.throws(() => assertGovernmentZipCoverage({}, zips), /omits 33791/);
});

test("ZIP-01: the saved Gazetteer, GeoNames and postal types reproduce each sample's location and postal type", async (t) => {
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const requestUrl = new URL(input instanceof Request ? input.url : input, "http://localhost");
    assert.equal(requestUrl.pathname,"/api/location/zip");
    return Response.json({location:fixtureZipLocation(requestUrl.searchParams.get("zip")!)});
  });
  const centroids = parseGazetteer(fixture("gazetteer.tsv"));
  const geonames = parseGeoNames(fixture("geonames.tsv"));
  const types = parsePostalTypes(fixture("postal-types.csv"));
  const boundaries = JSON.parse(fixture("boundaries.json")) as { zcta: Feature[]; county: Feature[]; place: Feature[] };
  const table = buildPostalTable(centroids, geonames, types, boundaries);
  for (const zip of Object.keys(geonames)) {
    assert.deepEqual(table[zip], (postalFile.zips as unknown as PostalTable)[zip], zip);
    const sync = fixtureZipResolution(zip), asyncResult = await resolveReaderZip(zip);
    assert.ok(sync.ok, zip);
    assert.deepEqual(asyncResult, sync, "resident server table and browser projection agree");
    assert.deepEqual(fixtureZipLocation(zip), sync.centroid);
  }
  assert.equal(table["73960"][2], "po-box");
  assert.equal(table["05009"][2], "unique");
  assert.equal(table["10540"][2], "po-box");
  assert.equal(table["11249"][2], "standard");
  assert.deepEqual(table["00501"].slice(0, 4), [40.8154, -73.0451, "unique", "11742"]);
  assert.deepEqual(table["10008"].slice(0, 4), [40.7143, -74.006, "po-box", "10007"]);
  assert.equal(table["73960"][7], "48421", "Census places Texhoma in Texas's Sherman County, despite GeoNames's north-shifted point");
  assert.equal(areaLookup(boundaries.zcta)(0, 0), null, "an uncovered point never gets its nearest ZCTA assigned");
});

test("ZIP-01: absent and known-but-unplaced five-digit ZIPs offer an address, without claiming nonexistence", () => {
  assert.deepEqual(resolveIn({}, "73960"), { ok: false, reason: "uncovered" });
  assert.deepEqual(fixtureZipResolution("00000"), { ok: false, reason: "uncovered" });
  const postal: PostalTable = { "73960": [null, null, "po-box", null, "Texhoma", "TX", "Sherman County", "48421", null] };
  assert.equal(lookupIn({}, "73960", postal), null);
  assert.deepEqual(resolveIn({}, "73960", postal), { ok: false, reason: "uncovered" });
  assert.deepEqual(fixtureZipResolution("0509"), { ok: false, reason: "malformed" });
  assert.equal(ZIP_AREA_MISSING, "We don't have that ZIP's area yet. Enter your street address and we'll find your districts.");
  const text = postalAreaMessage(fixtureZipLocation("73960")!.postal!);
  assert.match(text, /Texhoma, TX · Sherman County/);
  assert.match(text, /P.O. Box only/);
  assert.match(text, /Your districts depend on where you live/);
  assert.match(postalAreaMessage(fixtureZipLocation("05009")!.postal!), /unique to one institution/);
});

test("ZIP-01: a mail-only ZIP that is its own Census ZCTA keeps its residents' school district", async () => {
  // Bethel's residents get their mail at the post office; the Census still counts them in ZCTA 99559.
  const bethel = await readZipPlace("99559");
  assert.ok(bethel?.ids.includes("ocd-division/country:us/state:ak/school_district:lower_kuskokwim_school_district"));
  for (const zip of ["73960", "10540"]) assert.ok((await readZipPlace(zip))?.ids.some(id => /\/school_district:/.test(id)), zip);
});

test("ZIP-01: mail-only ZIPs cannot acquire residential legislative or school districts from a ZCTA or its point", async () => {
  for (const zip of ["10008", "00501"]) {
    const entry = await readZipPlace(zip);
    assert.ok(entry, zip);
    assert.equal(entry.samples, 0);
    assert.ok(entry.ids.length > 0, "town and county remain available");
    assert.ok(entry.ids.every(id => !/\/(?:cd|sldu|sldl|school_district|special_district):/.test(id)));
    const certainty = await zipCertainty(zip);
    assert.ok(certainty);
    assert.ok(entry.ids.filter(id => id.split("/").length > 3).every(id => certainty.certaintyOf(id) !== "CERTAIN"));
    assert.deepEqual(await readZipDivisions(zip), []);
    const point = ["ocd-division/country:us/state:tx/cd:13", "ocd-division/country:us/state:tx/sldu:31", "ocd-division/country:us/state:tx/school_district:texhoma"];
    assert.ok((await divisionIdsForZipArea(zip, point)).every(id => !point.includes(id)));
    const withQualifiedPoint = await divisionIdsForZipArea(zip, point, {
      purpose: "representation", asOf: "2026-10-13",
    });
    assert.ok(withQualifiedPoint.every(id => !point.includes(id)), "a valid point plan still cannot assign districts from a mail-only ZIP");
  }
});

test("ZIP-01: the saved Census address reply settles an address independently of a postal ZIP", async () => {
  const reply = JSON.parse(fixture("census-address.json"));
  const seen: string[] = [];
  const fetchImpl = (async (url: string | URL | Request) => {
    seen.push(String(url)); return Response.json(reply);
  }) as typeof fetch;
  const address = await locateAddressInZip("1600", "Pennsylvania Ave NW, Washington, DC", "73960", { fetchImpl, omitZip: true });
  assert.ok(address);
  assert.deepEqual({ lat: address.lat, lng: address.lng }, parseCensusPoint(reply));
  assert.ok(seen.every(url => !new URL(url).searchParams.get("address")!.includes("73960")));
  assert.equal(await locateAddressInZip("1600", "Pennsylvania Ave NW, Washington, DC", "73960", { fetchImpl }), null, "ordinary ZIP narrowing still rejects a different ZIP");
  assert.equal((await sampleStreetPoints("Pennsylvania Ave NW, Washington, DC", "73960", { fetchImpl, omitZip: true })).length, 4);
});
