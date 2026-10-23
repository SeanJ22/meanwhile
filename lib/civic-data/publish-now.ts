import type { IndependentRuntimeLane } from "../ops/independent-runtime-pass.ts";
import type { RoutineSourceTask } from "./runner.ts";
import type { WorkerResultRecord } from "../control-plane/workers/types.ts";
import type { DoorRecord } from "../doors/registry.ts";
import { doorPartitionIds } from "../doors/mission-refresh.ts";
import { owedFactItems, owedWorkerPublications, workerPublicationTasks, workerPublicationTasksFor, type HeldInputs, type OwedWorkerPublication, type WorkerPublicationItem } from "./worker-publication-tasks.ts";
import { AGGREGATE_LIST_READ_PAGE } from "../control-plane/repository/pg-store.ts";
import { WORKER_PUBLICATION_TASK_IDS } from "./worker-reader-contracts.ts";
import { stateFromRegistryRuntimeContractId } from "./state-scopes.ts";
import type { FactDb, Query } from "../facts/publish.ts";

export const PUBLISH_NOW_CURSOR = "publish-now";
const RETRY_CURSOR_PREFIX = `${PUBLISH_NOW_CURSOR}:retry:`;
export const PUBLISH_NOW_RETRY_MS = 15 * 60_000;

/** Unknown held inputs use the existing hourly fallback; its backoff must survive advancing the scan too. */
export function publishNowRetryItemIds(items: readonly WorkerPublicationItem[], owedItemIds: readonly string[], heldInputs: HeldInputs | null): string[] {
  const fallback = heldInputs === null ? items.filter(item => {
    const target = item.autonomousPlan?.publication?.contractId;
    const recordClass = item.autonomousPlan?.contract.recordClass;
    return stateFromRegistryRuntimeContractId(target ?? "") ? recordClass === "OFFICIAL_ROSTER" || recordClass === "OFFICIAL_BOARD_DIRECTORY"
      : target === "ballot-navigation" && recordClass === "VOTER_ACCESS_ROUTE";
  }).map(item => item.id) : [];
  return [...new Set([...owedItemIds, ...fallback])];
}

/** A failed or unstarted item has its own persisted retry clock, independent of the changed-since window. */
export async function readPublishNowRetryIds(query: Query, now: string): Promise<string[]> {
  const ids: string[] = [];
  let after = RETRY_CURSOR_PREFIX;
  for (;;) {
    const rows = await query(`SELECT name FROM pass_cursor WHERE name > $1 AND name < $2 AND position <= $3
      ORDER BY name LIMIT ${AGGREGATE_LIST_READ_PAGE}`, [after, `${PUBLISH_NOW_CURSOR}:retry;`, now]);
    for (const row of rows) {
      if (typeof row.name !== "string" || !row.name.startsWith(RETRY_CURSOR_PREFIX) || row.name <= after) {
        throw new Error("PUBLISH_NOW_RETRY_PAGE_INVALID");
      }
      ids.push(row.name.slice(RETRY_CURSOR_PREFIX.length));
    }
    if (rows.length < AGGREGATE_LIST_READ_PAGE) return ids;
    const next = String(rows.at(-1)!.name);
    if (next <= after) throw new Error("PUBLISH_NOW_RETRY_PAGE_NOT_ADVANCING");
    after = next;
  }
}

/**
 * Save every owed item before executing it, then advance the scan to `scannedThrough` (the pass start when the scan
 * caught up) in the same transaction. A crash after this
 * point leaves the item owed on its own clock; a failed save leaves the previous scan position intact.
 * The next read clears a retry only after publication admission says that item is no longer owed.
 */
