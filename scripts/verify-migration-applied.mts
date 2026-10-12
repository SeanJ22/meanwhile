/**
 * verify-migration-applied — read a target database's catalog back and diff it
 * against a committed migration's own SQL.
 *
 * `pnpm db:check` compares the journal (bookkeeping); this reads
 * `information_schema` and `pg_indexes` and compares the shape the SQL declares
 * against the shape the server actually holds.
 *
 * Reads only. It connects through `WTP_PRODUCTION_DATABASE_URL_READONLY` for
 * `--target=production` and issues nothing but catalog queries and counts.
 *
 *   pnpm verify:migration --tag=<migration tag> [--target=production]
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { config as loadEnv } from "dotenv";
import { neon } from "@neondatabase/serverless";

import {
  declaredMigrationCatalog,
  declaredMigrationCatalogCount,
} from "../lib/db/migration-catalog.ts";
import {
  appliedMigrationReceiptCensus,
  hasExactAppliedMigrationReceipt,
  readAppliedMigrationWhen,
} from "../lib/db/applied-migrations.ts";
import { floored, floorLine } from "../lib/ops/denominator-floor.ts";

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
  console.error("That is a COULD-NOT-TELL, not a pass.");
  process.exit(2);
}

const sqlPath = join("lib", "db", "migrations", `${tag}.sql`);
let migrationBytes: Buffer;
try {
  migrationBytes = readFileSync(sqlPath);
} catch {
  console.error(`verify:migration — no committed SQL at ${sqlPath}`);
  process.exit(2);
}
const migration = migrationBytes.toString("utf8");
const migrationSha256 = createHash("sha256").update(migrationBytes).digest("hex");

const sql = neon(url);
const declared = declaredMigrationCatalog(migration);
const declaredObjectCount = declaredMigrationCatalogCount(declared);

const journal = JSON.parse(
  readFileSync(join(process.cwd(), "lib", "db", "migrations", "meta", "_journal.json"), "utf8"),
) as { readonly entries?: readonly { readonly tag?: unknown; readonly when?: unknown }[] };
const journalEntries = (journal.entries ?? []).filter((entry) => entry.tag === tag);
if (journalEntries.length !== 1 || typeof journalEntries[0]?.when !== "number" || !Number.isFinite(journalEntries[0].when)) {
  console.error(`verify:migration — ${tag} does not have one exact committed journal entry`);
  process.exit(2);
}
const journalWhen = Number(journalEntries[0]!.when);

console.log(`verify:migration  tag=${tag}  target=${target}  via ${envName}`);
console.log(
  `  committed SQL declares ${declared.tables.size} table(s), ${declared.indexes.length} index(es), ` +
    `${declared.constraints.length} constraint(s), ${declared.functions.length} function(s), and ` +
    `${declared.triggers.length} trigger(s)`,
);

// A migration whose SQL parsed as ZERO tables would otherwise report success about a comparison never made.
if (declaredObjectCount === 0) {
  console.error(
    `  NOT ASSERTABLE — parsed no CREATE TABLE and no CREATE INDEX out of ${sqlPath}.` +
      " That is a fact about this reader, not about the migration.",
  );
  process.exit(1);
}
console.log(`  ${floorLine(floored("declared migration objects parsed", sqlPath, declaredObjectCount, declaredObjectCount))}`);

let mismatched = 0;

for (const [table, columns] of declared.tables) {
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

for (const index of declared.indexes) {
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

for (const constraint of declared.constraints) {
  // table_constraints hides rows from a SELECT-only role. The catalog remains
  // readable; ::name applies the server's own identifier-length semantics.
  const found = (await sql`
    select c.conname as constraint_name
      from pg_catalog.pg_constraint c
      join pg_catalog.pg_class r on r.oid = c.conrelid
      join pg_catalog.pg_namespace n on n.oid = r.relnamespace
     where n.nspname = 'public'
       and r.relname = ${constraint.table}
       and c.conname = ${constraint.name}::name
       and c.convalidated
  `) as { constraint_name: string }[];
  if (found.length !== 1) {
    mismatched += 1;
    console.log(`  ABSENT  constraint ${constraint.table}.${constraint.name}`);
  } else {
    console.log(`  MATCH   constraint ${constraint.table}.${constraint.name}`);
  }
}

for (const declaredFunction of declared.functions) {
  const found = (await sql`
    select p.proname
      from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = ${declaredFunction}
  `) as { proname: string }[];
  if (found.length !== 1) {
    mismatched += 1;
    console.log(`  ${found.length === 0 ? "ABSENT" : "DIFFER"} function ${declaredFunction} — live overloads=${found.length}`);
  } else {
    console.log(`  MATCH   function ${declaredFunction}`);
  }
}

for (const trigger of declared.triggers) {
  const found = (await sql`
    select t.tgname, t.tgconstraint <> 0 as is_constraint
      from pg_catalog.pg_trigger t
      join pg_catalog.pg_class c on c.oid = t.tgrelid
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relname = ${trigger.table}
       and t.tgname = ${trigger.name}
       and not t.tgisinternal
  `) as { tgname: string; is_constraint: boolean }[];
  const agrees = found.length === 1 && Boolean(found[0]!.is_constraint) === trigger.constraint;
  if (!agrees) {
    mismatched += 1;
    console.log(`  ${found.length === 0 ? "ABSENT" : "DIFFER"} trigger ${trigger.table}.${trigger.name}`);
  } else {
    console.log(`  MATCH   trigger ${trigger.table}.${trigger.name}`);
  }
}

const applied = await readAppliedMigrationWhen(url);
const appliedJournal = appliedMigrationReceiptCensus(applied, journalWhen);
if (!hasExactAppliedMigrationReceipt(applied, journalWhen, migrationSha256)) {
  mismatched += 1;
  const readFailure = applied.ok
    ? `live physical rows=${appliedJournal?.rowCount ?? 0}, usable hashes=${appliedJournal?.hashes.length ?? 0}`
    : `read refused=${applied.why.replace(/postgres(?:ql)?:\/\/[^\s]+/gi, "[REDACTED_DATABASE_URL]")}`;
  console.log(
    `  DIFFER journal ${tag} — expected created_at=${journalWhen}, sha256=${migrationSha256}; ` +
      readFailure,
  );
} else {
  console.log(`  MATCH   journal ${tag} created_at=${journalWhen} sha256=${migrationSha256}`);
}

// The smallest read that proves each table ANSWERS rather than merely existing.
console.log("  — smallest read, one count per table —");
for (const table of declared.tables.keys()) {
  // The name came from a committed .sql file, but a table name cannot be a bind parameter, so it is
  // checked against the identifier shape before it is interpolated.
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
  `\nOK — ${target} matches ${sqlPath} on its exact journal hash and every declared catalog object` +
    ` (${declared.tables.size} table(s), ${declared.indexes.length} index(es), ` +
    `${declared.constraints.length} constraint(s), ${declared.functions.length} function(s), ` +
    `${declared.triggers.length} trigger(s)).`,
);
