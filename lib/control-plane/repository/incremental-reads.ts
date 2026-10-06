/**
 * **ONE IN-MEMORY COPY PER ROUND, AND EACH LATER READ FETCHES ONLY WHAT CHANGED.**
 *
 * The research round (`scripts/freshness-shadow.mts`) re-read whole
 * control-plane tables on every worker wave: the planner's selection, the
 * standing runtime's unscoped broker, the round start, the promotion tail and
 * the campaign chain each call `list()` / `readAll()` on the same few tables.
 * That re-reading was most of the control-plane data-transfer bill.
 *
 * This wrapper keeps one copy of those tables for the life of the wrapped
 * bundle. The first `list()` / `readAll()` reads the table whole; each later
 * one asks the store only for rows whose database-clock `changed_at` (schema
 * v22) is at or after the previous read's start minus a slack, merges them, and
 * returns EXACTLY what the plain read would return now:
 *
 * ```
 *   aggregates   same rows, by id ascending; a row seen twice keeps the higher
 *                revision (aggregates are never deleted by any repository API)
 *   logs         same records, by key then position; a record is immutable, so
 *                one seen twice across the slack overlap is kept once
 * ```
 *
 * Why the watermark is safe: the store's `through` is its clock when the read
 * BEGAN. A change committed after that began has a `changed_at` no earlier than
 * its own statement's start, and every control-plane write is one bounded
 * statement (request-bounds.ts: at most 25 s), so the next read from
 * `through - slackMs` (default 120 s) sees it.
 *
 * Why the order is the plain read's: the store returns every batch in its own
 * `ORDER BY`, and each batch is checked against the order this wrapper sorts
 * by (code-point id; key then position). A batch out of that order means the
 * database collates differently, so the table goes back to plain reads for the
 * rest of the process rather than return rows in an order `list()` would not.
 *
 * Never stale and never partial in silence: a store without the method reads
 * plainly; a changed-since read that throws (for example `changed_at` does not
 * exist yet because version 22 has not been applied) falls back to the plain
 * read for that call and logs one line naming the table. Every other method
 * passes through untouched — writes, `read`, `listWhere`, `readSince`, all of
 * them.
 */

import type {
  AggregateRepository,
  AppendOnlyRepository,
  ChangedRecord,
  ControlPlaneRepositories,
  Persisted,
} from "./types.ts";

/** How far before the previous read's start a later read reaches back. */
export const INCREMENTAL_READS_SLACK_MS = 120_000;

/** The env switch that keeps the way back: `0` turns the wrapper off where it is wired. */
export const INCREMENTAL_READS_ENV = "WTP_INCREMENTAL_READS";

/** On unless the switch says `0`. */
export function incrementalReadsEnabled(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return env[INCREMENTAL_READS_ENV] !== "0";
}

/** The aggregates whose `list()` and the logs whose `readAll()` are read incrementally. */
export const INCREMENTAL_AGGREGATES = ["workItems", "attempts", "routeTasks", "occurrences", "leases"] as const;
export const INCREMENTAL_LOGS = ["artifacts", "scoutResults", "workerResults"] as const;

/** After this many failed changed-since reads a table reads plainly for the rest of the process. */
const MAX_FAILURES = 3;

export interface IncrementalReadOptions {
  readonly slackMs?: number;
  readonly log?: (line: string) => void;
}

const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const describeError = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** A missing column is permanent until the bootstrap runs; retrying it every wave only adds a round trip. */
const missingColumn = (error: unknown): boolean =>
  (error as { code?: unknown } | null)?.code === "42703" || /changed_at/.test(describeError(error));

/** One table's state: a serial queue, so a reset never races a merge. */
interface TableState {
  watermark: string | null;
  failures: number;
  disabled: boolean;
  unsupportedLogged: boolean;
  queue: Promise<unknown>;
}

function tableState(): TableState {
  return { watermark: null, failures: 0, disabled: false, unsupportedLogged: false, queue: Promise.resolve() };
}

function serial<R>(state: TableState, operation: () => Promise<R>): Promise<R> {
  const next = state.queue.then(operation, operation);
  state.queue = next.catch(() => undefined);
  return next;
}

function sinceFrom(watermark: string | null, slackMs: number): string | null {
  return watermark === null ? null : new Date(Date.parse(watermark) - slackMs).toISOString();
}

function laterOf(a: string | null, b: string): string {
  return a === null || Date.parse(b) > Date.parse(a) ? b : a;
}

