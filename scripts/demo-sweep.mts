/**
 * `pnpm demo:sweep` — deletes reader rows collected while the password wall
 * was up, and records the deletion in Admin's change history.
 *
 * ```
 *   pnpm demo:sweep                                  report only — what WOULD be deleted
 *   pnpm demo:sweep --execute --target=production    actually delete
 * ```
 *
 * Deleting requires both flags: it cannot be undone. The demo is selected by
 * `occurred_at`, which every write path sets, rather than by a marker column.
 */
import { createHash } from "node:crypto";

import { and, gte, lte, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";

import { OWNER_SURFACE_FORMAT_VERSION, type OwnerDigestRecord } from "../lib/control-plane/owner-surface.ts";
import { pgAppendOnlyRepository } from "../lib/control-plane/repository/pg-store.ts";
import { reactions, searchLog } from "../lib/db/schema.ts";
import { WriteHandleRefused, resolveProductionWriteHandle } from "../lib/db/write-handle.ts";

/** When the wall went up; `null` means the lower bound is the beginning. */
const WALL_UP: string | null = null;
/** When the wall came down; `null` until it does. Setting it arms the deletion. */
const WALL_DOWN: string | null = null;

const STORES_COVERED = ["reactions", "search_log"] as const;

type Verdict =
  | { state: "WALL_STILL_UP" | "CANNOT_RUN"; reason: string }
  | { state: "READY"; from: string | null; to: string; lowerBound: string };

function demoSweepVerdict(wallUp: string | null, wallDown: string | null): Verdict {
  if (wallDown === null) {
    return { state: "WALL_STILL_UP", reason: "The password wall has not come down. The deletion is armed and has not fired." };
  }
  if (wallUp === null) {
    return { state: "READY", from: null, to: wallDown, lowerBound: "the beginning — every row up to WALL_DOWN is the demo's." };
  }
  if (wallUp > wallDown) {
    return { state: "CANNOT_RUN", reason: `WALL_UP (${wallUp}) is after WALL_DOWN (${wallDown}), which is not a window.` };
  }
  return { state: "READY", from: wallUp, to: wallDown, lowerBound: `WALL_UP (${wallUp}) — a bounded window, both ends established` };
}

const EXECUTE = process.argv.includes("--execute");
const PRODUCTION = process.argv.includes("--target=production");

const verdict = demoSweepVerdict(WALL_UP, WALL_DOWN);

console.log("DEMO SWEEP");
console.log(`  stores covered:  ${STORES_COVERED.join(", ")}`);
console.log(`  verdict:         ${verdict.state}`);

if (verdict.state !== "READY") {
  console.log(`  ${verdict.reason}`);
  process.exit(0);
}

console.log(`  demo window:     ${verdict.from ?? "(the beginning)"} .. ${verdict.to}`);
console.log(`  lower bound:     ${verdict.lowerBound}`);

if (!EXECUTE || !PRODUCTION) {
  console.log(
    "\n  REPORT ONLY — nothing was deleted. Pass BOTH --execute and --target=production " +
      "to perform the deletion. This is irreversible and the two flags are the gate.",
  );
  process.exit(0);
}

const handle = resolveProductionWriteHandle(process.env);
if (!handle) {
  throw new WriteHandleRefused(
    "No production write handle. The demo deletion touches the live sold stores and will not run against anything else.",
  );
}
const db = drizzle(neon(handle.connection));
// `occurred_at` is a string-mode column; the end bound covers the whole final day.
const start = verdict.from === null ? null : `${verdict.from}T00:00:00.000Z`;
const end = `${verdict.to}T23:59:59.999Z`;
const deleted: Record<string, number> = {};

for (const [name, table, column] of [
  ["reactions", reactions, reactions.occurredAt],
  ["search_log", searchLog, searchLog.occurredAt],
] as const) {
  const where = start === null ? lte(column, end) : and(gte(column, start), lte(column, end));
  const before = await db.select({ n: sql<number>`count(*)::int` }).from(table).where(where);
  await db.delete(table).where(where);
  const after = await db.select({ n: sql<number>`count(*)::int` }).from(table).where(where);
  const remaining = after[0]?.n ?? 0;
  if (remaining !== 0) {
    throw new Error(
      `${name}: ${remaining} row(s) still inside the demo window after the delete. ` +
        "The deletion did NOT complete and must not be reported as though it had.",
    );
  }
  deleted[name] = before[0]?.n ?? 0;
}

console.log("\n  DELETED");
for (const [store, count] of Object.entries(deleted)) {
  console.log(`    ${store.padEnd(14)} ${count} row(s)`);
}

const at = new Date().toISOString();
const lines = [
  `Window ${verdict.from ?? "the beginning"} to ${verdict.to} — ${verdict.lowerBound}`,
  ...Object.entries(deleted).map(([s, c]) => `${s}: ${c} row(s) deleted`),
  "Counted before deletion and re-counted after; nothing outside the window was touched.",
];
const record: OwnerDigestRecord = {
  formatVersion: OWNER_SURFACE_FORMAT_VERSION,
  digestId: `demo-deletion:${createHash("sha256").update(`${verdict.to}:${at}`).digest("hex")}`,
  writtenAt: at,
  headline: "Demo-period reader data deleted",
  lines,
  cycleOk: true,
  testedSha: null,
};
const connection = process.env.WTP_CONTROL_PLANE_DATABASE_URL;
if (!connection) {
  console.error("\n  The deletion ran but could not be recorded in Admin: WTP_CONTROL_PLANE_DATABASE_URL is not set.");
  for (const line of lines) console.error(`    ${line}`);
  process.exit(1);
}
const controlSql = neon(connection);
const history = pgAppendOnlyRepository<OwnerDigestRecord>({
  query: (text, params, options) => controlSql.query(text, [...(params ?? [])], options),
}, "owner_digests");
await history.append("owner-digest", record.digestId, record, record.writtenAt);
console.log("\n  recorded in Admin's change history");
