import { BALLOT_NAVIGATION_STATES, ballotNavigationScope, ballotNavigationTaskId, ballotNavigationTaskState } from "./ballot-navigation-scope.ts";
import { requiredManualProductionContract, type ManualProductionContractId } from "./manual-contracts.ts";
import type { RoutineSourceTask } from "./runner.ts";
import type { RoutineCadencePolicy } from "./contracts.ts";
import election from "../../data/reference/voting-election.json" with { type: "json" };
import { REGISTRY_STATES, parseStateBallotContractId, stateBallotContractId } from "./state-scopes.ts";

const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;

/** Every registered door remains on this clock, including unpublished and closed routes. */
export function votingDoorRefreshCadence(electionDate: string): RoutineCadencePolicy {
  const electionMs = Date.parse(`${electionDate}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(electionDate) || !Number.isFinite(electionMs) ||
      new Date(electionMs).toISOString().slice(0, 10) !== electionDate) throw new Error("VOTING_ELECTION_DATE_INVALID");
  return {
    description: "Every voting source daily; hourly in the final week through Election Day",
    defaultEveryMs: DAY,
    phases: [
      { through: new Date(electionMs - 7 * DAY).toISOString(), everyMs: DAY, description: "Daily before the final week" },
      // Keep the hourly window open until Election Day has ended in every US timezone.
      { through: new Date(electionMs + DAY + 12 * HOUR).toISOString(), everyMs: HOUR, description: "Hourly through Election Day" },
    ],
  };
}

export const AUTOMATIC_REFRESH_CONTRACT_IDS = [
  ...REGISTRY_STATES.flatMap(state => [stateBallotContractId("voting-sites", state), stateBallotContractId("ballot-contests", state)]),
  "ballot-navigation", "az-sos-campaign-finance", "nh-sos-campaign-finance",
  "nj-elec-campaign-finance", "az-pima-local-finance",
  "member-offices", "prl", "prl-archives",
  "congress-bulk-roster", "congress-rollcalls", "federal-key-votes",
] as const satisfies readonly ManualProductionContractId[];

export const AUTOMATIC_REFRESH_TASKS: readonly RoutineSourceTask[] = AUTOMATIC_REFRESH_CONTRACT_IDS.flatMap(id => {
  const contract = requiredManualProductionContract(id);
  const stateContract = parseStateBallotContractId(id);
  const everyMs = DAY;
  const task: RoutineSourceTask = {
    id, sourceId: contract.sourceId, recordClass: contract.recordClass, scope: contract.scope,
    acquisitionFailureDomain: `routine-source:${contract.sourceId}${stateContract ? `:${stateContract.state}` : ""}`,
    requestedUrl: "", authorityMode: "REGISTERED_SOURCE_ROUTES", parserVersion: contract.parserNormalizerVersion,
    command: contract.command, cadenceMs: everyMs, retryMs: 60 * 60_000,
    contract: { readerProjection: contract.readerProjection,
      cadence: stateContract?.family === "voting-sites" || id === "ballot-navigation" ? votingDoorRefreshCadence(election.electionDate)
        : { defaultEveryMs: everyMs, description: "daily official-source refresh on the continuous runner" } },
  };
  return id === "ballot-navigation" ? BALLOT_NAVIGATION_STATES.map(state => ({ ...task,
    id: ballotNavigationTaskId(state), scope: ballotNavigationScope(state),
    acquisitionFailureDomain: `routine-source:${contract.sourceId}:${state}`,
    command: [...task.command, `--state=${state}`] })) : [task];
});

export function automaticRefreshContract(taskId: string): ManualProductionContractId | null {
  return ballotNavigationTaskState(taskId) ? "ballot-navigation" : AUTOMATIC_REFRESH_CONTRACT_IDS.find(id => id !== "ballot-navigation" && id === taskId) ?? null;
}
