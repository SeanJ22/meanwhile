import { requiredManualProductionContract } from "./manual-contracts.ts";
import type { RoutineSourceTask } from "./runner.ts";
import type { WorkItem } from "../control-plane/work-item.ts";
import type { WorkerResultRecord } from "../control-plane/workers/types.ts";
import { isWorkerReaderContract } from "./worker-reader-contracts.ts";
import { auditPull, latestParserResult } from "./worker-publication-evidence.ts";
import type { RoutineDataStore } from "./store.ts";
import { ZERO_RELEASE_EVENTS } from "./release.ts";

const HOUR = 3_600_000;

/**
 * Which owed work items the publisher should try now (§3). A work item with a
 * reader door is offered when it holds an extraction not yet published, or —
 * for rosters and body directories — hourly, so saved official pages from any
 * job are read in code.
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
      // ...unless the Auditor broke it after that publication: then it is re-checked once.
      const pull = auditPull(results, parser);
      if (outcome?.workerResultId === parser.id && (outcome.status !== "HELD" || outcome.recovery === "WORKER") && !(pull && pull.at > outcome.at)) return [];
      return [{ item, requestedAt: parser.endedAt }];
    }
    // No extraction yet: a roster or a body directory can still be read in code from saved official pages.
    if (target !== "registry-runtime-bindings" || !["OFFICIAL_ROSTER", "OFFICIAL_BOARD_DIRECTORY"].includes(plan.contract.recordClass)) return [];
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

/**
 * The one runner receipt line for a publication pass: the last version this
 * pass promoted (or confirmed unchanged), read back from the store it was
 * written to. A pass that published nothing prints none and exits non-zero,
 * so the runner records that nothing went live.
 */
export async function printWorkerPublicationReceipt(store: Pick<RoutineDataStore, "readCandidate">, source: string,
  report: readonly { readonly workItemId: string; readonly outcome: NonNullable<WorkItem["publicationOutcome"]> }[],
  /** Anything else this pass published outside work items (the national place publisher), with its gaps. */
  extra: { readonly records: number; readonly versionId: string | null; readonly candidateId: string | null; readonly gaps: readonly { readonly key: string; readonly detail: string }[] } | null = null): Promise<boolean> {
  const delivered = publicationDelivery(report, extra);
  const last = [...report.filter(row => row.outcome.status !== "HELD" && row.outcome.versionId).map(row => row.outcome),
    ...(extra?.versionId ? [{ at: "", candidateId: extra.candidateId, versionId: extra.versionId }] : [])].at(-1);
  const created = last?.candidateId ? await store.readCandidate(last.candidateId) : null;
  const record = created ?? (last?.versionId ? await store.readCandidate(last.versionId) : null);
  if (!last || !record) { process.exitCode = 2; return false; }
  console.log("RCD_RECEIPT=" + JSON.stringify({ source, candidateId: record.candidate.id, acquisitionSucceeded: record.acquisitionSucceeded,
    state: record.state, decision: record.receipt?.decision ?? null, promotedVersion: last.versionId, lastKnownGoodVersion: record.lastKnownGoodVersion,
    ...(created ? {} : { confirmedAt: last.at || new Date().toISOString() }), delivered, structuralReleaseContract: ZERO_RELEASE_EVENTS }));
  return true;
}

/**
 * What a publication pass actually put in front of readers, and what stayed
 * owed with its reason — so a promoted version is never read as delivery.
 */
export function publicationDelivery(
  report: readonly { readonly workItemId: string; readonly outcome: NonNullable<WorkItem["publicationOutcome"]> }[],
  extra: { readonly records: number; readonly gaps: readonly { readonly key: string; readonly detail: string }[] } | null = null,
): { readonly records: number; readonly gaps: number; readonly gapReasons: Readonly<Record<string, number>> } {
  const live = report.filter(row => row.outcome.status !== "HELD" && row.outcome.code !== "VERIFIED_RESULT_REUSED");
  const gaps = [...report.filter(row => row.outcome.status === "HELD").map(row => row.outcome.code), ...(extra?.gaps ?? []).map(gap => gap.detail.split(":")[0])];
  const gapReasons: Record<string, number> = {};
  for (const code of gaps) gapReasons[code] = (gapReasons[code] ?? 0) + 1;
  return { records: live.reduce((sum, row) => sum + (row.outcome.acceptedRecordIds?.length ?? row.outcome.bodyIds?.length ?? 0), 0) + (extra?.records ?? 0),
    gaps: gaps.length, gapReasons };
}
