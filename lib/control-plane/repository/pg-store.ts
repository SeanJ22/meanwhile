import { MANUAL_SOURCE_HINTS_SQL } from "./manual-source-index.ts";
import {MANUAL_METHOD_POOL_SQL} from "./manual-method-index.ts";
import { PLANNING_STATES, PLANNING_SUMMARY_SQL, planningStateOf } from "../scheduler/state-planning.ts";
import type { HuntOrder, HuntOrderRepository } from "../hunt-orders.ts";
import { pgAdminConfigRepository } from "./admin-config.ts";
import { archivedAggregateRepository, createPgDispatchState } from "./dispatch-state.ts";
import { pgSpendRepository } from "./model-charges.ts";
import { pgControlReadsBackfill } from "./control-reads-backfill.ts";
import { PUBLISHER, type BoxFinding, type BoxRepository } from "../box.ts";
import type { WorkerResultRecord } from "../workers/types.ts";
import type { AdminEvidenceCopyRequest } from "../evidence/admin-copy-request.ts";
import { installDatabaseTransferCounter } from "../../db/transfer.ts";
import { installDatabaseClientAccounting, withCallerSite } from "../../db/transfer-by-caller.ts";
import type { AskGapObservation } from "../ask-gap-observations.ts";
import type { DoorRecord } from "../../doors/registry.ts";
import { pageAddress } from "../../doors/page-doors.ts";
import { requireBallotState } from "../../civic-data/state-scopes.ts";
import type { VotingSourceDoor } from "../../ballot/voting-source-types.ts";
import type { LeadOrder } from "../leads/order.ts";
import { createWebsitePacing } from "../website-pacing.ts";
import type { LiveAuditLogRow } from "../live-audit-log.ts";
import type { SoftwareReleaseReviewRecord } from "../software-release-review.ts";
import { pgActiveWorkClaimReader } from "./active-work-claims.ts";

import { createHash } from "node:crypto";
import { neon, Pool, neonConfig } from "@neondatabase/serverless";
import type {
  CacheObservationRecord,
  OwnerDecisionIntent,
  OwnerDigestRecord,
  OwnerSnapshot,
  OwnerSnapshotState,
  RunnerHeartbeat,
} from "../owner-surface.ts";
import { BOOKKEEPING_KINDS, FIELD_MANUAL_ROLES, OUTCOME_RANK, coveringPlaces, methodEvidencePlaces, projectFieldManual, queryState, readMethodEvidence, TRANSFERABLE_METHOD_KINDS, type FieldManualEntry, type FieldManualQuery } from "../field-manual.ts";
import { MANUAL_BROAD_SQL, MANUAL_EMPTY_CLASS_SQL, MANUAL_METHOD_SQL, MANUAL_OUTCOME_SQL, MANUAL_PLAIN_SQL, MANUAL_LEARNED_ROUTES_SQL } from "./field-manual-sql.ts";
import { sourceOriginKeys,type FieldManualSourceHint } from "../field-manual-sources.ts";
import { createFixMapRepository, type FixMapRepository } from "../../method/fix-map.ts";
import type { OwnerSnapshotTotals, SpilledInbox, StateTotals } from "../owner-snapshot-totals.ts";
import { ensureRolePlaybooks, retireInstructionsSql } from "../playbook-seed.ts";
import { seedFieldManualNotes } from "../field-manual-notes.ts";
import type { ActionReceipt } from "../gateway/contract.ts";
import { appendActionReceiptWithHistoryAtomic, readActionHistoryPage } from "./action-history-atomic.ts";
import type { AgentJobRecord } from "../gateway/agent-job.ts";
import type { MeetingsDiscoveryAttempt } from "../../hunt/meetings-site-discovery.ts";
import type { AdminConfig } from "../gateway/admin-config.ts";
import type { CandidateStore } from "../../method/candidate.ts";
import type { FreshnessDebt } from "../scheduler/debt.ts";
import type { FreshnessOccurrence, StandingObligation } from "../scheduler/durable.ts";
import type { ResearchIntent, ResearchState } from "../scheduler/research-policy.ts";
import type { ScoutResult } from "../scheduler/scout-result.ts";
import type {
  PromotionPipelineRecord,
  WindowIncident,
  WindowIntent,
  WindowRunRecord,
} from "../promotion/types.ts";

import type { Attempt, ExecutionLease } from "../attempt.ts";
import type { BudgetLedger } from "../budget.ts";
import type { CostEntry } from "../cost.ts";
import type { Escalation } from "../work-item.ts";
import type { RouteTask } from "../route-task.ts";
import type { WorkItem } from "../work-item.ts";

import { budgetRepositoryFrom } from "./shared.ts";
import {
  ARTIFACT_SOURCE_INDEX,
  BOOTSTRAP_DDL,
  BOOTSTRAP_VERSION,
  ONLINE_INDEXES,
  SPEND_HOLDS_MOVE_DDL,
  recordVersionStatement,
  spendHoldDeadSql,
  spendHoldJsonSql,
  spendHoldLiveSql,
  type OnlineIndex,
} from "./pg-schema.ts";
import type { SpendHold } from "../budget.ts";
import {
  SETTLED_HOLD_RETENTION_MS,
  SPEND_HOLD_STALE_MS,
  SPEND_HOLD_SWEEP_LIMIT,
  SPEND_HOLD_WINDOW_MS,
  areaRefusal,
  everyLineMustFit,
  invalidAmountRefusal,
  sendRefusal,
  spendHoldsTableEnabled,
  type BudgetLine,
  type HoldDecision,
  type SpendHoldStore,
} from "../expansion/spend-holds.ts";
import type { HeldCopies } from "./incremental-reads.ts";
import {
  CONTROL_PLANE_CONNECT_MAX_ATTEMPTS,
  withControlPlaneConnectRetry,
} from "./connect-retry.ts";
import {
  CONTROL_PLANE_REQUEST_BOUNDS_MS,
  boundedQuery,
  currentStoreBudget,
  type BoundableQueryOptions,
  type ControlPlaneCallClass,
  type ControlPlaneRequestBounds,
} from "./request-bounds.ts";
import {
  AppendOnlyViolation,
  ConcurrentModification,
  CorruptPersistedState,
  IdentityCollision,
  UnknownAggregate,
  canonicalJson,
  projectAggregate,
  projectRecord,
  reconcileIdempotentPut,
  type AggregateRepository,
  type AppendOnlyRepository,
  type AppendOutcome,
  type ArtifactRecord,
  type ChangedReadOptions,
  type ChangedRecord,
  type ChangedRecords,
  type ChangedRows,
  type ControlPlaneRepositories,
  type FieldManualRepository,
  type DispositionCommit,
  type HeldSlots,
  type PassCursor,
  type LockManager,
  type Persisted,
  type PutOutcome,
  type RecordedTransition,
  type RecordProjection,
} from "./types.ts";

export const CONTROL_PLANE_URL_VAR = "WTP_CONTROL_PLANE_DATABASE_URL";

export const CONTROL_PLANE_TEST_URL_VAR = "WTP_CONTROL_PLANE_TEST_DATABASE_URL";

export interface Sql {
  query(text: string, params?: readonly unknown[], options?: BoundableQueryOptions): Promise<unknown>;

  withPinnedConnection?<T>(operation: (sql: Sql) => Promise<T>): Promise<T>;
}

export const DOCUMENT_ROW_TABLES: ReadonlySet<string> = new Set([
  "cp_budget",
  "cp_research_state",
  "cp_method_candidates",
  "cp_owner_snapshots",
  "cp_readiness_snapshots",
]);

export const DOCUMENT_RECORD_LOGS: ReadonlySet<string> = new Set([
  "owner_digests",
  "worker_results",
  "window_runs",
  "scout_results",
]);

export interface PgRepositoryBounds {
  readonly bounds?: ControlPlaneRequestBounds;

  readonly rowClass?: Exclude<ControlPlaneCallClass, "PAGE">;

  readonly copies?: HeldCopies | null;
  readonly state?: string;
  readonly activeOnly?: boolean;
  readonly since?: string;
}

let heldCopiesFor: ((connectionString: string, schemaVersion: number) => HeldCopies | null) | null = null;

export function installHeldCopies(open: (connectionString: string, schemaVersion: number) => HeldCopies | null): void {
  heldCopiesFor = open;
}

function heldFilter(held: HeldSlots | undefined, at: (value: unknown) => string, slot: string, version: string): string {
  if (!held || held.length === 0) return "";
  return `NOT EXISTS (SELECT 1 FROM unnest(${at(held.map(([name]) => name))}::text[], ${at(held.map(([, number]) => number))}::bigint[]) ` +
    `AS held(slot, version) WHERE held.slot = ${slot} AND held.version = ${version})`;
}

function callerPinned<R extends object>(repository: R): R {
  return Object.fromEntries(Object.entries(repository).map(([name, member]) => [name, typeof member === "function"
    ? (...args: unknown[]) => withCallerSite(() => member.apply(repository, args))
    : member])) as R;
}

export const CONTROL_PLANE_QUERY_CONCURRENCY = 16;
let activeQueries = 0;
const queryWaiters: Array<() => void> = [];

function boundedRunner(sql: Sql, prefix: string, bounds: ControlPlaneRequestBounds) {
  return async (operation: string, callClass: ControlPlaneCallClass, text: string, params?: readonly unknown[]) => {
    await new Promise<void>((resolve, reject) => {
      if (activeQueries < CONTROL_PLANE_QUERY_CONCURRENCY) { activeQueries++; resolve(); }
      else {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const admit = () => { if (timer) clearTimeout(timer); resolve(); };
        queryWaiters.push(admit);
        const budget = currentStoreBudget();
        if (budget) timer = setTimeout(() => {
          const index = queryWaiters.indexOf(admit);
          if (index < 0) return;
          queryWaiters.splice(index, 1);

          void boundedQuery(sql, { operation: `${prefix}.${operation}`, callClass }, text, params,
            { bounds, now: () => budget.deadlineMs }).catch(reject);
        }, Math.max(0, budget.deadlineMs - Date.now()));
      }
    });
    try {
      return await boundedQuery(sql, { operation: `${prefix}.${operation}`, callClass }, text, params, { bounds });
    } finally {
      const next = queryWaiters.shift();
      if (next) next();
      else activeQueries--;
    }
  };
}

export function advisoryLockKey(name: string): bigint {
  const OFFSET = BigInt("0xcbf29ce484222325");
  const PRIME = BigInt("0x100000001b3");
  const MASK64 = BigInt("0xffffffffffffffff");
  const MASK63 = BigInt("0x7fffffffffffffff");
  let hash = OFFSET;
  for (const byte of Buffer.from(name, "utf8")) {
    hash ^= BigInt(byte);
    hash = (hash * PRIME) & MASK64;
  }

  return hash & MASK63;
}

function parseValue<T>(raw: unknown, where: string): T {
  try {
    return (typeof raw === "string" ? JSON.parse(raw) : raw) as T;
  } catch (error) {
    throw new CorruptPersistedState(
      where,
      error instanceof Error ? error.message : String(error),
    );
  }
}

function jsonPathLiteral(table: string, path: readonly string[]): string {
  if (path.length === 0) throw new Error(`${table}: an empty JSON path cannot select a field`);
  for (const segment of path) {
    if (!/^[A-Za-z0-9_]+$/.test(segment)) {
      throw new Error(`${table}: unsafe JSON path segment ${JSON.stringify(segment)}`);
    }
  }
  return `{${path.join(",")}}`;
}

function recordProjectionSql(table: string, projection: RecordProjection, column: "record" | "value" = "record"): string {

  const source = column === "record" ? "record" : `${table}.value`;
  const literal = (key: string): string => {
    if (!/^[A-Za-z0-9_]+$/.test(key)) {
      throw new Error(`${table}: unsafe projection key ${JSON.stringify(key)}`);
    }
    return `'${key}'`;
  };
  const kept = Object.keys(projection);
  if (kept.length === 0) throw new Error(`${table}: an empty projection cannot select a field`);
  const narrowed = kept.flatMap((key) => {
    const keep = projection[key];
    return keep === true ? [] : [
      `WHEN t.key = ${literal(key)} AND jsonb_typeof(t.value) = 'object' THEN ` +
        `(SELECT coalesce(jsonb_object_agg(f.key, f.value), '{}'::jsonb) FROM jsonb_each(t.value) AS f ` +
        `WHERE f.key IN (${keep.length === 0 ? "NULL" : keep.map(literal).join(", ")}))`,
    ];
  });
  const value = narrowed.length === 0 ? "t.value" : `CASE ${narrowed.join(" ")} ELSE t.value END`;
  return `CASE WHEN jsonb_typeof(${source}) = 'object' THEN ` +
    `(SELECT coalesce(jsonb_object_agg(t.key, ${value}), '{}'::jsonb) FROM jsonb_each(${source}) AS t ` +
    `WHERE t.key IN (${kept.map(literal).join(", ")})) ELSE ${source} END`;
}

export const AGGREGATE_LIST_READ_PAGE = 100;

