import type { IndependentRuntimeLane } from "../ops/independent-runtime-pass.ts";
import type { RoutineSourceTask } from "./runner.ts";
import type { WorkerResultRecord } from "../control-plane/workers/types.ts";
import type { DoorRecord } from "../doors/registry.ts";
import { doorPartitionIds } from "../doors/mission-refresh.ts";
import { owedFactItems, owedWorkerPublications, workerPublicationTasks, workerPublicationTasksFor, type HeldBallotInputs, type OwedWorkerPublication, type WorkerPublicationItem } from "./worker-publication-tasks.ts";
import { AGGREGATE_LIST_READ_PAGE } from "../control-plane/repository/pg-store.ts";
import { WORKER_PUBLICATION_TASK_IDS } from "./worker-reader-contracts.ts";
import type { ReaderEdgePublicationOutcome } from "./reader-edge-outcome.ts";

export const PUBLISH_NOW_INTERVAL_MS = 60_000;
/** A publish-now pass starts no new child after this long; children already running finish. */
export const PUBLISH_NOW_PASS_BUDGET_MS = 10 * 60_000;
export const PUBLISH_NOW_SINGLETON_PORT = 49_373;
export function publishNowLane(run: () => Promise<void>): IndependentRuntimeLane {
  return { id: "publish-now", everyMs: PUBLISH_NOW_INTERVAL_MS, run };
}

/** An unchanged minute with no source work ends quietly; a copied pointer or failed copy still owes its existing supervisor receipt. */
export function publishNowHasNothingOwed(publishNow: boolean, selectedTasks: number, failures: number, edge: ReaderEdgePublicationOutcome): boolean {
  return publishNow && selectedTasks === 0 && failures === 0 && edge.ok &&
    (edge.readerEdge === "CURRENT" || edge.readerEdge === "SKIPPED_OWNER_PAUSE");
}

/** Keep the existing publication minute moving during a long outbox pass. Concurrent ticks share one sweep. */
export function startPublishNowEdgeChecks(input: {
  readonly check: () => Promise<ReaderEdgePublicationOutcome>;
  readonly readPaused: () => Promise<boolean>;
  readonly store: ReaderEdgePublicationOutcome["store"];
  readonly onError: (error: unknown) => void;
  readonly schedule?: (tick: () => void, everyMs: number) => () => void;
}): { run: () => Promise<ReaderEdgePublicationOutcome>; stop: () => Promise<ReaderEdgePublicationOutcome | null> } {
  const schedule = input.schedule ?? ((tick, everyMs) => {
    const timer = setInterval(tick, everyMs);
    timer.unref();
    return () => clearInterval(timer);
  });
  let inFlight: Promise<ReaderEdgePublicationOutcome> | null = null;
  let outcome: ReaderEdgePublicationOutcome | null = null;
  let stopped = false;
  const run = (): Promise<ReaderEdgePublicationOutcome> => {
    if (inFlight) return inFlight;
    inFlight = Promise.resolve().then(async (): Promise<ReaderEdgePublicationOutcome> => await input.readPaused()
      ? { ok: true, readerEdge: "SKIPPED_OWNER_PAUSE", store: input.store, sequence: null,
        detail: "The owner paused publication; no source pointers were copied." }
      : input.check()).catch((error): ReaderEdgePublicationOutcome => {
      input.onError(error);
      return { ok: false, readerEdge: "FAILED", store: input.store, sequence: outcome?.sequence ?? null,
        detail: "The publication check could not read its owner control or copy source pointers; retry remains owed." };
    }).then(next => {
      // A quiet later check must not erase an earlier publication or failure from this pass's receipt.
      if (!["CURRENT", "SKIPPED_OWNER_PAUSE"].includes(next.readerEdge) || outcome === null ||
          ["CURRENT", "SKIPPED_OWNER_PAUSE"].includes(outcome.readerEdge)) outcome = next;
      return next;
    }).finally(() => { inFlight = null; });
    return inFlight;
  };
  const cancel = schedule(() => { if (!stopped) void run().catch(input.onError); }, PUBLISH_NOW_INTERVAL_MS);
  return { run, stop: async () => { stopped = true; cancel(); if (inFlight) await inFlight; return outcome; } };
}

/** Parser results and held-page fallbacks share this outbox; publicationOutcome keeps each retry clock durable. */
export function publishNowWorkerTasks(items: readonly WorkerPublicationItem[], results: readonly WorkerResultRecord[], now: string): RoutineSourceTask[] {
  return workerPublicationTasks(items, results, now);
}

