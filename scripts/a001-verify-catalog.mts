/**
 * A-001 · READ THE CATALOG BACK, RATHER THAN TRUSTING THE MIGRATION'S OWN
 * REPORT.
 *
 * Session: audit-remediation-0824. Claim served: the brief's close-out item 8 —
 * "migration applied and verified by reading the catalog back".
 *
 * `pnpm db:apply` prints OK per statement. That is the step reporting on
 * itself, which RULING 113 says is exactly what must not stand in for
 * observing the step's product. This asks Postgres what the tables actually
 * look like now, and counts the rows the backfill was supposed to move.
 *
 *   pnpm tsx scripts/a001-verify-catalog.mts --target=production
 */
import { join } from "node:path";

import { neon } from "@neondatabase/serverless";
import { config as loadEnv } from "dotenv";

loadEnv({ path: join(process.cwd(), ".env.local") });

const PRODUCTION = process.argv.includes("--target=production");
const variable = PRODUCTION ? "WTP_PRODUCTION_DATABASE_URL_READONLY" : "DATABASE_URL";
const connection = process.env[variable];
if (!connection) {
  console.error(`a001-verify: ${variable} is not set — refusing to guess`);
  process.exit(2);
}
const sql = neon(connection);

const cols = (await sql`
  select table_name, column_name
  from information_schema.columns
  where table_schema = 'public' and table_name in ('feedback', 'feedback_contact')
  order by table_name, column_name
`) as { table_name: string; column_name: string }[];

const feedbackCols = cols.filter((c) => c.table_name === "feedback").map((c) => c.column_name);
const contactCols = cols.filter((c) => c.table_name === "feedback_contact").map((c) => c.column_name);

const [{ total, withHandle }] = (await sql`
  select count(*)::int as total,
         count(contact_ref)::int as "withHandle"
  from feedback
`) as { total: number; withHandle: number }[];

const [{ addresses }] = (await sql`
  select count(*)::int as addresses from feedback_contact
`) as { addresses: number }[];

const [{ orphans }] = (await sql`
  select count(*)::int as orphans
  from feedback f
  where f.contact_ref is not null
    and not exists (select 1 from feedback_contact c where c.contact_ref = f.contact_ref)
`) as { orphans: number }[];

console.log(`\na001-verify · ${variable}\n`);
console.log(`  feedback columns          ${feedbackCols.join(", ")}`);
console.log(`  feedback_contact columns  ${contactCols.join(", ")}`);
console.log(`\n  feedback rows                       ${total}`);
console.log(`  rows carrying a contact handle      ${withHandle} of ${total}`);
console.log(`  addresses in the delivery store     ${addresses}`);
console.log(`  handles pointing at nothing         ${orphans}`);

const problems: string[] = [];
if (feedbackCols.includes("reply_to")) problems.push("feedback.reply_to still exists");
if (!feedbackCols.includes("contact_ref")) problems.push("feedback.contact_ref is missing");
if (contactCols.length === 0) problems.push("feedback_contact does not exist");
if (withHandle !== addresses) {
  problems.push(`${withHandle} handle(s) against ${addresses} address(es) — the backfill did not reconcile`);
}
if (orphans > 0) problems.push(`${orphans} handle(s) resolve to no address`);

console.log("");
if (problems.length > 0) {
  for (const p of problems) console.log(`  PROBLEM  ${p}`);
  process.exit(1);
}
console.log("  the catalog agrees with the schema, and every handle resolves.\n");
