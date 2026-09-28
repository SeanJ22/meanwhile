import type { ResolvedScope } from "../control-plane/expansion/membership.ts";
import { requiredManualProductionContract } from "./manual-contracts.ts";
import { manualProducerInvocationMatrix } from "./manual-producer-invocation.ts";
import { routineTaskFromContract, type RoutineSourceTask } from "./runner.ts";
import { requiredRoutineContract } from "./contracts.ts";
import type { WorkItem } from "../control-plane/work-item.ts";
import type { WorkerResultRecord } from "../control-plane/workers/types.ts";
import { isWorkerReaderContract } from "./worker-reader-contracts.ts";
import { COCHISE_VOTE_CENTERS_URL } from "../sources/cochise-vote-centers.ts";
import { scheduledBlackoutAt } from "../control-plane/fleet-safety.ts";
import { ORIGINAL_LIFETIME_HUNT } from "../control-plane/scheduler/hunt-continuation.ts";

/** The owner did not pause the already-started original lifetime Send during
 * the scheduled blackout. Other Sends retain that policy unchanged. */
export function admittedHuntSourceScopes(scopes: readonly ResolvedScope[], now: string): readonly ResolvedScope[] {
  if (!scheduledBlackoutAt(now)) return scopes;
  return scopes.filter(scope => scope.kind === "RESOLVED" &&
    scope.decision.sourceWorkVersion === 1 && scope.decision.key === ORIGINAL_LIFETIME_HUNT.key &&
    scope.decision.receiptId === ORIGINAL_LIFETIME_HUNT.receiptId &&
    scope.decision.budgetStartedAt === ORIGINAL_LIFETIME_HUNT.budgetStartedAt &&
    scope.decision.budgetUsd === ORIGINAL_LIFETIME_HUNT.budgetUsd);
}

/** Only completed audits for an actual current Send reach this existing writer.
 * A retained publication receipt prevents unchanged re-publication. */
export function workerRosterSourceTasks(scopes: readonly ResolvedScope[], items: readonly WorkItem[], results: readonly WorkerResultRecord[], now: string): RoutineSourceTask[] {
  const current = new Set(scopes.filter(scope => scope.kind === "RESOLVED" && scope.decision.sourceWorkVersion === 1)
    .map(scope => scope.decision.receiptId));
  const owed = items.flatMap(item => {
    const target = item.autonomousPlan?.publication?.contractId;
    if (!target || (target !== "registry-runtime-bindings" && !isWorkerReaderContract(target))) return [];
    const instructions = (item.autonomousPlan.ownerInstructions ?? []).filter(id => current.has(id));
    if (!instructions.length) return [];
    const latest = results.filter(record => record.workItemId === item.id && record.result.role === "ADVERSARIAL_AUDITOR")
      .sort((a, b) => b.endedAt.localeCompare(a.endedAt) || b.id.localeCompare(a.id))[0];
    if (!latest || latest.result.verdict !== "SURVIVED" || Date.parse(latest.endedAt) > Date.parse(now) ||
      (item.publicationOutcome?.workerResultId === latest.id && item.publicationOutcome.code !== "ROSTER_READER_IDENTITY_UNRESOLVED" &&
        (item.publicationOutcome.recovery !== "PUBLISHER" || Date.parse(now) - Date.parse(item.publicationOutcome.at) < 15 * 60_000))) return [];
    return [{ item, latest, instructions }];
  });
  if (!owed.length) return [];
  return [...new Set(owed.map(row => row.item.autonomousPlan!.publication!.contractId))].map(id => {
  const group = owed.filter(row => row.item.autonomousPlan!.publication!.contractId === id);
  const contract = requiredManualProductionContract(id);
  return { id: contract.id, sourceId: contract.sourceId, recordClass: contract.recordClass, scope: contract.scope,
    acquisitionFailureDomain: `routine-source:${contract.sourceId}`, requestedUrl: "", authorityMode: "REGISTERED_SOURCE_ROUTES",
    parserVersion: contract.parserNormalizerVersion, command: [...contract.command, `--${id === "registry-runtime-bindings" ? "worker-rosters" : "worker-results"}=${group.map(row => row.item.id).sort().join(",")}`],
    cadenceMs: Number.POSITIVE_INFINITY, retryMs: 15 * 60_000,
    contract: { readerProjection: contract.readerProjection, cadence: { description: "Publish newly completed independent verification for the owner's Send", defaultEveryMs: Number.POSITIVE_INFINITY } },
    ownerInvocation: { publicationPending: true, requestedAt: group.map(row => row.latest.endedAt).sort().at(-1)!, instructions: [...new Set(group.flatMap(row => row.instructions))] } };
  });
}

export function huntSourceTasks(scopes: readonly ResolvedScope[], now: string, items: readonly WorkItem[] = []): RoutineSourceTask[] {
  const original = scopes.find((scope) => scope.kind === "RESOLVED" &&
    scope.decision.sourceWorkVersion === 1 && scope.decision.key === ORIGINAL_LIFETIME_HUNT.key &&
    scope.decision.receiptId === ORIGINAL_LIFETIME_HUNT.receiptId &&
    scope.decision.budgetStartedAt === ORIGINAL_LIFETIME_HUNT.budgetStartedAt &&
    scope.decision.budgetUsd === ORIGINAL_LIFETIME_HUNT.budgetUsd);
  const officialActions = original ? (() => {
    const task = routineTaskFromContract(requiredRoutineContract("az-governor-executive-orders"));
    return [{ ...task, cadenceMs: Number.POSITIVE_INFINITY,
      ownerInvocation: { requestedAt: original.decision.decidedAt, instructions: [original.decision.receiptId] },
    }];
  })() : [];
  return [...officialActions, ...manualProducerInvocationMatrix(scopes, now, items).filter(row => row.commandReady).flatMap(row => {
    const applicable = scopes.filter(scope => row.instructionIds.includes(scope.decision.receiptId));
    const contract = requiredManualProductionContract(row.id);
    return [{
      id: row.id === "voting-sites" ? "voting-sites:cochise-2026" : row.id,
      sourceId: contract.sourceId, recordClass: contract.recordClass, scope: contract.scope,
      acquisitionFailureDomain: `routine-source:${contract.sourceId}`,
      requestedUrl: row.id === "voting-sites" ? COCHISE_VOTE_CENTERS_URL : "", authorityMode: "REGISTERED_SOURCE_ROUTES" as const,
      parserVersion: contract.parserNormalizerVersion, command: row.id === "voting-sites" ? [...contract.command, "--cochise-only"] : contract.command,
      cadenceMs: Number.POSITIVE_INFINITY, retryMs: 15 * 60_000,
      contract: { readerProjection: contract.readerProjection, cadence: { description: "One verified refresh for the owner's Send; no new standing schedule", defaultEveryMs: Number.POSITIVE_INFINITY } },
      ownerInvocation: {
        requestedAt: applicable.map(scope => scope.decision.decidedAt).sort().at(-1)!,
        instructions: [...new Set(applicable.map(scope => scope.decision.receiptId))],
      },
    }];
  })];
}