export function pgAggregateRepository<T>(
  sql: Sql,
  kind: string,
  table: string,
  options: PgRepositoryBounds = {},
): AggregateRepository<T> {
  if (options.state && !/^(?:[a-z]{2}|system)$/.test(options.state)) throw new Error("One planning state is required");
  const statePredicate = table === "cp_route_tasks" || table === "cp_route_tasks_history" || table === "cp_attempts"
    ? `EXISTS(SELECT 1 FROM cp_work_items_history w WHERE w.id=${table}.value->>'workItemId' AND cp_control_state(w.value)='${options.state}')`
    : table === "cp_leases"
      ? `EXISTS(SELECT 1 FROM cp_route_tasks_history t JOIN cp_work_items_history w ON w.id=t.value->>'workItemId' WHERE t.id=${table}.value->>'routeTaskId' AND cp_control_state(w.value)='${options.state}')`
      : `cp_control_state(${table}.value)='${options.state}'`;
  const stateFilter = options.state ? ` AND ${statePredicate}` : "";
  const activeFilter = options.activeOnly ? " AND value->>'active'='true'" : "";
  const scopeFilter = stateFilter + activeFilter;
  const where = `${table} in the control-plane database`;
  const run = boundedRunner(sql, table, options.bounds ?? CONTROL_PLANE_REQUEST_BOUNDS_MS);
  const rowClass = options.rowClass ?? (DOCUMENT_ROW_TABLES.has(table) ? "DOCUMENT" : "POINT");
  const references = new Map<string, Persisted<unknown>>();
  const referenceTable = ["cp_admin_config", "cp_research_state", "cp_field_manual_entries"].includes(table);

  async function read(id: string): Promise<Persisted<T> | null> {
    const rows = (await run(
      "read",
      rowClass,
      `SELECT id, revision, updated_at, value FROM ${table} WHERE id = $1`,
      [id],
    )) as Record<string, unknown>[];
    if (rows.length === 0) return null;
    const row = rows[0];
    return {
      id: String(row.id),
      revision: Number(row.revision),
      updatedAt: new Date(row.updated_at as string).toISOString(),
      value: parseValue<T>(row.value, `${where} id ${id}`),
    };
  }

  async function listChangedSince(since: string | null, held?: HeldSlots, read: ChangedReadOptions<Persisted<T>> = {}, includeChangedAt = true): Promise<ChangedRows<T>> {
    const clock = (await run("listChangedSince:clock", "POINT", "SELECT now() AS read_at")) as Record<string, unknown>[];
    const through = new Date(clock[0]?.read_at as string).toISOString();
    const selected = read.projection ? recordProjectionSql(table, read.projection, "value") : "value";
    const out: Persisted<T>[] = [];
    let afterId: string | null = null;
    for (;;) {
      const params: unknown[] = [];
      const at = (value: unknown) => `$${params.push(value)}`;
      const filters = [scopeFilter ? scopeFilter.slice(5) : "", since === null ? "" : `changed_at >= ${at(since)}::timestamptz`,
        heldFilter(held, at, "id", "revision"), afterId === null ? "" : `id > ${at(afterId)}`].filter(Boolean);
      const rows = (await run(
        "listChangedSince",
        "PAGE",
        `SELECT id, revision, updated_at, ${includeChangedAt ? "changed_at, " : ""}${selected} AS value FROM ${table}
         ${filters.length === 0 ? "" : `WHERE ${filters.join(" AND ")}`}
         ORDER BY id ASC
         LIMIT ${AGGREGATE_LIST_READ_PAGE}`,
        params,
      )) as Record<string, unknown>[];
      const page = rows.map(row => persistedRow<T>(row));
      if (read.page) await read.page(page);
      else out.push(...page);
      if (rows.length < AGGREGATE_LIST_READ_PAGE) break;
      afterId = String(rows[rows.length - 1].id);
    }
    return { rows: out, through };
  }

  function persistedRow<O>(row: Record<string, unknown>): Persisted<O> {
    return {
      id: String(row.id),
      revision: Number(row.revision),
      updatedAt: new Date(row.updated_at as string).toISOString(),
      ...(row.changed_at == null ? {} : { changedAt: new Date(row.changed_at as string).toISOString() }),
      value: parseValue<O>(row.value, `${where} id ${String(row.id)}`),
    };
  }

  /* Primary-key batches of one page each, so no response nears the driver cap. */
  async function readManyAs<O>(ids: readonly string[], selected: string, caller: string): Promise<Persisted<O>[]> {
    const unique = [...new Set(ids)].sort();
    const out: Persisted<O>[] = [];
    for (let at = 0; at < unique.length; at += AGGREGATE_LIST_READ_PAGE) {
      const rows = (await run(
        caller,
        "PAGE",
        `SELECT id, revision, updated_at, ${selected} AS value FROM ${table} WHERE id = ANY($1::text[]) ORDER BY id ASC`,
        [unique.slice(at, at + AGGREGATE_LIST_READ_PAGE)],
      )) as Record<string, unknown>[];
      out.push(...rows.map(row => persistedRow<O>(row)));
    }
    return out;
  }

  const copies = options.copies ?? null;
  const listingSource = (since: string | null, held?: HeldSlots) => listChangedSince(since, held, {}, false);
  const held = <O>(out: (row: Persisted<T>) => O): Promise<O[]> => copies === null
    ? listingSource(null).then(changed => changed.rows.map(out))
    : copies.aggregateList(`${table}:${options.state ?? "all"}:${options.activeOnly ?? false}`, listingSource, out);

  async function listWhereAs<O>(path: readonly string[], value: string, selected: string, caller: string): Promise<Persisted<O>[]> {
    const jsonPath = jsonPathLiteral(table, path);
    const out: Persisted<O>[] = [];
    let afterId: string | null = null;
    for (;;) {
      const rows = (afterId === null
        ? await run(
            caller,
            "PAGE",
            `SELECT id, revision, updated_at, ${selected} AS value FROM ${table}
             WHERE value #>> '${jsonPath}' = $1${scopeFilter}
             ORDER BY id ASC
             LIMIT ${AGGREGATE_LIST_READ_PAGE}`,
            [value],
          )
        : await run(
            caller,
            "PAGE",
            `SELECT id, revision, updated_at, ${selected} AS value FROM ${table}
             WHERE value #>> '${jsonPath}' = $1${scopeFilter} AND id > $2
             ORDER BY id ASC
             LIMIT ${AGGREGATE_LIST_READ_PAGE}`,
            [value, afterId],
          )) as Record<string, unknown>[];
      for (const row of rows) {
        out.push({
          id: String(row.id),
          revision: Number(row.revision),
          updatedAt: new Date(row.updated_at as string).toISOString(),
          value: parseValue<O>(row.value, `${where} id ${String(row.id)}`),
        });
      }
      if (rows.length < AGGREGATE_LIST_READ_PAGE) break;
      afterId = String(rows[rows.length - 1].id);
    }
    return out;
  }

  return callerPinned({
    read,

    async readNarrowed(id, projection) {

      const narrowed = Object.keys(projection).length === 0 ? "'{}'::jsonb" : recordProjectionSql(table, projection, "value");
      const key = `${id}\n${JSON.stringify(projection)}`;
      const prior = references.get(key);
      const rows = (await run(
        "readNarrowed",
        "POINT",
        `SELECT id, revision, updated_at, ${prior ? `CASE WHEN revision = $2 THEN NULL ELSE ${narrowed} END` : narrowed} AS value FROM ${table} WHERE id = $1`,
        prior ? [id, prior.revision] : [id],
      )) as Record<string, unknown>[];
      if (rows.length === 0) { references.delete(key); return null; }
      const row = rows[0];
      if (prior && Number(row.revision) === prior.revision) return structuredClone(prior);
      const next = {
        id: String(row.id),
        revision: Number(row.revision),
        updatedAt: new Date(row.updated_at as string).toISOString(),
        value: parseValue<unknown>(row.value, `${where} id ${id}`),
      };
      if (referenceTable && Buffer.byteLength(JSON.stringify(next)) <= 65_536) {
        if (references.size >= 16) references.delete(references.keys().next().value!);
        references.set(key, structuredClone(next));
      } else references.delete(key);
      return next;
    },

    async mustRead(id) {
      const found = await read(id);
      if (found === null) throw new UnknownAggregate(kind, id);
      return found;
    },

    async put(id, value, now): Promise<PutOutcome<T>> {

      const inserted = (await run(
        "put",
        rowClass,
        `INSERT INTO ${table} (id, revision, updated_at, value)
         VALUES ($1, 1, $2, $3::jsonb)
         ON CONFLICT (id) DO NOTHING
         RETURNING id`,
        [id, now, JSON.stringify(value)],
      )) as unknown[];

      const persisted = await read(id);
      if (persisted === null) {
        throw new CorruptPersistedState(
          `${where} id ${id}`,
          "the row was neither inserted nor readable immediately afterwards",
        );
      }
      if (inserted.length > 0) return { created: true, persisted };

      const differs = reconcileIdempotentPut(kind, id, persisted.value, value);
      if (differs) {
        throw new IdentityCollision(
          kind,
          id,
          canonicalJson(persisted.value),
          canonicalJson(value),
        );
      }
      return { created: false, persisted };
    },

    async compareAndSet(id, expectedRevision, next, now) {

      const submitted = JSON.stringify(next);
      const updated = (await run(
        "compareAndSet",
        rowClass,
        `UPDATE ${table}
            SET revision = revision + 1, updated_at = $1, value = $2::jsonb, changed_at = now()
          WHERE id = $3 AND revision = $4
       RETURNING id, revision, updated_at`,
        [now, submitted, id, expectedRevision],
      )) as Record<string, unknown>[];

      if (updated.length === 0) {

        const current = (await run("readNarrowed", "POINT",
          `SELECT revision FROM ${table} WHERE id = $1`, [id])) as Record<string, unknown>[];
        throw new ConcurrentModification(
          kind,
          id,
          expectedRevision,
          current.length === 0 ? null : Number(current[0].revision),
        );
      }
      const row = updated[0];
      return {
        id: String(row.id),
        revision: Number(row.revision),
        updatedAt: new Date(row.updated_at as string).toISOString(),
        value: parseValue<T>(submitted, `${where} id ${id}`),
      };
    },

    readMany: ids => readManyAs<T>(ids, "value", "readMany"),
    readManyNarrowed: (ids, projection) => readManyAs<unknown>(ids,
      Object.keys(projection).length === 0 ? "'{}'::jsonb" : recordProjectionSql(table, projection, "value"), "readManyNarrowed"),

    async listWhereIn(path, values, projection) {
      /* Keyset-paged like `list()`; an expression index on the path serves `= ANY`. */
      const jsonPath = jsonPathLiteral(table, path);
      const narrowed = Object.keys(projection).length === 0 ? "'{}'::jsonb" : recordProjectionSql(table, projection, "value");
      const wanted = [...new Set(values)];
      const out: Persisted<unknown>[] = [];
      if (wanted.length === 0) return out;
      let afterId: string | null = null;
      for (;;) {
        const rows = (await run(
          "listWhereIn",
          "PAGE",
          `SELECT id, revision, updated_at, ${narrowed} AS value FROM ${table}
           WHERE value #>> '${jsonPath}' = ANY($1::text[])${scopeFilter}${afterId === null ? "" : " AND id > $2"}
           ORDER BY id ASC
           LIMIT ${AGGREGATE_LIST_READ_PAGE}`,
          afterId === null ? [wanted] : [wanted, afterId],
        )) as Record<string, unknown>[];
        out.push(...rows.map(row => persistedRow<unknown>(row)));
        if (rows.length < AGGREGATE_LIST_READ_PAGE) break;
        afterId = String(rows[rows.length - 1].id);
      }
      return out;
    },

    list: () => held(row => row),
    listNarrowed: projection => held(row => ({ ...row, value: projectAggregate(row.value, projection) })),
    listChangedSince,

    listWhere: (path, value) => listWhereAs<T>(path, value, "value", "listWhere"),
    listWhereNarrowed: (path, value, projection) => listWhereAs<unknown>(path, value,
      Object.keys(projection).length === 0 ? "'{}'::jsonb" : recordProjectionSql(table, projection, "value"), "listWhereNarrowed"),
  });
}

export const APPEND_ONLY_LOG_READ_PAGE = 100;

function pgArchivedAggregateRepository<T>(sql: Sql, entity: string, table: string, bounds: PgRepositoryBounds): AggregateRepository<T> {
  const options = { ...bounds, copies: null };
  const archive = archivedAggregateRepository(pgAggregateRepository<T>(sql, entity, table, options),
    pgAggregateRepository<T>(sql, entity, `${table}_archive`, options));
  const history = pgAggregateRepository<T>(sql, entity, `${table}_history`, options);
  return { ...archive, read: history.read, mustRead: history.mustRead,
    readNarrowed: history.readNarrowed, readMany: history.readMany,
    readManyNarrowed: history.readManyNarrowed, listWhereIn: history.listWhereIn,
    listChangedSince: history.listChangedSince };
}

export interface SnapshotStampedReadOptions {
  readonly projection?: RecordProjection;
  readonly timeRange?: { readonly path: readonly string[]; readonly from: string; readonly until: string };
}

export type SnapshotStampedRead<T> = (from: string, until: string,
  page: (records: readonly ChangedRecord<T>[]) => Promise<void> | void, options?: SnapshotStampedReadOptions) => Promise<void>;

