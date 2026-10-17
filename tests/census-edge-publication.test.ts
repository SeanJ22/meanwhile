import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { censusEdgePublication } from "../scripts/lib/census-edge-publication.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { processRegisteredRoutineCandidate } from "../lib/civic-data/promotion.ts";
import { readPromotedCivicData } from "../lib/civic-data/read-model.ts";
import { censusGeographyCandidate } from "../lib/census-geography/candidate.ts";
import { censusDistrictEdgeSlice, censusDistrictEdgeVersion, type CensusDistrictEdge } from "../lib/census-geography/district-edge.ts";
import { CENSUS_GEO_CONTRACT_ID, CENSUS_GEO_RECORD_CLASS, CENSUS_GEO_SCOPE } from "../lib/census-geography/publication.ts";
import type { BuiltDataset } from "../lib/census-geography/dataset.ts";

const servedVersion = censusDistrictEdgeVersion("prior-proved-version");
const unread = async (): Promise<never> => { throw new Error("projection unavailable"); };

test("failed pointer or replacement reads retain the exact prior proved Census version and report failure", async () => {
  for (const readVersion of [unread, async () => "new-pointer"]) {
    const failures: unknown[] = [];
    assert.deepEqual(await censusEdgePublication({ servedVersion, readVersion, readProjection: unread,
      onFailure: error => failures.push(error) }), null);
    assert.equal(failures.length, 1);
  }
  assert.equal(await censusEdgePublication({ servedVersion: null, readVersion: unread, readProjection: unread,
    onFailure: () => {} }), null, "no prior proof means no invented fallback");
});

test("the unchanged pointer reuses the copy without rereading the dataset", async () => {
  assert.deepEqual(await censusEdgePublication({ servedVersion, readVersion: async () => "prior-proved-version",
    readProjection: unread, onFailure: () => assert.fail("unchanged read should not fail") }), null);
});

test("only a proved promoted replacement advances Census; absent replacement keeps the prior copy", async () => {
  const store = new MemoryRoutineDataStore();
  const dataset = JSON.parse(readFileSync("lib/census-geography/bootstrap-az.json", "utf8")) as BuiltDataset;
  const readProjection = () => readPromotedCivicData<BuiltDataset>(CENSUS_GEO_RECORD_CLASS, CENSUS_GEO_SCOPE,
    { store, now: dataset.builtAt, bypassCache: true });
  const failures: unknown[] = [];
  assert.deepEqual(await censusEdgePublication({ servedVersion, readVersion: async () => null, readProjection,
    onFailure: error => failures.push(error) }), null);
  assert.equal(failures.length, 1);
  const promoted = await processRegisteredRoutineCandidate(store, CENSUS_GEO_CONTRACT_ID,
    censusGeographyCandidate(dataset), dataset.builtAt);
  assert.ok(promoted.promoted);
  const result = await censusEdgePublication({ servedVersion, readVersion: async () => "changed", readProjection,
    onFailure: () => assert.fail("proved projection should publish") });
  assert.ok(result);
  assert.notEqual(result.versionId, servedVersion);
  const slice = censusDistrictEdgeSlice(result.value as CensusDistrictEdge, result.versionId, "85635");
  assert.equal(slice.kind, "HELD");
  assert.ok(slice.kind === "HELD" && slice.value.containers.some(c => c.ref.geoid === "0406"));
});
