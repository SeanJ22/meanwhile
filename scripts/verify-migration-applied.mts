/**
 * verify-migration-applied — read a target database's catalog back and diff it
 * against a committed migration's own SQL.
 *
 * Written 2026-08-23 (overnight depth hunt, item 2) for the claim that
 * `0016_known_cerebro` reached production. It is PARAMETERISED rather than
 * session-dated, per RULING 76: a tool that takes a migration tag is worth more
 * than the eleventh `verify-<date>.mts`.
 *
 * WHY IT EXISTS, and it is not the same question `db:check` answers.
 * `pnpm db:check` compares the JOURNAL — which tags the applier recorded — and
 * that is a claim about bookkeeping. This reads `information_schema` and
 * `pg_indexes` and compares the SHAPE the SQL declares against the shape the
 * server actually holds. Per RULING 113, a step whose product can be observed is
 * observed AT THE STEP: the applier printing `OK` for seven statements is the
 * applier's report of itself, not the server's.
 *
 * Reads only. It connects through `WTP_PRODUCTION_DATABASE_URL_READONLY` for
 * `--target=production` and issues nothing but catalog queries and counts.
 *
 *   pnpm verify:migration --tag=0016_known_cerebro [--target=production]
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { config as loadEnv } from "dotenv";
import { neon } from "@neondatabase/serverless";

loadEnv({ path: join(process.cwd(), ".env.local") });

const args = process.argv.slice(2);
const tag = args.find((a) => a.startsWith("--tag="))?.slice("--tag=".length);
const target = args.find((a) => a.startsWith("--target="))?.slice("--target=".length) ?? "local";

if (!tag) {
  console.error("verify:migration — required: --tag=<migration tag>, e.g. --tag=0016_known_cerebro");
  process.exit(2);
}

const envName =
  target === "production" ? "WTP_PRODUCTION_DATABASE_URL_READONLY" : "DATABASE_URL";
const url = process.env[envName];
if (!url) {
  console.error(`verify:migration — ${envName} is not set, so this could not be checked at all.`);
  console.error("That is a COULD-NOT-TELL, not a pass (RULING 24).");
  process.exit(2);
}

const sqlPath = join("lib", "db", "migrations", `${tag}.sql`);
let migration: string;
try {
  migration = readFileSync(sqlPath, "utf8");
} catch {
  console.error(`verify:migration — no committed SQL at ${sqlPath}`);
  process.exit(2);
}

const sql = neon(url);

/** Every table the committed SQL creates, with the columns it declares. */
const declaredTables = new Map<string, string[]>();
for (const block of migration.split("--> statement-breakpoint")) {
  const created = /CREATE TABLE (?:IF NOT EXISTS )?"([^"]+)" \(([\s\S]*?)\n\);/.exec(block);
  if (!created) continue;
  const columns = created[2]
    .split("\n")
    .map((line) => /^\s*"([^"]+)"/.exec(line)?.[1])
    .filter((c): c is string => Boolean(c));
  declaredTables.set(created[1], columns);
}

/** Every index the committed SQL creates by name. */
const declaredIndexes = [...migration.matchAll(/CREATE (?:UNIQUE )?INDEX "([^"]+)"/g)].map(
  (m) => m[1],
);

console.log(`verify:migration  tag=${tag}  target=${target}  via ${envName}`);
console.log(
  `  committed SQL declares ${declaredTables.size} table(s) and ${declaredIndexes.length} index(es)`,
);

// RULING 100: a partial that reconciles is still wrong. A migration whose SQL
// this parser read as ZERO tables would otherwise sail through with nothing to
// compare, and report success about a comparison it never made.
if (declaredTables.size === 0 && declaredIndexes.length === 0) {
  console.error(
    `  NOT ASSERTABLE — parsed no CREATE TABLE and no CREATE INDEX out of ${sqlPath}.` +
      " That is a fact about this reader, not about the migration.",
  );
  process.exit(1);
}

let mismatched = 0;

for (const [table, columns] of declaredTables) {
  const live = (await sql`
    select column_name from information_schema.columns
    where table_schema = 'public' and table_name = ${table}
    order by ordinal_position
  `) as { column_name: string }[];
  const liveColumns = live.map((r) => r.column_name);

  if (liveColumns.length === 0) {
    mismatched += 1;
    console.log(`  ABSENT  ${table} — the server holds no such table`);
    continue;
  }

  const missing = columns.filter((c) => !liveColumns.includes(c));
  const extra = liveColumns.filter((c) => !columns.includes(c));
  const agrees = missing.length === 0 && extra.length === 0;
  if (!agrees) mismatched += 1;

  console.log(
    `  ${agrees ? "MATCH " : "DIFFER"} ${table.padEnd(30)} sql=${columns.length} live=${liveColumns.length}` +
      (missing.length ? `  missing=${missing.join(",")}` : "") +
      (extra.length ? `  extra=${extra.join(",")}` : ""),
  );
}

for (const index of declaredIndexes) {
  const found = (await sql`
    select indexname from pg_indexes where schemaname = 'public' and indexname = ${index}
  `) as { indexname: string }[];
  if (found.length === 0) {
    mismatched += 1;
    console.log(`  ABSENT  index ${index}`);
  } else {
    console.log(`  MATCH   index ${index}`);
  }
}

// The smallest read that proves each table ANSWERS rather than merely existing.
console.log("  — smallest read, one count per table —");
for (const table of declaredTables.keys()) {
  // The name came out of a committed .sql file, never from a request — but a
  // table name cannot be a bind parameter, so it is checked against the
  // identifier shape before it is interpolated rather than trusted for its
  // provenance.
  if (!/^[a-z_][a-z0-9_]*$/.test(table)) {
    console.log(`    ${table.padEnd(30)} NOT ASSERTABLE — name is not a plain identifier`);
    continue;
  }
  const rows = (await sql.query(`select count(*)::int as n from "${table}"`)) as { n: number }[];
  console.log(`    ${table.padEnd(30)} rows=${rows[0].n}`);
}

if (mismatched > 0) {
  console.error(
    `\nFAIL — ${mismatched} object(s) in ${tag} do not match what ${target} holds.`,
  );
  process.exit(1);
}

console.log(
  `\nOK — ${target} matches ${sqlPath} on every declared column and index` +
    ` (${declaredTables.size} table(s), ${declaredIndexes.length} index(es)).`,
);
