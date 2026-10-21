import { REGISTRY_STATES, stateRegistryRuntimeContractId } from "./state-scopes.ts";
import { requiredManualProductionContract } from "./manual-contracts.ts";
import type { RoutineSourceTask } from "./runner.ts";

/** Binding publication uses the existing state-specific manual source-verification door.
 * A standing clock supplies the invocation; each source fact still keeps its own date. */
export const STATE_BINDING_REFRESH_TASKS: readonly RoutineSourceTask[] = REGISTRY_STATES.map(state => {
  const contract = requiredManualProductionContract(stateRegistryRuntimeContractId(state));
  return {
    id: contract.id,
    registeredContractId: contract.id,
    sourceId: contract.sourceId,
    acquisitionFailureDomain: `routine-source:${contract.sourceId}:${state.toLowerCase()}`,
    recordClass: contract.recordClass,
    scope: contract.scope,
    requestedUrl: "",
    authorityMode: "REGISTERED_SOURCE_ROUTES",
    parserVersion: contract.parserNormalizerVersion,
    command: ["scripts/state-binding-refresh.mts", "--promote", `--state=${state}`],
    cadenceMs: 86_400_000,
    retryMs: 3_600_000,
    contract: {
      readerProjection: contract.readerProjection,
      cadence: { defaultEveryMs: 86_400_000, description: "Daily state reader binding refresh, independent of paid work and owner orders" },
    },
  };
});
