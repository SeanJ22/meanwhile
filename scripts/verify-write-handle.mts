/**
 * `pnpm verify:write-handle` — proof that the one sanctioned production write
 * path (`WTP_PRODUCTION_DATABASE_URL_WRITE`) connects, writes, and cleans up:
 *
 * 1. it resolves through `lib/db/write-handle.ts`, so both refusals (the
 *    READONLY variable by name, and any read-only user) are on the path;
 * 2. it confirms the host is NOT the branch `DATABASE_URL` calls local;
 * 3. it writes ONE row, marked SYNTHETIC with a run id it mints;
 * 4. it reads that row back by the run id;
 * 5. it deletes it and prints the before and after totals, so "delta 0" is checkable.
 *
 * This writes to PRODUCTION, on purpose; the row is gone by the end of the run.
 *
 * Run: `pnpm verify:write-handle`
 */
import { join } from "node:path";

import { config as loadEnv } from "dotenv";
import { neon } from "@neondatabase/serverless";

import { resolveProductionWriteHandle, WriteHandleRefused } from "../lib/db/write-handle.ts";

loadEnv({ path: join(process.cwd(), ".env.local") });

let failures = 0;
function report(label: string, ok: boolean, detail: string) {
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label} — ${detail}`);
}
function finish(): never {
  console.log(
    `\n${
      failures === 0
        ? "THE WRITE HANDLE IS PROVEN"
        : `THE WRITE HANDLE IS NOT PROVEN — ${failures} check(s) failed`
    }\n`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

console.log("\nRESOLUTION");
let handle;
try {
  handle = resolveProductionWriteHandle();
  report("the sanctioned variable resolves", true, `${handle.variable}`);
} catch (error) {
  if (error instanceof WriteHandleRefused) {
    report("the sanctioned variable resolves", false, error.message);
    finish();
  }
  throw error;
}
console.log(`  role = ${handle.role}`);
console.log(`  host = ${handle.host}`);
console.log(`  db   = ${handle.database}`);

console.log("\nBRANCH");
const localRaw = process.env.DATABASE_URL;
const localHost = localRaw ? new URL(localRaw).hostname : null;
report(
  "the write handle is not pointed at the branch DATABASE_URL calls local",
  localHost !== handle.host,
  localHost === null
    ? "DATABASE_URL is unset, so there is nothing to confuse it with"
    : localHost === handle.host
      ? `both are ${handle.host} — this handle would write to the local branch while claiming production`
      : `write = ${handle.host}, local = ${localHost}`,
);

const sql = neon(handle.connection);

console.log("\nCONNECTION");
let connected = false;
try {
  const rows = (await sql`
    select current_user as who, current_database() as db,
           pg_has_role(current_user, 'neon_superuser', 'member') as superuser
  `) as { who: string; db: string; superuser: boolean }[];
  connected = true;
  report(
    "the connection authenticates",
    true,
    `current_user = ${rows[0].who}, current_database = ${rows[0].db}, ` +
      `neon_superuser = ${rows[0].superuser}`,
  );
} catch (error) {
  report("the connection authenticates", false, (error as Error).message);
}
if (!connected) finish();

console.log("\nWRITE AND READ BACK");
const runId = `verify-write-handle@${new Date().toISOString()}`;
console.log(`  run id = ${runId}`);

const before = (await sql`select count(*)::int as n from search_log`) as { n: number }[];

try {
  await sql`
    insert into search_log
      (occurred_at, event_type, approximate_location, ocd_ids, division_vintage,
       detail, run_class, run_id)
    values
      (now(), 'SEARCH', '03255', '[]'::jsonb, 'TIGER2024',
       ${JSON.stringify({ probe: "verify-write-handle" })}::jsonb, 'SYNTHETIC', ${runId})
  `;
  report("the handle can INSERT", true, "one row written, marked SYNTHETIC");
} catch (error) {
  report("the handle can INSERT", false, (error as Error).message);
  finish();
}

const readBack = (await sql`
  select run_class from search_log where run_id = ${runId}
`) as { run_class: string }[];
report(
  "the row reads back by its run id",
  readBack.length === 1 && readBack[0].run_class === "SYNTHETIC",
  `${readBack.length} row(s), run_class = ${readBack[0]?.run_class ?? "none"}`,
);

console.log("\nCLEANUP");
const deleted = (await sql`
  delete from search_log where run_id = ${runId} returning id
`) as { id: string }[];
const after = (await sql`select count(*)::int as n from search_log`) as { n: number }[];
report(
  "the probe row is removed and the store returns to where it started",
  after[0].n === before[0].n,
  `search_log ${before[0].n} -> ${after[0].n}, delta ${after[0].n - before[0].n} ` +
    `(deleted ${deleted.length})`,
);

finish();
