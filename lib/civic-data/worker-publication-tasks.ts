import { requiredManualProductionContract } from "./manual-contracts.ts";
import type { RoutineSourceTask } from "./runner.ts";
import type { WorkItem } from "../control-plane/work-item.ts";
import type { WorkerResultRecord } from "../control-plane/workers/types.ts";
import { COMMENT_RULE_PUBLICATION, isWorkerReaderContract } from "./worker-reader-contracts.ts";
import { auditPull, latestParserResult } from "./worker-publication-evidence.ts";
import type { RoutineDataStore } from "./store.ts";
import { ZERO_RELEASE_EVENTS } from "./release.ts";

const HOUR = 3_600_000;

/** Admission needs identities and acknowledgement fields, never the work item's acquisition history. */
export type WorkerPublicationItem = Pick<WorkItem, "id"> & {
  readonly publicationOutcome?: Pick<NonNullable<WorkItem["publicationOutcome"]>, "workerResultId" | "status" | "at" | "recovery" | "sourceObservedAt">;
  readonly autonomousPlan?: {
    readonly publication?: Pick<NonNullable<NonNullable<WorkItem["autonomousPlan"]>["publication"]>, "contractId">;
    readonly contract: Pick<NonNullable<WorkItem["autonomousPlan"]>["contract"], "recordClass">;
  };
};

/** The classes that publish as facts in the runner's own pass rather than through a contract's command. */
const factClass = (item: WorkerPublicationItem): "rosters" | "comments" | null =>
  item.autonomousPlan?.publication?.contractId === "registry-runtime-bindings" && item.autonomousPlan.contract.recordClass === "OFFICIAL_ROSTER" ? "rosters"
    : item.autonomousPlan?.publication?.contractId === COMMENT_RULE_PUBLICATION ? "comments" : null;

/** Work items whose newest extraction or saved page has not been published yet. */
function owedPublications(items: readonly WorkerPublicationItem[], results: readonly WorkerResultRecord[], now: string): { readonly item: WorkerPublicationItem; readonly requestedAt: string }[] {
  const byItem = new Map<string, WorkerResultRecord[]>();
  for (const result of results) {
    const own = byItem.get(result.workItemId) ?? [];
    own.push(result);
    byItem.set(result.workItemId, own);
  }
  const nowMs = Date.parse(now);
  const hour = new Date(Math.floor(nowMs / HOUR) * HOUR).toISOString();
  return items.flatMap(item => {
    const plan = item.autonomousPlan;
    const target = plan?.publication?.contractId;
    if (!plan || !target || (target !== "registry-runtime-bindings" && !isWorkerReaderContract(target))) return [];
    const outcome = item.publicationOutcome;
    const ownResults = byItem.get(item.id) ?? [];
    const parser = latestParserResult(ownResults, item.id);
    if (parser && Date.parse(parser.endedAt) <= nowMs) {
            // A published extraction, or a hold only new evidence can clear, waits for a newer extraction,
            // unless the Auditor broke it after that publication: then it is re-checked once.
      const pull = auditPull(ownResults, parser);
      const published = outcome?.workerResultId === parser.id || outcome?.workerResultId.startsWith(`${parser.id}+`);
      const publicationStillOwed = outcome?.recovery === "PUBLISHER" ||
        (outcome?.status === "PARTIALLY_PUBLISHED" && plan.contract.recordClass === "BALLOT_MEASURE") ||
        (outcome?.status !== "HELD" && !outcome?.sourceObservedAt);
      if (outcome && published && !publicationStillOwed && (outcome.status !== "HELD" || outcome.recovery === "WORKER") && !(pull && pull.at > outcome.at)) return [];
      return [{ item, requestedAt: parser.endedAt }];
    }
    const heldReadable = target === "registry-runtime-bindings" ? ["OFFICIAL_ROSTER", "OFFICIAL_BOARD_DIRECTORY"].includes(plan.contract.recordClass)
      : target === "ballot-navigation" && plan.contract.recordClass === "VOTER_ACCESS_ROUTE";
    if (!heldReadable) return [];
    if (outcome && nowMs - Date.parse(outcome.at) < HOUR) return [];
    return [{ item, requestedAt: hour }];
  });
}

export function owedFactItems(items: readonly WorkerPublicationItem[], results: readonly WorkerResultRecord[], now: string): { rosters: string[]; comments: string[] } {
  const owed = { rosters: [] as string[], comments: [] as string[] };
  for (const { item } of owedPublications(items.filter(item => factClass(item) !== null), results, now)) owed[factClass(item)!].push(item.id);
  return owed;
}

export function workerPublicationTasks(items: readonly WorkerPublicationItem[], results: readonly WorkerResultRecord[], now: string): RoutineSourceTask[] {
  return owedPublications(items.filter(item => factClass(item) === null), results, now).map(({ item, requestedAt }) => {
    const id = item.autonomousPlan!.publication!.contractId as Exclude<NonNullable<NonNullable<WorkerPublicationItem["autonomousPlan"]>["publication"]>["contractId"], typeof COMMENT_RULE_PUBLICATION>;
    const contract = requiredManualProductionContract(id);
    const taskId = `worker-publication:${contract.id}:${item.id}`;
    return { id: taskId, registeredContractId: contract.id, sourceId: contract.sourceId, recordClass: contract.recordClass, scope: contract.scope,
      acquisitionFailureDomain: taskId, requestedUrl: "", authorityMode: "REGISTERED_SOURCE_ROUTES",
      parserVersion: contract.parserNormalizerVersion,
      command: [...contract.command, `--${id === "registry-runtime-bindings" ? "worker-directories" : "worker-results"}=${item.id}`],
      cadenceMs: Number.POSITIVE_INFINITY, retryMs: 15 * 60_000,
      contract: { readerProjection: contract.readerProjection, cadence: { description: "Publish owed work that now meets §3", defaultEveryMs: Number.POSITIVE_INFINITY } },
      ownerInvocation: { publicationPending: true, requestedAt, instructions: ["section3-publication"] } };
  });
}

export async function workerPublicationReceipt(store: Pick<RoutineDataStore, "readCandidate"> & Partial<Pick<RoutineDataStore, "readPromotionIdentity" | "readCandidateSummary">>, source: string,
  report: readonly { readonly workItemId: string; readonly outcome: NonNullable<WorkItem["publicationOutcome"]> }[],
  extra: { readonly records: number; readonly versionId: string | null; readonly candidateId: string | null; readonly gaps: readonly { readonly key: string; readonly detail: string }[] } | null = null,
  now?: string) {
  const delivered = publicationDelivery(report, extra, now);
  const passAt = now ?? report.map(row => row.outcome.at).sort().at(-1);
  let last: { readonly at: string; readonly candidateId?: string | null; readonly versionId?: string | null } | undefined =
    [...report.filter(row => row.outcome.status !== "HELD" && row.outcome.versionId && row.outcome.at === passAt).map(row => row.outcome),
      ...(extra?.versionId ? [{ at: "", candidateId: extra.candidateId, versionId: extra.versionId }] : [])].at(-1);
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

export async function printWorkerPublicationReceipt(...args: Parameters<typeof workerPublicationReceipt>): Promise<boolean> {
  const receipt = await workerPublicationReceipt(...args);
  if (!receipt) { process.exitCode = 2; return false; }
  console.log("RCD_RECEIPT=" + JSON.stringify(receipt));
  return true;
}

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
