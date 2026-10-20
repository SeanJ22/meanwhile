import { readFileSync } from "node:fs";
import { fecFundingScope } from "../../lib/civic-data/fec-state-scope.ts";
import type { FundingSnapshot } from "../../lib/funding/types.ts";
import { readFundingSnapshot } from "../../lib/funding/snapshot.ts";
import { installPromotedValue } from "./promoted-fixtures.ts";
import { provenEdgeEntry } from "./promoted-edge-entry.ts";

export function recordedFunding(): FundingSnapshot {
  return JSON.parse(readFileSync(new URL("../../data/fec/fec-2026.json", import.meta.url), "utf8")) as FundingSnapshot;
}
export function fundingFixtureForState(state: string, source = recordedFunding()): FundingSnapshot {
  const candidates = source.candidates.filter(row => row.state === state);
  const committees = new Set(candidates.flatMap(row => row.topContributions.flatMap(receipt => receipt.contributorCommitteeId ?? [])));
  return { ...source, candidates, absences: [], secondHop: source.secondHop?.filter(row => committees.has(row.committeeId)),
    refreshAttempts: source.refreshAttempts ? Object.fromEntries(Object.entries(source.refreshAttempts).filter(([id]) => committees.has(id) || candidates.some(row => row.fecCandidateId === id))) : undefined };
}
export function fundingFixtureEntries(versionId: string, source = recordedFunding()) {
  return [...new Set(source.candidates.map(row => row.state))].map(state => provenEdgeEntry({ recordClass: "FEC_FUNDING", scope: fecFundingScope(state), sourceId: "fec-open-api",
    versionId: `${versionId}:${state}`, value: fundingFixtureForState(state, source) }));
}
/** Install the same recorded rows through their exact state pointer; no implicit national seed is consulted. */
export async function installFundingFixture(state = "AZ"): Promise<FundingSnapshot> {
  const value = fundingFixtureForState(state);
  const edge = installPromotedValue({ recordClass: "FEC_FUNDING", scope: fecFundingScope(state), sourceId: "fec-open-api", versionId: `test:recorded-funding:${state}`, value });
  const read = await readFundingSnapshot({ state, edge, bypassCache: true });
  if (read.kind !== "PROMOTED") throw new Error(`FEC state fixture did not install: ${state}:${read.kind}`);
  return read.value;
}