export async function savePublishNowProgress(db: FactDb, input: {
  readonly startedAt: string;
  readonly selectedItemIds: readonly string[];
  readonly owedItemIds: readonly string[];
  readonly scannedThrough?: string;
}): Promise<void> {
  const at = Date.parse(input.startedAt);
  const position = input.scannedThrough ?? input.startedAt;
  if (!Number.isFinite(at) || new Date(at).toISOString() !== input.startedAt) throw new Error("PUBLISH_NOW_PROGRESS_TIME_INVALID");
  if (new Date(Date.parse(position)).toISOString() !== position || position > input.startedAt) throw new Error("PUBLISH_NOW_PROGRESS_TIME_INVALID");
  const selected = new Set(input.selectedItemIds);
  const owed = new Set(input.owedItemIds);
  if ([...selected, ...owed].some(id => !id.trim()) || [...owed].some(id => !selected.has(id))) {
    throw new Error("PUBLISH_NOW_PROGRESS_ITEM_INVALID");
  }
  const pending = [...owed].map(id => RETRY_CURSOR_PREFIX + id);
  const settled = [...selected].filter(id => !owed.has(id)).map(id => RETRY_CURSOR_PREFIX + id);
  const next = new Date(at + PUBLISH_NOW_RETRY_MS).toISOString();
  await db.transaction(async query => {
    for (let offset = 0; offset < pending.length; offset += AGGREGATE_LIST_READ_PAGE) {
      await query(`INSERT INTO pass_cursor (name, position) SELECT unnest($1::text[]), $2
        ON CONFLICT (name) DO UPDATE SET position = EXCLUDED.position WHERE pass_cursor.position <= $3`,
      [pending.slice(offset, offset + AGGREGATE_LIST_READ_PAGE), next, input.startedAt]);
    }
    for (let offset = 0; offset < settled.length; offset += AGGREGATE_LIST_READ_PAGE) {
      await query("DELETE FROM pass_cursor WHERE name = ANY($1::text[])", [settled.slice(offset, offset + AGGREGATE_LIST_READ_PAGE)]);
    }
    await query(`INSERT INTO pass_cursor (name, position) VALUES ($1, $2)
      ON CONFLICT (name) DO UPDATE SET position = greatest(pass_cursor.position, EXCLUDED.position)`, [PUBLISH_NOW_CURSOR, position]);
  });
}

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

/** One changed-since read covers at most this much time; a cursor that fell behind catches up one slice after another. */
export const PUBLISH_NOW_SCAN_SLICE_MS = 60 * 60_000;
/** A publish-now pass stops opening new slices after this; the cursor moves only as far as it scanned. */
export const PUBLISH_NOW_SCAN_BUDGET_MS = 2 * 60_000;

/* Work changed inside one slice ($2, $4]: the item itself, its worker results, or a page saved for its body or place;
   every held ballot route too when an input they all share moved. Each branch reads an index; rows are then fetched by id. */
const CHANGED_IN_SLICE = `WITH due(id) AS (
    SELECT id FROM cp_work_items_history WHERE changed_at > $2::timestamptz AND changed_at <= $4::timestamptz
    UNION SELECT log_key FROM cp_log_worker_results WHERE changed_at > $2::timestamptz AND changed_at <= $4::timestamptz
    UNION SELECT p.id FROM cp_log_artifacts a JOIN cp_work_items_history s ON s.id = a.log_key
      JOIN cp_work_items_history p ON p.value #>> '{autonomousPlan,publication,bodyId}' = s.value #>> '{autonomousPlan,publication,bodyId}'
      WHERE a.changed_at > $2::timestamptz AND a.changed_at <= $4::timestamptz
    UNION SELECT p.id FROM cp_log_artifacts a JOIN cp_work_items_history s ON s.id = a.log_key
      JOIN cp_work_items_history p ON p.value #>> '{subject}' = s.value #>> '{subject}'
      WHERE a.changed_at > $2::timestamptz AND a.changed_at <= $4::timestamptz
    UNION SELECT id FROM cp_work_items_history WHERE $3::boolean AND value #>> '{autonomousPlan,publication,contractId}' = 'ballot-navigation'
    UNION SELECT unnest($5::text[]))`;

const ITEM_COLUMNS = `SELECT id, value #>> '{subject}' AS subject,
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
      FROM cp_work_items_history
      WHERE value #>> '{autonomousPlan,publication,contractId}' = ANY($1::text[])`;

function publicationItem(row: Record<string, unknown>, contractIds: readonly string[]): WorkerPublicationItem {
  if (typeof row.id !== "string" || typeof row.contract_id !== "string" || !contractIds.includes(row.contract_id) ||
      typeof row.record_class !== "string" || !row.record_class.trim()) throw new Error("PUBLICATION_WORK_ITEM_METADATA_INVALID");
  return { id: row.id, ...(typeof row.subject === "string" ? { subject: row.subject } : {}), autonomousPlan: {
    publication: { contractId: row.contract_id as NonNullable<NonNullable<WorkerPublicationItem["autonomousPlan"]>["publication"]>["contractId"],
      ...(typeof row.body_id === "string" ? { bodyId: row.body_id } : {}) },
    contract: { recordClass: row.record_class },
  }, ...(row.publication_outcome === null || row.publication_outcome === undefined ? {}
    : { publicationOutcome: row.publication_outcome as WorkerPublicationItem["publicationOutcome"] }) };
}