export function pgAppendOnlyRepository<T>(
  sql: Sql,
  log: string,
  options: PgRepositoryBounds = {},
): AppendOnlyRepository<T> {
  const table = `cp_log_${log}`;
  if(options.state && !/^(?:[a-z]{2}|system)$/.test(options.state))throw new Error("One planning state is required");
  const run = boundedRunner(sql, table, options.bounds ?? CONTROL_PLANE_REQUEST_BOUNDS_MS);

  const recordClass = options.rowClass ?? (DOCUMENT_RECORD_LOGS.has(log) ? "DOCUMENT" : "POINT");
  const pipelineState=options.state && log==="promotion_pipeline"?`log_key IN (SELECT origin.log_key FROM cp_log_promotion_pipeline origin
    WHERE (origin.record->>'stage'='SCOUTED' OR origin.record #>> '{offered,stage}'='SCOUTED')
      AND cp_control_state(coalesce(origin.record->'offered',origin.record))='${options.state}')`:"";
  const recordState = !options.state ? "" : pipelineState || (["cp_log_artifacts", "cp_log_worker_results", "cp_log_transitions"].includes(table)
    ? `EXISTS(SELECT 1 FROM cp_work_items_history w WHERE w.id=coalesce(${table}.record->>'workItemId',${table}.log_key) AND cp_control_state(w.value)='${options.state}')`
    : `cp_control_state(record)='${options.state}'`);

  const changedRecord = (r: Record<string, unknown>): ChangedRecord<T> => ({
    key: String(r.log_key), recordId: String(r.record_id), position: Number(r.position),
    record: parseValue<T>(r.record, `${table} ${String(r.log_key)}`),
    changedAt: new Date(r.changed_at as string).toISOString(), stampedAt: new Date(r.recorded_at as string).toISOString(),
  });

  /* Keyset-paged by (log_key, position) under `filters`, each page handed to `page` as it arrives. */
  async function pagedRecords(caller: string, filters: (at: (value: unknown) => string) => readonly string[], selected: string,
    page: (records: readonly ChangedRecord<T>[]) => Promise<void> | void): Promise<void> {
    let cursor: { readonly key: string; readonly position: number } | null = null;
    for (;;) {
      const params: unknown[] = [];
      const at = (value: unknown) => `$${params.push(value)}`;
      const where = [...filters(at), cursor === null ? "" : `(log_key, position) > (${at(cursor.key)}, ${at(cursor.position)})`].filter(Boolean);
      const rows = (await run(
        caller,
        "PAGE",
        `SELECT log_key, record_id, position, ${selected} AS record, changed_at, recorded_at FROM ${table}
         ${where.length === 0 ? "" : `WHERE ${where.join(" AND ")}`}
         ORDER BY log_key ASC, position ASC
         LIMIT ${APPEND_ONLY_LOG_READ_PAGE}`,
        params,
      )) as Record<string, unknown>[];
      await page(rows.map(changedRecord));
      if (rows.length < APPEND_ONLY_LOG_READ_PAGE) break;
      const last = rows[rows.length - 1];
      cursor = { key: String(last.log_key), position: Number(last.position) };
    }
  }

  async function readChangedSince(since: string | null, held?: HeldSlots, read: ChangedReadOptions<ChangedRecord<T>> = {}): Promise<ChangedRecords<T>> {
    /* `readAll()` narrowed to records the database stamped at or after `since`, less the held ones; `through` is the database clock before the first page. */
    const clock = (await run("readChangedSince:clock", "POINT", "SELECT now() AS read_at")) as Record<string, unknown>[];
    const through = new Date(clock[0]?.read_at as string).toISOString();
    const out: ChangedRecord<T>[] = [];
    const stateKeys = pipelineState ? ((await run("readChangedSince:stateKeys", "PAGE",
      `SELECT DISTINCT log_key FROM ${table} WHERE ${pipelineState} ORDER BY log_key`)) as Record<string, unknown>[]).map(row => String(row.log_key)) : null;
    const batches = stateKeys === null ? [null] : Array.from({ length: Math.ceil(stateKeys.length / APPEND_ONLY_LOG_READ_PAGE) },
      (_, index) => stateKeys.slice(index * APPEND_ONLY_LOG_READ_PAGE, (index + 1) * APPEND_ONLY_LOG_READ_PAGE));
    const heldByKey = new Map<string, (readonly [string, number])[]>();
    if (stateKeys !== null) for (const slot of held ?? []) {
      const slots = heldByKey.get(slot[0]) ?? [];
      slots.push(slot);
      heldByKey.set(slot[0], slots);
    }
    for (const keys of batches) {
      const batchHeld = keys === null ? held : keys.flatMap(key => heldByKey.get(key) ?? []);
      await pagedRecords("readChangedSince", at => {
        const statePredicate = keys !== null ? `log_key=ANY(${at(keys)}::text[])` : recordState;
        return [options.state ? statePredicate : "", options.since ? `record->>'recordedAt'>=${at(options.since)}` : "",
          since === null ? "" : `changed_at >= ${at(since)}::timestamptz`, heldFilter(batchHeld, at, "log_key", "position")];
      }, read.projection ? recordProjectionSql(table, read.projection) : "record",
      async records => { if (read.page) await read.page(records); else out.push(...records); });
    }
    return { records: out, through };
  }

  const copies = options.copies ?? null;
  const heldAll = <O>(out: (record: T) => O): Promise<O[]> => copies === null
    ? readChangedSince(null).then(changed => changed.records.map(entry => out(entry.record)))
    : copies.logReadAll(`${table}:${options.state ?? "all"}`, readChangedSince, out);

  return callerPinned({
    async append(key, recordId, record, now): Promise<AppendOutcome<T>> {

      const already = (await run(
        "append:probe",
        recordClass,
        `SELECT position, record FROM ${table} WHERE log_key = $1 AND record_id = $2`,
        [key, recordId],
      )) as Record<string, unknown>[];
      if (already.length > 0) {
        const held = parseValue<T>(already[0].record, `${table} ${key}/${recordId}`);
        if (canonicalJson(held) !== canonicalJson(record)) {
          throw new AppendOnlyViolation(
            `${table} (${key})`,
            recordId,
            canonicalJson(held),
            canonicalJson(record),
          );
        }
        return { appended: false, recordId, record: held, position: Number(already[0].position) };
      }

      const allocated = (await run(
        "append:allocate",
        "POINT",
        `INSERT INTO cp_log_heads (log_table, log_key, next_position)
         VALUES ($1, $2, 1)
         ON CONFLICT (log_table, log_key)
           DO UPDATE SET next_position = cp_log_heads.next_position + 1
         RETURNING next_position - 1 AS position`,
        [table, key],
      )) as Record<string, unknown>[];
      if (allocated.length === 0) {
        throw new CorruptPersistedState(
          `cp_log_heads ${table}/${key}`,
          "the position allocator returned no row, so no ordered position could be assigned",
        );
      }

      const inserted = (await run(
        "append:insert",
        recordClass,
        `INSERT INTO ${table} (log_key, record_id, position, recorded_at, record)
         VALUES ($1, $2, $3, $4, $5::jsonb)
         ON CONFLICT (log_key, record_id) DO NOTHING
         RETURNING position`,
        [key, recordId, Number(allocated[0].position), now, JSON.stringify(record)],
      )) as Record<string, unknown>[];

      if (inserted.length > 0) {
        return {
          appended: true,
          recordId,
          record,
          position: Number(inserted[0].position),
        };
      }

      const existing = (await run(
        "append:reread",
        recordClass,
        `SELECT position, record FROM ${table} WHERE log_key = $1 AND record_id = $2`,
        [key, recordId],
      )) as Record<string, unknown>[];
      if (existing.length === 0) {
        throw new CorruptPersistedState(
          `${table} ${key}/${recordId}`,
          "the append conflicted and the conflicting record could not be read back",
        );
      }
      const held = parseValue<T>(existing[0].record, `${table} ${key}/${recordId}`);
      if (canonicalJson(held) !== canonicalJson(record)) {
        throw new AppendOnlyViolation(
          log,
          recordId,
          canonicalJson(held),
          canonicalJson(record),
        );
      }

      return { appended: false, recordId, record: held, position: Number(existing[0].position) };
    },

    async read(key) {

      const out: T[] = [];
      let afterPosition = -1;
      for (;;) {
        const rows = (await run(
          "read",
          "PAGE",
          `SELECT position, record FROM ${table}
           WHERE log_key = $1 AND position > $2
           ORDER BY position ASC
           LIMIT ${APPEND_ONLY_LOG_READ_PAGE}`,
          [key, afterPosition],
        )) as Record<string, unknown>[];
        for (const r of rows) out.push(parseValue<T>(r.record, `${table} ${key}`));
        if (rows.length < APPEND_ONLY_LOG_READ_PAGE) break;
        afterPosition = Number(rows[rows.length - 1].position);
      }
      return out;
    },

    async readWhere(key, path, value) {

      const jsonPath = jsonPathLiteral(table, path);
      const out: T[] = [];
      let afterPosition = -1;
      for (;;) {
        const rows = (await run(
          "readWhere",
          "PAGE",
          `SELECT position, record FROM ${table}
           WHERE log_key = $1 AND position > $2 AND record #>> '${jsonPath}' = $3
           ORDER BY position ASC
           LIMIT ${APPEND_ONLY_LOG_READ_PAGE}`,
          [key, afterPosition, value],
        )) as Record<string, unknown>[];
        for (const r of rows) out.push(parseValue<T>(r.record, `${table} ${key}`));
        if (rows.length < APPEND_ONLY_LOG_READ_PAGE) break;
        afterPosition = Number(rows[rows.length - 1].position);
      }
      return out;
    },

    async readRecentWhere(key, path, value, limit, projection, recordedAtSince) {

      const jsonPath = jsonPathLiteral(table, path);
      const narrowed = recordProjectionSql(table, projection);
      if (copies !== null && recordedAtSince === undefined) {

        return copies.recentWhere(table, JSON.stringify([key, path, value, limit, projection]), limit, async (since) => {
          const clock = (await run("readRecentWhere:clock", "POINT", "SELECT now() AS read_at")) as Record<string, unknown>[];
          const rows = (await run(
            "readRecentWhere",
            "PAGE",
            `SELECT position, ${narrowed} AS record FROM ${table}
             WHERE log_key = $1 AND record #>> '${jsonPath}' = $2${since === null ? "" : " AND changed_at >= $4::timestamptz"}
             ORDER BY position DESC
             LIMIT $3`,
            [key, value, Math.max(0, Math.trunc(limit)), ...(since === null ? [] : [since])],
          )) as Record<string, unknown>[];
          return { rows: rows.map((r) => ({ position: Number(r.position), record: parseValue<unknown>(r.record, `${table} ${key}`) })),
            through: new Date(clock[0]?.read_at as string).toISOString() };
        });
      }
      const rows = (await run(
        "readRecentWhere",
        "PAGE",
        `SELECT ${narrowed} AS record FROM ${table}
         WHERE log_key = $1 AND record #>> '${jsonPath}' = $2${recordedAtSince === undefined ? "" : " AND recorded_at >= $4::timestamptz"}
         ORDER BY position DESC
         LIMIT $3`,
        [key, value, Math.max(0, Math.trunc(limit)), ...(recordedAtSince === undefined ? [] : [recordedAtSince])],
      )) as Record<string, unknown>[];
      return rows.map((r) => parseValue<unknown>(r.record, `${table} ${key}`));
    },

    async readSince(since) {
      const out: T[] = [];
      let cursor: { readonly key: string; readonly position: number } | null = null;
      for (;;) {
        const rows = (await run(
          "readSince",
          "PAGE",
          `SELECT log_key, position, record FROM ${table}
           WHERE recorded_at >= $1::timestamptz${cursor === null ? "" : " AND (log_key, position) > ($2, $3)"}
           ORDER BY log_key ASC, position ASC
           LIMIT ${APPEND_ONLY_LOG_READ_PAGE}`,
          cursor === null ? [since] : [since, cursor.key, cursor.position],
        )) as Record<string, unknown>[];
        for (const row of rows) out.push(parseValue<T>(row.record, `${table} ${String(row.log_key)}`));
        if (rows.length < APPEND_ONLY_LOG_READ_PAGE) break;
        const last = rows[rows.length - 1];
        cursor = { key: String(last.log_key), position: Number(last.position) };
      }
      return out;
    },

    readStampedBetween: (from, until, page, options: SnapshotStampedReadOptions = {}) => pagedRecords("readStampedBetween", at => {
      const filters = [recordState, `recorded_at >= ${at(from)}::timestamptz`, `recorded_at < ${at(until)}::timestamptz`];
      if (options.timeRange) {
        const { path, from: lo, until: hi } = options.timeRange;
        const time = `record #>> '${jsonPathLiteral(table, path)}'`;
        // Noncanonical stamps still reach the caller's Date.parse handling.
        filters.push(`(${time} IS NULL OR ${time} !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$' OR ` +
          `(${time} >= ${at(lo)}::text AND ${time} < ${at(hi)}::text))`);
      }
      return filters;
    }, options.projection ? recordProjectionSql(table, options.projection) : "record", page),

    readAll: () => heldAll(record => record),
    readAllNarrowed: projection => heldAll(record => projectRecord(record, projection)),
    readChangedSince,

    async readRecent(key, limit) {

      const rows = (await run(
        "readRecent",
        "PAGE",
        `SELECT record FROM ${table} WHERE log_key = $1 ORDER BY position DESC LIMIT $2`,
        [key, Math.max(0, Math.trunc(limit))],
      )) as Record<string, unknown>[];
      return rows.map((r) => parseValue<T>(r.record, `${table} ${key}`));
    },

    async readLatest(keys, projection) {

      const narrowed = recordProjectionSql(table, projection);
      const unique = [...new Set(keys)];
      const out = new Map<string, unknown>();

      for (let at = 0; at < unique.length; at += APPEND_ONLY_LOG_READ_PAGE) {
        const rows = (await run(
          "readLatest",
          "PAGE",
          `SELECT latest.log_key, ${narrowed} AS record FROM (
             SELECT DISTINCT ON (log_key) log_key, record FROM ${table}
             WHERE log_key = ANY($1::text[])
             ORDER BY log_key ASC, position DESC
           ) AS latest`,
          [unique.slice(at, at + APPEND_ONLY_LOG_READ_PAGE)],
        )) as Record<string, unknown>[];
        for (const r of rows) out.set(String(r.log_key), parseValue<unknown>(r.record, `${table} ${String(r.log_key)}`));
      }
      return out;
    },

    async readKeys(keys: readonly string[], projection?: RecordProjection) {
      /* Keyset-paged on `(log_key, position)` (the log's unique order index), so a response stays under the 64 MiB cap
         however many records the keys hold, and the keys cost a few statements, not one each. */
      const unique = [...new Set(keys)];
      const out = new Map<string, T[]>();
      if (unique.length === 0) return out;
      let afterKey = "";
      let afterPosition = -1;
      for (;;) {
        const rows = (await run(
          "readKeys",
          "PAGE",
          `SELECT log_key, position, ${projection ? recordProjectionSql(table, projection) : "record"} AS record FROM ${table}
           WHERE log_key = ANY($1::text[]) AND (log_key, position) > ($2, $3)
           ORDER BY log_key ASC, position ASC
           LIMIT ${APPEND_ONLY_LOG_READ_PAGE}`,
          [unique, afterKey, afterPosition],
        )) as Record<string, unknown>[];
        for (const r of rows) {
          const key = String(r.log_key);
          const held = out.get(key);
          const record = parseValue<T>(r.record, `${table} ${key}`);
          if (held) held.push(record);
          else out.set(key, [record]);
        }
        if (rows.length < APPEND_ONLY_LOG_READ_PAGE) break;
        afterKey = String(rows[rows.length - 1].log_key);
        afterPosition = Number(rows[rows.length - 1].position);
      }
      return out;
    },

    async keys() {
      const rows = (await run(
        "keys",
        "PAGE",
        `SELECT DISTINCT log_key FROM ${table}${pipelineState?` WHERE ${pipelineState}`:""} ORDER BY log_key ASC`,
      )) as Record<string, unknown>[];
      return rows.map((r) => String(r.log_key));
    },

    async keysWhere(path, value) {

      const jsonPath = jsonPathLiteral(table, path);
      const rows = (await run(
        "keysWhere",
        "PAGE",
        `SELECT DISTINCT log_key FROM ${table} WHERE record #>> '${jsonPath}' = $1${pipelineState?` AND ${pipelineState}`:""} ORDER BY log_key ASC`,
        [value],
      )) as Record<string, unknown>[];
      return rows.map((r) => String(r.log_key));
    },
  });
}

