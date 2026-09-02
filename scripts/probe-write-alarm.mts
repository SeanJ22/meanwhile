/**
 * `pnpm probe:alarm` — prove the write alarm actually fires, end to end, on the
 * live deploy, and then put the table back.
 *
 * **Prompt D item 6.5, 2026-08-20.** The alarm's whole claim is that a failed
 * write to a sold store raises a row somewhere this repo can read. A claim like
 * that is worth exactly what its demonstration is worth, and "the code calls
 * `raiseWriteAlarm`" is not a demonstration — that is what D73 taught, where
 * every instrument said green about two stores that were dark.
 *
 * ## How the failure is induced, and why this way
 *
 * NOT by breaking the schema. Renaming a column on production to watch the
 * alarm fire would be committing D73 deliberately, against real readers, to
 * prove D73 is caught. Instead the probe sends `/api/log` a well-formed event
 * whose `detail` carries a key the search log forbids. That throws inside the
 * route's try block — the same catch a database refusal lands in — so the
 * swallow-and-alarm seam is exercised exactly as it would be by the real thing,
 * with no schema change, no reader impact, and no row in either sold store.
 *
 * The forbidden key is `promptd_alarm_probe_user`. The validator's message
 * quotes the key back, so the alarm row NAMES ITSELF as a probe rather than
 * needing a side table to say which rows were ours — the probe-naming rule
 * applied to the probe's own trace.
 *
 * ## The revert
 *
 * `--revert` deletes only rows whose message carries `promptd_alarm_probe`, and
 * prints how many it deleted against how many it found. It cannot reach a real
 * alarm: a genuine database refusal quotes the database's words, not ours.
 *
 * Run:
 *   corepack pnpm probe:alarm                    # fire one, against production
 *   corepack pnpm probe:alarm --revert           # delete the probe rows
 *   BASE=http://localhost:3100 corepack pnpm probe:alarm
 */
import { join } from "node:path";

import { config as loadEnv } from "dotenv";
import { neon } from "@neondatabase/serverless";

import { resolveProductionWriteHandle, WriteHandleRefused } from "../lib/db/write-handle.ts";

import { PUBLIC_SITE_ORIGIN } from "../lib/ops/origins.ts";

loadEnv({ path: join(process.cwd(), ".env.local") });

const BASE = process.env.SHOOT_BASE_URL ?? PUBLIC_SITE_ORIGIN;
const REVERT = process.argv.includes("--revert");
const MARKER = "promptd_alarm_probe";
const KEY = `${MARKER}_user`;

const READONLY = process.env.WTP_PRODUCTION_DATABASE_URL_READONLY;

async function readProbes(): Promise<{ id: string; raised_at: string; store: string }[]> {
  if (!READONLY) {
    console.error("probe:alarm: COULD NOT READ — WTP_PRODUCTION_DATABASE_URL_READONLY is not set.");
    process.exit(2);
  }
  const sql = neon(READONLY);
  return (await sql`
    SELECT id, raised_at, store
    FROM write_alarm
    WHERE error_message LIKE ${`%${MARKER}%`}
    ORDER BY raised_at
  `) as { id: string; raised_at: string; store: string }[];
}

if (REVERT) {
  const found = await readProbes();
  console.log(`probe rows found: ${found.length}`);
  if (found.length === 0) {
    console.log("nothing to revert.");
    process.exit(0);
  }
  let connection: string;
  try {
    connection = resolveProductionWriteHandle().connection;
  } catch (error) {
    if (error instanceof WriteHandleRefused) {
      console.error(`probe:alarm --revert: REFUSED — ${error.message}`);
      process.exit(1);
    }
    throw error;
  }
  const sql = neon(connection);
  const deleted = (await sql`
    DELETE FROM write_alarm WHERE error_message LIKE ${`%${MARKER}%`} RETURNING id
  `) as { id: string }[];
  console.log(`deleted ${deleted.length} of ${found.length} probe row(s)`);
  const left = await readProbes();
  console.log(`probe rows remaining: ${left.length}`);
  process.exit(left.length === 0 ? 0 : 1);
}

/* ---- fire one ------------------------------------------------------------- */

const beforeRows = await readProbes();
console.log(`base: ${BASE}`);
console.log(`probe rows before: ${beforeRows.length}`);

const response = await fetch(`${BASE}/api/log`, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    // Same-origin is required by the route; a probe declares the origin it is
    // pretending to be rather than working around the check.
    origin: BASE,
    "x-wtp-synthetic-run": process.env.WTP_RUN_ID ?? `promptd-alarm-probe@${MARKER}`,
  },
  body: JSON.stringify({
    eventType: "SEARCH",
    ocdIds: [],
    detail: { [KEY]: 1 },
  }),
});
const text = await response.text();
console.log(`POST /api/log -> HTTP ${response.status}  ${text.slice(0, 200)}`);

if (response.status !== 400) {
  console.error(
    "the probe did not reach the guarded catch — expected 400 from the forbidden detail key.",
  );
  process.exit(1);
}

/*
 * The route answers before the alarm insert resolves, so the row can land a
 * moment later. Poll for an OUTCOME rather than waiting a duration: a fixed
 * wait plus a single read cannot tell GONE from NOT YET (R49).
 */
let after = beforeRows;
for (let i = 0; i < 20; i += 1) {
  after = await readProbes();
  if (after.length > beforeRows.length) break;
  await new Promise((r) => setTimeout(r, 500));
}

console.log(`probe rows after:  ${after.length}`);
if (after.length <= beforeRows.length) {
  console.error(
    "\nTHE ALARM DID NOT FIRE. The route swallowed a sold-store write failure and " +
      "nothing landed in write_alarm — which is D73's shape exactly.",
  );
  process.exit(1);
}
for (const r of after.slice(beforeRows.length)) {
  console.log(`  ${r.raised_at}  ${r.store}  id=${r.id}`);
}
console.log("\nALARM FIRED. Revert with: corepack pnpm probe:alarm --revert");
