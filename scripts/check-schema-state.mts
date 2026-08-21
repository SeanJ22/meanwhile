/**
 * `pnpm db:check` — does a database have the migrations this checkout commits?
 *
 * **Prompt D item 6.1, 2026-08-20. D73's class, at the other end.**
 * `app/api/schema/route.ts` answers the same question from inside the running
 * deploy, for the walk. This answers it from CI and from the scheduled jobs,
 * which have a database credential and run on a clock — so a migration
 * committed and not applied fails loudly within a day rather than waiting for
 * somebody to open a session.
 *
 * Run:
 *   corepack pnpm db:check                      # DATABASE_URL (the local branch)
 *   corepack pnpm db:check --target=production  # WTP_PRODUCTION_DATABASE_URL_READONLY
 *
 * READONLY on purpose: this asks a question and must never be able to answer it
 * by applying something. Applying is `pnpm db:apply`, which resolves a
 * different variable through `lib/db/write-handle.ts` and refuses this one.
 *
 * ## What it prints, and the empty-success shape it refuses
 *
 * Counts on both sides, always, and the missing tags BY NAME. A run that could
 * not read the migrations table exits 2 — COULD NOT READ, distinct from exit 1's
 * OUT OF SYNC — because an unreadable answer must never print as a passing one.
 * That distinction is the whole reason this file exists rather than a one-line
 * query in a workflow.
 */
import { join } from "node:path";

import { config as loadEnv } from "dotenv";
import { neon } from "@neondatabase/serverless";

import {
  compareSchemaState,
  describeSchemaState,
  readJournal,
} from "../lib/db/schema-state.ts";

loadEnv({ path: join(process.cwd(), ".env.local") });

const PRODUCTION = process.argv.includes("--target=production");
const VARIABLE = PRODUCTION ? "WTP_PRODUCTION_DATABASE_URL_READONLY" : "DATABASE_URL";
const connection = process.env[VARIABLE];

if (!connection) {
  console.error(`db:check: COULD NOT READ — ${VARIABLE} is not set.`);
  console.error("  An unset credential is not a passing schema check.");
  process.exit(2);
}

{
  const u = new URL(connection);
  console.log(`db:check  ${VARIABLE}  role=${u.username}  host=${u.hostname}`);
}

const journal = readJournal();

let appliedWhen: number[];
try {
  const sql = neon(connection);
  const rows = (await sql`
    SELECT created_at FROM drizzle.__drizzle_migrations
  `) as { created_at: string | number }[];
  appliedWhen = rows.map((r) => Number(r.created_at));
} catch (error) {
  console.error(
    `db:check: COULD NOT READ drizzle.__drizzle_migrations — ${(error as Error).message}`,
  );
  console.error("  This is not 'zero applied'. Nothing is concluded about the schema.");
  process.exit(2);
}

const state = compareSchemaState(journal, appliedWhen);

console.log(`  committed: ${state.codeCount} migration(s), head ${state.codeHead}`);
console.log(`  applied:   ${state.appliedCount} migration(s)`);

if (state.inSync) {
  console.log(`\nIN SYNC — ${describeSchemaState(state)}`);
  process.exit(0);
}

console.error(`\nOUT OF SYNC`);
for (const tag of state.missing) console.error(`  NOT APPLIED  ${tag}`);
for (const w of state.unknownApplied) console.error(`  UNKNOWN APPLIED  created_at=${w}`);
console.error(`\n${describeSchemaState(state)}`);
process.exit(1);
