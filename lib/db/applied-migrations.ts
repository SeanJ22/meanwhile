/**
 * The one reader of what a database has applied. "Read it and found none" and
 * "could not read it" are different answers; callers cannot read a list until
 * they have checked `ok`.
 */

import { neon } from "@neondatabase/serverless";

/** What a database says it has applied, or why that could not be established. */
export type AppliedMigrations =
  | {
      readonly ok: true;
      /** The `created_at` values, which are the journal's own `when`. */
      readonly appliedWhen: number[];
      /**
       * sha256 of the raw bytes the applier executed. Catches a rewritten
       * migration that still reports applied by its `when` timestamp.
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
 * Counts one migration receipt. appliedHashes omits unusable hashes while
 * appliedWhen keeps those rows, so an exact receipt must consult both.
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

/** Read-only: one SELECT, never creates the table. */
export async function readAppliedMigrationWhen(connection: string): Promise<AppliedMigrations> {
  try {
    const sql = neon(connection);
    const rows = (await sql`
      SELECT hash, created_at FROM drizzle.__drizzle_migrations
    `) as { hash: string; created_at: string | number }[];
    return {
      ok: true,
      appliedWhen: rows.map((r) => Number(r.created_at)),
      // Unusable hashes are dropped, not carried as blanks that would read as mismatches.
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
