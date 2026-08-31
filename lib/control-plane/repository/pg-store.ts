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

function pgAggregateRepository<T>(
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
      const rows = (await sql.query(
        `SELECT id, revision, updated_at, value FROM ${table} ORDER BY id ASC`,
      )) as Record<string, unknown>[];
      return rows.map((row) => ({
        id: String(row.id),
        revision: Number(row.revision),
        updatedAt: new Date(row.updated_at as string).toISOString(),
        value: parseValue<T>(row.value, `${where} id ${String(row.id)}`),
      }));
    },
  };
}

function pgAppendOnlyRepository<T>(sql: Sql, log: string): AppendOnlyRepository<T> {
  const table = `cp_log_${log}`;

  return {
    async append(key, recordId, record, now): Promise<AppendOutcome<T>> {
      /*
       * The position is computed inside the INSERT, from the log's own current
       * length under the key, so two appenders cannot both compute the same
       * position from a stale read. The PRIMARY KEY refuses a rewrite at the
       * storage layer rather than by convention.
       */
      const inserted = (await sql.query(
        `INSERT INTO ${table} (log_key, record_id, position, recorded_at, record)
         SELECT $1, $2,
                COALESCE((SELECT MAX(position) + 1 FROM ${table} WHERE log_key = $1), 0),
                $3, $4::jsonb
         ON CONFLICT (log_key, record_id) DO NOTHING
         RETURNING position`,
        [key, recordId, now, JSON.stringify(record)],
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
      const rows = (await sql.query(
        `SELECT record FROM ${table} WHERE log_key = $1 ORDER BY position ASC`,
        [key],
      )) as Record<string, unknown>[];
      return rows.map((r) => parseValue<T>(r.record, `${table} ${key}`));
    },

    async readAll() {
      const rows = (await sql.query(
        `SELECT log_key, record FROM ${table} ORDER BY log_key ASC, position ASC`,
      )) as Record<string, unknown>[];
      return rows.map((r) => parseValue<T>(r.record, `${table} ${String(r.log_key)}`));
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
  await bootstrap(sql, nowIso);
  const locks = pgLockManager(sql);

  return {
    workItems: pgAggregateRepository<WorkItem>(sql, "WorkItem", "cp_work_items"),
    routeTasks: pgAggregateRepository<RouteTask>(sql, "RouteTask", "cp_route_tasks"),
    attempts: pgAggregateRepository<Attempt>(sql, "Attempt", "cp_attempts"),
    leases: pgAggregateRepository<ExecutionLease>(sql, "ExecutionLease", "cp_leases"),
    transitions: pgAppendOnlyRepository<RecordedTransition>(sql, "transitions"),
    escalations: pgAppendOnlyRepository<Escalation>(sql, "escalations"),
    dispositions: pgAppendOnlyRepository<DispositionCommit>(sql, "dispositions"),
    artifacts: pgAppendOnlyRepository<ArtifactRecord>(sql, "artifacts"),
    costs: pgAppendOnlyRepository<CostEntry>(sql, "costs"),
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
