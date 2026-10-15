import type { BoxFinding, BoxRepository } from "../box.ts";
import type { WorkerResultRecord } from "../workers/types.ts";
import type { AdminEvidenceCopyRequest } from "../evidence/admin-copy-request.ts";
import { installDatabaseTransferCounter } from "../../db/transfer.ts";
import { withCallerSite } from "../../db/transfer-by-caller.ts";
import type { AskGapObservation } from "../ask-gap-observations.ts";
import type { DoorRecord } from "../../doors/registry.ts";
import type { LeadOrder } from "../leads/order.ts";
import { createWebsitePacing } from "../website-pacing.ts";
import type { LiveAuditLogRow } from "../live-audit-log.ts";
import type { SoftwareReleaseReviewRecord } from "../software-release-review.ts";
import { pgActiveWorkClaimReader } from "./active-work-claims.ts";
/** The Postgres control-plane provider, implementing the same `ControlPlaneRepositories` interfaces as the file store. */

import { createHash } from "node:crypto";
import { neon, Pool, neonConfig } from "@neondatabase/serverless";
import type {
  CacheObservationRecord,
  OwnerDecisionIntent,
  OwnerDigestRecord,
  OwnerSnapshot,
  RunnerHeartbeat,
} from "../owner-surface.ts";
import { coveringPlaces, entryInSlice, queryState, TRANSFERABLE_METHOD_KINDS, type FieldManualEntry, type FieldManualQuery } from "../field-manual.ts";
import { createFixMapRepository } from "../../method/fix-map.ts";
import { copyFieldManualDocument, type SingleDocumentManual } from "../field-manual-copy.ts";
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
import type { SpendWindow } from "../spend-window.ts";
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
  type ChangedRecords,
  type ChangedRows,
  type ControlPlaneRepositories,
  type FieldManualRepository,
  type DispositionCommit,
  type HeldSlots,
  type LockManager,
  type Persisted,
  type PutOutcome,
  type RecordedTransition,
  type RecordProjection,
} from "./types.ts";

/** The one environment variable, named and never valued. */
export const CONTROL_PLANE_URL_VAR = "WTP_CONTROL_PLANE_DATABASE_URL";

/** The mutable conformance lane requires this separate isolated-test variable and never treats the production connection as a test one. */
export const CONTROL_PLANE_TEST_URL_VAR = "WTP_CONTROL_PLANE_TEST_DATABASE_URL";

/** Narrowed to the calls this provider makes. */
export interface Sql {
  query(text: string, params?: readonly unknown[], options?: BoundableQueryOptions): Promise<unknown>;
  /** Online DDL and session locks need one connection; normal reads keep HTTP. */
  withPinnedConnection?<T>(operation: (sql: Sql) => Promise<T>): Promise<T>;
}

/** Tables whose one row is a large document (hundreds of KB to MB each way). */
export const DOCUMENT_ROW_TABLES: ReadonlySet<string> = new Set([
  "cp_budget",
  "cp_research_state",
  "cp_field_manual",
  "cp_method_candidates",
  "cp_owner_snapshots",
  "cp_readiness_snapshots",
]);

/** Logs whose records reach tens to hundreds of KB. */
export const DOCUMENT_RECORD_LOGS: ReadonlySet<string> = new Set([
  "owner_digests",
  "worker_results",
  "window_runs",
  "scout_results",
]);

/** How one repository's calls are bounded. Omitted fields take the measured defaults. */
export interface PgRepositoryBounds {
  readonly bounds?: ControlPlaneRequestBounds;
  /** The class of a single-row call; DOCUMENT for the tables in DOCUMENT_ROW_TABLES / DOCUMENT_RECORD_LOGS. */
  readonly rowClass?: Exclude<ControlPlaneCallClass, "PAGE">;
  /** Where `list()` and `readAll()` keep their held copies; null reads every whole table as a first read. */
  readonly copies?: HeldCopies | null;
}

/* Runner processes install the held copies (`readFromHeldCopies`); civic-data commands never import their writer. */
let heldCopiesFor: ((connectionString: string, schemaVersion: number) => HeldCopies | null) | null = null;

/** Where this process's repositories keep their held copies; see incremental-reads.ts `readFromHeldCopies`. */
export function installHeldCopies(open: (connectionString: string, schemaVersion: number) => HeldCopies | null): void {
  heldCopiesFor = open;
}

/** A changed-since filter leaving out the slots a held copy already holds; empty when it holds none. */
function heldFilter(held: HeldSlots | undefined, at: (value: unknown) => string, slot: string, version: string): string {
  if (!held || held.length === 0) return "";
  return `NOT EXISTS (SELECT 1 FROM unnest(${at(held.map(([name]) => name))}::text[], ${at(held.map(([, number]) => number))}::bigint[]) ` +
    `AS held(slot, version) WHERE held.slot = ${slot} AND held.version = ${version})`;
}

