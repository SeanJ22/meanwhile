import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import type { Map as MapLibreMap } from "maplibre-gl";
import { POST as resolveAddress } from "../app/api/address/resolve/route.ts";
import { GET as boundaryAreas } from "../app/api/boundaries/representation/route.ts";
import { GET as representatives } from "../app/api/representation/[...division]/route.ts";
import { buildCensusDistrictEdge } from "../lib/census-geography/district-edge.ts";
import { censusWorkDivision } from "../lib/census-geography/division-id.ts";
import { CENSUS_GEOGRAPHIES_URL } from "../lib/geo/census-geocoder.ts";
import { publishScopeBoundaries } from "../lib/census-geography/boundary-artifacts.ts";
import { publishedZipDistricts, withCensusDistricts } from "../lib/geo/zip-census-districts.ts";
import { districtsAt, fillLayerId } from "../lib/map/districts.ts";
import { publishReaderEdgeArtifacts, readReaderManifest, readerAuthorityEdge } from "../lib/meetings/edge-serving.ts";
import { LocalFileArtifactStore } from "../lib/meetings/edge-store-local.ts";
import { contains, type GeoFeature } from "../lib/registry/resolve.ts";
import { withReaderAuthorityEdge } from "../lib/registry/runtime-edge.ts";
import { divisionsByOcdIds, seatHoldersForDivision } from "../lib/registry/server.ts";
import { indexDivisions, normalize, type PluralPerson } from "../lib/sources/plural/index.ts";
import { registryTransferImport } from "./helpers/promoted-fixtures.ts";
import { realBaseScope, realOverlayScope, SOURCE_FIXTURE_NOW } from "./helpers/representation-source-fixtures.ts";

const baseId = "ocd-division/country:us/state:nh/sldl:702";
const overlayId = "ocd-division/country:us/state:nh/sldl:ro31";
const baseNames = ["Jason Osborne", "Jim Spillane", "Kevin Verville"];
const overlayNames = ["Jess Edwards", "Terry Roy"];
// Controlled geocoder replies reuse the recorded High Street midpoint.
const point = { lat: 43.065050167418754, lng: -71.31029493560274 };
const source = JSON.parse(readFileSync(new URL("./fixtures/geography/openstates-candia.json", import.meta.url), "utf8")) as {
  sourceUrl: string; people: Pick<PluralPerson, "id" | "name" | "current_district" | "current_chamber" | "current_party">[];
};
const originalScopes = [realBaseScope(), await realOverlayScope()];
const directory = mkdtempSync(join(tmpdir(), "sl02-candia-reader-"));
const store = new LocalFileArtifactStore(directory);
const scopes = await Promise.all(originalScopes.map(scope => publishScopeBoundaries(scope, store)));
const census = await buildCensusDistrictEdge({ formatVersion: 1, builtAt: SOURCE_FIXTURE_NOW, coverage: "Original source fixtures",
  scopes, zctaUniverse: [...new Set(scopes.flatMap(scope => scope.groupings.flatMap(group => group.overlaps.map(edge => edge.zcta5))))] }, "real-candia-sources", store);
const divisions = scopes.flatMap(scope => scope.groupings.map(group => ({
  ocdId: censusWorkDivision({ ...group, type: scope.type, version: scope.version })!, label: group.label, divisionType: "sldl",
})));
const roster = normalize(source.people.filter(person => person.current_district.startsWith("Rockingham ")).map(person => ({
  ...person, state: "nh", email: "", image: "", links: "", sources: source.sourceUrl, sourceUrl: source.sourceUrl,
  capitol_address: "", capitol_voice: "", district_address: "", district_voice: "",
})), indexDivisions(divisions), SOURCE_FIXTURE_NOW, "US-NH");
assert.deepEqual(roster.unmatched, []);

const previousDirectory = process.env.WTP_READER_EDGE_DIR;
for (const key of ["DATABASE_URL", "DATABASE_URL_UNPOOLED", "NEON_DATABASE_URL"]) delete process.env[key];
const result = await publishReaderEdgeArtifacts(null, { sourceThrough: null, retrievedAt: SOURCE_FIXTURE_NOW, promotedThrough: SOURCE_FIXTURE_NOW }, {
  store, now: SOURCE_FIXTURE_NOW,
  authority: {
    "registry-runtime": { value: registryTransferImport().projection.payload, versionId: "candia-recorded-registry" },
    "census-districts": { value: census, versionId: census.versionId },
  },
  stateLegislators: { "US-NH": { versionId: "candia-source-roster", value: { formatVersion: 1, sourceId: "plural-openstates",
    jurisdiction: "US-NH", term: "Current source memberships", generatedAt: SOURCE_FIXTURE_NOW, roster } } },
});
assert.equal(result.status, "PUBLISHED", JSON.stringify(result));
process.env.WTP_READER_EDGE_DIR = directory;
after(() => {
  if (previousDirectory === undefined) delete process.env.WTP_READER_EDGE_DIR;
  else process.env.WTP_READER_EDGE_DIR = previousDirectory;
  rmSync(directory, { recursive: true, force: true });
});

