/**
 * `pnpm db:check` — does a database have the migrations this checkout commits?
 * Runs from CI and the scheduled jobs, so a migration committed and not applied
 * fails loudly within a day (`app/api/schema/route.ts` answers the same
 * question from inside a deploy).
 *
 * Run:
 *   corepack pnpm db:check                      # DATABASE_URL (the local branch)
 *   corepack pnpm db:check --target=production  # WTP_PRODUCTION_DATABASE_URL_READONLY
 *
 * READONLY on purpose: this must never be able to answer by applying
 * something (that is `pnpm db:apply`).
 *
 * Counts on both sides, always, and the missing tags BY NAME. A run that could
 * not read the migrations table exits 2 (COULD NOT READ), distinct from exit
 * 1 (OUT OF SYNC).
 */
import { join } from "node:path";

import { config as loadEnv } from "dotenv";

import { readAppliedMigrationWhen } from "../lib/db/applied-migrations.ts";
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

/* The query lives in `lib/db/applied-migrations.ts`, shared with
 * `scripts/db-shipping-gate.mts`. */
const read = await readAppliedMigrationWhen(connection);
if (!read.ok) {
  console.error(`db:check: COULD NOT READ drizzle.__drizzle_migrations — ${read.why}`);
  console.error("  This is not 'zero applied'. Nothing is concluded about the schema.");
  process.exit(2);
}

const state = compareSchemaState(journal, read.appliedWhen);

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
