/**
 * `pnpm db:apply` — apply the committed Drizzle migrations to a database
 * this repo can actually reach (g11, 2026-08-17).
 *
 * ## Why this exists when `pnpm db:migrate` already does
 *
 * `drizzle-kit migrate` exits 1 with no message on this machine — its
 * websocket driver never connects through the Neon pooler here. g9 and g10
 * both hit it and both applied their migration by executing the file's own
 * SQL and inserting the journal row by hand, matching the sha256 hash Drizzle
 * records. That worked twice and is exactly the kind of hand pass that goes
 * wrong the third time: the hash is easy to compute differently, and a
 * migration applied without its journal row re-runs forever.
 *
 * So the hand pass becomes a command. Small migrations use the HTTP driver;
 * the explicitly named large publication-index backfill uses a persistent
 * direct Neon connection. Each migration's statements plus its journal row
 * commit in one Postgres transaction. `hash` is sha256 of the file's raw bytes;
 * `created_at` is the journal's own `when`. If the connection drops during a
 * direct COMMIT, a second connection waits for the first transaction's
 * advisory lock and checks the exact journal hash. Unknown outcomes stop;
 * no mutation is blindly retried.
 * A later `drizzle-kit migrate`, if its driver is ever fixed, reads this table
 * and sees the work as done.
 *
 * ## Which database, and the refusals
 *
 * `--target=production` resolves `WTP_PRODUCTION_DATABASE_URL_WRITE` through
 * `lib/db/write-handle.ts`, which refuses the READONLY variable by name and
 * refuses any string whose user is read-only. Anything else targets
 * `DATABASE_URL`, and then refuses to run unless `WTP_DB_ROLE=local` — the
 * same reading `lib/db/write-guard.ts` applies at runtime, not a second
 * opinion about it.
 *
 * ## What it prints
 *
 * The role and host before anything else; the pending list before it applies
 * anything; each statement's result; and the journal count after. `--dry`
 * prints the plan and touches nothing. A migration that applies zero
 * statements is reported as zero, never as success — the empty-success shape.
 *
 * Run: `pnpm db:apply [--target=production] [--dry]`
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { config as loadEnv } from "dotenv";
import { neon, neonConfig, Pool } from "@neondatabase/serverless";

import { resolveProductionWriteHandle, WriteHandleRefused } from "../lib/db/write-handle.ts";
import { applyDirectMigration, directNeonConnectionUrl } from "../lib/db/direct-migration.ts";

loadEnv({ path: join(process.cwd(), ".env.local") });

const PRODUCTION = process.argv.includes("--target=production");
const DRY = process.argv.includes("--dry");

let connection: string;
let which: string;

if (PRODUCTION) {
  try {
    const handle = resolveProductionWriteHandle();
    connection = handle.connection;
    which = handle.variable;
  } catch (error) {
    if (error instanceof WriteHandleRefused) {
      console.error(`db:apply: REFUSED — ${error.message}`);
      process.exit(1);
    }
    throw error;
  }
} else {
  const local = process.env.DATABASE_URL;
  which = "DATABASE_URL";
  if (!local) {
    console.error("db:apply: DATABASE_URL is not set — refusing to guess a database.");
    process.exit(1);
  }
  if (process.env.WTP_DB_ROLE !== "local") {
    console.error(
      `db:apply: WTP_DB_ROLE is ${JSON.stringify(process.env.WTP_DB_ROLE ?? null)}, not "local". ` +
        `An undeclared role is production (lib/db/write-guard.ts). Use --target=production and ` +
        `the sanctioned write variable to mean it.`,
    );
    process.exit(1);
  }
  connection = local;
}

{
  const u = new URL(connection);
  console.log(
    `target: ${which}  role=${u.username}  host=${u.hostname}  db=${u.pathname.slice(1)}` +
      `${DRY ? "  (DRY RUN — nothing will be applied)" : ""}\n`,
  );
}

const sql = neon(connection);
const DIRECT_MIGRATIONS = new Set(["0031_publication_search_backfill"]);

interface JournalEntry {
  idx: number;
  when: number;
  tag: string;
}
const journal = JSON.parse(
  readFileSync(join(process.cwd(), "lib/db/migrations/meta/_journal.json"), "utf8"),
) as { entries: JournalEntry[] };

type AppliedMigration = { hash: string; created_at: string | number };

let applied: AppliedMigration[];
if (DRY) {
  /*
   * Planning is a read path. In particular, the first dry run against an
   * empty database must not create Drizzle's schema merely so it can report
   * that every committed migration is pending. `to_regclass` lets that first
   * observation stay a SELECT; an absent journal is the same planning state
   * as an existing journal with zero rows.
   */
  const journalState = (await sql`
    SELECT to_regclass('drizzle.__drizzle_migrations') IS NOT NULL AS exists
  `) as { exists: boolean }[];
  applied = journalState[0]?.exists
    ? ((await sql`
        SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at
      `) as AppliedMigration[])
    : [];
} else {
  await sql`CREATE SCHEMA IF NOT EXISTS drizzle`;
  await sql`
    CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint
    )
  `;

  applied = (await sql`
    SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at
  `) as AppliedMigration[];
}
const appliedWhen = new Set(applied.map((r) => Number(r.created_at)));

/*
 * `--upto=<tag>` — stop after that migration, inclusive (Prompt C, 2026-08-20).
 *
 * A NOT NULL column with no default may only lose its default once the code
 * that fills it is live, so its two halves land on either side of a deploy.
 * Without this flag the only way to apply the first half alone is to take the
 * second out of the journal and put it back afterwards, which is a hand pass
 * over the exact file that must not be hand-edited. See migrations 0013 and
 * 0014, which are that pair.
 *
 * An unknown tag REFUSES rather than applying everything — a typo that
 * silently means "all of it" is how this flag would cause the failure it
 * exists to prevent.
 */
