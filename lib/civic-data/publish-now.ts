import type { IndependentRuntimeLane } from "../ops/independent-runtime-pass.ts";
import type { RoutineSourceTask } from "./runner.ts";
import type { WorkerResultRecord } from "../control-plane/workers/types.ts";
import type { DoorRecord } from "../doors/registry.ts";
import { doorPartitionIds } from "../doors/mission-refresh.ts";
import { owedFactItems, owedWorkerPublications, workerPublicationTasks, workerPublicationTasksFor, type HeldInputs, type OwedWorkerPublication, type WorkerPublicationItem } from "./worker-publication-tasks.ts";
import { AGGREGATE_LIST_READ_PAGE } from "../control-plane/repository/pg-store.ts";
import { WORKER_PUBLICATION_TASK_IDS } from "./worker-reader-contracts.ts";

export const PUBLISH_NOW_INTERVAL_MS = 60_000;
/** A publish-now pass ends within this; what it did not finish stays owed to the next minute. */
export const PUBLISH_NOW_PASS_BUDGET_MS = 10 * 60_000;
export const PUBLISH_NOW_SINGLETON_PORT = 49_373;
export function publishNowLane(run: (deadlineMs: number) => Promise<void>): IndependentRuntimeLane {
  return { id: "publish-now", everyMs: PUBLISH_NOW_INTERVAL_MS, budgetMs: PUBLISH_NOW_PASS_BUDGET_MS, run };
}

/** An unchanged minute with no source work ends quietly. */
export function publishNowHasNothingOwed(publishNow: boolean, selectedTasks: number, failures: number): boolean {
  return publishNow && selectedTasks === 0 && failures === 0;
}

/** Parser results and held-page fallbacks share this outbox; publicationOutcome keeps each retry clock durable. */
export function publishNowWorkerTasks(items: readonly WorkerPublicationItem[], results: readonly WorkerResultRecord[], now: string): RoutineSourceTask[] {
  return workerPublicationTasks(items, results, now);
}

/* Work changed since the cursor: the item itself, its worker results, or a page saved for its body or place;
   every held ballot route too when an input they all share moved. Each branch reads an index. */
const CHANGED_SINCE = `WITH due(id) AS (
    SELECT id FROM cp_work_items WHERE changed_at > $2::timestamptz
    UNION SELECT log_key FROM cp_log_worker_results WHERE changed_at > $2::timestamptz
    UNION SELECT p.id FROM cp_log_artifacts a JOIN cp_work_items s ON s.id = a.log_key
      JOIN cp_work_items p ON p.value #>> '{autonomousPlan,publication,bodyId}' = s.value #>> '{autonomousPlan,publication,bodyId}' WHERE a.changed_at > $2::timestamptz
    UNION SELECT p.id FROM cp_log_artifacts a JOIN cp_work_items s ON s.id = a.log_key
      JOIN cp_work_items p ON p.value #>> '{subject}' = s.value #>> '{subject}' WHERE a.changed_at > $2::timestamptz
    UNION SELECT id FROM cp_work_items WHERE $3::boolean AND value #>> '{autonomousPlan,publication,contractId}' = 'ballot-navigation')`;

/** The publication outbox reads only its registered work and acknowledgement scalars: everything on a first pass, then only what changed since `since`. */
export async function readWorkerPublicationItems(
  query: (sql: string, parameters: readonly unknown[]) => Promise<readonly Record<string, unknown>[]>,
  contractIds: readonly string[] = WORKER_PUBLICATION_TASK_IDS,
  since: { readonly at: string; readonly sharedInputsMoved: boolean } | null = null,
): Promise<WorkerPublicationItem[]> {
  const registered = new Set(WORKER_PUBLICATION_TASK_IDS);
  if (contractIds.some(id => !registered.has(id))) throw new Error("PUBLICATION_CONTRACT_SELECTION_INVALID");
  if (contractIds.length === 0) return [];
  const items: WorkerPublicationItem[] = [];
  let afterId: string | null = null;
  const window = since === null ? [] : [since.at, since.sharedInputsMoved];
  for (;;) {
    const rows = await query(`${since === null ? "" : CHANGED_SINCE} SELECT id, value #>> '{subject}' AS subject,
      value #>> '{autonomousPlan,publication,contractId}' AS contract_id,
      value #>> '{autonomousPlan,publication,bodyId}' AS body_id,
      value #>> '{autonomousPlan,contract,recordClass}' AS record_class,
      CASE WHEN jsonb_typeof(value->'publicationOutcome') = 'object' THEN jsonb_strip_nulls(jsonb_build_object(
        'workerResultId', value #> '{publicationOutcome,workerResultId}',
        'status', value #> '{publicationOutcome,status}',
        'at', value #> '{publicationOutcome,at}',
        'recovery', value #> '{publicationOutcome,recovery}',
        'sourceObservedAt', value #> '{publicationOutcome,sourceObservedAt}',
        'code', value #> '{publicationOutcome,code}'
      )) ELSE NULL END AS publication_outcome
      FROM cp_work_items
      WHERE value #>> '{autonomousPlan,publication,contractId}' = ANY($1::text[])
        ${since === null ? "" : "AND id IN (SELECT id FROM due)"} ${afterId === null ? "" : `AND id > $${2 + window.length}`}
      ORDER BY id ASC LIMIT ${AGGREGATE_LIST_READ_PAGE}`, [contractIds, ...window, ...(afterId === null ? [] : [afterId])]);
    for (const row of rows) {
      if (typeof row.id !== "string" || typeof row.contract_id !== "string" || !contractIds.includes(row.contract_id) ||
          typeof row.record_class !== "string" || !row.record_class.trim()) throw new Error("PUBLICATION_WORK_ITEM_METADATA_INVALID");
      items.push({ id: row.id, ...(typeof row.subject === "string" ? { subject: row.subject } : {}), autonomousPlan: {
        publication: { contractId: row.contract_id as NonNullable<NonNullable<WorkerPublicationItem["autonomousPlan"]>["publication"]>["contractId"],
          ...(typeof row.body_id === "string" ? { bodyId: row.body_id } : {}) },
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
  heldInputs: HeldInputs | null = null,
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
  heldInputs: HeldInputs | null = null,
): Promise<{ rosters: string[]; comments: string[] }> {
  const owed = { rosters: [] as string[], comments: [] as string[] };
  for (let at = 0; at < items.length; at += AGGREGATE_LIST_READ_PAGE) {
    const page = items.slice(at, at + AGGREGATE_LIST_READ_PAGE);
    const found = owedFactItems(page, await readCompleted(page.map(item => item.id)), now, heldInputs);
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
