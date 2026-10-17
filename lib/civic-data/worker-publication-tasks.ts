import { stateFromRegistryRuntimeContractId, type StateRegistryContractId } from "./state-scopes.ts";
import { parseStateBallotContractId } from "./state-scopes.ts";
import { requiredManualProductionContract } from "./manual-contracts.ts";
import type { RoutineSourceTask } from "./runner.ts";
import type { WorkItem } from "../control-plane/work-item.ts";
import type { WorkerResultRecord } from "../control-plane/workers/types.ts";
import { COMMENT_RULE_PUBLICATION, isWorkerReaderContract, type WorkerReaderContract } from "./worker-reader-contracts.ts";
import { auditPull, latestParserResult } from "./worker-publication-evidence.ts";
import type { RoutineDataStore } from "./store.ts";
import { ZERO_RELEASE_EVENTS } from "./release.ts";

const HOUR = 3_600_000;
/** Held ballot routes checked by one publication child; its ids travel on one command line. */
export const HELD_BALLOT_BATCH = 100;

/** Admission needs identities and acknowledgement fields, never the work item's acquisition history. */
export type WorkerPublicationItem = Pick<WorkItem, "id"> & {
  readonly subject?: string;
  readonly publicationOutcome?: Pick<NonNullable<WorkItem["publicationOutcome"]>, "workerResultId" | "status" | "at" | "recovery" | "sourceObservedAt"> &
    Partial<Pick<NonNullable<WorkItem["publicationOutcome"]>, "code">>;
  readonly autonomousPlan?: {
    readonly publication?: Pick<NonNullable<NonNullable<WorkItem["autonomousPlan"]>["publication"]>, "contractId"> & { readonly bodyId?: string };
    readonly contract: Pick<NonNullable<WorkItem["autonomousPlan"]>["contract"], "recordClass">;
  };
};

/** The classes that publish as facts in the runner's own pass rather than through a contract's command. */
const factClass = (item: WorkerPublicationItem): "rosters" | "comments" | null =>
  stateFromRegistryRuntimeContractId(item.autonomousPlan?.publication?.contractId ?? "") && item.autonomousPlan?.contract.recordClass === "OFFICIAL_ROSTER" ? "rosters"
    : item.autonomousPlan?.publication?.contractId === COMMENT_RULE_PUBLICATION ? "comments" : null;

/** When each input a held publication is read from last changed: its place's or body's saved pages, the national office list, the registry and the published routes. */
export interface HeldInputs {
  readonly pagesAt: ReadonlyMap<string, string>;
  readonly bodyPagesAt: ReadonlyMap<string, string>;
  readonly nationalAt: string | null;
  readonly registryAt: string | null;
  readonly routesAt: string | null;
}

/* Outcomes only the government's own pages can change; any other hold is in our registry or publication step. */
const CONTENT_CODES = new Set(["ELECTION_OFFICE_NOT_ON_SAVED_PAGES", "ELECTION_OFFICES_PUBLISHED", "VERIFIED_RESULT_REUSED"]);

/* A held route is read again only when something it was read from changed after its last outcome. */
function heldBallotInputsChanged(item: WorkerPublicationItem, inputs: HeldInputs): boolean {
  const outcome = item.publicationOutcome;
  if (!outcome || item.subject === undefined) return true;
  const content = CONTENT_CODES.has(outcome.code ?? "");
  const read = [inputs.pagesAt.get(item.subject) ?? null, inputs.nationalAt,
    ...(content ? [] : [inputs.registryAt]),
    ...(content || outcome.code === "CANONICAL_BODY_MISSING" ? [] : [inputs.routesAt])];
  return read.some(at => at !== null && at > outcome.at);
}

export function workerPublicationTasks(items: readonly WorkerPublicationItem[], results: readonly WorkerResultRecord[], now: string,
  heldInputs: HeldInputs | null = null): RoutineSourceTask[] {
  return workerPublicationTasksFor(owedWorkerPublications(items, results, now, heldInputs), now);
}

/** One owed publication: the item, when it was asked for, and whether it is a held ballot route read in a batch. */
export interface OwedWorkerPublication {
  readonly id: string;
  readonly contractId: StateRegistryContractId | WorkerReaderContract | typeof COMMENT_RULE_PUBLICATION;
  readonly requestedAt: string;
  readonly batch: boolean;
}

/** Owed publications that run through a contract's command; rosters and comment rules publish as facts instead. */
export function owedWorkerPublications(items: readonly WorkerPublicationItem[], results: readonly WorkerResultRecord[], now: string,
  heldInputs: HeldInputs | null = null): OwedWorkerPublication[] {
  return owedPublications(items.filter(item => factClass(item) === null), results, now, heldInputs);
}