// Alternate retries and new findings. Each branch is bounded before ranking, and a poison finding's own retry clock cannot pin a page.
export const BOX_DUE_SQL = `WITH due AS (
    (SELECT 0 AS rank, id, value FROM cp_box_findings WHERE value->>'state' = 'waiting' AND (value #>> '{waitingFor,slots}') IS NOT NULL
      AND ((value #>> '{waitingFor,slots}') <> $1 OR (value #>> '{waitingFor,retryAt}') <= $2) ORDER BY id LIMIT $3)
    UNION ALL (SELECT 0, id, value FROM cp_box_findings WHERE value->>'state' = 'refused' AND (value #>> '{attempts,-1,builder}') = '${PUBLISHER}'
      AND (coalesce(value #>> '{waitingFor,slots}', '') <> $1 OR (value #>> '{waitingFor,retryAt}') <= $2) ORDER BY id LIMIT $3)
    UNION ALL (SELECT 0, id, value FROM cp_box_findings WHERE value->>'state' = 'taken' AND (value #>> '{claim,expiresAt}') <= $2 ORDER BY id LIMIT $3)
    UNION ALL (SELECT 1, id, value FROM cp_box_findings WHERE value->>'state' = 'waiting' AND (value #>> '{waitingFor,slots}') IS NULL ORDER BY id LIMIT $3)
  ) SELECT id, value FROM (SELECT *, row_number() OVER (PARTITION BY rank ORDER BY id) AS turn FROM due) fair
  ORDER BY turn, rank, id LIMIT $3`;
const BOX_WAITING_SQL = `SELECT id, value FROM cp_box_findings WHERE value->>'state' = 'waiting' AND (value #>> '{waitingFor,reason}') = $1 AND ($3::text[] IS NULL OR value->>'subjectId'=ANY($3::text[])) ORDER BY id LIMIT $2`;

// A government's boards are every subject from `<government>` up to `<government>#...`; the store collates in C, so `#` then `$` bounds them in the subject index.
const BOX_UNDER_SQL = `WITH under AS MATERIALIZED (SELECT id, value FROM cp_box_findings
    WHERE value #>> '{subjectId}' = $3 OR (value #>> '{subjectId}' > $3 || '#' AND value #>> '{subjectId}' < $3 || '$'))
  SELECT id, value FROM under WHERE value->>'state' = 'waiting' AND (value #>> '{waitingFor,reason}') = $1 ORDER BY id LIMIT $2`;

function pgBoxRepository(sql: Sql, options: PgRepositoryBounds = {}): BoxRepository {
  const run = boundedRunner(sql, "cp_box_findings", options.bounds ?? CONTROL_PLANE_REQUEST_BOUNDS_MS);
  const rows = (found: readonly Record<string, unknown>[]) => found.map(row => parseValue<BoxFinding>(row.value, `cp_box_findings id ${String(row.id)}`));
  return { ...pgAggregateRepository<BoxFinding>(sql, "BoxFinding", "cp_box_findings", options),
    due: async ({ slots, now, limit }) => rows(await run("boxDue", "PAGE", BOX_DUE_SQL, [slots, now, Math.max(0, Math.trunc(limit))]) as Record<string, unknown>[]),
    waitingFor: async (reason, limit, subjectIds) => rows(await run("boxWaitingFor", "PAGE", BOX_WAITING_SQL, [reason, Math.max(0, Math.trunc(limit)), subjectIds ?? null]) as Record<string, unknown>[]),
    waitingUnder: async (reason, limit, governmentIds) => (await Promise.all([...new Set(governmentIds)].map(async id =>
      rows(await run("boxWaitingUnder", "PAGE", BOX_UNDER_SQL, [reason, Math.max(0, Math.trunc(limit)), id]) as Record<string, unknown>[])))).flat(),
  };
}

export async function pgArtifactsByCanonicalUrl(sql: Sql, url: string, limit: number, options: PgRepositoryBounds = {}): Promise<readonly ArtifactRecord[]> {
  const run = boundedRunner(sql, "cp_log_artifacts", options.bounds ?? CONTROL_PLANE_REQUEST_BOUNDS_MS);
  const rows = await run("artifactsByCanonicalUrl", "PAGE",
    `SELECT record FROM cp_log_artifacts WHERE md5(record->>'canonicalUrl') = md5($1) AND record->>'canonicalUrl' = $1
     ORDER BY record->>'recordedAt' DESC NULLS LAST, record->>'artifactId' ASC LIMIT $2`,
    [url, Math.max(0, Math.trunc(limit))]) as Record<string, unknown>[];
  return rows.map(row => parseValue<ArtifactRecord>(row.record, "cp_log_artifacts source capture"));
}

const CAPTURED_URLS_PAGE = 1000;

export async function pgCapturedCanonicalUrls(sql: Sql, urls: readonly string[], options: PgRepositoryBounds = {}): Promise<ReadonlySet<string>> {
  const run = boundedRunner(sql, "cp_log_artifacts", options.bounds ?? CONTROL_PLANE_REQUEST_BOUNDS_MS);
  const held = new Set<string>();
  const unique = [...new Set(urls)];
  for (let at = 0; at < unique.length; at += CAPTURED_URLS_PAGE) {
    const page = unique.slice(at, at + CAPTURED_URLS_PAGE);
    const rows = await run("capturedCanonicalUrls", "PAGE", CAPTURED_URLS_SQL,
      [page.map((url) => createHash("md5").update(url, "utf8").digest("hex")), page]) as Record<string, unknown>[];
    for (const row of rows) held.add(String(row.url));
  }
  return held;
}

export const CAPTURED_URLS_SQL = `SELECT DISTINCT record->>'canonicalUrl' AS url FROM cp_log_artifacts
     WHERE md5(record->>'canonicalUrl') = ANY($1::text[]) AND record->>'canonicalUrl' = ANY($2::text[])`;

function pgLockManager(connectionString: string): LockManager {
  return {
    async withLock<R>(name: string, fn: () => Promise<R>): Promise<R> {
      if (!neonConfig.webSocketConstructor) neonConfig.webSocketConstructor = globalThis.WebSocket;

      const direct = new URL(connectionString);
      direct.hostname = direct.hostname.replace("-pooler.", ".");
      const pool = new Pool({ connectionString: direct.toString() });
      try {
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          const got = await client.query("SELECT pg_try_advisory_xact_lock($1::bigint) AS ok", [advisoryLockKey(name).toString()]);
          if (!got.rows[0]?.ok) {
            const { RepositoryLockHeld } = await import("./types.ts");
            throw new RepositoryLockHeld(name, "another pinned transaction holds this repository lock");
          }
          const result = await fn();
          await client.query("COMMIT");
          return result;
        } catch (error) {
          await client.query("ROLLBACK").catch(() => {});
          throw error;
        } finally { client.release(); }
      } finally { await pool.end(); }
    },
  };
}

const SOURCE_INDEX_BUILD_MS = 15 * 60_000;
const indexStatusSql = (name: string) => `SELECT i.indisvalid AS valid,
  EXISTS (SELECT 1 FROM pg_stat_progress_create_index p WHERE p.index_relid = i.indexrelid) AS building
  FROM pg_index i WHERE i.indexrelid = to_regclass('${name}')`;

export async function pgEnsureArtifactSourceIndex(
  sql: Sql,
  bounds: ControlPlaneRequestBounds = CONTROL_PLANE_REQUEST_BOUNDS_MS,
): Promise<void> {
  return pgEnsureOnlineIndex(sql, ARTIFACT_SOURCE_INDEX, bounds);
}

export async function pgEnsureOnlineIndex(
  sql: Sql,
  index: OnlineIndex,
  bounds: ControlPlaneRequestBounds = CONTROL_PLANE_REQUEST_BOUNDS_MS,
): Promise<void> {
  const run = boundedRunner(sql, `cp_schema.${index.name}`, bounds);
  const statusSql = indexStatusSql(index.name);

  const current = await run("status", "POINT", statusSql) as { valid: boolean }[];
  if (current[0]?.valid === true) return;
  if (sql.withPinnedConnection) return sql.withPinnedConnection(pinned => pgEnsureOnlineIndex(pinned, index, bounds));
  const key = advisoryLockKey(`cp_schema.${index.name}`).toString();
  const locks = await run("lock", "POINT", "SELECT pg_try_advisory_lock($1::bigint) AS locked", [key]) as { locked: boolean }[];
  if (locks[0]?.locked !== true) {
    throw new Error(`${index.inProgressCode}: another bootstrap owns ${index.name}; retry on the next runner cycle`);
  }
  try {
    const status = await run("statusLocked", "POINT", statusSql) as { valid: boolean; building: boolean }[];
    if (status[0]?.valid === true) return;

    if (status[0]?.building === true) {
      throw new Error(`${index.inProgressCode}: ${index.name} has an active builder; retry on the next runner cycle`);
    }
    const ddlRun = boundedRunner(sql, `cp_schema.${index.name}`, { ...bounds, POINT: SOURCE_INDEX_BUILD_MS });
    await run("buildTimeout", "POINT", `SET statement_timeout = ${SOURCE_INDEX_BUILD_MS}`);
    if (status[0]?.valid === false) {
      await ddlRun("dropInvalid", "POINT", `DROP INDEX CONCURRENTLY IF EXISTS ${index.name}`);
    }
    await ddlRun("create", "POINT", index.ddl);
  } finally {

    await run("unlock", "POINT", "SELECT pg_advisory_unlock($1::bigint)", [key]).catch(() => {});
    await run("restoreTimeout", "POINT", `SET statement_timeout = ${bounds.POINT}`).catch(() => {});
  }
}

export async function bootstrap(
  sql: Sql,
  nowIso: string,
  bounds: ControlPlaneRequestBounds = CONTROL_PLANE_REQUEST_BOUNDS_MS,
): Promise<void> {
  const run = boundedRunner(sql, "cp_schema", bounds);
  if (process.env.WTP_RUNTIME_MODE === "production" || process.env.NETLIFY === "true" && process.env.CONTEXT === "production") {
    const rows = await run("migration", "POINT", "SELECT id FROM cp_migrations WHERE id='CP-01_expand' AND completed_at IS NOT NULL") as { id: string }[];
    if (!rows.length) throw new Error("CONTROL_PLANE_MIGRATION_REQUIRED: CP-01_expand");
    return;
  }
  for (const statement of BOOTSTRAP_DDL) {

    if (statement === SPEND_HOLDS_MOVE_DDL && !spendHoldsTableEnabled()) continue;
    const online = ONLINE_INDEXES.get(statement);
    if (online) await pgEnsureOnlineIndex(sql, online, bounds);
    else await run("bootstrap", "POINT", statement);
  }
  const versions = await run("readVersion", "POINT", "SELECT version FROM cp_schema_version WHERE singleton") as { version: number }[];
  if ((versions[0]?.version ?? 0) < 33) await migrateVotingDoorScopes(sql, nowIso, bounds);
  await run("recordVersion", "POINT", recordVersionStatement(BOOTSTRAP_VERSION, nowIso));
}

async function migrateVotingDoorScopes(sql: Sql, nowIso: string,
  bounds: ControlPlaneRequestBounds = CONTROL_PLANE_REQUEST_BOUNDS_MS): Promise<void> {
  const run = boundedRunner(sql, "cp_doors", bounds);
  let after = "";
  for (;;) {
    const rows = await run("migrateVotingDoorScopes", "PAGE", `SELECT id, revision, value->'config' AS config FROM cp_doors
      WHERE value->>'kind'='official-voting-source' AND id>$1 ORDER BY id LIMIT 250`, [after]) as
      { id: string; revision: number; config: DoorRecord["config"] }[];
    for (const row of rows) {
      try {
        const primary = JSON.parse(String(row.config.votingSource)) as VotingSourceDoor;
        const mappings = [primary, ...JSON.parse(String(row.config.votingMappings ?? "[]")) as VotingSourceDoor[]];
        const url = pageAddress(primary.url)?.url;
        if (!url) throw new Error("Voting source door has no public URL.");
        const patch = { url, ...Object.fromEntries(mappings.map(source => [`votingState_${requireBallotState(source.scope.state)}`, true])) };
        if (Object.entries(patch).every(([key, value]) => row.config[key] === value)) continue;
        const changed = await run("migrateVotingDoorScopes", "POINT", `UPDATE cp_doors SET
          value=jsonb_set(value,'{config}',value->'config'||$3::jsonb)||jsonb_build_object('updatedAt',$4::text),
          revision=revision+1,updated_at=$4::timestamptz WHERE id=$1 AND revision=$2 RETURNING id`,
        [row.id, row.revision, JSON.stringify(patch), nowIso]) as { id: string }[];
        if (!changed.length) throw new ConcurrentModification("Door", row.id, Number(row.revision), null);
      } catch (error) {
        console.error("VOTING_DOOR_SCOPE_MIGRATION_FAILED", { id: row.id, error: error instanceof Error ? error.message : String(error) });
      }
    }
    if (rows.length < 250) return;
    after = rows.at(-1)!.id;
  }
}

