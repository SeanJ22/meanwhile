/**
 * **THE CONTROL-PLANE DATABASE'S OWN SCHEMA, VERSIONED IN THE MODULE.**
 * (Session B, W3.1 / W3.2, 2026-08-30. RULING 220 step 1.)
 *
 * ## Why this is not a Drizzle migration
 *
 * RULING 220 puts Level-2 scheduling state in a DEDICATED database, separate
 * from the reader-serving one, with **schema owned by the provider itself:
 * outside `lib/db`, outside `drizzle.config.ts`, invisible to `pnpm db:gate`**.
 * That is not an evasion of the shipping gate — it is the point. `db:gate` asks
 * PRODUCTION whether the SERVING schema is applied, and freezing a release
 * because control-plane bookkeeping has not migrated would freeze it for a
 * reason with nothing to do with what a reader is told.
 *
 * ## "Not governed by the serving gate" must not become "ungoverned"
 *
 * So this file carries three things a migration would otherwise have given it,
 * and `pnpm control-plane:gate` checks all three:
 *
 * ```
 *   VERSIONED   BOOTSTRAP_VERSION moves when the DDL moves, and the database
 *               records which version it is at
 *   APPLIED     the gate asks the database its version and compares
 *   DRIFT       the gate compares the live table/column set against what this
 *               module declares, so a hand-edit in a console is caught
 * ```
 *
 * ## Idempotent bootstrap, and why every statement is CREATE IF NOT EXISTS
 *
 * The provider brings its own schema up on connect. A worker starting on a
 * fresh machine must not need a separate migration step it could skip — a
 * scheduler whose first act can be to fail on a missing table is a scheduler
 * that requires an operator, which is the thing the whole workstream is
 * removing. Idempotent DDL is what makes "just connect" safe to run from every
 * process, every time.
 */

/** Moves whenever `BOOTSTRAP_DDL` moves. The gate compares against it. */
export const BOOTSTRAP_VERSION = 1;

/**
 * The tables, and the shape each one carries.
 *
 * Two kinds and no more, mirroring the interfaces exactly:
 *
 * ```
 *   AGGREGATE     id, revision, updated_at, value   — CAS on revision
 *   APPEND_ONLY   key, record_id, position, record  — unique on (log, record_id)
 * ```
 *
 * The value is `jsonb` rather than columns per field. That is deliberate: the
 * domain types are owned by `work-item.ts`, `route-task.ts` and `attempt.ts`,
 * and mirroring their fields into columns would put a second definition of
 * every aggregate in this file — which would then drift, silently, exactly the
 * way two surfaces answering one question always do.
 */
export const AGGREGATE_KINDS = [
  "work_items",
  "route_tasks",
  "attempts",
  "leases",
  "budget",
] as const;

export const APPEND_ONLY_LOGS = [
  "transitions",
  "escalations",
  "dispositions",
  "artifacts",
  "costs",
] as const;

/** Every table this schema declares, for the drift check. */
export const DECLARED_TABLES: readonly string[] = [
  "cp_schema_version",
  ...AGGREGATE_KINDS.map((k) => `cp_${k}`),
  ...APPEND_ONLY_LOGS.map((l) => `cp_log_${l}`),
];

function aggregateTable(name: string): string {
  return `
    CREATE TABLE IF NOT EXISTS cp_${name} (
      id          text PRIMARY KEY,
      revision    bigint NOT NULL,
      updated_at  timestamptz NOT NULL,
      value       jsonb NOT NULL
    );`;
}

function appendOnlyTable(name: string): string {
  return `
    CREATE TABLE IF NOT EXISTS cp_log_${name} (
      log_key     text NOT NULL,
      record_id   text NOT NULL,
      position    bigint NOT NULL,
      recorded_at timestamptz NOT NULL,
      record      jsonb NOT NULL,
      PRIMARY KEY (log_key, record_id)
    );
    CREATE INDEX IF NOT EXISTS cp_log_${name}_order
      ON cp_log_${name} (log_key, position);`;
}

/**
 * The bootstrap, as a list of statements.
 *
 * A list rather than one blob because the driver executes one statement per
 * call, and because a failure then names the statement that failed rather than
 * "the bootstrap".
 */