function incrementalAggregate<T>(
  table: string,
  repo: AggregateRepository<T>,
  slackMs: number,
  log: (line: string) => void,
): AggregateRepository<T> {
  const state = tableState();
  const cache = new Map<string, Persisted<T>>();
  let order: string[] | null = null;
  const reset = () => { cache.clear(); order = null; state.watermark = null; };

  const list = (): Promise<readonly Persisted<T>[]> => serial(state, async () => {
    const changedSince = repo.listChangedSince?.bind(repo);
    if (state.disabled) return repo.list();
    if (changedSince === undefined) {
      if (!state.unsupportedLogged) log(`incremental reads: ${table} store has no listChangedSince; reading it whole`);
      state.unsupportedLogged = true;
      return repo.list();
    }
    const since = sinceFrom(state.watermark, slackMs);
    let changed: Awaited<ReturnType<NonNullable<AggregateRepository<T>["listChangedSince"]>>>;
    try {
      changed = await changedSince(since);
      if (changed.through === null || Number.isNaN(Date.parse(changed.through))) throw new Error("the store returned no read clock");
    } catch (error) {
      reset();
      state.failures += 1;
      state.disabled = missingColumn(error) || state.failures >= MAX_FAILURES;
      log(`incremental reads: ${table} changed-since read failed (${describeError(error)}); reading it whole` +
        (state.disabled ? " for the rest of this process" : ""));
      return repo.list();
    }
    for (let i = 1; i < changed.rows.length; i++) {
      if (compareText(changed.rows[i - 1].id, changed.rows[i].id) >= 0) {
        reset();
        state.disabled = true;
        log(`incremental reads: ${table} rows arrived out of code-point id order; reading it whole for the rest of this process`);
        return repo.list();
      }
    }
    if (since === null) reset();
    for (const row of changed.rows) {
      const held = cache.get(row.id);
      if (held === undefined) order = null;
      if (held === undefined || row.revision >= held.revision) cache.set(row.id, row);
    }
    state.watermark = laterOf(state.watermark, changed.through);
    state.failures = 0;
    order ??= [...cache.keys()].sort(compareText);
    return order.map((id) => {
      const row = cache.get(id)!;
      return { ...row, value: structuredClone(row.value) };
    });
  });

  return { ...repo, list };
}

function incrementalLog<T>(
  table: string,
  repo: AppendOnlyRepository<T>,
  slackMs: number,
  log: (line: string) => void,
): AppendOnlyRepository<T> {
  const state = tableState();
  const cache = new Map<string, ChangedRecord<T>>();
  let order: ChangedRecord<T>[] | null = null;
  const reset = () => { cache.clear(); order = null; state.watermark = null; };
  const before = (a: ChangedRecord<T>, b: ChangedRecord<T>): number => compareText(a.key, b.key) || a.position - b.position;

  const readAll = (): Promise<readonly T[]> => serial(state, async () => {
    const changedSince = repo.readChangedSince?.bind(repo);
    if (state.disabled) return repo.readAll();
    if (changedSince === undefined) {
      if (!state.unsupportedLogged) log(`incremental reads: ${table} store has no readChangedSince; reading it whole`);
      state.unsupportedLogged = true;
      return repo.readAll();
    }
    const since = sinceFrom(state.watermark, slackMs);
    let changed: Awaited<ReturnType<NonNullable<AppendOnlyRepository<T>["readChangedSince"]>>>;
    try {
      changed = await changedSince(since);
      if (changed.through === null || Number.isNaN(Date.parse(changed.through))) throw new Error("the store returned no read clock");
    } catch (error) {
      reset();
      state.failures += 1;
      state.disabled = missingColumn(error) || state.failures >= MAX_FAILURES;
      log(`incremental reads: ${table} changed-since read failed (${describeError(error)}); reading it whole` +
        (state.disabled ? " for the rest of this process" : ""));
      return repo.readAll();
    }
    for (let i = 1; i < changed.records.length; i++) {
      if (before(changed.records[i - 1], changed.records[i]) >= 0) {
        reset();
        state.disabled = true;
        log(`incremental reads: ${table} records arrived out of (key, position) order; reading it whole for the rest of this process`);
        return repo.readAll();
      }
    }
    if (since === null) reset();
    for (const entry of changed.records) {
      const id = `${entry.key}\u0000${entry.recordId}`;
      if (cache.has(id)) continue;
      cache.set(id, entry);
      order = null;
    }
    state.watermark = laterOf(state.watermark, changed.through);
    state.failures = 0;
    order ??= [...cache.values()].sort(before);
    return order.map((entry) => structuredClone(entry.record));
  });

  return { ...repo, readAll };
}

/**
 * The bundle with incremental `list()` on {@link INCREMENTAL_AGGREGATES} and
 * incremental `readAll()` on {@link INCREMENTAL_LOGS}. Wrap ONCE where the
 * repositories are opened: the copy lives as long as the returned bundle.
 */
export function withIncrementalReads(
  repos: ControlPlaneRepositories,
  options: IncrementalReadOptions = {},
): ControlPlaneRepositories {
  const slackMs = options.slackMs ?? INCREMENTAL_READS_SLACK_MS;
  if (!Number.isFinite(slackMs) || slackMs < 0) throw new Error(`incremental reads: slackMs must be a non-negative number, got ${String(slackMs)}`);
  const log = options.log ?? ((line: string) => console.warn(line));
  return {
    ...repos,
    workItems: incrementalAggregate("cp_work_items", repos.workItems, slackMs, log),
    attempts: incrementalAggregate("cp_attempts", repos.attempts, slackMs, log),
    routeTasks: incrementalAggregate("cp_route_tasks", repos.routeTasks, slackMs, log),
    occurrences: incrementalAggregate("cp_occurrences", repos.occurrences, slackMs, log),
    leases: incrementalAggregate("cp_leases", repos.leases, slackMs, log),
    artifacts: incrementalLog("cp_log_artifacts", repos.artifacts, slackMs, log),
    scoutResults: incrementalLog("cp_log_scout_results", repos.scoutResults, slackMs, log),
    workerResults: incrementalLog("cp_log_worker_results", repos.workerResults, slackMs, log),
  };
}
