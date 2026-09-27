import type { ResolvedScope } from "../control-plane/expansion/membership.ts";
import { requiredManualProductionContract, type ManualProductionContractId } from "./manual-contracts.ts";
import type { RoutineSourceTask } from "./runner.ts";
import type { WorkItem } from "../control-plane/work-item.ts";
import type { WorkerResultRecord } from "../control-plane/workers/types.ts";
import { isWorkerReaderContract } from "./worker-reader-contracts.ts";

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
      (item.publicationOutcome?.workerResultId === latest.id &&
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