/**
 * The publication outbox reads only its registered work and acknowledgement scalars: everything on a first pass, then what
 * changed after `since.at`, one slice at a time, until it reaches `since.until` or `deadlineMs`. `through` is how far it read,
 * which is where the cursor may move; anything after it is read by the next pass.
 */
export async function readWorkerPublicationItems(
  query: (sql: string, parameters: readonly unknown[]) => Promise<readonly Record<string, unknown>[]>,
  contractIds: readonly string[] = WORKER_PUBLICATION_TASK_IDS,
  since: { readonly at: string; readonly until: string; readonly sharedInputsMoved: boolean } | null = null,
  retryIds: readonly string[] = [],
  deadlineMs: number = Number.POSITIVE_INFINITY,
): Promise<{ readonly items: WorkerPublicationItem[]; readonly through: string | null }> {
  const registered = new Set(WORKER_PUBLICATION_TASK_IDS);
  if (contractIds.some(id => !registered.has(id))) throw new Error("PUBLICATION_CONTRACT_SELECTION_INVALID");
  if (contractIds.length === 0) return { items: [], through: since?.until ?? null };
  const items: WorkerPublicationItem[] = [];
  if (since === null) {
    let afterId: string | null = null;
    for (;;) {
      const rows = await query(`${ITEM_COLUMNS} ${afterId === null ? "" : "AND id > $2"} ORDER BY id ASC LIMIT ${AGGREGATE_LIST_READ_PAGE}`,
        [contractIds, ...(afterId === null ? [] : [afterId])]);
      items.push(...rows.map(row => publicationItem(row, contractIds)));
      if (rows.length < AGGREGATE_LIST_READ_PAGE) return { items, through: null };
      const next = items.at(-1)!.id;
      if (afterId !== null && next <= afterId) throw new Error("PUBLICATION_WORK_ITEM_PAGE_NOT_ADVANCING");
      afterId = next;
    }
  }
  const end = Date.parse(since.until);
  if (!Number.isFinite(Date.parse(since.at)) || !Number.isFinite(end)) throw new Error("PUBLICATION_SCAN_WINDOW_INVALID");
  const seen = new Set<string>();
  let through = since.at;
  // The first slice always runs, so retries and shared-input changes are never starved by the deadline.
  for (let first = true; first || (Date.parse(through) < end && Date.now() < deadlineMs); first = false) {
    const until = new Date(Math.min(end, Date.parse(through) + PUBLISH_NOW_SCAN_SLICE_MS)).toISOString();
    const rows = await query(`${CHANGED_IN_SLICE} ${ITEM_COLUMNS} AND id = ANY(ARRAY(SELECT id FROM due)) ORDER BY id ASC`,
      [contractIds, through, first && since.sharedInputsMoved, until, first ? [...new Set(retryIds)] : []]);
    for (const row of rows) {
      const item = publicationItem(row, contractIds);
      if (!seen.has(item.id)) { seen.add(item.id); items.push(item); }
    }
    through = until;
  }
  return { items, through };
}

/** One completion-evidence read per page serves both fact and contract admission; no whole history is retained. */
export async function readPublicationAdmission(
  items: readonly WorkerPublicationItem[],
  readCompleted: (workItemIds: readonly string[]) => Promise<readonly WorkerResultRecord[]>,
  now: string,
  heldInputs: HeldInputs | null = null,
): Promise<{ owed: { rosters: string[]; comments: string[] }; publication: RoutineSourceTask[] }> {
  const owed = { rosters: [] as string[], comments: [] as string[] }, contracts: OwedWorkerPublication[] = [];
  for (let at = 0; at < items.length; at += AGGREGATE_LIST_READ_PAGE) {
    const page = items.slice(at, at + AGGREGATE_LIST_READ_PAGE);
    const completed = await readCompleted(page.map(item => item.id));
    const found = owedFactItems(page, completed, now, heldInputs);
    owed.rosters.push(...found.rosters);
    owed.comments.push(...found.comments);
    contracts.push(...owedWorkerPublications(page, completed, now, heldInputs));
  }
  return { owed, publication: workerPublicationTasksFor(contracts, now) };
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
