import type { WorkerResultRecord } from "../workers/types.ts";
import type { AdminEvidenceCopyRequest } from "../evidence/admin-copy-request.ts";
import { installDatabaseTransferCounter } from "../../db/transfer.ts";
import type { AskGapObservation } from "../ask-gap-observations.ts";
import type { DoorRecord } from "../../doors/registry.ts";
import type { LiveAuditLogRow } from "../live-audit-log.ts";
import type { SoftwareReleaseReviewRecord } from "../software-release-review.ts";
import { pgActiveWorkClaimReader } from "./active-work-claims.ts";
/**
 * **THE POSTGRES CONTROL-PLANE PROVIDER.** (Session B, W3.1. RULING 220.)
 *
 * A new file beside `file-store.ts`, implementing the same
 * `ControlPlaneRepositories` interfaces and nothing else — which is exactly the
 * shape `file-store.ts`'s own "WHY A FILESYSTEM AND NOT A DATABASE" section
 * predicted a later swap would take: *a new file in that directory, not a
 * change to a domain rule*.
 *
 * ## What only this provider can do
 *
 * ```
 *   CROSS-MACHINE CLAIMING   the file store's exclusiveCreate/link() lock
 *                            semantics are single-host and cannot arbitrate
 *                            between two machines; the Drive mirror is an
 *                            eventually-consistent synced folder, not a
 *                            locking substrate
 *   INDEXED DUE-TIME         a due-time query over a directory is a full scan
 *   SURVIVAL                 Neon outlives either laptop, with PITR
 * ```
 *
 * ## The four properties, and where each one lives here
 *
 * ```
 *   IDEMPOTENT PUT      INSERT ... ON CONFLICT DO NOTHING, then read back and
 *                       compare canonically. Identical is a no-op success;
 *                       different is IdentityCollision.
 *   APPEND-ONLY         PRIMARY KEY (log_key, record_id) makes a rewrite
 *                       impossible at the storage layer rather than by
 *                       convention; a re-append of the identical record is a
 *                       no-op success, a different one is AppendOnlyViolation.
 *   COMPARE-AND-SET     UPDATE ... WHERE revision = $expected. Zero rows
 *                       affected IS the refusal — the database arbitrates,
 *                       not a read-then-write in this process.
 *   FAILED READ ≠ EMPTY unparseable or unreachable raises
 *                       CorruptPersistedState; nothing here returns [] for a
 *                       read that did not happen.
 * ```
 *
 * ## Locks use a pinned WebSocket transaction
 *
 * `pg_advisory_xact_lock` is held by the DATABASE, so two processes on two
 * machines contend correctly — which is the single thing the filesystem
 * provider cannot do and the reason RULING 220 exists. The lock name is hashed
 * to a bigint because that is the API; the hash is stable and stated.
 *
 * ## What is NOT proved here, said plainly
 *
 * `WTP_CONTROL_PLANE_DATABASE_URL` is not provisioned on the machine this was
 * written on. So this provider is IMPLEMENTED and CONFORMANCE-TESTED by the
 * shared suite whenever the variable is present, and RULING 220's step 6 —
 * contention from both machines, crash/reclaim on Postgres, a restore drill —
 * has NOT been performed. Tracker NH300 carries that escalation with the
 * provider, mechanism, scopes and what continues without it. Nothing in this
 * file claims otherwise, and `pnpm control-plane:gate` reports NOT_CONFIGURED
 * rather than passing.
 */

import { neon, Pool, neonConfig } from "@neondatabase/serverless";
import type {
  CacheObservationRecord,
  OwnerDecisionIntent,
  OwnerDigestRecord,
  OwnerSnapshot,
  RunnerHeartbeat,
} from "../owner-surface.ts";
import type { FieldManualStore } from "../field-manual.ts";
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
  reconcileIdempotentPut,
  type AggregateRepository,
  type AppendOnlyRepository,
  type AppendOutcome,
  type ArtifactRecord,
  type ControlPlaneRepositories,
  type DispositionCommit,
  type LockManager,
  type Persisted,
  type PutOutcome,
  type RecordedTransition,
  type RecordProjection,
} from "./types.ts";

