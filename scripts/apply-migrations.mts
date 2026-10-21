/**
 * `pnpm db:apply` — apply the committed Drizzle migrations over the HTTP
 * driver (`drizzle-kit migrate`'s websocket driver does not connect through the
 * Neon pooler here).
 *
 * Each pending migration's statements and its journal row are applied in one
 * Postgres transaction: `hash` is sha256 of the file's raw bytes and
 * `created_at` is the journal's own `when`, so a later `drizzle-kit migrate`
 * sees the work as done. A failed statement rolls the whole migration back.
 *
 * `--target=production` resolves `WTP_PRODUCTION_DATABASE_URL_WRITE` through
 * `lib/db/write-handle.ts`, which refuses read-only credentials. Anything else
 * targets `DATABASE_URL` and refuses unless `WTP_DB_ROLE=local`, the same
 * reading `lib/db/write-guard.ts` applies at runtime.
 *
 * It prints the role and host, the pending list, each statement's result and
 * the journal count after. `--dry` prints the plan and touches nothing. A
 * migration that applies zero statements is reported as zero, never success.
 *
 * Run: `pnpm db:apply [--target=production] [--dry]`
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { config as loadEnv } from "dotenv";
import { neon } from "@neondatabase/serverless";

import { resolveProductionWriteHandle, WriteHandleRefused } from "../lib/db/write-handle.ts";
import { declaredPhase, phaseFromSql } from "../lib/db/migration-phases.ts";

export const RUNTIME_CONTRACT_RETRY_MS = 15 * 60_000;
export const RUNTIME_CONTRACT_ATTEMPT_MS = 5 * 60_000;
// Contracts can take exclusive reader-table locks (0045 does). The complete
// journalled DO statement must release them inside the reader query deadline.
export const RUNTIME_CONTRACT_SQL_SETTINGS = ["SET LOCAL lock_timeout = '250ms'", "SET LOCAL statement_timeout = '1000ms'"] as const;

/** Migrations have their own clock. Asking for them never waits for DDL and
 * repeated cycle boundaries cannot hammer a failed migration or overlap it. */
export function runtimeContractRetry(input: {
  readonly run: (sha: string, cwd: string) => Promise<boolean>;
  readonly onError: (error: unknown, sha: string) => void | Promise<void>;
  readonly cancelActive?: () => Promise<void>;
  readonly retryMs?: number;
  readonly schedule?: (run: () => void, delayMs: number) => () => void;
}) {
  const completed = new Set<string>();
  let target: { sha: string; cwd: string } | null = null;
  let active: Promise<void> | null = null;
  let cancel: (() => void) | null = null;
  let stopped = false;
  const schedule = input.schedule ?? ((run, delay) => {
    const timer = setTimeout(run, delay); timer.unref();
    return () => clearTimeout(timer);
  });
  const start = (): void => {
    if (stopped || active || !target || completed.has(target.sha)) return;
    const current = target;
    active = Promise.resolve().then(() => stopped ? false : input.run(current.sha, current.cwd)).then(ok => {
      if (ok) completed.add(current.sha);
    }).catch(error => input.onError(error, current.sha)).catch(error => {
      console.error(`Contract migration failure could not be recorded: ${error instanceof Error ? error.name : "error"}`);
    }).finally(() => {
      active = null;
      if (stopped || !target || completed.has(target.sha)) return;
      if (target.sha !== current.sha) start();
      else cancel = schedule(() => { cancel = null; start(); }, input.retryMs ?? RUNTIME_CONTRACT_RETRY_MS);
    });
  };
  return {
    request(sha: string | null, cwd: string): void {
      if (stopped || sha === null || completed.has(sha)) return;
      if (target?.sha === sha) return;
      target = { sha, cwd };
      cancel?.(); cancel = null;
      start();
    },
    async stop(): Promise<void> { stopped = true; cancel?.(); cancel = null; await input.cancelActive?.(); await active; },
  };
}

