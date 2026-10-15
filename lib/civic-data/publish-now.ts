import type { IndependentRuntimeLane } from "../ops/independent-runtime-pass.ts";
import { readRoutineTaskClocks, routineTaskDue, type RoutineSourceTask } from "./runner.ts";
import type { WorkerResultRecord } from "../control-plane/workers/types.ts";
import { owedFactItems, owedWorkerPublications, workerPublicationTasks, workerPublicationTasksFor, type HeldBallotInputs, type OwedWorkerPublication, type WorkerPublicationItem } from "./worker-publication-tasks.ts";
import { AGGREGATE_LIST_READ_PAGE, readBoxPublicationFindings } from "../control-plane/repository/pg-store.ts";
import { readCompletedWorkerResultsOf } from "../control-plane/repository/worker-completion.ts";
import type { ControlPlaneRepositories } from "../control-plane/repository/types.ts";
import { BOX_PUBLICATION_LOOKBACK_MS, FINDING_SLOTS_VERSION } from "../facts/finding-slots.ts";
import type { Query } from "../facts/publish.ts";
import { readHeldBallotInputs } from "./worker-held-elections.ts";
import type { RoutineDataStore } from "./store.ts";
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

export const WORKER_PUBLICATION_STATE_SQL = "upper(regexp_replace(coalesce(nullif(value #>> '{autonomousPlan,jurisdiction}', ''), value #>> '{autonomousPlan,contract,jurisdiction,state}', 'US'), '^US-', '', 'i'))";

export async function* readWorkerPublicationItems(
  query: (sql: string, parameters: readonly unknown[]) => Promise<readonly Record<string, unknown>[]>,
  state: string,
  now: string,
  contractIds: readonly string[] = WORKER_PUBLICATION_TASK_IDS,
): AsyncGenerator<readonly WorkerPublicationItem[]> {
  const registered = new Set(WORKER_PUBLICATION_TASK_IDS);
  if (contractIds.some(id => !registered.has(id))) throw new Error("PUBLICATION_CONTRACT_SELECTION_INVALID");
  if (!/^(?:US|US-[A-Z]{2})$/.test(state)) throw new Error("PUBLICATION_STATE_SELECTION_INVALID");
  if (!Number.isFinite(Date.parse(now))) throw new Error("PUBLICATION_TIME_INVALID");
  if (contractIds.length === 0) return;
  let afterId = "";
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
      FROM cp_work_items w
      WHERE value #>> '{autonomousPlan,publication,contractId}' = ANY($1::text[])
        AND ${WORKER_PUBLICATION_STATE_SQL} = $2 AND id > $3
        AND (jsonb_typeof(value->'publicationOutcome') IS DISTINCT FROM 'object'
          OR coalesce(value #>> '{publicationOutcome,at}', '') <= $5
          OR value #>> '{autonomousPlan,publication,contractId}' = 'ballot-navigation'
          OR EXISTS (SELECT 1 FROM cp_log_worker_results r WHERE r.log_key=w.id AND (
            (r.record #>> '{result,role}'='PARSER' AND r.record #>> '{result,verdict}'='EXTRACTED'
              AND r.record->>'endedAt' <= $4 AND (
                NOT (coalesce(w.value #>> '{publicationOutcome,workerResultId}', '') = r.record_id
                  OR starts_with(coalesce(w.value #>> '{publicationOutcome,workerResultId}', ''),r.record_id || '+'))
                OR w.value #>> '{publicationOutcome,recovery}'='PUBLISHER'
                OR (w.value #>> '{publicationOutcome,status}'='PARTIALLY_PUBLISHED'
                  AND w.value #>> '{autonomousPlan,contract,recordClass}'='BALLOT_MEASURE')
                OR (w.value #>> '{publicationOutcome,status}'<>'HELD' AND coalesce(w.value #>> '{publicationOutcome,sourceObservedAt}', '')='')
                OR (w.value #>> '{publicationOutcome,status}'='HELD' AND coalesce(w.value #>> '{publicationOutcome,recovery}', '')<>'WORKER')))
            OR (r.record #>> '{result,role}'='ADVERSARIAL_AUDITOR' AND r.record #>> '{result,verdict}'='BROKE'
              AND r.record->>'endedAt' > coalesce(w.value #>> '{publicationOutcome,at}', '')))))
      ORDER BY id ASC LIMIT ${AGGREGATE_LIST_READ_PAGE}`,
    [contractIds, state.replace(/^US-/, ""), afterId, now, new Date(Date.parse(now) - 3_600_000).toISOString()]);
    const items: WorkerPublicationItem[] = rows.map(row => {
      if (typeof row.id !== "string" || typeof row.contract_id !== "string" || !contractIds.includes(row.contract_id) ||
          typeof row.record_class !== "string" || !row.record_class.trim()) throw new Error("PUBLICATION_WORK_ITEM_METADATA_INVALID");
      return { id: row.id, ...(typeof row.subject === "string" ? { subject: row.subject } : {}), autonomousPlan: {
        publication: { contractId: row.contract_id as NonNullable<NonNullable<WorkerPublicationItem["autonomousPlan"]>["publication"]>["contractId"] },
        contract: { recordClass: row.record_class },
      }, ...(row.publication_outcome === null || row.publication_outcome === undefined ? {}
        : { publicationOutcome: row.publication_outcome as WorkerPublicationItem["publicationOutcome"] }) };
    });
    if (items.length) yield items;
    if (rows.length < AGGREGATE_LIST_READ_PAGE) return;
    const next = items.at(-1)!.id;
    if (next <= afterId) throw new Error("PUBLICATION_WORK_ITEM_PAGE_NOT_ADVANCING");
    afterId = next;
  }
}

export async function hasPendingPublicationWork(input: {
  readonly query: Query;
  readonly repos: ControlPlaneRepositories;
  readonly store: Pick<RoutineDataStore, "readPromotionIdentity" | "clocks">;
  readonly state: string;
  readonly now: string;
}): Promise<boolean> {
  const nowMs = Date.parse(input.now);
  if ((await readBoxPublicationFindings(input.repos, input.state.replace(/^US-/, ""), FINDING_SLOTS_VERSION,
    input.now, new Date(nowMs - BOX_PUBLICATION_LOOKBACK_MS).toISOString(), 1)).length) return true;
  for await (const items of readWorkerPublicationItems(input.query, input.state, input.now)) {
    const results = await readCompletedWorkerResultsOf(input.repos, items.map(item => item.id));
    const facts = owedFactItems(items, results, input.now);
    if (facts.rosters.length || facts.comments.length) return true;
    const held = await readHeldBallotInputs(input.query,
      async (recordClass, scope) => (await input.store.readPromotionIdentity(recordClass, scope))?.promotedAt ?? null, items);
    const tasks = workerPublicationTasksFor(owedWorkerPublications(items, results, input.now, held), input.now);
    const clocks = await readRoutineTaskClocks(tasks, targets => input.store.clocks(targets.map(task => ({
      sourceId: task.sourceId, recordClass: task.recordClass, scope: task.scope, parserVersion: task.parserVersion,
    }))));
    for (const read of clocks) {
      if (!read.ok) throw new Error(`PUBLICATION_CLOCK_UNREAD:${read.task.id}`);
      if (routineTaskDue(read.task, read.clock, nowMs)) return true;
    }
  }
  return false;
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