/** The one environment variable, named and never valued. */
export const CONTROL_PLANE_URL_VAR = "WTP_CONTROL_PLANE_DATABASE_URL";

/**
 * The SEPARATE variable that names an ISOLATED test control plane.
 *
 * The conformance suite's Postgres lane MUTATES — it puts, appends and
 * compare-and-sets — so it may only ever run against a database designated for
 * exactly that. `CONTROL_PLANE_URL_VAR` names the LIVE, append-only production
 * control plane; a normal `.env.local` carries it, and a local gate or handoff
 * loads that file. If the mutable lane read that variable it would write test
 * fixtures into the production control plane every time the suite ran — which
 * is how an overnight quota was burned. So the mutable lane requires THIS
 * variable, and never silently treats the production connection as a test one.
 */
export const CONTROL_PLANE_TEST_URL_VAR = "WTP_CONTROL_PLANE_TEST_DATABASE_URL";

/**
 * The SQL surface this provider uses, narrowed to what it actually calls.
 *
 * Not `ReturnType<typeof neon>`: that type is generic over array-mode and
 * full-results flags, and a concrete client does not widen back to it. The
 * provider only ever calls the parameterized `query` form, so the seam is one
 * method — which also means a test double is one function rather than a mock of
 * the whole driver.
 *
 * The third argument is the driver's per-query options. This provider passes
 * only `fetchOptions.signal`, which cancels the request at its bound
 * (request-bounds.ts); a double may ignore it.
 */
export interface Sql {
  query(text: string, params?: readonly unknown[], options?: BoundableQueryOptions): Promise<unknown>;
  /** Online DDL and session locks need one connection; normal reads keep HTTP. */
  withPinnedConnection?<T>(operation: (sql: Sql) => Promise<T>): Promise<T>;
}

/**
 * Tables whose ONE row is a large document, so a read, put or compare-and-set
 * of it moves hundreds of KB to MB each way. Measured 2026-09-23: research
 * state 1.1 MB (1.06 MB of it the FleetSafety deferral list), field manual
 * 1.4 MB, method candidates 0.8 MB, owner snapshot 428 KB, readiness snapshot
 * 119 KB. Measured staging 2026-10-02: the shared budget ledger is 3.37 MB
 * as host state and lifetime spend holds accumulate.
 */
export const DOCUMENT_ROW_TABLES: ReadonlySet<string> = new Set([
  "cp_budget",
  "cp_research_state",
  "cp_field_manual",
  "cp_method_candidates",
  "cp_owner_snapshots",
  "cp_readiness_snapshots",
]);

/**
 * Logs whose records reach tens to hundreds of KB, so an append uploads a
 * document. Measured 2026-09-23 maximum record: owner digests 708 KB, worker
 * results 246 KB, window runs 147 KB, scout results 73 KB. Every other log's
 * records are under 14 KB.
 */
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
}

/** Bound transport fan-out across repositories and clients in this process.
 * Thousands of dispatch rows may be ready together; they share HTTP capacity,
 * rather than starting thousands of request timers while waiting for sockets.
 * This does not cap workers or due work. Each admitted query keeps its existing
 * request bound, and an enclosing store budget still includes queue time. */
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

/**
 * A stable 63-bit key for an advisory lock name.
 *
 * FNV-1a, written out rather than imported, because the only property that
 * matters is that two processes computing it from one name agree — and a hash
 * whose implementation could change under a dependency bump is a lock that
 * could silently stop being the same lock.
 */
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

/* The `#>>` path is a fixed literal built from CODE-PROVIDED segments, never a
   query value; validate each segment so it can never carry SQL, then embed it
   (the extracted VALUE is the parameter). Shared by the log `readWhere` and the
   aggregate `listWhere`, so there is one validator, not two. */
