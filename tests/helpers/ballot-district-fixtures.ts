import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { BallotSet } from "../../lib/ballot/types.ts";
import type { BuiltDataset } from "../../lib/census-geography/dataset.ts";
import { buildCensusDistrictEdge, censusDistrictEdgeSlice } from "../../lib/census-geography/district-edge.ts";
import type { CodeSlice, Slice } from "../../lib/control-plane/admin-view/promoted-slices.ts";

export const azDistricts = buildCensusDistrictEdge(
  JSON.parse(readFileSync(join(import.meta.dirname, "../../lib/census-geography/bootstrap-az.json"), "utf8")) as BuiltDataset,
  "ballot-production-district-fixture",
);
const azBallot = Object.values(JSON.parse(readFileSync(join(import.meta.dirname, "../../data/ballot/2026-general/az.json"), "utf8")).ballots)[0] as BallotSet;
export const electionSelection = { purpose: "election" as const, asOf: "2026-10-12", electionDate: azBallot.election.date };

export function azDistrictSlice(zip: string): Slice<CodeSlice> & { kind: "HELD" } {
  const slice = censusDistrictEdgeSlice(azDistricts, azDistricts.versionId, zip);
  if (slice.kind !== "HELD") throw new Error("The committed Census fixture must be readable");
  return slice;
}
