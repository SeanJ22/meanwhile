import type { WorkerResultRecord } from "../workers/types.ts";
import type { SoftwareReleaseReviewRecord } from "../software-release-review.ts";
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
 * ## Locks are ADVISORY LOCKS, and that is the cross-machine half
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

import { neon } from "@neondatabase/serverless";
import type {
  CacheObservationRecord,
  OwnerDecisionIntent,
  OwnerDigestRecord,
  OwnerSnapshot,
  RunnerHeartbeat,
} from "../owner-surface.ts";
import type { FieldManualStore } from "../field-manual.ts";
import type { ReadinessStateSnapshot } from "../readiness/model.ts";
import type { ActionReceipt } from "../gateway/contract.ts";
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
  BOOTSTRAP_DDL,
  BOOTSTRAP_VERSION,
  recordVersionStatement,
} from "./pg-schema.ts";
import {
  CONTROL_PLANE_CONNECT_MAX_ATTEMPTS,
  withControlPlaneConnectRetry,
} from "./connect-retry.ts";
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
 */
export interface Sql {
  query(text: string, params?: readonly unknown[]): Promise<unknown>;
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
): AggregateRepository<T> {
  const where = `${table} in the control-plane database`;

  async function read(id: string): Promise<Persisted<T> | null> {
    const rows = (await sql.query(
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

  return {
    read,

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
      const inserted = (await sql.query(
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
      const updated = (await sql.query(
        `UPDATE ${table}
            SET revision = revision + 1, updated_at = $1, value = $2::jsonb
          WHERE id = $3 AND revision = $4
       RETURNING id, revision, updated_at, value`,
        [now, JSON.stringify(next), id, expectedRevision],
      )) as Record<string, unknown>[];

      if (updated.length === 0) {
        const current = await read(id);
        throw new ConcurrentModification(
          kind,
          id,
          expectedRevision,
          current === null ? null : current.revision,
        );
      }
      const row = updated[0];
      return {
        id: String(row.id),
        revision: Number(row.revision),
        updatedAt: new Date(row.updated_at as string).toISOString(),
        value: parseValue<T>(row.value, `${where} id ${id}`),
      };
    },

    async list() {
      /* Keyset-paged by id so no one response can exceed the driver's 64 MiB
         cap (see AGGREGATE_LIST_READ_PAGE). `id > $1` on the primary key is an
         index range scan; the concatenation equals the old single statement. */
      const out: Persisted<T>[] = [];
      let afterId: string | null = null;
      for (;;) {
        const rows = (afterId === null
          ? await sql.query(
              `SELECT id, revision, updated_at, value FROM ${table}
               ORDER BY id ASC
               LIMIT ${AGGREGATE_LIST_READ_PAGE}`,
            )
          : await sql.query(
              `SELECT id, revision, updated_at, value FROM ${table}
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
            value: parseValue<T>(row.value, `${where} id ${String(row.id)}`),
          });
        }
        if (rows.length < AGGREGATE_LIST_READ_PAGE) break;
        afterId = String(rows[rows.length - 1].id);
      }
      return out;
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
          ? await sql.query(
              `SELECT id, revision, updated_at, value FROM ${table}
               WHERE value #>> '${jsonPath}' = $1
               ORDER BY id ASC
               LIMIT ${AGGREGATE_LIST_READ_PAGE}`,
              [value],
            )
          : await sql.query(
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
 * its startup method-candidate-authority gate (the read there is how it verifies
 * the adoption receipt in the owner digest log). Appends kept succeeding — they
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

export function pgAppendOnlyRepository<T>(sql: Sql, log: string): AppendOnlyRepository<T> {
  const table = `cp_log_${log}`;

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
      const already = (await sql.query(
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

      const allocated = (await sql.query(
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

      const inserted = (await sql.query(
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

      const existing = (await sql.query(
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
        const rows = (await sql.query(
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
        const rows = (await sql.query(
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

    async readAll() {
      /* Keyset-paged over the whole table in the same (log_key, position) order
         the single statement used, for the same 64 MiB reason as `read`. */
      const out: T[] = [];
      let cursor: { readonly key: string; readonly position: number } | null = null;
      for (;;) {
        const rows = (cursor === null
          ? await sql.query(
              `SELECT log_key, position, record FROM ${table}
               ORDER BY log_key ASC, position ASC
               LIMIT ${APPEND_ONLY_LOG_READ_PAGE}`,
            )
          : await sql.query(
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

    async readRecent(key, limit) {
      /* Newest `limit`, newest first. `limit` bounds the response, so this needs
         no paging — callers pass a small tail (e.g. a digest-history window). */
      const rows = (await sql.query(
        `SELECT record FROM ${table} WHERE log_key = $1 ORDER BY position DESC LIMIT $2`,
        [key, Math.max(0, Math.trunc(limit))],
      )) as Record<string, unknown>[];
      return rows.map((r) => parseValue<T>(r.record, `${table} ${key}`));
    },

    async keys() {
      const rows = (await sql.query(
        `SELECT DISTINCT log_key FROM ${table} ORDER BY log_key ASC`,
      )) as Record<string, unknown>[];
      return rows.map((r) => String(r.log_key));
    },
  };
}

/**
 * Advisory locks, held by the DATABASE.
 *
 * This is the cross-machine half of RULING 220 and the one thing the file
 * provider structurally cannot do. `pg_try_advisory_lock` rather than the
 * blocking form, so a held lock is a NAMED REFUSAL exactly as the interface
 * requires — a silent wait in a library that promised not to read a clock is a
 * lie about both.
 */
function pgLockManager(sql: Sql): LockManager {
  return {
    async withLock<R>(name: string, fn: () => Promise<R>): Promise<R> {
      const key = advisoryLockKey(name).toString();
      const got = (await sql.query(`SELECT pg_try_advisory_lock($1::bigint) AS ok`, [key])) as {
        ok: boolean;
      }[];
      if (!got[0]?.ok) {
        const { RepositoryLockHeld } = await import("./types.ts");
        throw new RepositoryLockHeld(
          name,
          `advisory key ${key} is held by another session, possibly on another machine`,
        );
      }
      try {
        return await fn();
      } finally {
        /* Released in a finally because this one CAN be: the lock is
           session-scoped rather than transaction-scoped, so a process that
           returns normally must hand it back. A process that DIES holds
           nothing — the connection closes and Postgres releases it, which is
           the property that makes this safe across a crash. */
        await sql.query(`SELECT pg_advisory_unlock($1::bigint)`, [key]);
      }
    },
  };
}

/** Bring the schema up. Idempotent, and it records the version it reached. */
export async function bootstrap(sql: Sql, nowIso: string): Promise<void> {
  for (const statement of BOOTSTRAP_DDL) await sql.query(statement);
  await sql.query(recordVersionStatement(BOOTSTRAP_VERSION, nowIso));
}

/**
 * Open the Postgres control-plane repositories.
 *
 * NO ENV MAGIC in the signature: the caller passes the connection string, the
 * same discipline `createFileRepositories` applies to its root. `fromEnv`
 * below is the one place the variable is read, and it refuses rather than
 * defaulting.
 */
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
  const sql = neon(connectionString);
  if (!options.skipBootstrap) {
    /* The schema bootstrap is this process's first Neon I/O, so its first query
       IS the connect. Under host load that connect can fail transiently
       (`NeonDbError: Error connecting to database: fetch failed`); before this
       wrapper that single throw aborted a whole standing-runner cycle at its
       start — the per-cycle child died ~2s in having dispatched nothing.
       bootstrap is idempotent (it records the version it reaches), so retrying
       the transient connect is safe. A latched circuit or a real SQL/status
       error is not retried; see connect-retry.ts. */
    await withControlPlaneConnectRetry(() => bootstrap(sql, nowIso), {
      onRetry: ({ attempt, delayMs, error }) =>
        console.warn(
          `control-plane bootstrap connect: transient failure on attempt ${attempt} of ` +
            `${CONTROL_PLANE_CONNECT_MAX_ATTEMPTS}; retrying in ${delayMs}ms — ` +
            (error instanceof Error ? error.message : String(error)),
        ),
    });
  }
  const locks = pgLockManager(sql);

  return {
    workItems: pgAggregateRepository<WorkItem>(sql, "WorkItem", "cp_work_items"),
    routeTasks: pgAggregateRepository<RouteTask>(sql, "RouteTask", "cp_route_tasks"),
    attempts: pgAggregateRepository<Attempt>(sql, "Attempt", "cp_attempts"),
    obligations: pgAggregateRepository<StandingObligation>(
      sql,
      "StandingObligation",
      "cp_obligations",
    ),
    occurrences: pgAggregateRepository<FreshnessOccurrence>(
      sql,
      "FreshnessOccurrence",
      "cp_occurrences",
    ),
    debts: pgAggregateRepository<FreshnessDebt>(sql, "FreshnessDebt", "cp_debts"),
    leases: pgAggregateRepository<ExecutionLease>(sql, "ExecutionLease", "cp_leases"),
    transitions: pgAppendOnlyRepository<RecordedTransition>(sql, "transitions"),
    escalations: pgAppendOnlyRepository<Escalation>(sql, "escalations"),
    dispositions: pgAppendOnlyRepository<DispositionCommit>(sql, "dispositions"),
    artifacts: pgAppendOnlyRepository<ArtifactRecord>(sql, "artifacts"),
    costs: pgAppendOnlyRepository<CostEntry>(sql, "costs"),
    /* The owner control centre's data plane (ITEM H, schema v3). */
    ownerSnapshots: pgAggregateRepository<OwnerSnapshot>(
      sql,
      "OwnerSnapshot",
      "cp_owner_snapshots",
    ),
    readinessSnapshots: pgAggregateRepository<ReadinessStateSnapshot>(
      sql,
      "ReadinessStateSnapshot",
      "cp_readiness_snapshots",
    ),
    fieldManual: pgAggregateRepository<FieldManualStore>(
      sql,
      "FieldManual",
      "cp_field_manual",
    ),
    runnerHeartbeat: pgAggregateRepository<RunnerHeartbeat>(
      sql,
      "RunnerHeartbeat",
      "cp_runner_heartbeat",
    ),
    cacheObservations: pgAggregateRepository<CacheObservationRecord>(
      sql,
      "CacheObservationRecord",
      "cp_cache_observations",
    ),
    ownerDigests: pgAppendOnlyRepository<OwnerDigestRecord>(sql, "owner_digests"),
    ownerDecisions: pgAppendOnlyRepository<OwnerDecisionIntent>(sql, "owner_decisions"),
    /* Level 1 — Research (schema v4). */
    researchState: pgAggregateRepository<ResearchState>(sql, "ResearchState", "cp_research_state"),
    methodCandidates: pgAggregateRepository<CandidateStore>(sql, "MethodCandidateStore", "cp_method_candidates"),
    researchIntents: pgAppendOnlyRepository<ResearchIntent>(sql, "research_intents"),
    scoutResults: pgAppendOnlyRepository<ScoutResult>(sql, "scout_results"),
    workerResults: pgAppendOnlyRepository<WorkerResultRecord>(sql, "worker_results"),
    /* The nightly door (RULING 242, schema v5). */
    promotionPipeline: pgAppendOnlyRepository<PromotionPipelineRecord>(sql, "promotion_pipeline"),
    windowRuns: pgAppendOnlyRepository<WindowRunRecord>(sql, "window_runs"),
    windowIncidents: pgAppendOnlyRepository<WindowIncident>(sql, "window_incidents"),
    windowIntents: pgAppendOnlyRepository<WindowIntent>(sql, "window_intents"),
    /* Software release review (Admin Pass B, schema v8). */
    softwareReleaseReviews: pgAppendOnlyRepository<SoftwareReleaseReviewRecord>(sql, "software_release_reviews"),
    /* The Action Gateway (Admin Pass C, ADM-C6, schema v9). */
    adminReceipts: pgAppendOnlyRepository<ActionReceipt>(sql, "admin_receipts"),
    agentJobs: pgAppendOnlyRepository<AgentJobRecord>(sql, "agent_jobs"),
    discoveryAttempts: pgAppendOnlyRepository<MeetingsDiscoveryAttempt>(sql, "discovery_attempts"),
    adminConfig: pgAggregateRepository<AdminConfig>(sql, "AdminConfig", "cp_admin_config"),
    budget: budgetRepositoryFrom(
      pgAggregateRepository<BudgetLedger>(sql, "BudgetLedger", "cp_budget"),
      locks,
    ),
    locks,
    describe: () =>
      `Postgres control-plane repositories (schema v${BOOTSTRAP_VERSION}, connection named by ` +
      `${CONTROL_PLANE_URL_VAR})`,
    durable: true,
  };
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
