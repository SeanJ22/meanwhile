import { requiredManualProductionContract, type ManualProductionContractId } from "./manual-contracts.ts";
import type { RoutineSourceTask } from "./runner.ts";

/** Existing source adapters run on the standing clock, independent of an Admin Send. */
export const AUTOMATIC_REFRESH_CONTRACT_IDS = [
  "voting-sites", "az-sos-campaign-finance", "nh-sos-campaign-finance",
  "nj-elec-campaign-finance", "az-pima-local-finance",
  // State legislators' offices from Open States, joined to each official roster (lib/officials/member-offices-publication.ts).
  "member-offices",
  // DB-08: Congress refreshes itself every day, with no Send. The roster is read at the project's current revision, the
  // roll calls from the chambers' own clerks (catching up from the last roll held, `scripts/fetch-votes.mts`), and the
  // reviewed key-vote selection's positions from the same roll calls.
  "congress-bulk-roster", "congress-rollcalls", "federal-key-votes",
] as const satisfies readonly ManualProductionContractId[];

export const AUTOMATIC_REFRESH_TASKS: readonly RoutineSourceTask[] = AUTOMATIC_REFRESH_CONTRACT_IDS.map(id => {
  const contract = requiredManualProductionContract(id);
  const everyMs = 24 * 60 * 60_000;
  return {
    id, sourceId: contract.sourceId, recordClass: contract.recordClass, scope: contract.scope,
    acquisitionFailureDomain: `routine-source:${contract.sourceId}`,
    requestedUrl: "", authorityMode: "REGISTERED_SOURCE_ROUTES", parserVersion: contract.parserNormalizerVersion,
    command: contract.command, cadenceMs: everyMs, retryMs: 60 * 60_000,
    contract: { readerProjection: contract.readerProjection,
      cadence: { defaultEveryMs: everyMs, description: "daily official-source refresh on the continuous runner" } },
  };
});

export function automaticRefreshContract(taskId: string): ManualProductionContractId | null {
  return AUTOMATIC_REFRESH_CONTRACT_IDS.find(id => id === taskId) ?? null;
}
