import type { ResolvedScope } from "../control-plane/expansion/membership.ts";
import { requiredManualProductionContract } from "./manual-contracts.ts";
import { manualProducerInvocationMatrix } from "./manual-producer-invocation.ts";
import type { RoutineSourceTask } from "./runner.ts";
import { scheduledBlackoutAt } from "../control-plane/fleet-safety.ts";
import { isFundedHunt } from "../control-plane/scheduler/hunt-continuation.ts";

/** The owner did not pause a funded Send during the scheduled blackout. Unfunded Sends keep that policy. */
export function admittedHuntSourceScopes(scopes: readonly ResolvedScope[], now: string): readonly ResolvedScope[] {
  if (!scheduledBlackoutAt(now)) return scopes;
  return scopes.filter(scope => scope.kind === "RESOLVED" &&
    scope.decision.sourceWorkVersion === 1 && isFundedHunt(scope.decision));
}

export function huntSourceTasks(scopes: readonly ResolvedScope[], now: string): RoutineSourceTask[] {
  return manualProducerInvocationMatrix(scopes, now).filter(row => row.commandReady).flatMap(row => {
    const applicable = scopes.filter(scope => row.instructionIds.includes(scope.decision.receiptId));
    const contract = requiredManualProductionContract(row.id);
    return [{
      id: row.id,
      registeredContractId: contract.id,
      sourceId: contract.sourceId, recordClass: contract.recordClass, scope: contract.scope,
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