const FIELD_MANUAL_MATCHES_SQL = `SELECT id,value FROM cp_field_manual_entries
  WHERE ($1::text[] IS NULL OR value->>'role'=ANY($1::text[]))
    AND ($2::text[] IS NULL OR value->>'kind'=ANY($2::text[]))
    AND ($3::text IS NULL OR jsonb_array_length(coalesce(value->'recordClasses','[]'::jsonb))=0 OR value->'recordClasses' ? $3)
    AND NOT(value->>'kind'=ANY($8::text[])) AND ($9::text IS NULL OR id>$9)
    AND ($10::text IS NULL OR value->'states' ? $10)
    AND (($4::boolean AND ($6::text IS NULL OR jsonb_array_length(coalesce(value->'platforms','[]'::jsonb))=0 OR value->'platforms' ? $6))
      OR (NOT $4 AND (coalesce(value->'reach'->'places','[]'::jsonb) ?| $5::text[]
        OR ($7::text IS NOT NULL AND coalesce(value->'reach'->'states','[]'::jsonb) ? $7)
        OR coalesce((value->'reach'->>'everywhere')::boolean,false)
        OR (jsonb_array_length(coalesce(value->'reach'->'platforms','[]'::jsonb))>0 AND ($6::text IS NULL OR value->'reach'->'platforms' ? $6))
        OR (((value->>'kind' IN (${[...TRANSFERABLE_METHOD_KINDS].map(kind=>`'${kind}'`).join(",")})
          AND (value->>'url' IS NULL OR jsonb_array_length(coalesce(value->'platforms','[]'::jsonb))>0))
          OR coalesce((value->'reach'->>'method')::boolean,false))
          AND ($6::text IS NULL OR jsonb_array_length(coalesce(value->'platforms','[]'::jsonb))=0 OR value->'platforms' ? $6)))))
  ORDER BY id LIMIT ${AGGREGATE_LIST_READ_PAGE}`;

export const FIELD_MANUAL_SLICE_SQL = `WITH eligible AS NOT MATERIALIZED (
  SELECT id,value FROM cp_field_manual_entries
    WHERE ($1::text[] IS NULL OR value->>'role'=ANY($1::text[]))
      AND ($2::text[] IS NULL OR value->>'kind'=ANY($2::text[]))
      AND ($3::text IS NULL OR jsonb_array_length(coalesce(value->'recordClasses','[]'::jsonb))=0 OR value->'recordClasses' ? $3)
      AND NOT(value->>'kind'=ANY($13::text[]))
      AND ($14::text IS NULL OR value->'states' ? $14)
), broad AS (
  SELECT picked.id FROM unnest(coalesce($1::text[],ARRAY[${FIELD_MANUAL_ROLES.map(role=>`'${role}'`).join(",")}])) r(role)
  CROSS JOIN (VALUES(false),(true)) reach(global)
  CROSS JOIN (VALUES(false),(true)) classes(empty)
  CROSS JOIN (VALUES(false),(true)) preference(preferred)
  CROSS JOIN LATERAL (
    SELECT id FROM eligible
    WHERE ${MANUAL_PLAIN_SQL} AND value->>'role'=r.role AND ${MANUAL_BROAD_SQL}=reach.global
      AND ($4::boolean OR reach.global) AND ${MANUAL_EMPTY_CLASS_SQL}=classes.empty
      AND (NOT preference.preferred OR ($11::text[] IS NOT NULL AND cardinality($11)>0 AND NOT classes.empty AND coalesce(value->'recordClasses','[]'::jsonb) ?| $11))
      AND (NOT preference.preferred OR $4 OR EXISTS (SELECT 1 FROM cp_field_manual_entries
        WHERE ${MANUAL_PLAIN_SQL} AND ${MANUAL_BROAD_SQL} AND (value->'role') @> to_jsonb(r.role)
          AND coalesce(value->'recordClasses','[]'::jsonb) ?| $11))
      AND (($4 AND ($6::text IS NULL OR jsonb_array_length(coalesce(value->'platforms','[]'::jsonb))=0 OR value->'platforms' ? $6))
        OR (NOT $4 AND (coalesce((value->'reach'->>'everywhere')::boolean,false)
          OR (jsonb_array_length(coalesce(value->'reach'->'platforms','[]'::jsonb))>0 AND ($6::text IS NULL OR value->'reach'->'platforms' ? $6)))))
    ORDER BY ${MANUAL_OUTCOME_SQL},coalesce(value->>'observedAt','') COLLATE "C" DESC,id COLLATE "C"
    LIMIT $8::int
  ) picked
), method_pool AS (
  ${MANUAL_METHOD_POOL_SQL}
), candidates AS NOT MATERIALIZED (
  SELECT id FROM broad
  UNION SELECT id FROM eligible WHERE coalesce(value->'reach'->'places','[]'::jsonb) ?| $5::text[]
    AND (NOT $4 OR $6::text IS NULL OR jsonb_array_length(coalesce(value->'platforms','[]'::jsonb))=0 OR value->'platforms' ? $6)
  UNION SELECT id FROM eligible WHERE NOT ${MANUAL_METHOD_SQL} AND $7::text IS NOT NULL AND coalesce(value->'reach'->'states','[]'::jsonb) ? $7
    AND (NOT $4 OR $6::text IS NULL OR jsonb_array_length(coalesce(value->'platforms','[]'::jsonb))=0 OR value->'platforms' ? $6)
  UNION SELECT id FROM eligible WHERE NOT ${MANUAL_METHOD_SQL} AND $6::text IS NOT NULL AND coalesce(value->'reach'->'platforms','[]'::jsonb) ? $6
    AND (NOT $4 OR jsonb_array_length(coalesce(value->'platforms','[]'::jsonb))=0 OR value->'platforms' ? $6)
  UNION SELECT id FROM eligible WHERE value->>'kind'='EXHAUSTED_RUNGS' AND value #>> '{payload,subjectId}'=$9
    AND (($4 AND ($6::text IS NULL OR jsonb_array_length(coalesce(value->'platforms','[]'::jsonb))=0 OR value->'platforms' ? $6))
      OR (NOT $4 AND (coalesce((value->'reach'->>'everywhere')::boolean,false)
        OR (jsonb_array_length(coalesce(value->'reach'->'platforms','[]'::jsonb))>0 AND ($6::text IS NULL OR value->'reach'->'platforms' ? $6)))))
  UNION SELECT id FROM method_pool
  UNION SELECT id FROM eligible WHERE id IN(SELECT method_id FROM cp_fix_map WHERE place_id=ANY($10::text[]) AND state='WORKS')
  UNION SELECT id FROM eligible WHERE id IN(SELECT entry_id FROM cp_manual_method_meta WHERE legacy_here ?| $5::text[])

), scored AS NOT MATERIALIZED (
  SELECT e.id,
    CASE WHEN flags.method THEN method.tier
      ELSE CASE WHEN flags.here THEN 1 WHEN ($7::text IS NOT NULL AND n.reach->'states' ? $7)
        OR ($6::text IS NOT NULL AND n.reach->'platforms' ? $6) THEN 2 ELSE 3 END END AS tier,
    CASE WHEN $11::text[] IS NULL THEN 0 WHEN n."recordClasses" ?| $11 THEN 0 ELSE 1 END AS preferred,
    CASE WHEN $11::text[] IS NULL THEN 0 WHEN jsonb_array_length(coalesce(n."recordClasses",'[]'::jsonb))=0 THEN 0 ELSE 1 END AS any_class,
    CASE WHEN n.kind='EXHAUSTED_RUNGS' THEN 1 ELSE 0 END AS exhausted,
    CASE n.outcome ${Object.entries(OUTCOME_RANK).map(([outcome,rank])=>`WHEN '${outcome}' THEN ${rank}`).join(" ")} ELSE 5 END AS outcome,
    coalesce(n."observedAt",'') AS observed
  -- Keep metadata parsing behind the indexed reach lookup.
  FROM candidates c CROSS JOIN LATERAL (SELECT id,value FROM cp_field_manual_entries WHERE id=c.id OFFSET 0) e
  CROSS JOIN LATERAL jsonb_to_record(e.value) AS n(kind text,outcome text,"observedAt" text,"recordClasses" jsonb,
    reach jsonb,platforms jsonb,url text,"ocdIds" jsonb,"bodyIds" jsonb,states jsonb,"placeResults" jsonb)
  CROSS JOIN LATERAL (SELECT coalesce(n.reach->'places','[]'::jsonb) ?| $5::text[] AS here,
    ((n.kind IN (${[...TRANSFERABLE_METHOD_KINDS].map(kind=>`'${kind}'`).join(",")}) AND(n.url IS NULL OR jsonb_array_length(coalesce(n.platforms,'[]'::jsonb))>0))
      OR coalesce((n.reach->>'method')::boolean,false)) AS method) flags
  LEFT JOIN LATERAL (
    SELECT CASE WHEN status.here='FAILS' THEN NULL WHEN status.here='WORKS' OR flags.here THEN 1
      WHEN $7::text=ANY(coalesce(legacy.states,'{}'::text[])||coalesce(working.states,'{}'::text[])) THEN 2
      WHEN (SELECT count(DISTINCT proof.state) FROM unnest(coalesce(legacy.states,'{}'::text[])||coalesce(working.states,'{}'::text[])) proof(state))>=3 THEN 3
      WHEN cardinality(coalesce(legacy.states,'{}'::text[])||coalesce(working.states,'{}'::text[]))>0
        OR coalesce(legacy.any_place,false) OR coalesce(working.any_place,false) THEN 4 ELSE 5 END AS tier
    FROM (SELECT 1) one
    LEFT JOIN LATERAL (SELECT state FROM cp_fix_map
      WHERE method_id=e.id AND place_id=ANY($10::text[]) ORDER BY place_id LIMIT 1) fixed ON true
  LEFT JOIN LATERAL (
    SELECT EXISTS(SELECT 1 FROM unnest($5::text[]) places(place) WHERE m.legacy_here->>place='FAILS') AS failed_here,
      EXISTS(SELECT 1 FROM unnest($5::text[]) places(place) WHERE m.legacy_here->>place='WORKS') AS worked_here,
      m.legacy_any AS any_place,m.legacy_states AS states FROM cp_manual_method_meta m WHERE m.entry_id=e.id
  ) legacy ON true
  LEFT JOIN LATERAL (SELECT m.working_any AS any_place,m.working_states AS states FROM cp_manual_method_meta m WHERE m.entry_id=e.id) working ON true
  CROSS JOIN LATERAL (SELECT coalesce(nullif(fixed.state,'UNTRIED'),CASE WHEN legacy.failed_here THEN 'FAILS' WHEN legacy.worked_here THEN 'WORKS' END) AS here) status
    WHERE flags.method OFFSET 0
  ) method ON true
  WHERE n.kind NOT IN(${[...BOOKKEEPING_KINDS].map(kind=>`'${kind}'`).join(",")})
    AND(n.kind<>'EXHAUSTED_RUNGS' OR ($9::text IS NOT NULL AND jsonb_typeof(e.value #> '{payload,subjectId}')='string' AND e.value #>> '{payload,subjectId}'=$9
      AND($12::text[] IS NULL OR n."recordClasses" ?| $12)))
  -- Compute each rank once while streaming the matching history.
  OFFSET 0
), chosen AS (
  SELECT * FROM scored WHERE tier IS NOT NULL
  ORDER BY preferred,tier,any_class,exhausted DESC,outcome,observed COLLATE "C" DESC,id COLLATE "C"
  LIMIT $8::int
)
SELECT e.id,e.value
FROM chosen JOIN cp_field_manual_entries e ON e.id=chosen.id
ORDER BY chosen.preferred,chosen.tier,chosen.any_class,chosen.exhausted DESC,chosen.outcome,chosen.observed COLLATE "C" DESC,chosen.id COLLATE "C"`;

export function fieldManualSliceParams(query: FieldManualQuery): unknown[] {
  return [
    query.role === undefined ? null : [...new Set([query.role, "SHARED"])],
    query.kinds === undefined ? null : [...query.kinds],
    query.recordClass?.toLowerCase() ?? null,
    query.everywhere === true,
    coveringPlaces(query),
    query.platform?.toLowerCase() ?? null,
    queryState(query) ?? null,
    query.limit??null,query.subjectId??null,methodEvidencePlaces(query),query.preferredRecordClasses??null,
    query.requiredExhaustedClasses?.length?query.requiredExhaustedClasses:null,query.excludedKinds??[],query.withinState?.toLowerCase()??null,
  ];
}