/** The publication outbox reads only its registered work and acknowledgement scalars, before transfer. */
export async function readWorkerPublicationItems(
  query: (sql: string, parameters: readonly unknown[]) => Promise<readonly Record<string, unknown>[]>,
  contractIds: readonly string[] = WORKER_PUBLICATION_TASK_IDS,
): Promise<WorkerPublicationItem[]> {
  const registered = new Set(WORKER_PUBLICATION_TASK_IDS);
  if (contractIds.some(id => !registered.has(id))) throw new Error("PUBLICATION_CONTRACT_SELECTION_INVALID");
  if (contractIds.length === 0) return [];
  const items: WorkerPublicationItem[] = [];
  let afterId: string | null = null;
  for (;;) {
    const rows = await query(`SELECT id, value #>> '{subject}' AS subject,
      value #>> '{autonomousPlan,publication,contractId}' AS contract_id,
      value #>> '{autonomousPlan,contract,recordClass}' AS record_class,
      CASE WHEN jsonb_typeof(value->'publicationOutcome') = 'object' THEN jsonb_strip_nulls(jsonb_build_object(
        'workerResultId', value #> '{publicationOutcome,workerResultId}',
        'status', value #> '{publicationOutcome,status}',
        'at', value #> '{publicationOutcome,at}',
        'recovery', value #> '{publicationOutcome,recovery}',
        'sourceObservedAt', value #> '{publicationOutcome,sourceObservedAt}',
        'code', value #> '{publicationOutcome,code}'
      )) ELSE NULL END AS publication_outcome
      FROM cp_work_items_history
      WHERE value #>> '{autonomousPlan,publication,contractId}' = ANY($1::text[])
        ${afterId === null ? "" : "AND id > $2"}
      ORDER BY id ASC LIMIT ${AGGREGATE_LIST_READ_PAGE}`, afterId === null ? [contractIds] : [contractIds, afterId]);
    for (const row of rows) {
      if (typeof row.id !== "string" || typeof row.contract_id !== "string" || !contractIds.includes(row.contract_id) ||
          typeof row.record_class !== "string" || !row.record_class.trim()) throw new Error("PUBLICATION_WORK_ITEM_METADATA_INVALID");
      items.push({ id: row.id, ...(typeof row.subject === "string" ? { subject: row.subject } : {}), autonomousPlan: {
        publication: { contractId: row.contract_id as NonNullable<NonNullable<WorkerPublicationItem["autonomousPlan"]>["publication"]>["contractId"] },
        contract: { recordClass: row.record_class },
      }, ...(row.publication_outcome === null || row.publication_outcome === undefined ? {}
        : { publicationOutcome: row.publication_outcome as WorkerPublicationItem["publicationOutcome"] }) });
    }
    if (rows.length < AGGREGATE_LIST_READ_PAGE) return items;
    const next = items.at(-1)!.id;
    if (afterId !== null && next <= afterId) throw new Error("PUBLICATION_WORK_ITEM_PAGE_NOT_ADVANCING");
    afterId = next;
  }
}

/** Keep only task descriptors across pages; source documents and completion evidence stay with each existing repository page. */
export async function readPublishNowWorkerTasks(
  items: readonly WorkerPublicationItem[],
  readCompleted: (workItemIds: readonly string[]) => Promise<readonly WorkerResultRecord[]>,
  now: string,
  heldInputs: HeldBallotInputs | null = null,
): Promise<RoutineSourceTask[]> {
  const owed: OwedWorkerPublication[] = [];
  for (let at = 0; at < items.length; at += AGGREGATE_LIST_READ_PAGE) {
    const page = items.slice(at, at + AGGREGATE_LIST_READ_PAGE);
    owed.push(...owedWorkerPublications(page, await readCompleted(page.map(item => item.id)), now, heldInputs));
  }
  return workerPublicationTasksFor(owed, now);
}

/** Rosters and comment rules owed publication as facts, read a page of completion evidence at a time. */
export async function readOwedFactItems(
  items: readonly WorkerPublicationItem[],
  readCompleted: (workItemIds: readonly string[]) => Promise<readonly WorkerResultRecord[]>,
  now: string,
): Promise<{ rosters: string[]; comments: string[] }> {
  const owed = { rosters: [] as string[], comments: [] as string[] };
  for (let at = 0; at < items.length; at += AGGREGATE_LIST_READ_PAGE) {
    const page = items.slice(at, at + AGGREGATE_LIST_READ_PAGE);
    const found = owedFactItems(page, await readCompleted(page.map(item => item.id)), now);
    owed.rosters.push(...found.rosters);
    owed.comments.push(...found.comments);
  }
  return owed;
}

export function publishNowDoorTasks(doors: readonly DoorRecord[], tasks: readonly RoutineSourceTask[], now: string): RoutineSourceTask[] {
  const requests = new Map<string, string>();
  for (const door of doors) {
    const at = door.validators?.changedAt;
    if (door.status !== "OPEN" || !at || !Number.isFinite(Date.parse(at)) || Date.parse(at) > Date.parse(now) ||
      (door.lastSuccessAt !== null && Date.parse(door.lastSuccessAt) >= Date.parse(at))) continue;
    for (const id of doorPartitionIds(door)) if (!requests.has(id) || requests.get(id)! < at) requests.set(id, at);
  }
  return tasks.flatMap(task => {
    const requestedAt = requests.get(task.id);
    return requestedAt ? [{ ...task, ownerInvocation: { publicationPending: true, requestedAt,
      instructions: ["publish-now:source-changed"] } }] : [];
  });
}