function owedPublications(items: readonly WorkerPublicationItem[], results: readonly WorkerResultRecord[], now: string,
  heldInputs: HeldInputs | null = null): OwedWorkerPublication[] {
  const byItem = new Map<string, WorkerResultRecord[]>();
  for (const result of results) {
    const own = byItem.get(result.workItemId) ?? [];
    own.push(result);
    byItem.set(result.workItemId, own);
  }
  const nowMs = Date.parse(now);
  const hour = new Date(Math.floor(nowMs / HOUR) * HOUR).toISOString();
  return items.flatMap((item): OwedWorkerPublication[] => {
    const plan = item.autonomousPlan;
    const target = plan?.publication?.contractId;
    if (!plan || !target || (!stateFromRegistryRuntimeContractId(target) && target !== COMMENT_RULE_PUBLICATION && !isWorkerReaderContract(target))) return [];
    const contractId = target as OwedWorkerPublication["contractId"];
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
      return [{ id: item.id, contractId, requestedAt: parser.endedAt, batch: false }];
    }
    const heldReadable = stateFromRegistryRuntimeContractId(target) ? ["OFFICIAL_ROSTER", "OFFICIAL_BOARD_DIRECTORY"].includes(plan.contract.recordClass)
      : target === "ballot-navigation" && plan.contract.recordClass === "VOTER_ACCESS_ROUTE";
    if (!heldReadable) return [];
    if (target === "ballot-navigation" && heldInputs !== null) {
      return heldBallotInputsChanged(item, heldInputs) ? [{ id: item.id, contractId, requestedAt: hour, batch: true }] : [];
    }
    // A held roster or directory is read again only once a page for its body was saved after its last outcome.
    if (outcome && (heldInputs === null ? nowMs - Date.parse(outcome.at) < HOUR : !((heldInputs.bodyPagesAt.get(plan.publication?.bodyId ?? "") ?? "") > outcome.at))) return [];
    return [{ id: item.id, contractId, requestedAt: hour, batch: false }];
  });
}

export function owedFactItems(items: readonly WorkerPublicationItem[], results: readonly WorkerResultRecord[], now: string,
  heldInputs: HeldInputs | null = null): { rosters: string[]; comments: string[] } {
  const owed = { rosters: [] as string[], comments: [] as string[] };
  const facts = items.filter(item => factClass(item) !== null), byId = new Map(facts.map(item => [item.id, item]));
  for (const row of owedPublications(facts, results, now, heldInputs)) owed[factClass(byId.get(row.id)!)!].push(row.id);
  return owed;
}

/** Each owed publication as its own task, except held ballot routes, which share a child per batch. */
export function workerPublicationTasksFor(owed: readonly OwedWorkerPublication[], now: string): RoutineSourceTask[] {
  const hour = new Date(Math.floor(Date.parse(now) / HOUR) * HOUR).toISOString();
  const batched = owed.filter(row => row.batch).map(row => row.id);
  const batches = Array.from({ length: Math.ceil(batched.length / HELD_BALLOT_BATCH) }, (_, n) => batched.slice(n * HELD_BALLOT_BATCH, (n + 1) * HELD_BALLOT_BATCH))
    .map(ids => ({ ids, key: `held-pages:${ids[0]}`, requestedAt: hour, contractId: "ballot-navigation" as const }));
  return [...owed.filter(row => !row.batch).map(row => ({ ids: [row.id], key: row.id, requestedAt: row.requestedAt, contractId: row.contractId })), ...batches]
    .map(({ ids, key, requestedAt, contractId: id }) => {
      const contract = requiredManualProductionContract(id as Exclude<typeof id, typeof COMMENT_RULE_PUBLICATION>);
      const taskId = `worker-publication:${contract.id}:${key}`;
      const command = stateFromRegistryRuntimeContractId(id) || parseStateBallotContractId(id)?.family === "voting-sites" ? contract.command
        : ["scripts/promote-manual-civic-projection.mts", `--contract=${id}`];
      return { id: taskId, registeredContractId: contract.id, sourceId: contract.sourceId, recordClass: contract.recordClass, scope: contract.scope,
        acquisitionFailureDomain: taskId, requestedUrl: "", authorityMode: "REGISTERED_SOURCE_ROUTES",
        parserVersion: contract.parserNormalizerVersion,
        command: [...command, `--${stateFromRegistryRuntimeContractId(id) ? "worker-directories" : "worker-results"}=${ids.join(",")}`],
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
  const read = store.readCandidateSummary?.bind(store) ?? store.readCandidate.bind(store);
  let last: { readonly at: string; readonly candidateId?: string | null; readonly versionId?: string | null } | undefined =
    [...report.filter(row => row.outcome.status !== "HELD" && row.outcome.versionId && row.outcome.at === passAt).map(row => row.outcome),
      ...(extra?.versionId ? [{ at: "", candidateId: extra.candidateId, versionId: extra.versionId }] : [])].at(-1);
  if (!last && now && (report.length > 0 || (extra?.gaps.length ?? 0) > 0) && store.readPromotionIdentity) {
    const state = ballotNavigationTaskState(source);
    const contract = requiredManualProductionContract((state ? "ballot-navigation" : source) as Parameters<typeof requiredManualProductionContract>[0]);
    let scope = state ? ballotNavigationScope(state) : contract.scope;
    if (source === "ballot-navigation") {
      const knownId = report.map(row => row.outcome.candidateId ?? row.outcome.versionId).filter(Boolean).at(-1);
      const known = knownId ? await read(knownId) : null;
      if (!known || !ballotNavigationState(known.candidate.scope)) return null;
      scope = known.candidate.scope;
    }
    const pointer = await store.readPromotionIdentity(contract.recordClass, scope);
    // Named as the canonical candidate, never as a confirmation: only the store records a confirmation, and the runner re-proves this one.
    if (pointer) last = { at: now, candidateId: pointer.versionId, versionId: pointer.versionId };
  }
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
