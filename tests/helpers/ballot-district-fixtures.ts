import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after } from "node:test";
import type { BallotSet } from "../../lib/ballot/types.ts";
import type { BuiltDataset } from "../../lib/census-geography/dataset.ts";
import { createCensusDistrictReaderEdge, type CensusDistrictEdge } from "../../lib/census-geography/district-edge.ts";
import { buildCensusDistrictEdge, publishCensusDistrictState } from "../../lib/census-geography/state-publication.ts";
import type { CodeSlice, Slice } from "../../lib/control-plane/admin-view/promoted-slices.ts";
import { type ReaderArtifactStore } from "../../lib/meetings/edge-store.ts";
import { LocalFileArtifactStore } from "../../lib/meetings/edge-store-local.ts";

export const azDistrictDataset = JSON.parse(readFileSync(join(import.meta.dirname, "../../lib/census-geography/bootstrap-az.json"), "utf8")) as BuiltDataset;
export const publishDistrictFixture = (store: ReaderArtifactStore, version = "ballot-production-district-fixture", dataset = azDistrictDataset) => buildCensusDistrictEdge(structuredClone(dataset), version, store);
export async function publishDistrictStatesFixture(store: ReaderArtifactStore, version: string, dataset = azDistrictDataset) {
  const published: Record<string, { value: CensusDistrictEdge; versionId: string }> = {};
  const states = [...new Set(dataset.scopes.filter(scope => scope.type !== "cbsa").flatMap(scope => scope.groupings.map(group => group.stateAbbr)))];
  for (const state of states) {
    const scopes = dataset.scopes.map(scope => ({ ...scope, groupings: scope.groupings.filter(group => group.stateAbbr === state || group.memberStates.includes(state)) })).filter(scope => scope.groupings.length);
    const zctaUniverse = states.length === 1 ? dataset.zctaUniverse : [...new Set(scopes.filter(scope => scope.type !== "cbsa").flatMap(scope => scope.groupings.flatMap(group => group.overlaps.map(overlap => overlap.zcta5))))];
    const value = await publishCensusDistrictState({ state, dataset: structuredClone({ ...dataset, scopes, zctaUniverse }) }, `${version}:${state}`, store);
    published[state] = { value, versionId: value.versionId };
  }
  return published;
}
const directory = mkdtempSync(join(tmpdir(), "ballot-district-fixture-"));
after(() => rmSync(directory, { recursive: true, force: true }));
export const districtFixtureStore = new LocalFileArtifactStore(directory);
export const azDistricts = createCensusDistrictReaderEdge(await publishDistrictFixture(districtFixtureStore), districtFixtureStore);
export const azBallot = JSON.parse(readFileSync(join(import.meta.dirname, "../../data/states/az/ballot/az-pima-2026.json"), "utf8")) as BallotSet;
export const electionSelection = { purpose: "election" as const, asOf: "2026-10-12", electionDate: azBallot.election.date };

export async function azDistrictSlice(zip: string): Promise<Slice<CodeSlice> & { kind: "HELD" }> {
  const slice = await azDistricts.loadZip(zip);
  if (slice.kind !== "HELD") throw new Error("The committed Census fixture must be readable");
  return slice;
}