/** Each method reads its caller's site on entry, so the bytes of queries it sends after its own awaits still count under that caller. */
function callerPinned<R extends object>(repository: R): R {
  return Object.fromEntries(Object.entries(repository).map(([name, member]) => [name, typeof member === "function"
    ? (...args: unknown[]) => withCallerSite(() => member.apply(repository, args))
    : member])) as R;
}

/** Bounds transport fan-out across repositories and clients in this process, so many ready rows share HTTP capacity. */
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
          // Use the existing named DEADLINE path without sending a query.
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

/** FNV-1a written out, so two processes always agree and a dependency bump cannot change the lock. */
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
  /* Postgres advisory keys are signed 64-bit; fold to a positive 63-bit value
     so the same name never lands on a negative that reads as a different key. */
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

/* The `#>>` path is built from code-provided segments, each validated so it can never carry SQL; the extracted value is the parameter. */
function jsonPathLiteral(table: string, path: readonly string[]): string {
  if (path.length === 0) throw new Error(`${table}: an empty JSON path cannot select a field`);
  for (const segment of path) {
    if (!/^[A-Za-z0-9_]+$/.test(segment)) {
      throw new Error(`${table}: unsafe JSON path segment ${JSON.stringify(segment)}`);
    }
  }
  return `{${path.join(",")}}`;
}

