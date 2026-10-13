import { requiredManualProductionContract, type ManualProductionContractId } from "./manual-contracts.ts";
import type { RoutineSourceTask } from "./runner.ts";

export const AUTOMATIC_REFRESH_CONTRACT_IDS = [
  "voting-sites", "az-sos-campaign-finance", "nh-sos-campaign-finance",
  "nj-elec-campaign-finance", "az-pima-local-finance",
  "member-offices", "prl", "prl-archives",
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
  if (/^legistar-members:[a-z0-9_-]+$/i.test(taskId)) return "registry-runtime-bindings";
  return AUTOMATIC_REFRESH_CONTRACT_IDS.find(id => id === taskId) ?? null;
}
