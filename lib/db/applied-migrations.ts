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
 *   - `scripts/check-schema-state.mts` — `pnpm db:check`, on a clock, in
 *     `intake-tripwire.yml`. This is the one that reads production.
 *   - `scripts/db-shipping-gate.mts` — the merge gate, added the same day.
 *
 * **What was missing was never detection. It was PLACEMENT.** Nothing in the
 * merge or deploy path consulted any of them: the walk is a standing regression
 * net a session runs by hand, and the tripwire runs the morning after.
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

import { createGuardedNeon } from "./guarded-neon.ts";

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
    const sql = createGuardedNeon(connection);
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