/* A `RecordProjection` as a Postgres expression over `record` (a log) or `value` (an aggregate); keys are code-provided. */
function recordProjectionSql(table: string, projection: RecordProjection, column: "record" | "value" = "record"): string {
  /* An aggregate's column is named through its table, so it is never read as the `value` column `jsonb_each` answers. */
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

/** Rows per `list()` page: the HTTP driver caps a response at 64 MiB, so aggregate reads are keyset-paged by id. */
export const AGGREGATE_LIST_READ_PAGE = 100;

export function pgAggregateRepository<T>(
  sql: Sql,
  kind: string,
  table: string,
  options: PgRepositoryBounds = {},
): AggregateRepository<T> {
  const where = `${table} in the control-plane database`;
  const run = boundedRunner(sql, table, options.bounds ?? CONTROL_PLANE_REQUEST_BOUNDS_MS);
  const rowClass = options.rowClass ?? (DOCUMENT_ROW_TABLES.has(table) ? "DOCUMENT" : "POINT");

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

  async function listChangedSince(since: string | null, held?: HeldSlots): Promise<ChangedRows<T>> {
    /* Rows the database stamped at or after `since` (all when null), less the held ones, in id order; `through` is the database clock before the first page. */
    const clock = (await run("listChangedSince:clock", "POINT", "SELECT now() AS read_at")) as Record<string, unknown>[];
    const through = new Date(clock[0]?.read_at as string).toISOString();
    const out: Persisted<T>[] = [];
    let afterId: string | null = null;
    for (;;) {
      const params: unknown[] = [];
      const at = (value: unknown) => `$${params.push(value)}`;
      const filters = [since === null ? "" : `changed_at >= ${at(since)}::timestamptz`,
        heldFilter(held, at, "id", "revision"), afterId === null ? "" : `id > ${at(afterId)}`].filter(Boolean);
      const rows = (await run(
        "listChangedSince",
        "PAGE",
        `SELECT id, revision, updated_at, value FROM ${table}
         ${filters.length === 0 ? "" : `WHERE ${filters.join(" AND ")}`}
         ORDER BY id ASC
         LIMIT ${AGGREGATE_LIST_READ_PAGE}`,
        params,
      )) as Record<string, unknown>[];
      for (const row of rows) {
        out.push({
          id: String(row.id),
          revision: Number(row.revision),
          updatedAt: new Date(row.updated_at as string).toISOString(),
          value: parseValue<T>(row.value, `${where} id ${String(row.id)}`),
        });
      }
      if (rows.length < AGGREGATE_LIST_READ_PAGE) break;
      afterId = String(rows[rows.length - 1].id);
    }
    return { rows: out, through };
  }

  const copies = options.copies ?? null;
  const held = <O>(out: (row: Persisted<T>) => O): Promise<O[]> => copies === null
    ? listChangedSince(null).then(changed => changed.rows.map(out))
    : copies.aggregateList(table, listChangedSince, out);

  /* `list()` filtered in the database with the same order and paging, so the result equals `list()` filtered; `selected` is the value or its projection. */
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
             WHERE value #>> '${jsonPath}' = $1
             ORDER BY id ASC
             LIMIT ${AGGREGATE_LIST_READ_PAGE}`,
            [value],
          )
        : await run(
            caller,
            "PAGE",
            `SELECT id, revision, updated_at, ${selected} AS value FROM ${table}
             WHERE value #>> '${jsonPath}' = $1 AND id > $2
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
      /* Postgres narrows the row, so only kept fields cross the wire; an empty projection skips the value entirely. */
      const narrowed = Object.keys(projection).length === 0 ? "'{}'::jsonb" : recordProjectionSql(table, projection, "value");
      const rows = (await run(
        "readNarrowed",
        "POINT",
        `SELECT id, revision, updated_at, ${narrowed} AS value FROM ${table} WHERE id = $1`,
        [id],
      )) as Record<string, unknown>[];
      if (rows.length === 0) return null;
      const row = rows[0];
      return {
        id: String(row.id),
        revision: Number(row.revision),
        updatedAt: new Date(row.updated_at as string).toISOString(),
        value: parseValue<unknown>(row.value, `${where} id ${id}`),
      };
    },

    async mustRead(id) {
      const found = await read(id);
      if (found === null) throw new UnknownAggregate(kind, id);
      return found;
    },

    async put(id, value, now): Promise<PutOutcome<T>> {
      /* INSERT ... DO NOTHING, then read back. Never an upsert, which would silently replace a different value under a derived id. */
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

      /* Existed already. Identical is a no-op success; different refuses. */
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
      /* The WHERE clause is the compare-and-set: zero rows affected is the refusal, decided by the database. */
      // Keep the exact submitted JSON: the caller may mutate next while the
      // request is pending, and JSON normalizes undefined, dates and numbers.
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
        // A losing writer needs only the current revision, not another copy
        // The revision fence acknowledges this exact JSON; there are no value-rewrite triggers, so no readback is needed.
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

    async readMany(ids) {
      /* Primary-key batches of one page each, so no response nears the driver cap. */
      const unique = [...new Set(ids)].sort();
      const out: Persisted<T>[] = [];
      for (let at = 0; at < unique.length; at += AGGREGATE_LIST_READ_PAGE) {
        const rows = (await run(
          "readMany",
          "PAGE",
          `SELECT id, revision, updated_at, value FROM ${table} WHERE id = ANY($1::text[]) ORDER BY id ASC`,
          [unique.slice(at, at + AGGREGATE_LIST_READ_PAGE)],
        )) as Record<string, unknown>[];
        for (const row of rows) {
          out.push({
            id: String(row.id),
            revision: Number(row.revision),
            updatedAt: new Date(row.updated_at as string).toISOString(),
            value: parseValue<T>(row.value, `${where} id ${String(row.id)}`),
          });
        }
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

/** Records per log read page: a full-log read must never assume it fits in one 64 MiB response. */
export const APPEND_ONLY_LOG_READ_PAGE = 100;

export function pgAppendOnlyRepository<T>(
  sql: Sql,
  log: string,
  options: PgRepositoryBounds = {},
): AppendOnlyRepository<T> {
  const table = `cp_log_${log}`;
  const run = boundedRunner(sql, table, options.bounds ?? CONTROL_PLANE_REQUEST_BOUNDS_MS);
  /* An append's probe and re-read return the held record, and its insert uploads one. */
  const recordClass = options.rowClass ?? (DOCUMENT_RECORD_LOGS.has(log) ? "DOCUMENT" : "POINT");

  async function readChangedSince(since: string | null, held?: HeldSlots): Promise<ChangedRecords<T>> {
    /* `readAll()` narrowed to records the database stamped at or after `since`, less the held ones; `through` is the database clock before the first page. */
    const clock = (await run("readChangedSince:clock", "POINT", "SELECT now() AS read_at")) as Record<string, unknown>[];
    const through = new Date(clock[0]?.read_at as string).toISOString();
    const out: { key: string; recordId: string; position: number; record: T }[] = [];
    let cursor: { readonly key: string; readonly position: number } | null = null;
    for (;;) {
      const params: unknown[] = [];
      const at = (value: unknown) => `$${params.push(value)}`;
      const filters = [since === null ? "" : `changed_at >= ${at(since)}::timestamptz`, heldFilter(held, at, "log_key", "position"),
        cursor === null ? "" : `(log_key, position) > (${at(cursor.key)}, ${at(cursor.position)})`].filter(Boolean);
      const rows = (await run(
        "readChangedSince",
        "PAGE",
        `SELECT log_key, record_id, position, record FROM ${table}
         ${filters.length === 0 ? "" : `WHERE ${filters.join(" AND ")}`}
         ORDER BY log_key ASC, position ASC
         LIMIT ${APPEND_ONLY_LOG_READ_PAGE}`,
        params,
      )) as Record<string, unknown>[];
      for (const r of rows) {
        out.push({ key: String(r.log_key), recordId: String(r.record_id), position: Number(r.position),
          record: parseValue<T>(r.record, `${table} ${String(r.log_key)}`) });
      }
      if (rows.length < APPEND_ONLY_LOG_READ_PAGE) break;
      const last = rows[rows.length - 1];
      cursor = { key: String(last.log_key), position: Number(last.position) };
    }
    return { records: out, through };
  }

  const copies = options.copies ?? null;
  const heldAll = <O>(out: (record: T) => O): Promise<O[]> => copies === null
    ? readChangedSince(null).then(changed => changed.records.map(entry => out(entry.record)))
    : copies.logReadAll(table, readChangedSince, out);

  return callerPinned({
    async append(key, recordId, record, now): Promise<AppendOutcome<T>> {
      /*
       * The position is allocated by the position-allocator table, never computed as MAX+1 (which races under
       * READ COMMITTED). The idempotency probe runs first, so a retry keeps its position. Positions may have
       * gaps under contention: position is an order key, never a count.
       */
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
      /* A retried append after a partial failure. A no-op success, never a
         duplicate history entry. */
      return { appended: false, recordId, record: held, position: Number(existing[0].position) };
    },

    async read(key) {
      /* Keyset-paged by position so no one response can exceed the driver's
         64 MiB cap. `position > $2` starting at -1 includes position 0. */
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
      /* Content filter, keyset-paged like `read`, so a selective filter over a huge log still returns every match. */
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
      /* `readWhere` newest first, stopped at `limit`; `limit` bounds the response, so no paging. */
      const jsonPath = jsonPathLiteral(table, path);
      const narrowed = recordProjectionSql(table, projection);
      if (copies !== null && recordedAtSince === undefined) {
        /* On the runner the query's newest records are held, and only matches stamped since the copy's clock cross the wire. */
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

    readAll: () => heldAll(record => record),
    readAllNarrowed: projection => heldAll(record => projectRecord(record, projection)),
    readChangedSince,

    async readRecent(key, limit) {
      /* Newest `limit`, newest first. `limit` bounds the response, so this needs
         no paging — callers pass a small tail (e.g. a digest-history window). */
      const rows = (await run(
        "readRecent",
        "PAGE",
        `SELECT record FROM ${table} WHERE log_key = $1 ORDER BY position DESC LIMIT $2`,
        [key, Math.max(0, Math.trunc(limit))],
      )) as Record<string, unknown>[];
      return rows.map((r) => parseValue<T>(r.record, `${table} ${key}`));
    },

    async readLatest(keys, projection) {
      /* The inner statement picks each key's newest row; the outer one narrows only those rows. */
      const narrowed = recordProjectionSql(table, projection);
      const unique = [...new Set(keys)];
      const out = new Map<string, unknown>();
      /* One statement per page of keys, so a response stays under the 64 MiB cap for the reason `read` pages. */
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

    async readKeys(keys) {
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
          `SELECT log_key, position, record FROM ${table}
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
        `SELECT DISTINCT log_key FROM ${table} ORDER BY log_key ASC`,
      )) as Record<string, unknown>[];
      return rows.map((r) => String(r.log_key));
    },

    async keysWhere(path, value) {
      /* `keys()` narrowed in the database, on the same `#>>` expression the log indexes use. */
      const jsonPath = jsonPathLiteral(table, path);
      const rows = (await run(
        "keysWhere",
        "PAGE",
        `SELECT DISTINCT log_key FROM ${table} WHERE record #>> '${jsonPath}' = $1 ORDER BY log_key ASC`,
        [value],
      )) as Record<string, unknown>[];
      return rows.map((r) => String(r.log_key));
    },
  });
}

const BOX_DUE_SQL = `SELECT id, value FROM (
    SELECT id, value FROM cp_box_findings WHERE value->>'state' = 'waiting' AND value->>'lastRecordedAt' >= $3
      AND ((value #>> '{waitingFor,slots}') IS NULL OR (value #>> '{waitingFor,slots}') < $1 OR (value #>> '{waitingFor,slots}') > $1)
    UNION ALL
    SELECT id, value FROM cp_box_findings WHERE value->>'state' = 'taken' AND (value #>> '{claim,expiresAt}') <= $2 AND value->>'lastRecordedAt' >= $3
  ) due ORDER BY id LIMIT $4`;
const BOX_WAITING_SQL = `SELECT id, value FROM cp_box_findings WHERE value->>'state' = 'waiting' AND (value #>> '{waitingFor,reason}') = $1 ORDER BY id LIMIT $2`;

/** The Box with its builder queue answered by the partial indexes on state, slot map, lease and reason. */
export function pgBoxRepository(sql: Sql, options: PgRepositoryBounds = {}): BoxRepository {
  const run = boundedRunner(sql, "cp_box_findings", options.bounds ?? CONTROL_PLANE_REQUEST_BOUNDS_MS);
  const rows = (found: readonly Record<string, unknown>[]) => found.map(row => parseValue<BoxFinding>(row.value, `cp_box_findings id ${String(row.id)}`));
  return { ...pgAggregateRepository<BoxFinding>(sql, "BoxFinding", "cp_box_findings", options),
    due: async ({ slots, now, since, limit }) => rows(await run("boxDue", "PAGE", BOX_DUE_SQL, [slots, now, since, Math.max(0, Math.trunc(limit))]) as Record<string, unknown>[]),
    waitingFor: async (reason, limit) => rows(await run("boxWaitingFor", "PAGE", BOX_WAITING_SQL, [reason, Math.max(0, Math.trunc(limit))]) as Record<string, unknown>[]),
  };
}

/** Bounded source lookup; the canonical URL and newest-capture order use the artifact index. */
export async function pgArtifactsByCanonicalUrl(sql: Sql, url: string, limit: number, options: PgRepositoryBounds = {}): Promise<readonly ArtifactRecord[]> {
  const run = boundedRunner(sql, "cp_log_artifacts", options.bounds ?? CONTROL_PLANE_REQUEST_BOUNDS_MS);
  const rows = await run("artifactsByCanonicalUrl", "PAGE",
    `SELECT record FROM cp_log_artifacts WHERE md5(record->>'canonicalUrl') = md5($1) AND record->>'canonicalUrl' = $1
     ORDER BY record->>'recordedAt' DESC NULLS LAST, record->>'artifactId' ASC LIMIT $2`,
    [url, Math.max(0, Math.trunc(limit))]) as Record<string, unknown>[];
  return rows.map(row => parseValue<ArtifactRecord>(row.record, "cp_log_artifacts source capture"));
}

/** Page size for one batched source lookup. */
const CAPTURED_URLS_PAGE = 1000;

/** Which exact canonical URLs have a capture: one indexed read per thousand, on the same md5 expression as the source index. */
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

/** Locks use one pinned WebSocket transaction. HTTP queries have no shared session. */
function pgLockManager(connectionString: string): LockManager {
  return {
    async withLock<R>(name: string, fn: () => Promise<R>): Promise<R> {
      if (!neonConfig.webSocketConstructor) neonConfig.webSocketConstructor = globalThis.WebSocket;
      // Session state requires the endpoint itself, not transaction pooling.
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

// Online index builds scan inside Postgres, not into the runner. Give this DDL
// its own bounded build time rather than cancelling it at the small-row bound.
const SOURCE_INDEX_BUILD_MS = 15 * 60_000;
const indexStatusSql = (name: string) => `SELECT i.indisvalid AS valid,
  EXISTS (SELECT 1 FROM pg_stat_progress_create_index p WHERE p.index_relid = i.indexrelid) AS building
  FROM pg_index i WHERE i.indexrelid = to_regclass('${name}')`;

/** A pinned autocommit session is required; neither DDL runs in a transaction. */
export async function pgEnsureArtifactSourceIndex(
  sql: Sql,
  bounds: ControlPlaneRequestBounds = CONTROL_PLANE_REQUEST_BOUNDS_MS,
): Promise<void> {
  return pgEnsureOnlineIndex(sql, ARTIFACT_SOURCE_INDEX, bounds);
}

/** Build one index online: an existing valid index is kept, an interrupted one is rebuilt, another builder is left alone. */
export async function pgEnsureOnlineIndex(
  sql: Sql,
  index: OnlineIndex,
  bounds: ControlPlaneRequestBounds = CONTROL_PLANE_REQUEST_BOUNDS_MS,
): Promise<void> {
  const run = boundedRunner(sql, `cp_schema.${index.name}`, bounds);
  const statusSql = indexStatusSql(index.name);
  // Existing valid indexes need no socket or session lock. If DDL is owed,
  // switch to a pinned connection and re-read after acquiring its session lock.
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
    // An in-progress concurrent build is temporarily INVALID too. Do not drop it.
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
    // A failed build retains its original error. The caller destroys the pinned
    await run("unlock", "POINT", "SELECT pg_advisory_unlock($1::bigint)", [key]).catch(() => {});
    await run("restoreTimeout", "POINT", `SET statement_timeout = ${bounds.POINT}`).catch(() => {});
  }
}

/**
 * Keep ordinary bootstrap on bounded HTTP and record the version only after
 * every statement succeeds. Online index creation/recovery alone needs a pinned
 * autocommit connection and a session lock, never a transaction.
 */
export async function bootstrap(
  sql: Sql,
  nowIso: string,
  bounds: ControlPlaneRequestBounds = CONTROL_PLANE_REQUEST_BOUNDS_MS,
): Promise<void> {
  const run = boundedRunner(sql, "cp_schema", bounds);
  for (const statement of BOOTSTRAP_DDL) {
    /* The way back (`WTP_SPEND_HOLDS_TABLE=0`) keeps the holds on the ledger row, so they are not moved off it. */
    if (statement === SPEND_HOLDS_MOVE_DDL && !spendHoldsTableEnabled()) continue;
    const online = ONLINE_INDEXES.get(statement);
    if (online) await pgEnsureOnlineIndex(sql, online, bounds);
    else await run("bootstrap", "POINT", statement);
  }
  await run("recordVersion", "POINT", recordVersionStatement(BOOTSTRAP_VERSION, nowIso));
}

/** The SQL half of `entryInSlice`: the rows one job could use, never fewer (the caller applies the exact rule). */
export const FIELD_MANUAL_SLICE_SQL = `SELECT id, revision, updated_at, value FROM cp_field_manual_entries
  WHERE ($1::text[] IS NULL OR value->>'role' = ANY($1::text[]))
    AND ($2::text[] IS NULL OR value->>'kind' = ANY($2::text[]))
    AND ($3::text IS NULL OR jsonb_array_length(coalesce(value->'recordClasses', '[]'::jsonb)) = 0 OR value->'recordClasses' ? $3::text)
    AND (($4::boolean AND ($7::text IS NULL OR jsonb_array_length(coalesce(value->'platforms', '[]'::jsonb)) = 0 OR value->'platforms' ? $7::text))
      OR (NOT $4::boolean AND (value->>'kind' = ANY($5::text[])
        OR coalesce((value->'reach'->>'method')::boolean, false)
        OR coalesce((value->'reach'->>'everywhere')::boolean, false)
        OR coalesce(value->'reach'->'places', '[]'::jsonb) ?| $6::text[]
        OR (jsonb_array_length(coalesce(value->'reach'->'platforms', '[]'::jsonb)) > 0 AND ($7::text IS NULL OR value->'reach'->'platforms' ? $7::text))
        OR ($8::text IS NOT NULL AND coalesce(value->'reach'->'states', '[]'::jsonb) ? $8::text))))
    AND ($9::text IS NULL OR id > $9::text)
  ORDER BY id ASC LIMIT ${AGGREGATE_LIST_READ_PAGE}`;

/** The slice's parameters, in `FIELD_MANUAL_SLICE_SQL`'s order (without the page cursor). */
export function fieldManualSliceParams(query: FieldManualQuery): unknown[] {
  return [
    query.role === undefined ? null : [...new Set([query.role, "SHARED"])],
    query.kinds === undefined ? null : [...query.kinds],
    query.recordClass?.toLowerCase() ?? null,
    query.everywhere === true,
    [...TRANSFERABLE_METHOD_KINDS],
    coveringPlaces(query),
    query.platform?.toLowerCase() ?? null,
    queryState(query) ?? null,
  ];
}

/**
 * The field manual's rows in `cp_field_manual_entries`. On the runner a slice is the held copy filtered by
 * `entryInSlice`, so a process pays only for rows changed since the copy's clock; without a copy (a page host or
 * a hand-run script) the slice crosses the wire one page at a time.
 */
export function pgFieldManualRepository(sql: Sql, options: PgRepositoryBounds = {}): FieldManualRepository {
  const base = pgAggregateRepository<FieldManualEntry>(sql, "FieldManualEntry", "cp_field_manual_entries", options);
  const run = boundedRunner(sql, "cp_field_manual_entries", options.bounds ?? CONTROL_PLANE_REQUEST_BOUNDS_MS);
  const copies = options.copies ?? null;
  return {
    ...base,
    readMany: base.readMany!,
    async retireInstructions() {
      await run("retireInstructions", "DOCUMENT", retireInstructionsSql(), []);
    },
    async insertNew(entries, now) {
      const inserted = new Set<string>();
      for (let at = 0; at < entries.length; at += AGGREGATE_LIST_READ_PAGE) {
        const page = entries.slice(at, at + AGGREGATE_LIST_READ_PAGE);
        const rows = (await run("insertNew", "PAGE", `INSERT INTO cp_field_manual_entries (id, revision, updated_at, value)
          SELECT e->>'id', 1, $2::timestamptz, e FROM jsonb_array_elements($1::jsonb) AS e
          ON CONFLICT (id) DO NOTHING RETURNING id`, [JSON.stringify(page), now])) as Record<string, unknown>[];
        for (const row of rows) inserted.add(String(row.id));
      }
      return inserted;
    },
    async slice(query) {
      if (copies !== null) {
        const rows = await copies.aggregateList("cp_field_manual_entries", base.listChangedSince!,
          (row) => (entryInSlice(row.value, query) ? row : null));
        return rows.filter((row): row is Persisted<FieldManualEntry> => row !== null);
      }
      const params = fieldManualSliceParams(query);
      const out: Persisted<FieldManualEntry>[] = [];
      let afterId: string | null = null;
      for (;;) {
        const rows = (await run("slice", "PAGE", FIELD_MANUAL_SLICE_SQL, [...params, afterId])) as Record<string, unknown>[];
        for (const row of rows) {
          out.push({ id: String(row.id), revision: Number(row.revision), updatedAt: new Date(row.updated_at as string).toISOString(),
            value: parseValue<FieldManualEntry>(row.value, `cp_field_manual_entries id ${String(row.id)}`) });
        }
        if (rows.length < AGGREGATE_LIST_READ_PAGE) return out;
        afterId = String(rows[rows.length - 1]!.id);
      }
    },
  };
}

/** Every call is one statement, so one implicit transaction. Nothing reads the table whole; `liveAll` reads only holds that still count. */
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
      /* Settled holds leave once their cost is in every reader's history; the sweep is bounded, the next one takes the rest. */
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

/** The caller passes the connection string; `fromEnv` is the one place the variable is read. */
const placeReadConnections = new WeakMap<ControlPlaneRepositories, Sql>();

/** Reconcile all subjects in one place against one indexed query, rather
 * than opening a serverless connection for every field's subject. The filter is
 * the exact expression of `cp_work_items_subject` (`#>> '{subject}'`): `->>`
 * does not match that index and scanned the whole table. */
export async function readPlaceWorkItems(repos: ControlPlaneRepositories, subjects: readonly string[]): Promise<Persisted<WorkItem>[]> {
  if (!subjects.length) return [];
  const ids = [...new Set(subjects)];
  const sql = placeReadConnections.get(repos);
  if (!sql) {
    const rows: Persisted<WorkItem>[] = [];
    for (const subject of ids) rows.push(...await repos.workItems.listWhere(["subject"], subject));
    return rows.sort((a, b) => a.id.localeCompare(b.id));
  }
  const run = boundedRunner(sql, "cp_work_items", CONTROL_PLANE_REQUEST_BOUNDS_MS);
  const rows = await run("placeSubjects", "PAGE", `SELECT id, revision, updated_at, value
    FROM cp_work_items WHERE value #>> '{subject}'=ANY($1::text[]) ORDER BY id`, [ids]) as Record<string, unknown>[];
  return rows.map(row => ({ id: String(row.id), revision: Number(row.revision),
    updatedAt: new Date(row.updated_at as string).toISOString(), value: parseValue<WorkItem>(row.value, `place work item ${String(row.id)}`) }));
}

export async function readPlaceArtifacts(repos: ControlPlaneRepositories, url: string, cutoff: string, now: string): Promise<readonly ArtifactRecord[]> {
  const sql = placeReadConnections.get(repos);
  if (!sql) return (await repos.artifacts.readAll()).filter(row => row.canonicalUrl === url && !row.partial &&
    row.tier !== "RESTRICTED_RAW" && row.recordedAt >= cutoff && row.recordedAt <= now);
  const run = boundedRunner(sql, "cp_log_artifacts", CONTROL_PLANE_REQUEST_BOUNDS_MS);
  const rows = await run("placeSource", "PAGE", `SELECT record FROM cp_log_artifacts
    WHERE md5(record->>'canonicalUrl')=md5($1) AND record->>'canonicalUrl'=$1 AND record->>'partial'='false' AND record->>'tier'<>'RESTRICTED_RAW'
      AND record->>'recordedAt'>=$2 AND record->>'recordedAt'<=$3 ORDER BY record->>'recordedAt' DESC`, [url, cutoff, now]) as Record<string, unknown>[];
  return rows.map(row => parseValue<ArtifactRecord>(row.record, "place source artifact"));
}

/** Declared work for the place/ring's exact divisions, including the portable
 * national and relevant state sources. No country-wide work objects are read. */
export async function readPlaceStandingWork(repos: ControlPlaneRepositories, divisionIds: readonly string[]) {
  const sql = placeReadConnections.get(repos);
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
    /** Pages never own the schema: skip the bootstrap, and a schema that is behind reads as STORE_UNREACHABLE. */
    readonly skipBootstrap?: boolean;
    /**
     * Override the per-class request bounds (request-bounds.ts). Tests shrink
     * them; production uses the measured defaults. No call is ever unbounded.
     */
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
  installDatabaseTransferCounter();
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
    /* The bootstrap is idempotent and is this process's first Neon I/O, so its transient connect failures are retried. */
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
  // One process need not contend with its own read/modify/write requests on
  // this large aggregate. Other processes still contend through the same CAS.
  // This queues accounting writes only; workers and their leases run in parallel.
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

  const fixMapRun = boundedRunner(sql, "cp_fix_map", bounds);
  const pacingRun = boundedRunner(sql, "cp_website_pacing", bounds);
  const repositories: ControlPlaneRepositories = {
    adminActionHistoryPage: query => readActionHistoryPage(sql, query, bounds),
    workItems: pgAggregateRepository<WorkItem>(sql, "WorkItem", "cp_work_items", bounded),
    routeTasks: pgAggregateRepository<RouteTask>(sql, "RouteTask", "cp_route_tasks", bounded),
    attempts: pgAggregateRepository<Attempt>(sql, "Attempt", "cp_attempts", bounded),
    obligations: pgAggregateRepository<StandingObligation>(
      sql,
      "StandingObligation",
      "cp_obligations",
      bounded,
    ),
    occurrences: pgAggregateRepository<FreshnessOccurrence>(
      sql,
      "FreshnessOccurrence",
      "cp_occurrences",
      bounded,
    ),
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
    fieldManual: pgFieldManualRepository(sql, bounded),
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
    researchState: pgAggregateRepository<ResearchState>(sql, "ResearchState", "cp_research_state", bounded),
    spendWindow: pgAggregateRepository<SpendWindow>(sql, "SpendWindow", "cp_spend_window", bounded),
    methodCandidates: pgAggregateRepository<CandidateStore>(sql, "MethodCandidateStore", "cp_method_candidates", bounded),
    researchIntents: pgAppendOnlyRepository<ResearchIntent>(sql, "research_intents", bounded),
    boxFindings: pgBoxRepository(sql, bounded),
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
    adminConfig: pgAggregateRepository<AdminConfig>(sql, "AdminConfig", "cp_admin_config", bounded),
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
  placeReadConnections.set(repositories, sql);
  if (!options.skipBootstrap) {
    const copied = await copyFieldManualDocument(pgSingleDocumentManual(sql, bounded), repositories, nowIso).catch((error: unknown) => {
      console.error(`  field manual: the lessons were not copied into rows this start; the next start tries again (${error instanceof Error ? error.message : String(error)})`);
      return null;
    });
    if (copied !== null) {
      console.log(`  field manual: ${copied.entries} lessons copied into one row each (${copied.retagged.fromRecord + copied.retagged.fromSameAddress} given ` +
        `their place, ${copied.reach.NOWHERE} name no place yet; report ${copied.copiedAt})`);
    }
  }
  if (!options.skipBootstrap) {
    // PB-01: the role instructions are control-plane rows, so they are seeded here and never by a reader-database migration.
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
  return repositories;
}

/** The old single-document manual in `cp_field_manual`, for the one-time copy into rows. */
export function pgSingleDocumentManual(sql: Sql, options: PgRepositoryBounds = {}): SingleDocumentManual {
  const documents = pgAggregateRepository<{ readonly entries?: readonly FieldManualEntry[] }>(sql, "FieldManual", "cp_field_manual", options);
  const run = boundedRunner(sql, "cp_field_manual", options.bounds ?? CONTROL_PLANE_REQUEST_BOUNDS_MS);
  return {
    read: (id) => documents.read(id),
    async retire(id, revision, as) {
      const moved = (await run("retire", "DOCUMENT", "UPDATE cp_field_manual SET id = $3 WHERE id = $1 AND revision = $2 RETURNING id",
        [id, revision, as])) as unknown[];
      return moved.length === 1;
    },
  };
}

/** Null when absent: NOT_CONFIGURED, not broken. */
export function controlPlaneUrlFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const value = env[CONTROL_PLANE_URL_VAR];
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

/** The one place the isolated-test variable is read. Empty is null. */
export function controlPlaneTestUrlFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const value = env[CONTROL_PLANE_TEST_URL_VAR];
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}
