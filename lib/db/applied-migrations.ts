/**
 * **ONE READER FOR "WHAT HAS THIS DATABASE ACTUALLY APPLIED?"**
 * (2026-08-28, consolidating during the schema-drift incident.)
 *
 * ## The detector was never missing, and this file is the proof of that
 *
 * `compareSchemaState` in `./schema-state.ts` is the ONE comparison in this
 * repository, and three surfaces already ask it the same question:
 *
 *   - `app/api/schema/route.ts` — answered from inside the running deploy,
 *     which is what `scripts/walk-all.mts`'s `[promptD]` check reads. Under
 *     RULING 125 a walk runs against a LOCAL production build, so that check
 *     asks `DATABASE_URL` — the DEVELOPMENT branch — and says so in its own
 *     detail line. It is not a production check and it does not claim to be.
 *   - `scripts/check-schema-state.mts` — the explicit `pnpm db:check`
 *     diagnostic. Its former GitHub clock in `intake-tripwire.yml` was retired
 *     by PDC V2.
 *   - `scripts/db-shipping-gate.mts` — the software merge/push gate, added the
 *     same day and also reused by automatic post-deploy integrity.
 *
 * **What was missing was never detection. It was PLACEMENT.** Nothing in the
 * merge or deploy path consulted any of them at the time: the walk was a
 * standing regression net a session ran by hand, and the retired tripwire ran
 * the morning after. The shipping and post-deploy gates now own those software
 * lifecycle placements.
 *
 * ## So this is the query, once
 *
 * Two of those three surfaces had their own `neon(...)` and their own `SELECT`,
 * each with its own idea of what a failure meant. A second reader is how the
 * two drift — one of them learns something about a connection error and the
 * other does not. (`app/api/schema/route.ts` still carries its own copy; it is
 * a Next route and out of this change's reach.)
 *
 * **THE RETURN TYPE IS THE WHOLE POINT.** "I read it and there were none" and
 * "I could not read it" are different answers and this refuses to collapse
 * them — RULING 24, and the exact distinction `db:check` exits 1 and 2 over.
 * A caller cannot accidentally treat an unreadable table as an empty one,
 * because there is no field to read until it has checked `ok`.
 */

import { neon } from "@neondatabase/serverless";
import { sql } from "drizzle-orm";

/** Shared read-only expression for an exact absent migration receipt. */
export function migrationReceiptAbsentExpression(expectedWhen: number) {
  return sql<boolean>`(
    select count(*) = 0
    from drizzle.__drizzle_migrations
    where created_at = ${expectedWhen}
  )`;
}

/** What a database says it has applied, or why that could not be established. */
export type AppliedMigrations =
  | {
      readonly ok: true;
      /**
       * The `created_at` values, which are the journal's own `when`. That is
       * the join key `scripts/apply-migrations.mts` writes and the one
       * `compareSchemaState` compares on, so nothing is hashed to line the two
       * sides up.
       */
      readonly appliedWhen: number[];
      /**
       * **WHAT THE DATABASE RECORDED EXECUTING, BY CONTENT.** (RULING 196.)
       *
       * `appliedWhen` answers a BOOKKEEPING question — did a migration with
       * this timestamp run? — and that is the question a rewritten migration
       * keeps answering correctly while its SQL no longer matches. `hash` is
       * the sha256 of the raw bytes `scripts/apply-migrations.mts` wrote when
       * it applied the file, which is the only record anywhere of what
       * production ACTUALLY ran.
       *
       * The column has always been there: the applier CREATEs the table with
       * `hash text NOT NULL` and has selected it against production since the
       * 2026-08-28 drift incident. It was written on every apply and read by
       * nothing, so `scripts/db-shipping-gate.mts` could compare git against
       * git and never git against the database.
       *
       * This is the SECOND, INDEPENDENT immutability check, and it catches the
       * one case the git guard structurally cannot: a rewrite that landed
       * BEFORE the git guard existed.
       */
      readonly appliedHashes: { readonly when: number; readonly hash: string }[];
    }
  | {
      readonly ok: false;
      /** The database's own words. Never a count, never an empty list. */
      readonly why: string;
    };

export type AppliedMigrationReceiptCensus = {
  /** Every physical journal row at the expected `created_at`, including rows with an unusable hash. */
  readonly rowCount: number;
  /** Usable hash-bearing rows at that same `created_at`. */
  readonly hashes: readonly string[];
};

/**
 * Count one migration receipt without letting a malformed hash disappear from
 * the physical-row cardinality proof. `readAppliedMigrationWhen` deliberately
 * omits unusable hashes from `appliedHashes`; `appliedWhen` still carries those
 * rows, so an exact receipt must consult both views.
 */
export function appliedMigrationReceiptCensus(
  read: AppliedMigrations,
  expectedWhen: number,
): AppliedMigrationReceiptCensus | null {
  if (!read.ok) return null;
  return {
    rowCount: read.appliedWhen.filter((when) => when === expectedWhen).length,
    hashes: read.appliedHashes
      .filter((row) => row.when === expectedWhen)
      .map((row) => row.hash),
  };
}

/** One physical journal row, carrying exactly the committed raw-byte hash. */
export function hasExactAppliedMigrationReceipt(
  read: AppliedMigrations,
  expectedWhen: number,
  expectedSha256: string,
): boolean {
  const census = appliedMigrationReceiptCensus(read, expectedWhen);
  return census !== null
    && census.rowCount === 1
    && census.hashes.length === 1
    && census.hashes[0] === expectedSha256;
}

/**
 * Read `drizzle.__drizzle_migrations` from one database.
 *
 * READ-ONLY BY CONSTRUCTION: one SELECT, no DDL, no `CREATE TABLE IF NOT
 * EXISTS`. `scripts/apply-migrations.mts` creates the table when it has to,
 * because applying is what may write; a reader that created its own subject
 * would report an empty journal about a database it had just changed.
 */
export async function readAppliedMigrationWhen(connection: string): Promise<AppliedMigrations> {
  try {
    const sql = neon(connection);
    const rows = (await sql`
      SELECT hash, created_at FROM drizzle.__drizzle_migrations
    `) as { hash: string; created_at: string | number }[];
    return {
      ok: true,
      appliedWhen: rows.map((r) => Number(r.created_at)),
      // A row whose hash is not a usable string is DROPPED rather than carried
      // as an empty one: `checksumViolations` compares committed sha256 against
      // recorded sha256, and a blank on either side would read as a mismatch
      // about a file nobody has touched.
      appliedHashes: rows
        .filter((r) => typeof r.hash === "string" && r.hash.length > 0)
        .map((r) => ({ when: Number(r.created_at), hash: r.hash })),
    };
  } catch (error) {
    return { ok: false, why: (error as Error).message };
  }
}

/** The role and host a connection string names, for a log line that says what was asked. */
export function describeConnection(connection: string): string {
  const u = new URL(connection);
  return `role=${u.username}  host=${u.hostname}`;
}
