import assert from "node:assert/strict";
import test from "node:test";
import type { MapLibreMap } from "maplibre-gl";
import type { BuiltDataset, BuiltScope } from "../lib/census-geography/dataset.ts";
import { buildCensusDistrictEdge, censusDistrictEdgeSlice } from "../lib/census-geography/district-edge.ts";
import { representationDivisionsAt, excludedRepresentationAtPoints, requestRepresentationGeographyReader, supplementPointDivisions } from "../lib/geo/representation-geography.ts";
import { withCensusDistricts } from "../lib/geo/zip-census-districts.ts";
import { resolveAddress } from "../lib/geo/address-resolution.ts";
import { districtsAt, fillLayerId } from "../lib/map/districts.ts";
import type { Division } from "../lib/registry/types.ts";
import type { GeographySlice, Slice } from "../lib/control-plane/admin-view/promoted-slices.ts";

const square = { type: "Polygon" as const, coordinates: [[[0,0],[2,0],[2,2],[0,2],[0,0]]] };
const baseId = "ocd-division/country:us/state:nh/sldl:ro1";
const overlayId = "ocd-division/country:us/state:nh/sldl:ro31";
const selection = { purpose: "representation" as const, asOf: "2026-10-12" };

function scope(type: BuiltScope["type"], version: string, geoid: string, label: string): BuiltScope {
  return { type, version, fractionBasis: "area", instanceCount: 1, zctaEdgeCount: 1,
    versionMeta: { key: version, type, plan: "Constructed test plan", zctaTabulation: "2020", effectiveFor: "Test representation",
      applicability: [{ purpose: "representation", from: "2022-01-01", through: "2033-01-01" }],
      provenance: { sourceUrls: ["https://publisher.gov/boundary", "https://publisher.gov/towns"], sourceDataset: "TEST", sourceFiles: ["boundary", "towns"], sourceChecksums: ["a", "b"], method: "Constructed square topology test", computedAt: "2026-10-12T00:00:00Z" } },
    groupings: [{ geoid, ocdId: null, label, stateFips: "33", stateAbbr: "NH", memberStates: ["NH"], chamber: "lower", geometry: square,
      ...(type === "overlay_district" ? { representation: "overlay" as const } : {}), overlaps: [{ zcta5: "00001", whole: false, fraction: 0.25 }] }] };
}

test("a published ZIP retains its Census partition and independent overlay, with identical land-share semantics", () => {
  const dataset: BuiltDataset = { formatVersion: 1, builtAt: "2026-10-12T00:00:00Z", coverage: "Constructed topology test", zctaUniverse: ["00001"],
    scopes: [scope("state_leg_lower", "sldl:2024", "33RO1", "Rockingham 1"), scope("overlay_district", "overlay:test", "33RO31", "Rockingham 31")] };
  const edge = buildCensusDistrictEdge(dataset, "fixture");
  const slice = censusDistrictEdgeSlice(edge, edge.versionId, "00001");
  assert.equal(slice.kind, "HELD");
  const zip = withCensusDistricts({ ids: [], partial: [], samples: 0 }, slice, "00001", selection);
  assert.deepEqual(new Set(zip.ids), new Set([baseId, overlayId]));
  assert.deepEqual(new Set(zip.partial), new Set([baseId, overlayId]));
  if (slice.kind !== "HELD") return;
  const hits = representationDivisionsAt([1,1], slice.value, selection);
  assert.deepEqual(new Set(hits.map(hit => hit.ocdId)), new Set([baseId, overlayId]));
  assert.equal(hits.find(hit => hit.ocdId === overlayId)?.representation, "overlay");
  assert.equal(hits.find(hit => hit.ocdId === overlayId)?.sourceUrls?.length, 2);
  const address = resolveAddress([hits]);
  assert.equal(address.status, "RESOLVED");
  assert.deepEqual(new Set(address.levels.find(level => level.level === "sldl")?.divisionIds), new Set([baseId, overlayId]));
  assert.deepEqual(excludedRepresentationAtPoints([[3,3]], slice.value, selection), [overlayId]);
  assert.deepEqual(excludedRepresentationAtPoints([[1,1],[3,3]], slice.value, selection), []);
});

test("one map click returns base and overlay House hits and preserves their distinct sources", () => {
  const map = { getLayer: () => true, queryRenderedFeatures: () => [
    { layer: { id: fillLayerId("state-house") }, properties: { ocdId: baseId, label: "Rockingham 1", state: "NH" } },
    { layer: { id: "district-state-house-representation-fill" }, properties: { ocdId: overlayId, label: "Rockingham 31", state: "NH", representation: "overlay", sourceUrls: JSON.stringify(["https://publisher.gov/boundary", "https://publisher.gov/towns"]) } },
  ] } as unknown as MapLibreMap;
  const hits = districtsAt(map, {x:10,y:10}, ["state-house"]);
  assert.deepEqual(hits.map(hit => hit.ocdId), [baseId, overlayId]);
  assert.equal(hits[1].typeLabel, "Overlay district");
  assert.equal(hits[1].sourceUrls?.length, 2);
});

test("concurrent street samples read their state's overlay version once, then a new request sees the next version", async () => {
  const dataset: BuiltDataset = { formatVersion: 1, builtAt: "2026-10-12T00:00:00Z", coverage: "Constructed topology test", zctaUniverse: ["00001"],
    scopes: [scope("overlay_district", "overlay:test", "33RO31", "Rockingham 31")] };
  const edge = buildCensusDistrictEdge(dataset, "street-samples");
  const zipSlice = censusDistrictEdgeSlice(edge, edge.versionId, "00001");
  assert.equal(zipSlice.kind, "HELD");
  if (zipSlice.kind !== "HELD") return;
  let release!: (slice: Slice<GeographySlice>) => void;
  const held = new Promise<Slice<GeographySlice>>(resolve => { release = resolve; });
  const reads: string[] = [];
  const read = async (state: string) => { reads.push(state); return held; };
  const shared = requestRepresentationGeographyReader(read);
  const base = {ocdId:baseId,divisionType:"sldl",label:"Rockingham 1",state:"NH"} as Division;
  const samples = Promise.all([0.5,1,1.5,1.8].map(lat => supplementPointDivisions(lat,1,[base],undefined,shared)));
  assert.deepEqual(reads,["NH"],"all in-flight samples must share one bounded read rather than serialize four database round trips");
  release(zipSlice);
  for (const hits of await samples) assert.deepEqual(hits.map(hit => hit.ocdId),[baseId,overlayId]);
  const withoutBase = await supplementPointDivisions(1,1,[],undefined,shared,["NH"]);
  assert.deepEqual(withoutBase.map(hit=>hit.ocdId),[overlayId],"published ZIP state hints must preserve a verified overlay when the older base registry lacks that state");
  assert.deepEqual(reads,["NH"],"the ZIP hint shares the same bounded request read");

  const fresh = requestRepresentationGeographyReader(async state => {
    reads.push(state);
    return {kind:"HELD",versionId:"next-version",value:{...zipSlice.value,containers:[]}};
  });
  const next = await supplementPointDivisions(1,1,[base],undefined,fresh);
  assert.deepEqual(next.map(hit=>hit.ocdId),[baseId],"a finished request must not cache its geography into the next one");
  assert.deepEqual(reads,["NH","NH"]);
});
