import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after } from "node:test";
import type { BallotSet } from "../../lib/ballot/types.ts";
import type { BuiltDataset } from "../../lib/census-geography/dataset.ts";
import { buildCensusDistrictEdge, createCensusDistrictReaderEdge } from "../../lib/census-geography/district-edge.ts";
import type { CodeSlice, Slice } from "../../lib/control-plane/admin-view/promoted-slices.ts";
import { LocalFileArtifactStore, type ReaderArtifactStore } from "../../lib/meetings/edge-store.ts";

export const azDistrictDataset = JSON.parse(readFileSync(join(import.meta.dirname, "../../lib/census-geography/bootstrap-az.json"), "utf8")) as BuiltDataset;
export const publishDistrictFixture = (store: ReaderArtifactStore, version = "ballot-production-district-fixture", dataset = azDistrictDataset) => buildCensusDistrictEdge(dataset, version, store);
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