const uptoArg = process.argv.find((a) => a.startsWith("--upto="));
const UPTO = uptoArg ? uptoArg.slice("--upto=".length) : null;

const allPending = journal.entries.filter((e) => !appliedWhen.has(e.when));
if (UPTO && !journal.entries.some((e) => e.tag === UPTO)) {
  console.error(
    `REFUSED: --upto=${UPTO} names no migration in the journal. Tags are: ` +
      journal.entries.map((e) => e.tag).join(", "),
  );
  process.exit(1);
}
const uptoIndex = UPTO ? allPending.findIndex((e) => e.tag === UPTO) : -1;
if (UPTO && uptoIndex < 0) {
  console.log(`--upto=${UPTO} is already applied here; nothing before it is pending.`);
}
const pending = UPTO
  ? uptoIndex >= 0
    ? allPending.slice(0, uptoIndex + 1)
    : []
  : allPending;
if (UPTO) {
  const held = allPending.slice(uptoIndex + 1);
  if (held.length > 0) {
    console.log(
      `  HELD BACK by --upto=${UPTO}: ${held.map((e) => e.tag).join(", ")}`,
    );
  }
}

console.log(
  `journal: ${journal.entries.length} migration(s) committed · ` +
    `${applied.length} already applied here · ${pending.length} pending`,
);
for (const e of pending) console.log(`  pending: ${e.tag}`);
// Deliberately NOT process.exit() on the paths below: the Neon HTTP driver
// still holds a libuv handle at this point, and exiting through it aborts with
// an assertion and a Windows exit code of 3221226505 — a run that did its work
// correctly reporting failure to every caller that checks one. Letting the
// event loop drain on its own gives the true code.
const nothingPending = pending.length === 0;
if (nothingPending) {
  console.log("\nNothing to apply. The database is current with the journal.");
} else if (DRY) {
  console.log("\nDRY RUN — nothing applied.");
}

if (!nothingPending && !DRY) {
  let statementsRun = 0;
  for (const entry of pending) {
    const path = join(process.cwd(), "lib/db/migrations", `${entry.tag}.sql`);
    const raw = readFileSync(path);
    const hash = createHash("sha256").update(raw).digest("hex");
    const statements = raw
      .toString("utf8")
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter(Boolean);

    console.log(`\n── ${entry.tag} — ${statements.length} statement(s) ──`);
    if (statements.length === 0) {
      console.error(
        `  ${entry.tag} contains no statements. A migration that applies nothing is not a ` +
          `migration that succeeded — refusing to journal it.`,
      );
      process.exit(1);
    }

    if (DIRECT_MIGRATIONS.has(entry.tag)) {
      // A large backfill can outlive Neon's HTTP request window. Keep the
      // sanctioned credential and exact journal contract, but use a persistent
      // direct connection whose uncertain COMMIT is independently reconciled.
      neonConfig.webSocketConstructor = WebSocket;
      const pool = new Pool({ connectionString: directNeonConnectionUrl(connection), max: 1 });
      try {
        const outcome = await applyDirectMigration({
          pool: {
            connect: async () => {
              const client = await pool.connect();
              return {
                query: async (statement: string, values?: readonly unknown[]) => {
                  const result = await client.query(statement, values as unknown[] | undefined);
                  return { rows: result.rows as Record<string, unknown>[] };
                },
                release: (destroy?: boolean) => client.release(destroy),
              };
            },
          },
          tag: entry.tag, when: entry.when, hash, statements,
        });
        console.log(`  direct transaction ${outcome === "COMMITTED" ? "committed" : "commit recovered from exact journal hash"}`);
      } catch (error) {
        console.error(`  FAIL  ${error instanceof Error ? error.message : String(error)}`);
        console.error(`  No automatic retry. Confirm this migration's exact journal hash before any new apply.`);
        process.exitCode = 1;
        break;
      } finally {
        await pool.end();
      }
      if (process.exitCode === 1) break;
    } else {
      try {
        await sql.transaction((transaction) => [
          ...statements.map((statement) => transaction.query(statement)),
          transaction`
            INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
            VALUES (${hash}, ${entry.when})
          `,
        ]);
      } catch (error) {
        let committed = false;
        try {
          const receipt = await sql`SELECT hash FROM drizzle.__drizzle_migrations WHERE created_at=${entry.when}`;
          committed = receipt.length === 1 && receipt[0]?.hash === hash;
        } catch { /* A failed read leaves the outcome unknown. */ }
        if (committed) {
          console.log(`  HTTP response failed, but the exact journal hash proves commit`);
        } else {
          console.error(`  FAIL  transaction outcome unconfirmed: ${error instanceof Error ? error.message : String(error)}`);
          console.error(`  No automatic retry. Confirm this migration's exact journal hash after the prior transaction resolves.`);
          process.exitCode = 1;
          break;
        }
      }
    }
    statementsRun += statements.length;
    for (const statement of statements) {
      console.log(`  OK    ${statement.replace(/\s+/g, " ").slice(0, 110)}`);
    }
    console.log(`  journalled  hash=${hash.slice(0, 16)}…  created_at=${entry.when}`);
  }

  if (process.exitCode !== 1) {
    const after = (await sql`SELECT COUNT(*) AS n FROM drizzle.__drizzle_migrations`) as {
      n: string | number;
    }[];
    console.log(
      `\nApplied ${pending.length} migration(s), ${statementsRun} statement(s). ` +
        `Journal now holds ${Number(after[0].n)} of ${journal.entries.length} committed.`,
    );
  }
}