export async function applyMigrations(args: string[], options: { beforeContract?: () => Promise<void> } = {}): Promise<void> {
  const PRODUCTION_BUILD = args.includes("--production-build");
  if (PRODUCTION_BUILD && (process.env.CONTEXT !== "production" || process.env.BRANCH !== "main" || process.env.NETLIFY !== "true")) {
    console.log("db:apply: production expand skipped outside the Netlify production main build; writes=0");
    process.exit(0);
  }

  loadEnv({ path: join(process.cwd(), ".env.local"), quiet: true });

  const PRODUCTION = args.includes("--target=production");
  const DRY = args.includes("--dry");
  const phaseArg = args.find(a => a.startsWith("--phase="));
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
  let contractChecked = false;
  async function beforeContract(): Promise<void> {
    if (!PRODUCTION || PHASE !== "contract" || DRY || contractChecked) return;
    if (options.beforeContract) await options.beforeContract();
    else {
      const sha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
      const expected = args.find(arg => arg.startsWith("--runtime-commit="))?.slice(17);
      if (process.env.WTP_RUNTIME_MODE !== "production" || !args.includes("--production-runtime") || expected !== sha) {
        throw new Error("db:apply: REFUSED — pending contracts require the production runtime commit to be loaded");
      }
      const { fetchServedCommit } = await import("./post-deploy-observer.mts");
      const { PUBLIC_SITE_ORIGIN } = await import("../lib/ops/origins.ts");
      if ((await fetchServedCommit(PUBLIC_SITE_ORIGIN)).sha !== sha) {
        throw new Error("db:apply: REFUSED — pending contracts require the exact runtime commit to be serving");
      }
    }
    contractChecked = true;
  }

  let connection: string;
  let which: string;
  // A build with no DDL to apply can inspect the journal without a writer.
  // This connection never reaches schema setup or migration transactions.
  const INSPECT_ONLY = PRODUCTION_BUILD && !process.env.WTP_PRODUCTION_DATABASE_URL_WRITE;

  if (INSPECT_ONLY) {
    which = "DATABASE_URL";
    connection = process.env.DATABASE_URL ?? "";
    let host = "";
    try { host = new URL(connection).hostname; } catch { /* Refuse without printing credentials. */ }
    if (host.replace(/-pooler(?=\.)/, "").split(".")[0] !== "ep-dry-river-axwtolzc" || !host.endsWith(".neon.tech")) {
      throw new Error("db:apply: REFUSED — journal inspection requires the approved ep-dry-river endpoint");
    }
  } else if (PRODUCTION) {
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
  const committedHashes = new Map<number, string>();

  interface JournalEntry {
    idx: number;
    when: number;
    tag: string;
  }
  const journal = JSON.parse(
    readFileSync(join(process.cwd(), "lib/db/migrations/meta/_journal.json"), "utf8"),
  ) as { entries: JournalEntry[] };

  const uptoArg = args.find((a) => a.startsWith("--upto="));
  const UPTO = uptoArg ? uptoArg.slice("--upto=".length) : null;
  if (UPTO !== null && !journal.entries.some((entry) => entry.tag === UPTO)) {
    console.error("db:apply: REFUSED — --upto names no committed migration");
    process.exit(1);
  }

  // Validate the exact committed files before even creating a journal schema.
  for (const entry of journal.entries) {
    const relative = `lib/db/migrations/${entry.tag}.sql`;
    const raw = readFileSync(join(process.cwd(), relative));
    committedHashes.set(entry.when, createHash("sha256").update(raw).digest("hex"));
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

  // A dry first run stays SELECT-only; concurrent first applies share the DDL lock.
  const journalState = (INSPECT_ONLY
    ? (await sql.transaction(tx => [tx`SELECT to_regclass('drizzle.__drizzle_migrations') IS NOT NULL AS exists`], { readOnly: true }))[0]
    : await sql`SELECT to_regclass('drizzle.__drizzle_migrations') IS NOT NULL AS exists`) as { exists: boolean }[];
  let applied: AppliedMigration[] = [];
  if (journalState[0]?.exists) {
    applied = (INSPECT_ONLY
      ? (await sql.transaction(tx => [tx`SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at`], { readOnly: true }))[0]
      : await sql`SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at`) as AppliedMigration[];
  } else if (!DRY && !INSPECT_ONLY) {
    // An absent journal means contracts are pending; verify before any bootstrap DDL.
    await beforeContract();
    const setup = await sql.transaction((transaction) => [
      ...(PRODUCTION && PHASE === "contract" ? RUNTIME_CONTRACT_SQL_SETTINGS.map(statement => transaction.query(statement)) : []),
      transaction`SELECT pg_advisory_xact_lock(1835360622, 1)`,
      transaction`CREATE SCHEMA IF NOT EXISTS drizzle`,
      transaction`CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
        id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint
      )`,
      transaction`SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at`,
    ]);
    applied = setup.at(-1) as AppliedMigration[];
  }
  for (const row of applied) {
    const expected = committedHashes.get(Number(row.created_at));
    if (expected !== undefined && expected !== row.hash) {
      const tag = journal.entries.find(entry => entry.when === Number(row.created_at))!.tag;
      throw new Error(`db:apply: REFUSED — ${tag} does not match the applied journal hash`);
    }
  }
  const appliedWhen = new Set(applied.map((r) => Number(r.created_at)));

  /*
   * `--upto=<tag>` — stop after that migration, inclusive, so the two halves of
   * a NOT NULL-without-default change can land on either side of a deploy
   * without hand-editing the journal. An unknown tag REFUSES rather than
   * applying everything.
   */
  const uptoIndex = UPTO ? journal.entries.findIndex((e) => e.tag === UPTO) : -1;
  const boundedPending = (UPTO ? journal.entries.slice(0, uptoIndex + 1) : journal.entries)
    .filter(entry => !appliedWhen.has(entry.when));
  const pending = PHASE ? boundedPending.filter(e => declaredPhase(e.tag)?.phase === PHASE) : boundedPending;
  if (PHASE) console.log(`phase: ${PHASE}; deferred other phase: ${boundedPending.length - pending.length}`);
  if (UPTO) {
    const held = journal.entries.slice(uptoIndex + 1).filter(entry => !appliedWhen.has(entry.when));
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
  // Deliberately NOT process.exit() below: the Neon HTTP driver still holds a
  // libuv handle, and exiting through it aborts with a failure exit code
  // (3221226505 on Windows). Letting the event loop drain gives the true code.
  const nothingPending = pending.length === 0;
  if (INSPECT_ONLY && !nothingPending) {
    throw new Error("db:apply: REFUSED — pending expand migrations require WTP_PRODUCTION_DATABASE_URL_WRITE; inspection writes=0");
  }
  if (nothingPending) {
    console.log(`\nNo pending ${PHASE ?? "selected"} migrations within this plan.`);
    if (INSPECT_ONLY) console.log("Production journal inspection complete; writes=0; no writer required.");
  } else if (DRY) {
    console.log("\nDRY RUN — nothing applied.");
  }

  if (!nothingPending && !DRY) {
    await beforeContract();
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
          ...(PRODUCTION && PHASE === "contract" ? RUNTIME_CONTRACT_SQL_SETTINGS.map(statement => transaction.query(statement)) : []),
          transaction`SELECT pg_advisory_xact_lock(1835360622, 1)`,
          transaction.query(apply),
          transaction`SELECT EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations
            WHERE created_at = ${entry.when} AND hash = ${hash}
            AND xmin = pg_current_xact_id()::xid) AS applied`,
        ]);
        appliedHere = (results.at(-1) as { applied: boolean }[])[0]?.applied === true;
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

}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  if (args.includes("--target=production")) {
    const { runDbApply } = await import("./db-apply.mts");
    process.exitCode = await runDbApply(args);
  } else await applyMigrations(args);
}
