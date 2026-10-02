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
 * So the hand pass becomes a command. It uses the HTTP driver the rest of the
 * repo uses and applies each pending migration's statements plus its journal
 * row in one Postgres transaction. `hash` is sha256 of the file's raw bytes;
 * `created_at` is the journal's own `when`. A failed statement rolls the whole
 * migration back, so production cannot be left half-migrated and unjournalled.
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
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { config as loadEnv } from "dotenv";
import { neon } from "@neondatabase/serverless";

import { resolveProductionWriteHandle, WriteHandleRefused } from "../lib/db/write-handle.ts";
import { declaredPhase, phaseFromSql } from "../lib/db/migration-phases.ts";

const PRODUCTION_BUILD = process.argv.includes("--production-build");
if (PRODUCTION_BUILD && (process.env.CONTEXT !== "production" || process.env.BRANCH !== "main" || process.env.NETLIFY !== "true")) {
  console.log("db:apply: production expand skipped outside the Netlify production main build; writes=0");
  process.exit(0);
}

loadEnv({ path: join(process.cwd(), ".env.local"), quiet: true });

const PRODUCTION = process.argv.includes("--target=production");
const DRY = process.argv.includes("--dry");
const phaseArg = process.argv.find(a => a.startsWith("--phase="));
const PHASE = phaseArg?.slice("--phase=".length);
if (PHASE !== undefined && PHASE !== "expand" && PHASE !== "contract") {
  console.error("db:apply: REFUSED — phase must be expand or contract");
  process.exit(1);
}
if (PRODUCTION_BUILD && (!PRODUCTION || PHASE !== "expand")) {
  console.error("db:apply: REFUSED — the production build applies only production expand migrations");
  process.exit(1);
}
if (PRODUCTION && PHASE === undefined) {
  console.error("db:apply: REFUSED — production requires an explicit expand or contract phase");
  process.exit(1);
}

let connection: string;
let which: string;

if (PRODUCTION) {
  try {
    const handle = resolveProductionWriteHandle();
    if (handle.host.replace(/-pooler(?=\.)/, "").split(".")[0] !== "ep-dry-river-axwtolzc" || !handle.host.endsWith(".neon.tech")) {
      throw new WriteHandleRefused("production migrations require the approved ep-dry-river endpoint");
    }
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

interface JournalEntry {
  idx: number;
  when: number;
  tag: string;
}
const journal = JSON.parse(
  readFileSync(join(process.cwd(), "lib/db/migrations/meta/_journal.json"), "utf8"),
) as { entries: JournalEntry[] };

const uptoArg = process.argv.find((a) => a.startsWith("--upto="));
const UPTO = uptoArg ? uptoArg.slice("--upto=".length) : null;
if (UPTO !== null && !journal.entries.some((entry) => entry.tag === UPTO)) {
  console.error("db:apply: REFUSED — --upto names no committed migration");
  process.exit(1);
}

// Validate the exact committed files before even creating a journal schema.
for (const entry of journal.entries) {
  const relative = `lib/db/migrations/${entry.tag}.sql`;
  const raw = readFileSync(join(process.cwd(), relative));
  const declaration = declaredPhase(entry.tag);
  if (!declaration || declaration.phase !== phaseFromSql(raw.toString("utf8")).phase) {
    throw new Error(`db:apply: REFUSED — ${entry.tag} has no matching migration phase`);
  }
  if (PRODUCTION) {
    const committed = execFileSync("git", ["show", `HEAD:${relative}`], { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] });
    if (!committed.equals(raw)) throw new Error(`db:apply: REFUSED — ${entry.tag} differs from its committed SQL`);
  }
}
if (PRODUCTION) {
  const relative = "lib/db/migrations/meta/_journal.json";
  const committed = execFileSync("git", ["show", `HEAD:${relative}`], { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] });
  if (!committed.equals(readFileSync(join(process.cwd(), relative)))) throw new Error("db:apply: REFUSED — migration journal differs from its committed version");
}

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
const allPending = journal.entries.filter((e) => !appliedWhen.has(e.when));
const uptoIndex = UPTO ? allPending.findIndex((e) => e.tag === UPTO) : -1;
if (UPTO && uptoIndex < 0) {
  console.log(`--upto=${UPTO} is already applied here; nothing before it is pending.`);
}
const boundedPending = UPTO
  ? uptoIndex >= 0
    ? allPending.slice(0, uptoIndex + 1)
    : []
  : allPending;
const pending = PHASE ? boundedPending.filter(e => declaredPhase(e.tag)?.phase === PHASE) : boundedPending;
if (PHASE) console.log(`phase: ${PHASE}; deferred other phase: ${boundedPending.length - pending.length}`);
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
  let migrationsApplied = 0;
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

    let appliedHere = false;
    try {
      // The existing journal is re-read under the same transaction lock as the DDL.
      // Two concurrent build/runner callers cannot both apply an unseen migration.
      const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
      const delimiter = `$wtp_${hash}$`;
      const apply = `DO ${delimiter} BEGIN
        IF EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations WHERE created_at = ${entry.when} AND hash <> ${quote(hash)}) THEN
          RAISE EXCEPTION 'MIGRATION_JOURNAL_HASH_MISMATCH';
        END IF;
        IF NOT EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations WHERE created_at = ${entry.when}) THEN
          ${statements.map(statement => `EXECUTE ${quote(statement)};`).join("\n")}
          INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES (${quote(hash)}, ${entry.when});
        END IF;
      END ${delimiter};`;
      const results = await sql.transaction((transaction) => [
        transaction`SELECT pg_advisory_xact_lock(1835360622, 1)`,
        transaction.query(apply),
        transaction`SELECT EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations
          WHERE created_at = ${entry.when} AND hash = ${hash}
          AND xmin = pg_current_xact_id()::xid) AS applied`,
      ]);
      appliedHere = (results[2] as { applied: boolean }[])[0]?.applied === true;
    } catch (error) {
      console.error(`  FAIL  transaction rolled back before the journal row was written`);
      console.error(`        ${(error as Error).message}`);
      console.error(
        `\n${entry.tag} applied no durable statements in this run. Nothing is being guessed at ` +
          `or retried — read the error, fix the cause, and run again.`,
      );
      process.exit(1);
    }
    if (!appliedHere) {
      console.log(`  REUSED ${entry.tag}: a concurrent caller already applied this exact journal entry`);
      continue;
    }
    migrationsApplied++;
    statementsRun += statements.length;
    for (const statement of statements) {
      console.log(`  OK    ${statement.replace(/\s+/g, " ").slice(0, 110)}`);
    }
    console.log(`  journalled  hash=${hash.slice(0, 16)}…  created_at=${entry.when}`);
  }

  const after = (await sql`SELECT COUNT(*) AS n FROM drizzle.__drizzle_migrations`) as {
    n: string | number;
  }[];
  console.log(
    `\nApplied ${migrationsApplied} migration(s), ${statementsRun} statement(s). ` +
      `Journal now holds ${Number(after[0].n)} of ${journal.entries.length} committed.`,
  );
}
