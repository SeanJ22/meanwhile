import { requiredManualProductionContract, type ManualProductionContractId } from "./manual-contracts.ts";
import type { RoutineSourceTask } from "./runner.ts";
import { votingDoorRefreshCadence } from "../ballot/voting-refresh.ts";
export { votingDoorRefreshCadence } from "../ballot/voting-refresh.ts";
import election from "../../data/reference/voting-election.json" with { type: "json" };
import { REGISTRY_STATES, parseStateBallotContractId, stateBallotContractId } from "./state-scopes.ts";
import { FEDERAL_DIRECTORY_STATES, federalDirectoryContractId } from "../officials/federal-directory-data-plane.ts";

const DAY = 86_400_000;

export const AUTOMATIC_REFRESH_CONTRACT_IDS = [
  ...REGISTRY_STATES.flatMap(state => [stateBallotContractId("voting-sites", state), stateBallotContractId("ballot-contests", state)]),
  "az-sos-campaign-finance", "nh-sos-campaign-finance",
  "nj-elec-campaign-finance", "az-pima-local-finance",
  "member-offices", "prl", "prl-archives",
  ...FEDERAL_DIRECTORY_STATES.map(federalDirectoryContractId), "congress-rollcalls", "federal-key-votes",
] as const satisfies readonly ManualProductionContractId[];

export const AUTOMATIC_REFRESH_TASKS: readonly RoutineSourceTask[] = AUTOMATIC_REFRESH_CONTRACT_IDS.map(id => {
  const contract = requiredManualProductionContract(id);
  const stateContract = parseStateBallotContractId(id);
  const everyMs = DAY;
  return {
    id, sourceId: contract.sourceId, recordClass: contract.recordClass, scope: contract.scope,
    acquisitionFailureDomain: `routine-source:${contract.sourceId}${stateContract ? `:${stateContract.state}` : ""}`,
    requestedUrl: "", authorityMode: "REGISTERED_SOURCE_ROUTES", parserVersion: contract.parserNormalizerVersion,
    command: contract.command, cadenceMs: everyMs, retryMs: 60 * 60_000,
    contract: { readerProjection: contract.readerProjection,
      cadence: stateContract?.family === "voting-sites" ? votingDoorRefreshCadence(election.electionDate)
        : { defaultEveryMs: everyMs, description: "daily official-source refresh on the continuous runner" } },
  };
});

export function automaticRefreshContract(taskId: string): ManualProductionContractId | null {
  return AUTOMATIC_REFRESH_CONTRACT_IDS.find(id => id === taskId) ?? null;
}
