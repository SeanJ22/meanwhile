/**
 * A-001 · EXPORT EVERY FEEDBACK ROW BEFORE THE COLUMN IS DROPPED.
 *
 * Session: audit-remediation-0824. Claim served: the brief's Item 7 step 3 —
 * "export the existing feedback rows to a dated local backup before any
 * destructive step and report the row count exported".
 *
 * The migration moves `feedback.reply_to` into `feedback_contact.address` and
 * then drops the column. A backfill plus a drop is reversible only while the
 * bytes still exist somewhere, and the somewhere has to be outside the database
 * being altered.
 *
 * **It writes OUTSIDE the repository.** These are readers' words and, on any
 * row that has one, a reader's email address; the repo is public-adjacent and
 * `tests/secret-redaction.test.ts` sweeps everything that would be committed.
 * The file lands beside the repo in `../wtp-backups/`, and the path is printed.
 *
 *   pnpm tsx scripts/a001-feedback-backup.mts --target=production
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { neon } from "@neondatabase/serverless";
import { config as loadEnv } from "dotenv";

import { today } from "./doc-dates.mjs";

loadEnv({ path: join(process.cwd(), ".env.local") });

const PRODUCTION = process.argv.includes("--target=production");
const variable = PRODUCTION ? "WTP_PRODUCTION_DATABASE_URL_READONLY" : "DATABASE_URL";
const connection = process.env[variable];

if (!connection) {
  console.error(`a001-backup: ${variable} is not set — refusing to guess`);
  process.exit(2);
}

const sql = neon(connection);

// `to_regclass` rather than a try/catch: a missing table is an ordinary state
// on a branch the migration has not reached, and it must not read as a failure
// to export.
const [{ present }] = (await sql`select to_regclass('public.feedback') is not null as present`) as {
  present: boolean;
}[];

if (!present) {
  console.log(`a001-backup: no feedback table on ${variable} — 0 row(s) to export.`);
  process.exit(0);
}

const columns = (await sql`
  select column_name from information_schema.columns
  where table_schema = 'public' and table_name = 'feedback'
  order by column_name
`) as { column_name: string }[];

const rows = (await sql`select * from feedback order by received_at`) as Record<
  string,
  unknown
>[];

const dir = resolve(import.meta.dirname, "..", "..", "wtp-backups");
mkdirSync(dir, { recursive: true });
const file = join(dir, `feedback-before-a001-${today()}-${PRODUCTION ? "production" : "local"}.json`);

writeFileSync(
  file,
  `${JSON.stringify(
    {
      exportedFrom: variable,
      // The connection string itself is NEVER written here — RULING 127.
      columns: columns.map((c) => c.column_name),
      rowCount: rows.length,
      rows,
    },
    null,
    2,
  )}\n`,
  "utf8",
);

const withReply = rows.filter((r) => typeof r.reply_to === "string" && r.reply_to !== "").length;

console.log(`\na001-backup · ${variable}`);
console.log(`  columns   ${columns.map((c) => c.column_name).join(", ")}`);
console.log(`  rows      ${rows.length} exported`);
console.log(`  with a reply address  ${withReply} of ${rows.length}`);
console.log(`  written   ${file}\n`);