function jsonPathLiteral(table: string, path: readonly string[]): string {
  if (path.length === 0) throw new Error(`${table}: an empty JSON path cannot select a field`);
  for (const segment of path) {
    if (!/^[A-Za-z0-9_]+$/.test(segment)) {
      throw new Error(`${table}: unsafe JSON path segment ${JSON.stringify(segment)}`);
    }
  }
  return `{${path.join(",")}}`;
}

/* A `RecordProjection` as a Postgres expression over the `record` column (a
   log's) or the `value` column (an aggregate's): `projectRecord`, built by the
   database, so a dropped field never leaves it.
   Keys are CODE-PROVIDED and embedded as literals, so each is validated as a
   plain identifier exactly as a JSON path segment is. `jsonb_each` keeps only
   the keys the record holds, so an absent key stays absent. */
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

/**
 * How many aggregate rows one `list()` statement fetches.
 *
 * The Neon serverless (HTTP) driver caps a single response at 64 MiB. An
 * aggregate table grows without bound — one row per work item, attempt, lease,
 * transition subject — and `readAutonomousActivity` lists FOUR of them
 * (`workItems`, `routeTasks`, `attempts`, `leases`) on every `/admin/fleet`
 * render. A single unbounded `SELECT ... ORDER BY id` therefore threw
 * `NeonDbError: response is too large` once the fleet's aggregates crossed the
 * cap, surfacing as STORE_UNREACHABLE and collapsing the whole operations
 * report — the same failure the append-only log had (see
 * {@link APPEND_ONLY_LOG_READ_PAGE}), one layer up. `list()` keyset-pages
 * instead. `id` is the primary key and the ASC order key, so `id > $1` is an
 * index range scan and the page concatenation is byte-identical to the old
 * single statement.
 */
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

  async function list(): Promise<readonly Persisted<T>[]>;
  async function list(projection: RecordProjection): Promise<readonly Persisted<unknown>[]>;
  async function list(projection?: RecordProjection): Promise<readonly Persisted<unknown>[]> {
    const operation = projection === undefined ? "list" : "listNarrowed";
    const value = projection === undefined ? "value" : Object.keys(projection).length === 0
      ? "'{}'::jsonb AS value" : `${recordProjectionSql(table, projection, "value")} AS value`;
    /* Keyset-paged by id so no one response can exceed the driver's 64 MiB
       cap (see AGGREGATE_LIST_READ_PAGE). `id > $1` on the primary key is an
       index range scan; the concatenation equals the old single statement. */
    const out: Persisted<unknown>[] = [];
    let afterId: string | null = null;
    for (;;) {
      const rows = (afterId === null
        ? await run(
            operation,
            "PAGE",
            `SELECT id, revision, updated_at, ${value} FROM ${table}
             ORDER BY id ASC
             LIMIT ${AGGREGATE_LIST_READ_PAGE}`,
          )
        : await run(
            operation,
            "PAGE",
            `SELECT id, revision, updated_at, ${value} FROM ${table}
             WHERE id > $1
             ORDER BY id ASC
             LIMIT ${AGGREGATE_LIST_READ_PAGE}`,
            [afterId],
          )) as Record<string, unknown>[];
      for (const row of rows) {
        out.push({
          id: String(row.id),
          revision: Number(row.revision),
          updatedAt: new Date(row.updated_at as string).toISOString(),
          value: parseValue<unknown>(row.value, `${where} id ${String(row.id)}`),
        });
      }
      if (rows.length < AGGREGATE_LIST_READ_PAGE) break;
      afterId = String(rows[rows.length - 1].id);
    }
    return out;
  }

  return {
    read,

    async readNarrowed(id, projection) {
      /* Postgres narrows the row, so only the kept fields cross the wire; an
         empty projection reads the revision and write time without the value
         at all, so a large document is not even decompressed. A small answer,
         so a POINT call, whatever the row's class. */
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
      /*
       * INSERT ... DO NOTHING, then read back. Not an upsert: an upsert would
       * silently replace a DIFFERENT value under a derived id, which is the
       * exact collision `IdentityCollision` exists to refuse. The database
       * decides who created; this process only decides what the difference
       * means.
       */
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
      /*
       * The WHERE clause IS the compare-and-set. Zero rows affected is the
       * refusal, decided by the database — a read-then-write in this process
       * would leave a window in which two writers both read the same revision
       * and both proceeded, which is the lost update the whole mechanism
       * exists to prevent, and it is precisely the window a second MACHINE
       * makes reachable.
       */
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
        // of a potentially multi-megabyte aggregate.
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
        // The schema's aggregate tables have no value-rewrite triggers. The
        // successful revision fence acknowledges this exact JSON assignment;
        // downloading its identical value again adds no readback information.
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

    list: () => list(),
    listNarrowed: projection => list(projection),

    async listChangedSince(since) {
      /* `list()` narrowed to rows the DATABASE stamped at or after `since`
         (schema v22), the same id keyset pages. `through` is the database clock
         taken before the first page, so a change committed while the pages are
         read is caught by the next read rather than straddled. */
      const clock = (await run("listChangedSince:clock", "POINT", "SELECT now() AS read_at")) as Record<string, unknown>[];
      const through = new Date(clock[0]?.read_at as string).toISOString();
      const changed = since === null ? "" : "changed_at >= $1::timestamptz";
      const out: Persisted<T>[] = [];
      let afterId: string | null = null;
      for (;;) {
        const filters = [changed, afterId === null ? "" : `id > $${since === null ? 1 : 2}`].filter(Boolean);
        const params = [...(since === null ? [] : [since]), ...(afterId === null ? [] : [afterId])];
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
    },

    async listWhere(path, value) {
      /* `list()` filtered IN THE DATABASE: the same ORDER BY id and keyset
         paging, with the content filter in the WHERE clause, so only matching
         rows cross the wire and the result equals `list()` filtered, row for
         row and in order. One RouteTask's Attempts is one bounded round trip
         here, where `list()` is every page of cp_attempts (44 on 2026-09-22). */
      const jsonPath = jsonPathLiteral(table, path);
      const out: Persisted<T>[] = [];
      let afterId: string | null = null;
      for (;;) {
        const rows = (afterId === null
          ? await run(
              "listWhere",
              "PAGE",
              `SELECT id, revision, updated_at, value FROM ${table}
               WHERE value #>> '${jsonPath}' = $1
               ORDER BY id ASC
               LIMIT ${AGGREGATE_LIST_READ_PAGE}`,
              [value],
            )
          : await run(
              "listWhere",
              "PAGE",
              `SELECT id, revision, updated_at, value FROM ${table}
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
            value: parseValue<T>(row.value, `${where} id ${String(row.id)}`),
          });
        }
        if (rows.length < AGGREGATE_LIST_READ_PAGE) break;
        afterId = String(rows[rows.length - 1].id);
      }
      return out;
    },
  };
}

/**
 * How many log records one read statement fetches.
 *
 * The Neon serverless (HTTP) driver caps a single response at 64 MiB, and an
 * append-only log grows without bound — so a full-log read must NEVER assume it
 * fits in one response. On 2026-09-15 the owner-digest log crossed 64 MiB and
 * every `SELECT record ... ORDER BY position` for it began throwing
 * `NeonDbError: Server error (HTTP status 507): response is too large`, which
 * surfaced to callers as STORE_UNREACHABLE and stopped the standing runner at
 * its startup gate, which read this log (that gate is gone). Appends kept succeeding — they
 * are small — so the log only grew, one crash-loop hold every five minutes.
 *
 * Reads are fetched in keyset pages instead. 100 rows keeps a page far under the
 * cap even at the largest record this control plane has ever held (~0.25 MiB →
 * ~25 MiB per page), with room for the log to keep growing. The concatenation is
 * identical to the old single statement because `position` is a strict
 * per-`log_key` order and `(log_key, position)` is strict across the whole
 * table — both backed by the `cp_log_<name>_order` unique index the schema
 * already creates, so each page is an index range scan, not a re-sort.
 */
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

  return {
    async append(key, recordId, record, now): Promise<AppendOutcome<T>> {
      /*
       * **THE POSITION IS ALLOCATED, NOT COMPUTED.** (Session B resume, W3.D.)
       *
       * This read `COALESCE((SELECT MAX(position) + 1 FROM ... WHERE log_key = $1), 0)`
       * inside the INSERT, under a comment asserting that computing it inside
       * the statement meant "two appenders cannot both compute the same
       * position from a stale read". That is not what it meant. A subquery in
       * an INSERT still runs against the statement's READ COMMITTED snapshot,
       * so two concurrent appenders with different `record_id`s each saw the
       * same committed MAX and each wrote it. `PRIMARY KEY (log_key, record_id)`
       * does not object — the record ids differ — so both committed, and the
       * log held two records at one position.
       *
       * The log is the replay history: `reconcile()` walks dispositions in
       * position order to finish aggregate writes a crash interrupted. Two
       * records at one position make that order ambiguous.
       *
       * The idempotency check runs FIRST so a retried append returns the
       * position it already has instead of allocating a fresh one. Positions
       * may therefore contain GAPS under contention — an allocation whose
       * insert then no-ops burns its number — and that is fine and is stated
       * here so nobody later "fixes" it: position is an ORDER key, never a
       * count, and `readAll` orders by it rather than counting it.
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
      /* Content filter, keyset-paged like `read`: the response only ever holds
         matching rows (bounded by the page), so a selective filter over a log
         far larger than the 64 MiB cap still returns every match. The cursor
         advances by the last match's position, skipping non-matching rows. */
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
      /* `readWhere` newest first, stopped at `limit` matches, each record
         narrowed in the SELECT list: the database projects only the rows it
         returns, and `limit` bounds the response, so this needs no paging.
         `ORDER BY position DESC` on `(log_key, position)` is a backward index
         scan that stops at the `limit`th match. */
      const jsonPath = jsonPathLiteral(table, path);
      const narrowed = recordProjectionSql(table, projection);
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

    async readAll() {
      /* Keyset-paged over the whole table in the same (log_key, position) order
         the single statement used, for the same 64 MiB reason as `read`. */
      const out: T[] = [];
      let cursor: { readonly key: string; readonly position: number } | null = null;
      for (;;) {
        const rows = (cursor === null
          ? await run(
              "readAll",
              "PAGE",
              `SELECT log_key, position, record FROM ${table}
               ORDER BY log_key ASC, position ASC
               LIMIT ${APPEND_ONLY_LOG_READ_PAGE}`,
            )
          : await run(
              "readAll",
              "PAGE",
              `SELECT log_key, position, record FROM ${table}
               WHERE (log_key, position) > ($1, $2)
               ORDER BY log_key ASC, position ASC
               LIMIT ${APPEND_ONLY_LOG_READ_PAGE}`,
              [cursor.key, cursor.position],
            )) as Record<string, unknown>[];
        for (const r of rows) out.push(parseValue<T>(r.record, `${table} ${String(r.log_key)}`));
        if (rows.length < APPEND_ONLY_LOG_READ_PAGE) break;
        const last = rows[rows.length - 1];
        cursor = { key: String(last.log_key), position: Number(last.position) };
      }
      return out;
    },

    async readChangedSince(since) {
      /* `readAll()` narrowed to records the DATABASE stamped at or after
         `since` (schema v22), the same (log_key, position) keyset pages, each
         with its coordinates. `through` is the database clock before the first
         page, as in the aggregate read. */
      const clock = (await run("readChangedSince:clock", "POINT", "SELECT now() AS read_at")) as Record<string, unknown>[];
      const through = new Date(clock[0]?.read_at as string).toISOString();
      const out: { key: string; recordId: string; position: number; record: T }[] = [];
      let cursor: { readonly key: string; readonly position: number } | null = null;
      for (;;) {
        const at = since === null ? 1 : 2;
        const filters = [since === null ? "" : "changed_at >= $1::timestamptz",
          cursor === null ? "" : `(log_key, position) > ($${at}, $${at + 1})`].filter(Boolean);
        const params = [...(since === null ? [] : [since]), ...(cursor === null ? [] : [cursor.key, cursor.position])];
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
    },

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
      /* The inner statement picks each key's newest row on `(log_key, position)`; the outer one narrows only those rows,
         with the projection `readRecentWhere` uses, so older walks and dropped fields never leave the database. */
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

    async keys() {
      const rows = (await run(
        "keys",
        "PAGE",
        `SELECT DISTINCT log_key FROM ${table} ORDER BY log_key ASC`,
      )) as Record<string, unknown>[];
      return rows.map((r) => String(r.log_key));
    },

    async keysWhere(path, value) {
      /* `keys()` narrowed in the database, on the same `#>>` expression the
         version-20 log indexes are built on (CH-26). */
      const jsonPath = jsonPathLiteral(table, path);
      const rows = (await run(
        "keysWhere",
        "PAGE",
        `SELECT DISTINCT log_key FROM ${table} WHERE record #>> '${jsonPath}' = $1 ORDER BY log_key ASC`,
        [value],
      )) as Record<string, unknown>[];
      return rows.map((r) => String(r.log_key));
    },
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
    // session as well, releasing the session lock even after a transport failure.
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

/**
 * **THE SPEND HOLDS, ONE ROW EACH.** (Schema v24, 2026-10-06.)
 *
 * Every call is one statement over the HTTP driver, so one implicit
 * transaction. An admission is `cp_admit_spend_hold` (pg-schema.ts): it locks
 * the lines it names, deletes what no longer counts on them, and decides as
 * `decideHold` does; the refusal is worded here by the same functions. A
 * settle is one UPDATE by job, a release one DELETE by id, a live read one
 * indexed SELECT, and a sweep one bounded DELETE. Nothing reads the table
 * whole: the only unfiltered read (`liveAll`) is of holds that still count.
 */
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

/**
 * Open the Postgres control-plane repositories.
 *
 * NO ENV MAGIC in the signature: the caller passes the connection string, the
 * same discipline `createFileRepositories` applies to its root. `fromEnv`
 * below is the one place the variable is read, and it refuses rather than
 * defaulting.
 */
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

/** Exact source observations from any job; unrelated vault metadata stays in
 * Postgres instead of being copied into every place worker. The md5 filter is
 * what `cp_log_artifacts_source_url` (v18) indexes; the plain equality alone
 * scanned the whole log. */
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
    /**
     * Skip the schema bootstrap. (ADM-2, 9.4.26.) The bootstrap replays every
     * DDL statement and a version upsert — nine sequential Neon round trips —
     * and the admin PAGES were paying it on every request before their first
     * SELECT, which is most of the two-second lag the owner felt choosing a
     * state. A page never owns the schema: the runner and the publishers
     * bootstrap, the deploy only reads. On a database whose schema is behind,
     * a read then fails and the page says STORE_UNREACHABLE, which is the
     * honest reading — never a silent CREATE from a web request.
     */
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
        "RULING 220 separates on purpose.",
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
  const bounded: PgRepositoryBounds = { bounds };
  if (!options.skipBootstrap) {
    /* The schema bootstrap is this process's first Neon I/O, so its first query
       IS the connect. Under host load that connect can fail transiently
       (`NeonDbError: Error connecting to database: fetch failed`); before this
       wrapper that single throw aborted a whole standing-runner cycle at its
       start — the per-cycle child died ~2s in having dispatched nothing.
       bootstrap is idempotent (it records the version it reaches), so retrying
       the transient connect is safe. A latched circuit or a real SQL/status
       error is not retried; see connect-retry.ts. */
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
    adminEvidenceCopyRequests: pgAggregateRepository<AdminEvidenceCopyRequest>(sql, "AdminEvidenceCopyRequest", "cp_admin_evidence_copy_requests", bounded),
    costs: pgAppendOnlyRepository<CostEntry>(sql, "costs", bounded),
    /* The owner control centre's data plane (ITEM H, schema v3). */
    ownerSnapshots: pgAggregateRepository<OwnerSnapshot>(
      sql,
      "OwnerSnapshot",
      "cp_owner_snapshots",
      bounded,
    ),
    fieldManual: pgAggregateRepository<FieldManualStore>(
      sql,
      "FieldManual",
      "cp_field_manual",
      bounded,
    ),
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
    /* Level 1 — Research (schema v4). */
    researchState: pgAggregateRepository<ResearchState>(sql, "ResearchState", "cp_research_state", bounded),
    methodCandidates: pgAggregateRepository<CandidateStore>(sql, "MethodCandidateStore", "cp_method_candidates", bounded),
    researchIntents: pgAppendOnlyRepository<ResearchIntent>(sql, "research_intents", bounded),
    scoutResults: pgAppendOnlyRepository<ScoutResult>(sql, "scout_results", bounded),
    workerResults: pgAppendOnlyRepository<WorkerResultRecord>(sql, "worker_results", bounded),
    /* The nightly door (RULING 242, schema v5). */
    promotionPipeline: pgAppendOnlyRepository<PromotionPipelineRecord>(sql, "promotion_pipeline", bounded),
    windowRuns: pgAppendOnlyRepository<WindowRunRecord>(sql, "window_runs", bounded),
    windowIncidents: pgAppendOnlyRepository<WindowIncident>(sql, "window_incidents", bounded),
    windowIntents: pgAppendOnlyRepository<WindowIntent>(sql, "window_intents", bounded),
    /* Software release review (Admin Pass B, schema v8). */
    softwareReleaseReviews: pgAppendOnlyRepository<SoftwareReleaseReviewRecord>(sql, "software_release_reviews", bounded),
    /* The Action Gateway (Admin Pass C, ADM-C6, schema v9). */
    adminReceipts,
    agentJobs: pgAppendOnlyRepository<AgentJobRecord>(sql, "agent_jobs", bounded),
    discoveryAttempts: pgAppendOnlyRepository<MeetingsDiscoveryAttempt>(sql, "discovery_attempts", bounded),
    /* Live-audit results, corrections and pulls (DP-13, schema v21). */
    liveAudits: pgAppendOnlyRepository<LiveAuditLogRow>(sql, "live_audits", bounded),
    adminConfig: pgAggregateRepository<AdminConfig>(sql, "AdminConfig", "cp_admin_config", bounded),
    /* What readers were told Ask does not hold (schema v13). Ask's route adds through `pgAskGapObservationSink`, one atomic upsert per row. */
    askGapObservations: pgAggregateRepository<AskGapObservation>(sql, "AskGapObservation", "cp_ask_gap_observations", bounded),
    /* The Door Registry (DB-09, schema v19). */
    doors: pgAggregateRepository<DoorRecord>(sql, "Door", "cp_doors", bounded),
    budget,
    /* The spend holds, one row each (schema v24). */
    spendHolds: pgSpendHoldRepository(sql, bounds),
    locks,
    describe: () =>
      `Postgres control-plane repositories (schema v${BOOTSTRAP_VERSION}, connection named by ` +
      `${CONTROL_PLANE_URL_VAR})`,
    durable: true,
  };
  placeReadConnections.set(repositories, sql);
  return repositories;
}

/**
 * The one place the variable is read.
 *
 * Returns null when it is absent, so a caller can report NOT_CONFIGURED rather
 * than crashing — every machine without a control plane is a legitimate state,
 * and "this is not set up here" is a different sentence from "this is broken".
 */
export function controlPlaneUrlFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const value = env[CONTROL_PLANE_URL_VAR];
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

/**
 * The one place the ISOLATED-TEST variable is read. Same "empty is null" rule
 * as {@link controlPlaneUrlFromEnv}, so an absent or blank value means "no test
 * database is configured" — which is a legitimate state that reads NOT RUN, not
 * a licence to fall back to the production control plane.
 */
export function controlPlaneTestUrlFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const value = env[CONTROL_PLANE_TEST_URL_VAR];
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}
