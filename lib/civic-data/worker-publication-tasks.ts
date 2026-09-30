import { requiredManualProductionContract } from "./manual-contracts.ts";
import type { RoutineSourceTask } from "./runner.ts";
import type { WorkItem } from "../control-plane/work-item.ts";
import type { WorkerResultRecord } from "../control-plane/workers/types.ts";
import { isWorkerReaderContract } from "./worker-reader-contracts.ts";
import { latestParserResult } from "./worker-publication-evidence.ts";

const HOUR = 3_600_000;

/**
 * Which owed work items the publisher should try now (§3). A work item with a
 * reader door is offered when it holds an extraction not yet published, or —
 * for rosters — hourly, so saved official pages from any job are read in code.
 * No live Send, auditor or owner instruction is needed: publication is not
 * paid work, and verified facts reach readers within minutes.
 */
export function workerPublicationTasks(items: readonly WorkItem[], results: readonly WorkerResultRecord[], now: string): RoutineSourceTask[] {
  const nowMs = Date.parse(now);
  const hour = new Date(Math.floor(nowMs / HOUR) * HOUR).toISOString();
  const owed = items.flatMap(item => {
    const plan = item.autonomousPlan;
    const target = plan?.publication?.contractId;
    if (!plan || !target || (target !== "registry-runtime-bindings" && !isWorkerReaderContract(target))) return [];
    const outcome = item.publicationOutcome;
    const parser = latestParserResult(results, item.id);
    if (parser && Date.parse(parser.endedAt) <= nowMs) {
      // A published extraction, or a hold only new evidence can clear, waits for a newer extraction.
      if (outcome?.workerResultId === parser.id && (outcome.status !== "HELD" || outcome.recovery === "WORKER")) return [];
      return [{ item, requestedAt: parser.endedAt }];
    }
    // No extraction yet: a roster can still be read in code from saved official pages.
    if (target !== "registry-runtime-bindings" || plan.contract.recordClass !== "OFFICIAL_ROSTER") return [];
    if (outcome && nowMs - Date.parse(outcome.at) < HOUR) return [];
    return [{ item, requestedAt: hour }];
  });
  return [...new Set(owed.map(row => row.item.autonomousPlan!.publication!.contractId))].map(id => {
    const group = owed.filter(row => row.item.autonomousPlan!.publication!.contractId === id);
    const contract = requiredManualProductionContract(id);
    return { id: contract.id, sourceId: contract.sourceId, recordClass: contract.recordClass, scope: contract.scope,
      acquisitionFailureDomain: `routine-source:${contract.sourceId}`, requestedUrl: "", authorityMode: "REGISTERED_SOURCE_ROUTES",
      parserVersion: contract.parserNormalizerVersion,
      command: [...contract.command, `--${id === "registry-runtime-bindings" ? "worker-rosters" : "worker-results"}=${group.map(row => row.item.id).sort().join(",")}`],
      cadenceMs: Number.POSITIVE_INFINITY, retryMs: 15 * 60_000,
      contract: { readerProjection: contract.readerProjection, cadence: { description: "Publish owed work that now meets §3", defaultEveryMs: Number.POSITIVE_INFINITY } },
      ownerInvocation: { publicationPending: true, requestedAt: group.map(row => row.requestedAt).sort().at(-1)!, instructions: ["section3-publication"] } };
  });
}