export const BOOTSTRAP_DDL: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS cp_schema_version (
     singleton   boolean PRIMARY KEY DEFAULT true CHECK (singleton),
     version     integer NOT NULL,
     applied_at  timestamptz NOT NULL
   );`,
  ...AGGREGATE_KINDS.map(aggregateTable),
  ...APPEND_ONLY_LOGS.map(appendOnlyTable),
  /*
   * The due-work index. RULING 220 names indexed due-time queries as one of the
   * two things the filesystem provider cannot carry — a due-time query over a
   * directory is a full scan, and a SQL index is the boring correct tool.
   */
  `CREATE INDEX IF NOT EXISTS cp_route_tasks_state
     ON cp_route_tasks ((value->>'state'));`,
  `CREATE INDEX IF NOT EXISTS cp_leases_expiry
     ON cp_leases ((value->>'expiresAt'));`,
];

/** The statement that records which version the database is now at. */
export function recordVersionStatement(version: number, nowIso: string): string {
  return `INSERT INTO cp_schema_version (singleton, version, applied_at)
          VALUES (true, ${version}, '${nowIso}')
          ON CONFLICT (singleton) DO UPDATE
            SET version = EXCLUDED.version, applied_at = EXCLUDED.applied_at;`;
}

/** What the gate found, and every field is a fact it read rather than assumed. */
export interface SchemaVerdict {
  readonly configured: boolean;
  readonly reachable: boolean;
  readonly appliedVersion: number | null;
  readonly expectedVersion: number;
  readonly missingTables: readonly string[];
  readonly unexpectedTables: readonly string[];
  readonly problems: readonly string[];
}

/**
 * Judge a live reading against what this module declares.
 *
 * PURE, so the gate's rule is testable without a database — which matters more
 * than usual here, because the database is exactly what a session without the
 * credential cannot reach. A gate whose logic could only be exercised against
 * the thing it guards is a gate nobody can check.
 *
 * **An unreachable database is NOT a pass.** It is `reachable: false` with the
 * reason, and the caller decides whether that is fatal — a gate that treated
 * "could not connect" as "nothing wrong" would go green on every machine that
 * has no control plane at all.
 */
export function judgeSchema(input: {
  readonly configured: boolean;
  readonly reachable: boolean;
  readonly appliedVersion: number | null;
  readonly liveTables: readonly string[] | null;
  readonly unreachableReason?: string;
}): SchemaVerdict {
  const problems: string[] = [];

  if (!input.configured) {
    return {
      configured: false,
      reachable: false,
      appliedVersion: null,
      expectedVersion: BOOTSTRAP_VERSION,
      missingTables: [],
      unexpectedTables: [],
      problems: [],
    };
  }

  if (!input.reachable || input.liveTables === null) {
    return {
      configured: true,
      reachable: false,
      appliedVersion: null,
      expectedVersion: BOOTSTRAP_VERSION,
      missingTables: [],
      unexpectedTables: [],
      problems: [
        `the control-plane database is configured and could not be reached: ${
          input.unreachableReason ?? "no reason given"
        }. A gate that read this as "nothing wrong" would go green on a database that does not ` +
          "exist, which is the shape of an unenforced check.",
      ],
    };
  }

  const live = new Set(input.liveTables);
  const missingTables = DECLARED_TABLES.filter((t) => !live.has(t));
  /* Only `cp_`-prefixed tables are ours to judge. A dedicated database might
     legitimately hold something else one day, and claiming otherwise would make
     this gate an opinion about the whole database. */
  const unexpectedTables = [...live].filter(
    (t) => t.startsWith("cp_") && !DECLARED_TABLES.includes(t),
  );

  if (missingTables.length > 0) {
    problems.push(
      `${missingTables.length} declared table(s) are absent: ${missingTables.join(", ")}. The ` +
        "bootstrap is idempotent and runs on connect, so an absent table means no provider has " +
        "connected to this database yet, or something dropped it.",
    );
  }
  if (unexpectedTables.length > 0) {
    problems.push(
      `${unexpectedTables.length} control-plane table(s) exist that this module does not ` +
        `declare: ${unexpectedTables.join(", ")}. Schema is owned by the provider module; a ` +
        "table nobody declared is a hand edit, and a hand edit nobody can see is how a schema " +
        "stops being what its code says it is.",
    );
  }
  if (input.appliedVersion === null) {
    problems.push(
      "the database records no schema version. It cannot be placed against " +
        `BOOTSTRAP_VERSION ${BOOTSTRAP_VERSION}, and an unplaceable schema is not a current one.`,
    );
  } else if (input.appliedVersion !== BOOTSTRAP_VERSION) {
    problems.push(
      `the database is at schema version ${input.appliedVersion} and this module declares ` +
        `${BOOTSTRAP_VERSION}. Connect a provider to bring it up, or the code and the database ` +
        "are two different schemas.",
    );
  }

  return {
    configured: true,
    reachable: true,
    appliedVersion: input.appliedVersion,
    expectedVersion: BOOTSTRAP_VERSION,
    missingTables,
    unexpectedTables,
    problems,
  };
}