export function pgFieldManualRepository(sql:Sql,options:PgRepositoryBounds,fixMap:()=>FixMapRepository):FieldManualRepository {
  const base=pgAggregateRepository<FieldManualEntry>(sql,"FieldManualEntry","cp_field_manual_entries",options);
  const run=boundedRunner(sql,"cp_field_manual_entries",options.bounds??CONTROL_PLANE_REQUEST_BOUNDS_MS);
  const repository:FieldManualRepository={
    ...base,readMany:base.readMany!,
    async learnedRoutes(routeIds) {
      const rows=await run("learnedRoutes","PAGE",MANUAL_LEARNED_ROUTES_SQL,[[...new Set(routeIds)]]) as {summary:unknown}[];
      return parseValue<{present:boolean;routeIds:readonly string[]}>(rows[0].summary,"cp_field_manual_entries route summary");
    },
    async sourceHints(scope,url) {
      const rows=await run("sourceHints","PAGE",MANUAL_SOURCE_HINTS_SQL,[coveringPlaces(scope),queryState(scope)??null,sourceOriginKeys(url)]) as {hint:unknown}[];
      return rows.map(row=>parseValue<FieldManualSourceHint>(row.hint,"cp_field_manual_entries source hint"));
    },
    async retireInstructions(){await run("retireInstructions","DOCUMENT",retireInstructionsSql(),[]);},
    async insertNew(entries,now) {
      const inserted=new Set<string>();
      for(let at=0;at<entries.length;at+=AGGREGATE_LIST_READ_PAGE) {
        const page=entries.slice(at,at+AGGREGATE_LIST_READ_PAGE);
        const rows=await run("insertNew","PAGE",`INSERT INTO cp_field_manual_entries(id,revision,updated_at,value)
          SELECT e->>'id',1,$2::timestamptz,e FROM jsonb_array_elements($1::jsonb) e ON CONFLICT(id) DO NOTHING RETURNING id`,[JSON.stringify(page),now]) as Record<string,unknown>[];
        for(const row of rows)inserted.add(String(row.id));
      }
      return inserted;
    },
    async select(query) {
      if(query.limit!==undefined && (!Number.isSafeInteger(query.limit)||query.limit<0))throw new Error("Invalid field-manual note limit");
      const params=fieldManualSliceParams(query),entries:FieldManualEntry[]=[];
      let afterId:string|null=null;
      for(;;) {
        const rows=await run("select","PAGE",query.limit===undefined?FIELD_MANUAL_MATCHES_SQL:FIELD_MANUAL_SLICE_SQL,
          query.limit===undefined?[...params.slice(0,7),params[12],afterId,params[13]]:params) as Record<string,unknown>[];
        for(const row of rows)if(row.id!==null)entries.push(parseValue<FieldManualEntry>(row.value,`cp_field_manual_entries ${String(row.id)}`));
        if(query.limit!==undefined || rows.length<AGGREGATE_LIST_READ_PAGE)break;
        afterId=String(rows.at(-1)!.id);
      }
      const evidence=await readMethodEvidence({fieldManual:repository,fixMap:fixMap()},entries,query);
      return {projection:projectFieldManual({entries},query,evidence),store:{entries},...(evidence?{evidence}:{})};
    },
  };
  return repository;
}

export function pgSpendHoldRepository(sql: Sql, bounds: ControlPlaneRequestBounds = CONTROL_PLANE_REQUEST_BOUNDS_MS): SpendHoldStore {
  const run = boundedRunner(sql, "cp_spend_holds", bounds);
  const since = (now: string) => {
    const ms = Date.parse(now);
    if (!Number.isFinite(ms)) throw new Error(`cp_spend_holds: ${JSON.stringify(now)} is not an instant`);
    const at = (back: number) => new Date(ms - back).toISOString();
    return [at(SPEND_HOLD_WINDOW_MS), at(SPEND_HOLD_STALE_MS), at(SETTLED_HOLD_RETENTION_MS)] as const;
  };
  const holdsOf = (rows: unknown, where: string): Record<string, SpendHold> => {
    const out: Record<string, SpendHold> = {};
    for (const row of rows as Record<string, unknown>[]) {
      const hold = parseValue<SpendHold>(row.hold, where);
      out[hold.holdId] = hold;
    }
    return out;
  };
  const liveSelect = (where: string) =>
    `SELECT ${spendHoldJsonSql("h")} AS hold FROM cp_spend_holds h WHERE ${where}${where ? " AND " : ""}${spendHoldLiveSql("h", "$1::timestamptz", "$2::timestamptz", "$3::timestamptz")} ORDER BY h.hold_id`;
  const sweep = async (now: string): Promise<number> => {
    const rows = await run("sweep", "POINT", `DELETE FROM cp_spend_holds x WHERE x.hold_id IN (SELECT h.hold_id FROM cp_spend_holds h
      WHERE ${spendHoldDeadSql("h", "$1::timestamptz", "$2::timestamptz", "$3::timestamptz")} LIMIT $4::integer) RETURNING x.hold_id`,
      [...since(now), SPEND_HOLD_SWEEP_LIMIT]) as unknown[];
    return rows.length;
  };
  const lineOf = (l: BudgetLine) => ({ key: l.key, budgetUsd: l.budgetUsd, historicalUsd: l.historicalUsd, historyReadAt: l.historyReadAt, lifetime: l.lifetime === true });
  return {
    async admit(input, now): Promise<HoldDecision> {
      since(now);
      const measured = Number.isFinite(input.usd) && input.usd >= 0;
      const rows = await run("admit", "POINT",
        "SELECT cp_admit_spend_hold($1::jsonb, $2::jsonb, $3::timestamptz, $4::bigint, $5::bigint, $6::bigint, $7::integer) AS decision",
        [JSON.stringify({ holdId: input.holdId, jobId: input.jobId, obligationId: input.obligationId, usd: measured ? input.usd : null, what: input.what }),
          JSON.stringify({ sends: input.lines.sends.map(lineOf), areas: input.lines.areas.map(lineOf) }),
          now, SPEND_HOLD_WINDOW_MS, SPEND_HOLD_STALE_MS, SETTLED_HOLD_RETENTION_MS, SPEND_HOLD_SWEEP_LIMIT]) as Record<string, unknown>[];
      const decision = parseValue<{ admit: boolean; hold?: SpendHold | null; refusal?: string; left?: number | string; position?: number }>(rows[0]?.decision, "cp_admit_spend_hold");
      if (decision === null || typeof decision !== "object") throw new CorruptPersistedState("cp_admit_spend_hold", "returned no decision");
      if (decision.admit === true) return { admit: true, hold: decision.hold ?? null };
      const left = Number(decision.left ?? 0);
      if (decision.refusal === "AMOUNT") return invalidAmountRefusal(input);
      if (decision.refusal === "SEND" && input.lines.sends.length > 0) return sendRefusal(input, left);
      const line = everyLineMustFit(input.lines)[Number(decision.position)];
      if (decision.refusal === "AREA" && line !== undefined) return areaRefusal(input, line, left);
      throw new CorruptPersistedState("cp_admit_spend_hold", `an unreadable refusal ${JSON.stringify(decision)}`);
    },
    async settle(input, now) {
      if (input.usd !== null && Number.isFinite(input.usd)) {
        await run("settle", "POINT", `WITH mine AS (
            SELECT h.hold_id, row_number() OVER (ORDER BY h.held_at, h.hold_id COLLATE "C") AS n FROM cp_spend_holds h
            WHERE h.job_id = $4 AND h.cost_recorded_at IS NULL AND ${spendHoldLiveSql("h", "$1::timestamptz", "$2::timestamptz", "$3::timestamptz")})
          UPDATE cp_spend_holds s SET settled_usd = CASE WHEN mine.n = 1 THEN greatest(0, $5::numeric) ELSE 0 END,
            cost_recorded_at = $6::timestamptz, changed_at = now()
          FROM mine WHERE s.hold_id = mine.hold_id RETURNING s.hold_id`,
        [...since(now), input.jobId, input.usd, input.costRecordedAt]);
      }

      await sweep(now);
    },
    async release(holdId, now) {
      since(now);
      await run("release", "POINT", "DELETE FROM cp_spend_holds WHERE hold_id = $1 RETURNING hold_id", [holdId]);
    },
    async liveFor(keys, now) {
      if (keys.length === 0) return {};
      return holdsOf(await run("liveFor", "PAGE", liveSelect("h.keys && $4::text[]"), [...since(now), [...new Set(keys)]]), "cp_spend_holds live on lines");
    },
    async liveAll(now) {
      return holdsOf(await run("liveAll", "PAGE", liveSelect(""), [...since(now)]), "cp_spend_holds live");
    },
    sweep,
  };
}

const connectionForReads = Symbol("control-plane-read-connection");
const placeReadConnection = (repos: ControlPlaneRepositories): Sql | undefined =>
  (repos as ControlPlaneRepositories & { [connectionForReads]?: () => Sql })[connectionForReads]?.();

export function pgHuntOrderRepository(sql:Sql,bounds:ControlPlaneRequestBounds=CONTROL_PLANE_REQUEST_BOUNDS_MS):HuntOrderRepository {
  const run=boundedRunner(sql,"cp_hunt_orders",bounds);
  return {
      ...pgAggregateRepository<HuntOrder>(sql,"HuntOrder","cp_hunt_orders",{bounds}),
      async request(orders,at) {
        await run("huntStop","PAGE",`INSERT INTO cp_hunt_orders(id,revision,updated_at,value)
          SELECT item->>'id',1,$2::timestamptz,item FROM jsonb_array_elements($1::jsonb) item ON CONFLICT(id) DO NOTHING`,[JSON.stringify(orders),at]);
      },
      async latestStop(state) {
        const rows=await run("lastHuntStop","POINT",`SELECT id,revision,updated_at,value FROM cp_hunt_orders
          WHERE value->>'state'=$1 AND value->>'scopeKey' IS NULL ORDER BY value->>'requestedAt' DESC,id DESC LIMIT 1`,[state]) as Record<string,unknown>[];
        return rows.length?{id:String(rows[0].id),revision:Number(rows[0].revision),updatedAt:new Date(rows[0].updated_at as string).toISOString(),value:rows[0].value as HuntOrder}:null;
      },
      async pending(state) {
        const rows=await run("pending","PAGE","SELECT id,revision,updated_at,value FROM cp_hunt_orders WHERE value->>'state'=$1 AND value->>'confirmedAt' IS NULL ORDER BY id",[state]) as Record<string,unknown>[];
        return rows.map(row=>({id:String(row.id),revision:Number(row.revision),updatedAt:new Date(row.updated_at as string).toISOString(),value:row.value as HuntOrder}));
      },
  };
}

export async function readPlanningIntents(repos:ControlPlaneRepositories,state:string|null=repos.planningState??null):Promise<readonly ResearchIntent[]> {
  const stoppedAt=state?(await repos.huntOrders.latestStop(state))?.value.requestedAt??null:null;
  const sql=placeReadConnection(repos);
  if(!sql)return (await repos.researchIntents.read("level-1")).filter(record=>record.kind!=="INTENT" || record.action!=="DISPATCH" || stoppedAt===null || record.requestedAt>stoppedAt);
  return pgPlanningIntents(sql,state,stoppedAt);
}

export async function pgPlanningIntents(sql:Sql,state:string|null,stoppedAt:string|null):Promise<readonly ResearchIntent[]> {
  const run=boundedRunner(sql,"cp_log_research_intents",CONTROL_PLANE_REQUEST_BOUNDS_MS);
  const rows=await run("planningControls","PAGE",`WITH wanted AS MATERIALIZED (
    SELECT latest.position,latest.record FROM unnest($2::text[]) AS actions(action)
    CROSS JOIN LATERAL (SELECT position,record FROM cp_log_research_intents WHERE log_key=$1 AND record->>'kind'='INTENT'
      AND record->>'action'=actions.action ORDER BY record->>'requestedAt' DESC,position DESC LIMIT 1) latest
    UNION SELECT i.position,i.record FROM cp_log_research_intents i WHERE i.log_key=$1 AND i.record->>'kind'='INTENT'
      AND i.record->>'action' IN ('DISPATCH','CANCEL_DISPATCH','RUN_CYCLE_NOW')
      AND (NOT EXISTS(SELECT 1 FROM cp_log_research_intents h WHERE h.log_key=$1 AND h.record->>'honors'=i.record->>'intentId')
        OR i.record->>'action'='DISPATCH' AND $3::text IS NOT NULL AND EXISTS(
          SELECT 1 FROM cp_obligations o WHERE cp_control_state(o.value)=$3
            AND o.value->'assignments' @> jsonb_build_array(jsonb_build_object('ref',i.record->>'intentId'))))
      AND (i.record->>'action'<>'DISPATCH' OR (($4::text IS NULL OR i.record->>'requestedAt'>$4) AND NOT EXISTS(
        SELECT 1 FROM cp_log_research_intents c WHERE c.log_key=$1 AND c.record->>'action'='CANCEL_DISPATCH'
          AND c.record->>'kind'='INTENT' AND c.record->>'note'=i.record->>'intentId')))
  ) SELECT position,record FROM wanted UNION SELECT h.position,h.record FROM cp_log_research_intents h
    WHERE h.log_key=$1 AND h.record->>'honors' IN (SELECT record->>'intentId' FROM wanted) ORDER BY position`,
    ["level-1",["PAUSE","RESUME","PAUSE_RUNNER","RESUME_RUNNER"],state,stoppedAt]) as {record:unknown}[];
  return rows.map(row=>parseValue<ResearchIntent>(row.record,"effective planning controls"));
}

export async function deactivateUnfundedHunts(repos:ControlPlaneRepositories,refs:readonly string[],now:string):Promise<number> {
  const state=repos.planningState;
  if(!state)throw new Error("Hunt reconciliation needs one planning state");
  const sql=placeReadConnection(repos);
  if(sql) {
    const run=boundedRunner(sql,"cp_obligations",CONTROL_PLANE_REQUEST_BOUNDS_MS);
    const rows=await run("stopUnfundedHunts","PAGE",`WITH stopped AS (UPDATE cp_obligations SET revision=revision+1,updated_at=$3::timestamptz,
      value=value || jsonb_build_object('active',false,'nextDueAt',NULL,'updatedAt',$3::text)
      WHERE cp_control_state(value)=$1 AND value->>'active'='true' AND id LIKE 'hunt:packet:%'
        AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(value->'assignments','[]'::jsonb)) mark WHERE mark->>'ref'=ANY($2::text[]))
      RETURNING id) SELECT count(*)::integer AS n FROM stopped`,[state,refs,now]) as {n:number}[];
    return Number(rows[0].n);
  }
  let count=0;
  for(const row of await repos.obligations.listWhere(["materializedBy"],"OWNER_DISPATCH")) {
    if(row.id.startsWith("hunt:packet:") && row.value.active && planningStateOf(row.value.subjectId)===state && !row.value.assignments?.some(mark=>refs.includes(mark.ref))) {
      await repos.obligations.compareAndSet(row.id,row.revision,{...row.value,active:false,nextDueAt:null,updatedAt:now},now);count++;
    }
  }
  return count;
}

