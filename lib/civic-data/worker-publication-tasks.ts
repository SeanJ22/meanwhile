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
      // A roster publication names its reading as `<parser>+<schedule page>` when a saved schedule page attached.
      const published = outcome?.workerResultId === parser.id || outcome?.workerResultId.startsWith(`${parser.id}+`);
      if (outcome && published && (outcome.status !== "HELD" || outcome.recovery === "WORKER") && !(pull && pull.at > outcome.at)) return [];
      return [{ item, requestedAt: parser.endedAt }];
    }
    // No extraction yet: a roster, a body directory or a government's election offices can still be read in code from saved official pages.
    const heldReadable = target === "registry-runtime-bindings" ? ["OFFICIAL_ROSTER", "OFFICIAL_BOARD_DIRECTORY"].includes(plan.contract.recordClass)
      : target === "ballot-navigation" && plan.contract.recordClass === "VOTER_ACCESS_ROUTE";
    if (!heldReadable) return [];
    if (outcome && nowMs - Date.parse(outcome.at) < HOUR) return [];
    return [{ item, requestedAt: hour }];
  });
  return owed.map(({ item, requestedAt }) => {
    const id = item.autonomousPlan!.publication!.contractId;
    const contract = requiredManualProductionContract(id);
    const taskId = `worker-publication:${contract.id}:${item.id}`;
    return { id: taskId, registeredContractId: contract.id, sourceId: contract.sourceId, recordClass: contract.recordClass, scope: contract.scope,
      acquisitionFailureDomain: taskId, requestedUrl: "", authorityMode: "REGISTERED_SOURCE_ROUTES",
      parserVersion: contract.parserNormalizerVersion,
      command: [...contract.command, `--${id === "registry-runtime-bindings" ? "worker-rosters" : "worker-results"}=${item.id}`],
      cadenceMs: Number.POSITIVE_INFINITY, retryMs: 15 * 60_000,
      contract: { readerProjection: contract.readerProjection, cadence: { description: "Publish owed work that now meets §3", defaultEveryMs: Number.POSITIVE_INFINITY } },
      ownerInvocation: { publicationPending: true, requestedAt, instructions: ["section3-publication"] } };
  });
}

/**
 * The one runner receipt line for a publication pass: the last version this
 * pass promoted (or confirmed unchanged), read back from the store it was
 * written to. A pass with nothing new confirms the door's current version
 * with nothing delivered and its gaps counted; only a pass with no items or
 * no readable door prints none and exits non-zero.
 */
export async function workerPublicationReceipt(store: Pick<RoutineDataStore, "readCandidate"> & Partial<Pick<RoutineDataStore, "readPromotionIdentity" | "readCandidateSummary">>, source: string,
  report: readonly { readonly workItemId: string; readonly outcome: NonNullable<WorkItem["publicationOutcome"]> }[],
  /** Anything else this pass published outside work items (the national place publisher), with its gaps. */
  extra: { readonly records: number; readonly versionId: string | null; readonly candidateId: string | null; readonly gaps: readonly { readonly key: string; readonly detail: string }[] } | null = null,
  /** This pass's clock. An item already published reports its earlier outcome, whose version may no longer be current. */
  now?: string) {
  const delivered = publicationDelivery(report, extra, now);
  // Only this pass's own publications; a pass that only re-reports earlier ones published nothing.
  const passAt = now ?? report.map(row => row.outcome.at).sort().at(-1);
  let last: { readonly at: string; readonly candidateId?: string | null; readonly versionId?: string | null } | undefined =
    [...report.filter(row => row.outcome.status !== "HELD" && row.outcome.versionId && row.outcome.at === passAt).map(row => row.outcome),
      ...(extra?.versionId ? [{ at: "", candidateId: extra.candidateId, versionId: extra.versionId }] : [])].at(-1);
  // Nothing new this pass (items already published, or held with their reasons): the door confirms its current
  // version, delivering nothing and counting its gaps, so the runner records a finished pass rather than a failure.
  if (!last && now && (report.length > 0 || (extra?.gaps.length ?? 0) > 0) && store.readPromotionIdentity) {
    const contract = requiredManualProductionContract(source as Parameters<typeof requiredManualProductionContract>[0]);
    const pointer = await store.readPromotionIdentity(contract.recordClass, contract.scope);
    // Named as the canonical candidate, never as a confirmation: only the store records a confirmation, and the runner re-proves this one.
    if (pointer) last = { at: now, candidateId: pointer.versionId, versionId: pointer.versionId };
  }
  const read = store.readCandidateSummary?.bind(store) ?? store.readCandidate.bind(store);
  const created = last?.candidateId ? await read(last.candidateId) : null;
  const record = created ?? (last?.versionId ? await read(last.versionId) : null);
  if (!last || !record) return null;
  return { source, candidateId: record.candidate.id, acquisitionSucceeded: record.acquisitionSucceeded,
    state: record.state, decision: record.receipt?.decision ?? null, promotedVersion: last.versionId, lastKnownGoodVersion: record.lastKnownGoodVersion,
    ...(created ? {} : { confirmedAt: last.at || new Date().toISOString() }), delivered, structuralReleaseContract: ZERO_RELEASE_EVENTS };
}

/** CLI adapter only. In-process jobs return their own receipt without changing
 * another lane's exit status or writing into another job's output. */
export async function printWorkerPublicationReceipt(...args: Parameters<typeof workerPublicationReceipt>): Promise<boolean> {
  const receipt = await workerPublicationReceipt(...args);
  if (!receipt) { process.exitCode = 2; return false; }
  console.log("RCD_RECEIPT=" + JSON.stringify(receipt));
  return true;
}

/**
 * What a publication pass actually put in front of readers, and what stayed
 * owed with its reason — so a promoted version is never read as delivery.
 */
export function publicationDelivery(
  report: readonly { readonly workItemId: string; readonly outcome: NonNullable<WorkItem["publicationOutcome"]> }[],
  extra: { readonly records: number; readonly gaps: readonly { readonly key: string; readonly detail: string }[] } | null = null,
  now?: string,
): { readonly records: number; readonly gaps: number; readonly gapReasons: Readonly<Record<string, number>> } {
  const passAt = now ?? report.map(row => row.outcome.at).sort().at(-1);
  const live = report.filter(row => row.outcome.status !== "HELD" && row.outcome.code !== "VERIFIED_RESULT_REUSED" && row.outcome.at === passAt);
  const gaps = [...report.filter(row => row.outcome.status === "HELD").map(row => row.outcome.code), ...(extra?.gaps ?? []).map(gap => gap.detail.split(":")[0])];
  const gapReasons: Record<string, number> = {};
  for (const code of gaps) gapReasons[code] = (gapReasons[code] ?? 0) + 1;
  return { records: live.reduce((sum, row) => sum + (row.outcome.acceptedRecordIds?.length ?? row.outcome.bodyIds?.length ?? 0), 0) + (extra?.records ?? 0),
    gaps: gaps.length, gapReasons };
}