test("Candia's real ZIP scope resolves its base and floterial with all five source holders", async () => {
  const manifest = await readReaderManifest();
  assert.ok(manifest);
  return withReaderAuthorityEdge(await readerAuthorityEdge(manifest), async () => {
    const zip = withCensusDistricts({ ids: [], partial: [], samples: 0 }, await publishedZipDistricts("03034"), "03034");
    assert.deepEqual(new Set(zip.ids), new Set([baseId, overlayId]));
    assert.deepEqual(zip.partial, []);
    const held = await divisionsByOcdIds(zip.ids, { zip: "03034" });
    assert.deepEqual(new Set(held.map(division => division.ocdId)), new Set([baseId, overlayId]));
    assert.equal(held.find(division => division.ocdId === overlayId)?.representation, "overlay");
    assert.equal(held.find(division => division.ocdId === overlayId)?.sourceUrls?.length, 2);
    assert.deepEqual((await seatHoldersForDivision(baseId)).map(holder => holder.name).sort(), baseNames);
    assert.deepEqual((await seatHoldersForDivision(overlayId)).map(holder => holder.name).sort(), overlayNames);
  });
});

test("Candia street, representation address and election address retain both House districts despite missing ballot holdings", async () => {
  const priorFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async input => {
    const url = String(input);
    assert.ok(url.startsWith(CENSUS_GEOGRAPHIES_URL), `Unexpected network request: ${url}`);
    calls.push(url);
    return new Response(JSON.stringify({ result: { addressMatches: [{
      addressComponents: { zip: "03034" }, coordinates: { x: point.lng, y: point.lat },
      geographies: { "2024 State Legislative Districts - Lower": [{ GEOID: "33702", STATE: "33", SLDL: "702", NAME: "State House District Rockingham 02" }] },
    }] } }));
  }) as typeof fetch;
  try {
    for (const [houseNumber, selection] of [
      ["", { purpose: "representation", asOf: "2026-10-15" }],
      ["74", { purpose: "representation", asOf: "2026-10-15" }],
      ["74", { purpose: "election", asOf: "2026-10-15", electionDate: "2026-11-03" }],
    ] as const) {
      const before = calls.length;
      const response = await resolveAddress(new Request("http://localhost/api/address/resolve", { method: "POST",
        headers: { "content-type": "application/json" }, body: JSON.stringify({ zip: "03034", street: "High Street", houseNumber, selection }) }));
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.resolution.status, "RESOLVED");
      assert.equal(body.ballotStatus, selection.purpose === "election" ? "HOLDING_UNAVAILABLE" : "NOT_RECORDED");
      assert.deepEqual(body.contestIds, [], "unavailable ballot data must never narrow the displayed ballot");
      const house = body.resolution.levels.find((level: { level: string }) => level.level === "sldl");
      assert.equal(house.certain, true);
      assert.deepEqual(new Set(house.divisionIds), new Set([baseId, overlayId]));
      assert.equal(body.excludedDivisionIds.includes(overlayId), false);
      assert.deepEqual(body.point, point);
      assert.equal(calls.length - before, houseNumber ? selection.purpose === "election" ? 1 : 2 : 8);
      assert.equal(response.headers.get("cache-control"), "no-store, no-cache, must-revalidate");
    }
  } finally { globalThis.fetch = priorFetch; }
});

test("a Candia map click returns both actual-source districts and their three plus two holders", async () => {
  const response = await boundaryAreas(new Request(`http://localhost/api/boundaries/representation?lat=${point.lat}&lng=${point.lng}&state=nh&bounds=-71.4,43,-71.2,43.2`));
  assert.equal(response.status, 200);
  const collection = await response.json();
  for (const bounds of ["288.6,43,288.8,43.2", "-431.4,43,-431.2,43.2"]) {
    const shifted = await boundaryAreas(new Request(`http://localhost/api/boundaries/representation?lat=${point.lat}&lng=${point.lng}&state=nh&bounds=${bounds}`));
    assert.equal(shifted.status, 200);
    assert.deepEqual(await shifted.json(), collection, "a wrapped map center must preserve its visible world copy");
  }
  const overlays = collection.features.filter((feature: GeoFeature) => contains([point.lng, point.lat], feature));
  assert.deepEqual(overlays.map((feature: GeoFeature) => feature.properties.ocdId), [overlayId]);
  const base = JSON.parse(readFileSync(new URL("../data/states/nh/geo/sldl-33.geojson", import.meta.url), "utf8"))
    .features.filter((feature: GeoFeature) => contains([point.lng, point.lat], feature));
  assert.deepEqual(base.map((feature: GeoFeature) => feature.properties.ocdId), [baseId]);
  const map = { getLayer: () => true, queryRenderedFeatures: () => [
    ...base.map((feature: GeoFeature) => ({ ...feature, layer: { id: fillLayerId("state-house") } })),
    ...overlays.map((feature: GeoFeature) => ({ ...feature, layer: { id: "district-state-house-representation-fill" } })),
  ] } as unknown as MapLibreMap;
  const hits = districtsAt(map, { x: 100, y: 100 }, ["state-house"]);
  assert.deepEqual(hits.map(hit => hit.ocdId), [baseId, overlayId]);
  assert.equal(hits[1].typeLabel, "Overlay district");
  assert.equal(hits[1].sourceUrls?.length, 2);
  for (const [index, hit] of hits.entries()) {
    const seats = await representatives(new Request(`http://localhost/api/representation/${hit.ocdId}`),
      { params: Promise.resolve({ division: hit.ocdId.split("/") }) });
    assert.equal(seats.status, 200);
    const body = await seats.json();
    assert.equal(body.ocdId, hit.ocdId);
    assert.equal(body.holderStatus, "HELD");
    assert.deepEqual(body.holders.map((holder: { name: string }) => holder.name).sort(), index ? overlayNames : baseNames);
  }
});