export async function readMaterializedPlanningIds(repos:ControlPlaneRepositories,refs:readonly string[]):Promise<ReadonlySet<string>> {
  const sql=placeReadConnection(repos);
  if(!sql) {
    const stops=(repos.planningState?await repos.huntOrders.listWhere(["state"],repos.planningState):await repos.huntOrders.list()).filter(row=>row.value.confirmedAt!==null);
    return new Set((await repos.obligations.listWhere(["materializedBy"],"OWNER_DISPATCH")).filter(row=>
      row.id.startsWith("hunt:packet:")?row.value.assignments?.some(mark=>refs.includes(mark.ref) && !stops.some(stop=>
        stop.value.requestedAt>=mark.at && (stop.value.scopeKey===null || stop.value.scopeKey===mark.assignmentKey))):row.value.active).map(row=>row.id));
  }
  const rows=await sql.query(`SELECT id FROM cp_obligations WHERE cp_control_state(value)=$1 AND value->>'materializedBy'='OWNER_DISPATCH'
    AND ((id NOT LIKE 'hunt:packet:%' AND value->>'active'='true')
      OR EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(value->'assignments','[]'::jsonb)) mark WHERE mark->>'ref'=ANY($2::text[])
        AND NOT EXISTS(SELECT 1 FROM cp_hunt_orders stop WHERE stop.value->>'state'=$1 AND stop.value->>'confirmedAt' IS NOT NULL
          AND stop.value->>'requestedAt'>=mark->>'at' AND (stop.value->>'scopeKey' IS NULL OR stop.value->>'scopeKey'=mark->>'assignmentKey')))) ORDER BY id`,[repos.planningState??"system",refs]) as {id:string}[];
  return new Set(rows.map(row=>row.id));
}

export async function readCoordinatorWorkItems(repos: ControlPlaneRepositories, exaAgentLane = false): Promise<WorkItem[]> {
  const sql = placeReadConnection(repos);
  if (!sql) {
    const items = (await repos.workItems.list()).map(row => row.value);
    const adapterWork = new Map<string, WorkItem>();
    for (const item of items) if (item.autonomousPlan) {
      const held = adapterWork.get(item.subject);
      const hunt=item.autonomousPlan.capability === "hunt-packet", heldHunt=held?.autonomousPlan?.capability === "hunt-packet";
      if (!held || hunt && !heldHunt || hunt===heldHunt &&
        (item.createdAt > held.createdAt || item.createdAt === held.createdAt && item.id > held.id)) adapterWork.set(item.subject,item);
    }
    if (!repos.scoutResults.keysWhere) throw new Error("SCOUT_SCOPED_READ_UNAVAILABLE");
    const adapterSubjects = new Set<string>();
    for (const key of await repos.scoutResults.keysWhere(["outcome"], "NEEDS_ADAPTER")) {
      for (const result of await repos.scoutResults.read(key)) if (result.outcome === "NEEDS_ADAPTER" && result.refusal === null && adapterWork.has(result.subjectId)) adapterSubjects.add(result.subjectId);
    }
    for (const subject of adapterSubjects) {
      const latest = new Map<string, ScoutResult>();
      const results: ScoutResult[] = [];
      for (const key of await repos.scoutResults.keysWhere(["subjectId"], subject)) results.push(...await repos.scoutResults.read(key));
      for (const result of results.filter(result => result.subjectId === subject).sort((a, b) => a.recordedAt.localeCompare(b.recordedAt))) latest.set(result.recordClass, result);
      if (![...latest.values()].some(result => result.outcome === "NEEDS_ADAPTER" && result.refusal === null)) adapterSubjects.delete(subject);
    }
    const selected: WorkItem[] = [];
    for (const item of items) {
      if (!item.autonomousPlan) continue;
      const plan=item.autonomousPlan;
      const continuation=plan.capability !== "hunt-packet" && (plan.acquisition.length>0 || plan.sources.length>0);
      if (continuation || adapterSubjects.has(item.subject) && adapterWork.get(item.subject)?.id === item.id) { selected.push(item); continue; }
      const tasks = (await repos.routeTasks.listWhere(["workItemId"], item.id)).map(row => row.value);
      if (tasks.some(task => ["PENDING", "CLAIMED", "RECLAIMABLE", "POLICY_DENIED"].includes(task.state)) ||
          exaAgentLane && plan.capability === "hunt-packet" && tasks.some(task => task.routeId === "hunter:packet") && !tasks.some(task => task.routeId === "hunter:exa-agent")) selected.push(item);
    }
    return selected;
  }
  return pgCoordinatorWorkItems(sql, exaAgentLane, repos.planningState);
}

