/**
 * `pnpm alarms` — has a write to a sold store failed?
 *
 * Run:
 *   corepack pnpm alarms                      # DATABASE_URL (the local branch)
 *   corepack pnpm alarms --target=production  # WTP_PRODUCTION_DATABASE_URL_READONLY
 *   corepack pnpm alarms --hours=72           # window, default 24
 *
 * Exit codes ("found nothing" and "could not look" must differ):
 *   0  no alarms in the window — the stores accepted their writes
 *   1  ALARMS PRESENT, printed with the database's own words
 *   2  COULD NOT READ — no credential, or the table could not be queried
 */
import { join } from "node:path";

import { config as loadEnv } from "dotenv";
import { neon } from "@neondatabase/serverless";

loadEnv({ path: join(process.cwd(), ".env.local") });

const PRODUCTION = process.argv.includes("--target=production");
const VARIABLE = PRODUCTION ? "WTP_PRODUCTION_DATABASE_URL_READONLY" : "DATABASE_URL";
const connection = process.env[VARIABLE];

const hoursArg = process.argv.find((a) => a.startsWith("--hours="));
const HOURS = hoursArg ? Number(hoursArg.slice("--hours=".length)) : 24;
if (!Number.isFinite(HOURS) || HOURS <= 0) {
  console.error(`alarms: --hours must be a positive number, got ${JSON.stringify(hoursArg)}`);
  process.exit(2);
}

if (!connection) {
  console.error(`alarms: COULD NOT READ — ${VARIABLE} is not set.`);
  console.error("  An unset credential is not an empty alarm table.");
  process.exit(2);
}

{
  const u = new URL(connection);
  console.log(`alarms  ${VARIABLE}  role=${u.username}  host=${u.hostname}  window=${HOURS}h`);
}

interface Row {
  raised_at: string;
  store: string;
  error_code: string | null;
  error_message: string | null;
}

let rows: Row[];
let total: number;
try {
  const sql = neon(connection);
  rows = (await sql`
    SELECT raised_at, store, error_code, error_message
    FROM write_alarm
    WHERE raised_at > now() - (${String(HOURS)} || ' hours')::interval
    ORDER BY raised_at DESC
    LIMIT 200
  `) as Row[];
  const counted = (await sql`SELECT COUNT(*)::int AS n FROM write_alarm`) as { n: number }[];
  total = counted[0]!.n;
} catch (error) {
  console.error(`alarms: COULD NOT READ write_alarm — ${(error as Error).message}`);
  console.error("  This is not 'no alarms'. Nothing is concluded.");
  process.exit(2);
}

// The count against its denominator: a deliberate clip must not read as a failure, nor the reverse.
console.log(`  ${rows.length} alarm(s) in the last ${HOURS}h, of ${total} ever recorded`);

if (rows.length === 0) {
  console.log("\nNO ALARMS — both sold stores accepted every write in this window.");
  process.exit(0);
}

const byStore = new Map<string, number>();
for (const r of rows) byStore.set(r.store, (byStore.get(r.store) ?? 0) + 1);

console.error("\nALARMS RAISED — a sold store refused a write:");
for (const [store, n] of byStore) console.error(`  ${store.padEnd(12)} ${n}`);
console.error("");
/**
 * A missing SQLSTATE renders as its named gap, never a placeholder: either the
 * driver never gave one (the Neon HTTP driver carries the code down `.cause`),
 * or the row predates walking the cause chain.
 */
const NO_CODE =
  "no SQLSTATE — the driver gave none anywhere in the cause chain (a fact about the driver, not about the database)";

for (const r of rows.slice(0, 20)) {
  console.error(
    `  ${r.raised_at}  ${r.store.padEnd(12)} ${r.error_code ?? NO_CODE}  ${r.error_message ?? "no message recorded"}`,
  );
}
if (rows.length > 20) console.error(`  … ${rows.length - 20} more not printed`);
console.error(
  "\nIf the message names a column, run: corepack pnpm db:check --target=production",
);
process.exit(1);
