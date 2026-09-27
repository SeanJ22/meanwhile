import type { ResolvedScope } from "../control-plane/expansion/membership.ts";
import { requiredManualProductionContract, type ManualProductionContractId } from "./manual-contracts.ts";
import type { RoutineSourceTask } from "./runner.ts";

/** Existing deterministic producers, invoked once per resolved Send, never added to the standing portfolio. */
const HUNT_SOURCES: readonly { id: ManualProductionContractId; state?: string }[] = [
  { id: "congress-bulk-roster" },
  { id: "congress-rollcalls" },
  { id: "federal-key-votes" },
  { id: "az-sos-campaign-finance", state: "AZ" },
];

export function huntSourceTasks(scopes: readonly ResolvedScope[], now: string): RoutineSourceTask[] {
  const nowMs = Date.parse(now);
  return HUNT_SOURCES.flatMap(({ id, state }) => {
    const applicable = scopes.filter(scope => scope.kind === "RESOLVED" && scope.zctas.size > 0 && scope.decision.sourceWorkVersion === 1 &&
      (!state || scope.states.includes(state)) && scope.decision.receiptId.trim() &&
      Number.isFinite(Date.parse(scope.decision.decidedAt)) && Date.parse(scope.decision.decidedAt) <= nowMs);
    if (applicable.length === 0) return [];
    const contract = requiredManualProductionContract(id);
    return [{
      id, sourceId: contract.sourceId, recordClass: contract.recordClass, scope: contract.scope,
      acquisitionFailureDomain: `routine-source:${contract.sourceId}`,
      requestedUrl: "", authorityMode: "REGISTERED_SOURCE_ROUTES" as const,
      parserVersion: contract.parserNormalizerVersion, command: contract.command,
      cadenceMs: Number.POSITIVE_INFINITY, retryMs: 15 * 60_000,
      contract: { readerProjection: contract.readerProjection, cadence: { description: "One verified refresh for the owner's Send; no new standing schedule", defaultEveryMs: Number.POSITIVE_INFINITY } },
      ownerInvocation: {
        requestedAt: applicable.map(scope => scope.decision.decidedAt).sort().at(-1)!,
        instructions: [...new Set(applicable.map(scope => scope.decision.receiptId))],
      },
    }];
  });
}