export async function pgCoordinatorWorkItems(sql: Sql, exaAgentLane = false, state?: string): Promise<WorkItem[]> {
  const run = boundedRunner(sql, "cp_work_items", CONTROL_PLANE_REQUEST_BOUNDS_MS);
  const selected: WorkItem[] = [];
  let after = "";
  for (;;) {
    const rows = await run("coordinatorItems", "PAGE", `WITH candidates AS (
      SELECT id FROM cp_work_items_history WHERE ${state ? "cp_control_state(value)=$2 AND" : ""} value->'autonomousPlan' IS NOT NULL
        AND value #>> '{autonomousPlan,capability}' IS DISTINCT FROM 'hunt-packet'
        AND (jsonb_array_length(coalesce(value #> '{autonomousPlan,acquisition}', '[]'::jsonb)) > 0
          OR jsonb_array_length(coalesce(value #> '{autonomousPlan,sources}', '[]'::jsonb)) > 0)
      UNION SELECT value #>> '{workItemId}' FROM cp_route_tasks
        WHERE value->>'state' IN ('PENDING','CLAIMED','RECLAIMABLE','POLICY_DENIED')
        ${state ? "AND EXISTS(SELECT 1 FROM cp_work_items_history w WHERE w.id=cp_route_tasks.value->>'workItemId' AND cp_control_state(w.value)=$2)" : ""}
      UNION SELECT latest.id FROM (
        SELECT DISTINCT pending.record #>> '{subjectId}' AS subject FROM cp_log_scout_results pending
        WHERE ${state ? "cp_control_state(pending.record)=$2 AND" : ""} pending.record->>'outcome' = 'NEEDS_ADAPTER' AND pending.record->'refusal' = 'null'::jsonb
          AND NOT EXISTS (SELECT 1 FROM cp_log_scout_results newer
            WHERE newer.record #>> '{subjectId}' = pending.record #>> '{subjectId}'
              AND newer.record->>'recordClass' = pending.record->>'recordClass'
              AND (newer.record->>'recordedAt', newer.log_key, newer.position) > (pending.record->>'recordedAt', pending.log_key, pending.position))
      ) owed CROSS JOIN LATERAL (
        SELECT id FROM cp_work_items_history WHERE value #>> '{subject}' = owed.subject
          AND value->'autonomousPlan' IS NOT NULL
        ORDER BY CASE WHEN value #>> '{autonomousPlan,capability}' = 'hunt-packet' THEN 0 ELSE 1 END,
          value->>'createdAt' DESC, id DESC LIMIT 1
      ) latest
      ${exaAgentLane ? `UNION SELECT w.id FROM cp_work_items_history w
        WHERE w.value #>> '{autonomousPlan,capability}' = 'hunt-packet'
          AND EXISTS (SELECT 1 FROM cp_route_tasks_history t WHERE t.value #>> '{workItemId}'=w.id AND t.value->>'routeId'='hunter:packet')
          AND NOT EXISTS (SELECT 1 FROM cp_route_tasks_history t WHERE t.value #>> '{workItemId}'=w.id AND t.value->>'routeId'='hunter:exa-agent')` : ""}
    ) SELECT w.id, w.value FROM candidates c JOIN cp_work_items_history w ON w.id=c.id
      WHERE w.id > $1 ${state ? "AND cp_control_state(w.value)=$2" : ""} AND w.value->'autonomousPlan' IS NOT NULL
        ${state ? `AND (w.value #>> '{autonomousPlan,capability}' IS DISTINCT FROM 'hunt-packet' OR EXISTS(
          SELECT 1 FROM cp_occurrences_history own JOIN cp_obligations o ON o.id=own.value->>'obligationId'
          WHERE own.value #>> '{workItemId}'=w.id AND o.value->>'active'='true'))` : ""} ORDER BY w.id LIMIT 100`, state ? [after,state] : [after]) as Record<string, unknown>[];
    selected.push(...rows.map(row => parseValue<WorkItem>(row.value, `coordinator work item ${String(row.id)}`)));
    if (rows.length < 100) return selected;
    after = String(rows.at(-1)!.id);
  }
}

export async function readPlaceWorkItems(repos: ControlPlaneRepositories, subjects: readonly string[]): Promise<Persisted<WorkItem>[]> {
  if (!subjects.length) return [];
  const ids = [...new Set(subjects)];
  const sql = placeReadConnection(repos);
  if (!sql) {
    const rows: Persisted<WorkItem>[] = [];
    for (const subject of ids) rows.push(...await repos.workItems.listWhere(["subject"], subject));
    return rows.sort((a, b) => a.id.localeCompare(b.id));
  }
  const run = boundedRunner(sql, "cp_work_items", CONTROL_PLANE_REQUEST_BOUNDS_MS);
  const rows = await run("placeSubjects", "PAGE", `SELECT id, revision, updated_at, value
    FROM cp_work_items_history WHERE value #>> '{subject}'=ANY($1::text[]) ORDER BY id`, [ids]) as Record<string, unknown>[];
  return rows.map(row => ({ id: String(row.id), revision: Number(row.revision),
    updatedAt: new Date(row.updated_at as string).toISOString(), value: parseValue<WorkItem>(row.value, `place work item ${String(row.id)}`) }));
}

export async function readPlaceArtifacts(repos: ControlPlaneRepositories, url: string, cutoff: string, now: string): Promise<readonly ArtifactRecord[]> {
  const sql = placeReadConnection(repos);
  if (!sql) return (await repos.artifacts.readAll()).filter(row => row.canonicalUrl === url && !row.partial &&
    row.tier !== "RESTRICTED_RAW" && row.recordedAt >= cutoff && row.recordedAt <= now);
  const run = boundedRunner(sql, "cp_log_artifacts", CONTROL_PLANE_REQUEST_BOUNDS_MS);
  const rows = await run("placeSource", "PAGE", `SELECT record FROM cp_log_artifacts
    WHERE md5(record->>'canonicalUrl')=md5($1) AND record->>'canonicalUrl'=$1 AND record->>'partial'='false' AND record->>'tier'<>'RESTRICTED_RAW'
      AND record->>'recordedAt'>=$2 AND record->>'recordedAt'<=$3 ORDER BY record->>'recordedAt' DESC`, [url, cutoff, now]) as Record<string, unknown>[];
  return rows.map(row => parseValue<ArtifactRecord>(row.record, "place source artifact"));
}

export async function readPlaceStandingWork(repos: ControlPlaneRepositories, divisionIds: readonly string[]) {
  const sql = placeReadConnection(repos);
  if (!sql) return (await repos.obligations.listWhere(["active"], "true")).map(row => row.value)
    .filter(row => row.scopeDivisions?.some(id => divisionIds.includes(id)));
  const run = boundedRunner(sql, "cp_obligations", CONTROL_PLANE_REQUEST_BOUNDS_MS);
  const rows = await run("placeWork", "PAGE", `SELECT id, value->>'subjectId' AS subject_id, value->'scopeDivisions' AS divisions
    FROM cp_obligations WHERE value->>'active'='true' AND value->'scopeDivisions' ?| $1::text[] ORDER BY id`, [[...divisionIds]]) as Record<string, unknown>[];
  return rows.map(row => ({ id: String(row.id), subjectId: String(row.subject_id), scopeDivisions: row.divisions as string[] }));
}

export async function createPgRepositories(
  connectionString: string,
  nowIso: string = new Date().toISOString(),
  options: {

    readonly skipBootstrap?: boolean;
    readonly planningState?: string;

    readonly requestBounds?: Partial<ControlPlaneRequestBounds>;
  } = {},
): Promise<ControlPlaneRepositories> {
  if (typeof connectionString !== "string" || connectionString.trim().length === 0) {
    throw new Error(
      "createPgRepositories requires an explicit connection string. There is deliberately no " +
        "default: a control plane that can be opened by accident is one whose contents nobody " +
        "can account for, and a default here could point at the SERVING database, which " +
        "is kept separate on purpose.",
    );
  }
  installDatabaseClientAccounting(neonConfig, installDatabaseTransferCounter);
  const bounds: ControlPlaneRequestBounds = { ...CONTROL_PLANE_REQUEST_BOUNDS_MS, ...options.requestBounds };
  for (const [callClass, ms] of Object.entries(bounds)) {
    if (!Number.isSafeInteger(ms) || ms <= 0) {
      throw new Error(`CONTROL_PLANE_REQUEST_BOUND_INVALID: ${callClass}=${String(ms)}; every class needs a positive bound`);
    }
  }
  const sql = Object.assign(neon(connectionString), {
    async withPinnedConnection<T>(operation: (pinned: Sql) => Promise<T>): Promise<T> {
      if (!neonConfig.webSocketConstructor) neonConfig.webSocketConstructor = globalThis.WebSocket;
      const direct = new URL(connectionString);
      direct.hostname = direct.hostname.replace("-pooler.", ".");
      const pool = new Pool({
        connectionString: direct.toString(), connectionTimeoutMillis: bounds.POINT,
        statement_timeout: bounds.POINT, query_timeout: SOURCE_INDEX_BUILD_MS + 1_000,
      });
      try {
        const client = await pool.connect();
        try { return await operation({ query: async (text, params = []) => (await client.query(text, [...params])).rows }); }
        finally { client.release(true); }
      } finally { await pool.end(); }
    },
  });
  const bounded: PgRepositoryBounds = { bounds, copies: heldCopiesFor?.(connectionString, BOOTSTRAP_VERSION) ?? null };
  if (!options.skipBootstrap) {

    await withControlPlaneConnectRetry(() => bootstrap(sql, nowIso, bounds), {
      onRetry: ({ attempt, delayMs, error }) =>
        console.warn(
          `control-plane bootstrap connect: transient failure on attempt ${attempt} of ` +
            `${CONTROL_PLANE_CONNECT_MAX_ATTEMPTS}; retrying in ${delayMs}ms — ` +
            (error instanceof Error ? error.message : String(error)),
        ),
    });
  }
  const locks = pgLockManager(connectionString);
  const sharedBudget = budgetRepositoryFrom(
    pgAggregateRepository<BudgetLedger>(sql, "BudgetLedger", "cp_budget", bounded), locks, "ATOMIC_COMPARE_AND_SET",
  );

  let budgetWrite: Promise<unknown> = Promise.resolve();
  const budget: ControlPlaneRepositories["budget"] = { ...sharedBudget, mutate: (mutator, now) => {
    const write = budgetWrite.then(() => sharedBudget.mutate(mutator, now));
    budgetWrite = write.catch(() => undefined);
    return write;
  } };

  const receiptLog = pgAppendOnlyRepository<ActionReceipt>(sql, "admin_receipts", bounded);
  const adminReceipts: AppendOnlyRepository<ActionReceipt> = {
    ...receiptLog,
    async append(key, recordId, record, recordedAt) {
      if (key !== "admin-action") return receiptLog.append(key, recordId, record, recordedAt);
      if (recordId !== record.receiptId) throw new Error("ADMIN_RECEIPT_ID_MISMATCH");
      const globalRunner = (record.type === "runner.pause" || record.type === "runner.resume") &&
        record.subjectKind === "the standing runner";
      const outcome = await appendActionReceiptWithHistoryAtomic({ sql, receipt: record,
        sourceRecordedAt: recordedAt, bounds,
        validatedAction: globalRunner
          ? { kind: "GLOBAL_RUNNER", type: record.type as "runner.pause" | "runner.resume" }
          : { kind: "UNAVAILABLE", legacy: false },
      });
      return { appended: outcome.state === "APPENDED", recordId, record, position: outcome.position };
    },
  };

  const adminRun = boundedRunner(sql, "cp_admin_config", bounds);
  const fixMapRun = boundedRunner(sql, "cp_fix_map", bounds);
  const pacingRun = boundedRunner(sql, "cp_website_pacing", bounds);
  const repositories: ControlPlaneRepositories = {
    adminActionHistoryPage: query => readActionHistoryPage(sql, query, bounds),
    dispatchState: callerPinned(createPgDispatchState(sql, () => repositories, bounds)),
    workItems: pgArchivedAggregateRepository<WorkItem>(sql, "WorkItem", "cp_work_items", bounded),
    routeTasks: pgArchivedAggregateRepository<RouteTask>(sql, "RouteTask", "cp_route_tasks", bounded),
    attempts: pgAggregateRepository<Attempt>(sql, "Attempt", "cp_attempts", bounded),
    obligations: pgAggregateRepository<StandingObligation>(
      sql,
      "StandingObligation",
      "cp_obligations",
      bounded,
    ),
    occurrences: pgArchivedAggregateRepository<FreshnessOccurrence>(sql, "FreshnessOccurrence", "cp_occurrences", bounded),
    debts: pgAggregateRepository<FreshnessDebt>(sql, "FreshnessDebt", "cp_debts", bounded),
    leases: pgAggregateRepository<ExecutionLease>(sql, "ExecutionLease", "cp_leases", bounded),
    activeWorkClaims: pgActiveWorkClaimReader(sql),
    transitions: pgAppendOnlyRepository<RecordedTransition>(sql, "transitions", bounded),
    escalations: pgAppendOnlyRepository<Escalation>(sql, "escalations", bounded),
    dispositions: pgAppendOnlyRepository<DispositionCommit>(sql, "dispositions", bounded),
    artifacts: pgAppendOnlyRepository<ArtifactRecord>(sql, "artifacts", bounded),
    artifactsByCanonicalUrl: (url, limit) => pgArtifactsByCanonicalUrl(sql, url, limit, bounded),
    capturedCanonicalUrls: (urls) => pgCapturedCanonicalUrls(sql, urls, bounded),
    adminEvidenceCopyRequests: pgAggregateRepository<AdminEvidenceCopyRequest>(sql, "AdminEvidenceCopyRequest", "cp_admin_evidence_copy_requests", bounded),
    costs: pgAppendOnlyRepository<CostEntry>(sql, "costs", bounded),
    ownerSnapshots: pgAggregateRepository<OwnerSnapshot>(
      sql,
      "OwnerSnapshot",
      "cp_owner_snapshots",
      bounded,
    ),
    ownerSnapshotTotals: pgAggregateRepository<OwnerSnapshotTotals>(sql, "OwnerSnapshotTotals", "cp_owner_snapshots", bounded),
    ownerSnapshotStates: pgAggregateRepository<OwnerSnapshotState>(sql, "OwnerSnapshotState", "cp_owner_snapshots", bounded),
    ownerSnapshotStateTotals: pgAggregateRepository<StateTotals>(sql, "StateTotals", "cp_owner_snapshots", bounded),
    ownerSnapshotInboxes: pgAggregateRepository<SpilledInbox>(sql, "SpilledInbox", "cp_owner_snapshots", bounded),
    fieldManual: pgFieldManualRepository(sql,bounded,()=>repositories.fixMap),
    fixMap: createFixMapRepository(async (text, params) =>
      (await fixMapRun("fixMap", "PAGE", text, params)) as readonly Record<string, unknown>[]),
    websitePacing: createWebsitePacing(async (text, params) =>
      (await pacingRun("websitePacing", "POINT", text, params)) as readonly Record<string, unknown>[]),
    runnerHeartbeat: pgAggregateRepository<RunnerHeartbeat>(
      sql,
      "RunnerHeartbeat",
      "cp_runner_heartbeat",
      bounded,
    ),
    cacheObservations: pgAggregateRepository<CacheObservationRecord>(
      sql,
      "CacheObservationRecord",
      "cp_cache_observations",
      bounded,
    ),
    ownerDigests: pgAppendOnlyRepository<OwnerDigestRecord>(sql, "owner_digests", bounded),
    ownerDecisions: pgAppendOnlyRepository<OwnerDecisionIntent>(sql, "owner_decisions", bounded),
    huntOrders: pgHuntOrderRepository(sql,bounds),
    planningControls:{
      async pendingStates() {const rows=await adminRun("planningPending","POINT","SELECT state FROM cp_planning_controls WHERE revision>applied_revision ORDER BY state") as {state:string}[];return rows.map(row=>row.state);},
      async publishSummary(roundAt,at) {await adminRun("planningSummary","POINT",PLANNING_SUMMARY_SQL,[PLANNING_STATES.map(state=>`level-1:${state}`),roundAt,at,"level-1"]);},
      async revision(state) {const rows=await adminRun("planningRevision","POINT","SELECT revision FROM cp_planning_controls WHERE state=$1",[state]) as {revision:number}[];return Number(rows[0]?.revision??0);},
      async applied(state,revision,at) {await adminRun("planningApplied","POINT","UPDATE cp_planning_controls SET applied_revision=greatest(applied_revision,least(revision,$2::bigint)),applied_at=$3::timestamptz WHERE state=$1",[state,revision,at]);},
    },
    controlReadsBackfill: pgControlReadsBackfill(sql,()=>repositories),
    researchState: pgAggregateRepository<ResearchState>(sql, "ResearchState", "cp_research_state", bounded),
    spend: callerPinned(pgSpendRepository(sql, bounds)),
    methodCandidates: pgAggregateRepository<CandidateStore>(sql, "MethodCandidateStore", "cp_method_candidates", bounded),
    researchIntents: pgAppendOnlyRepository<ResearchIntent>(sql, "research_intents", bounded),
    boxFindings: pgBoxRepository(sql, bounded),
    passCursors: pgAggregateRepository<PassCursor>(sql, "PassCursor", "cp_pass_cursors", bounded),
    scoutResults: pgAppendOnlyRepository<ScoutResult>(sql, "scout_results", bounded),
    workerResults: pgAppendOnlyRepository<WorkerResultRecord>(sql, "worker_results", bounded),
    promotionPipeline: pgAppendOnlyRepository<PromotionPipelineRecord>(sql, "promotion_pipeline", bounded),
    windowRuns: pgAppendOnlyRepository<WindowRunRecord>(sql, "window_runs", bounded),
    windowIncidents: pgAppendOnlyRepository<WindowIncident>(sql, "window_incidents", bounded),
    windowIntents: pgAppendOnlyRepository<WindowIntent>(sql, "window_intents", bounded),
    softwareReleaseReviews: pgAppendOnlyRepository<SoftwareReleaseReviewRecord>(sql, "software_release_reviews", bounded),
    adminReceipts,
    agentJobs: pgAppendOnlyRepository<AgentJobRecord>(sql, "agent_jobs", bounded),
    discoveryAttempts: pgAppendOnlyRepository<MeetingsDiscoveryAttempt>(sql, "discovery_attempts", bounded),
    liveAudits: pgAppendOnlyRepository<LiveAuditLogRow>(sql, "live_audits", bounded),
    adminConfig: callerPinned(pgAdminConfigRepository(pgAggregateRepository<AdminConfig>(sql, "AdminConfig", "cp_admin_config", bounded), async (text, params) =>
      (await adminRun("adminConfig", "PAGE", text, params)) as readonly Record<string, unknown>[])),
    askGapObservations: pgAggregateRepository<AskGapObservation>(sql, "AskGapObservation", "cp_ask_gap_observations", bounded),
    doors: pgAggregateRepository<DoorRecord>(sql, "Door", "cp_doors", bounded),
    leadOrders: pgAggregateRepository<LeadOrder>(sql, "LeadOrder", "cp_lead_orders", bounded),
    budget,
    spendHolds: pgSpendHoldRepository(sql, bounds),
    locks,
    describe: () =>
      `Postgres control-plane repositories (schema v${BOOTSTRAP_VERSION}, connection named by ` +
      `${CONTROL_PLANE_URL_VAR})`,
    durable: true,
  };
  Object.assign(repositories, { [connectionForReads]: () => sql });
  if (!options.skipBootstrap) {

    const setup = await ensureRolePlaybooks(repositories, nowIso).catch((error: unknown) => {
      console.error(`  role instructions: not seeded this start; the next start tries again (${error instanceof Error ? error.message : String(error)})`);
      return null;
    });
    if (setup !== null && (setup.created > 0 || setup.retired)) {
      console.log(`  role instructions: ${setup.created} created, ${setup.present} already held${setup.retired ? ", old instruction rows retired" : ""}`);
    }
    const notes = await seedFieldManualNotes(repositories, nowIso).catch((error: unknown) => {
      console.error(`  field manual notes: not loaded this start; the next start tries again (${error instanceof Error ? error.message : String(error)})`);
      return null;
    });
    if (notes !== null && notes.created > 0) console.log(`  field manual notes: ${notes.created} loaded, ${notes.present} already held`);
  }
  if (options.planningState) {
    const state = options.planningState;
    const scoped = { ...bounded,state,copies: null };
    const stateRepos: ControlPlaneRepositories = { ...repositories, planningState: state,
      obligations: pgAggregateRepository<StandingObligation>(sql,"StandingObligation","cp_obligations",{ ...scoped,activeOnly: true }),
      occurrences: pgArchivedAggregateRepository<FreshnessOccurrence>(sql,"FreshnessOccurrence","cp_occurrences",scoped),
      workItems: pgArchivedAggregateRepository<WorkItem>(sql,"WorkItem","cp_work_items",scoped),
      routeTasks: pgArchivedAggregateRepository<RouteTask>(sql,"RouteTask","cp_route_tasks",scoped),
      attempts: pgAggregateRepository<Attempt>(sql,"Attempt","cp_attempts",scoped),
      leases: pgAggregateRepository<ExecutionLease>(sql,"ExecutionLease","cp_leases",scoped),
      debts: pgAggregateRepository<FreshnessDebt>(sql,"FreshnessDebt","cp_debts",scoped),
      askGapObservations: pgAggregateRepository<AskGapObservation>(sql,"AskGapObservation","cp_ask_gap_observations",scoped),
      doors: pgAggregateRepository<DoorRecord>(sql,"Door","cp_doors",scoped),
      artifacts: pgAppendOnlyRepository<ArtifactRecord>(sql,"artifacts",scoped),
      workerResults: pgAppendOnlyRepository<WorkerResultRecord>(sql,"worker_results",scoped),
      promotionPipeline:pgAppendOnlyRepository<PromotionPipelineRecord>(sql,"promotion_pipeline",{...scoped,copies:bounded.copies}),
      transitions: pgAppendOnlyRepository<RecordedTransition>(sql,"transitions",scoped),
      costs: pgAppendOnlyRepository<CostEntry>(sql,"costs",scoped),
      discoveryAttempts: pgAppendOnlyRepository<MeetingsDiscoveryAttempt>(sql,"discovery_attempts",scoped),
      scoutResults: pgAppendOnlyRepository<ScoutResult>(sql,"scout_results",{...scoped,since:new Date(Date.parse(nowIso)-24*60*60_000).toISOString()}),
      dispatchState: createPgDispatchState(sql,()=>stateRepos,bounds,state),
    };
    return stateRepos;
  }
  return repositories;
}

export function controlPlaneUrlFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const value = env[CONTROL_PLANE_URL_VAR];
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

export function controlPlaneTestUrlFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const value = env[CONTROL_PLANE_TEST_URL_VAR];
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}
