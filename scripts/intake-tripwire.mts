/**
 * The daily intake tripwire (T08 1f): identifier-free day counts out of
 * the two written stores, analyzed by lib/signal/tripwire.ts, written to
 * docs/intake-report.md for the author. Also the limiter table's purge —
 * expiry on the limiter's own schedule (48h), per the isolation contract.
 *
 * Run: `pnpm intake:tripwire` (needs DATABASE_URL). Exits 1 loudly when it
 * cannot run — a tripwire that silently skips is worse than none. Exits 0
 * whether or not days are flagged; a flag is a line for the author, never
 * an action.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { config as loadEnv } from "dotenv";
import { neon } from "@neondatabase/serverless";

loadEnv({ path: join(process.cwd(), ".env.local") });

import { purgeExpiredLimiterState } from "../lib/db/intake-limiter.ts";
import {
  renderIntakeReport,
  analyzeStore,
  type IntakeDayCount,
} from "../lib/signal/tripwire.ts";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL missing — tripwire NOT RUN. This is a failure, not a quiet day.");
  process.exit(1);
}
const sql = neon(url);

// Identifier-free by construction: dates and counts leave the database,
// nothing else. The suspect count reads the flag column only.
const reactionRows = (await sql`
  SELECT occurred_at::date::text AS day,
         count(*)::int AS total,
         count(*) FILTER (WHERE suspect_reason IS NOT NULL)::int AS suspect
  FROM reactions
  WHERE occurred_at > now() - interval '30 days'
  GROUP BY 1 ORDER BY 1
`) as { day: string; total: number; suspect: number }[];

const searchRows = (await sql`
  SELECT occurred_at::date::text AS day, count(*)::int AS total
  FROM search_log
  WHERE occurred_at > now() - interval '30 days'
  GROUP BY 1 ORDER BY 1
`) as { day: string; total: number }[];

const reactionDays: IntakeDayCount[] = reactionRows.map((r) => ({
  day: r.day,
  total: r.total,
  suspect: r.suspect,
}));
const searchLogDays: IntakeDayCount[] = searchRows.map((r) => ({
  day: r.day,
  total: r.total,
  suspect: 0,
}));

const limiterRowsPurged = await purgeExpiredLimiterState();
const remaining = (await sql`SELECT count(*)::int AS n FROM intake_limiter`) as {
  n: number;
}[];

const report = renderIntakeReport({
  generatedAt: new Date().toISOString(),
  reactionDays,
  searchLogDays,
  limiterRowsPurged,
  limiterRowsRemaining: remaining[0]?.n ?? 0,
});

const target = join(process.cwd(), "docs", "intake-report.md");
writeFileSync(target, report, "utf8");

// The count-and-denominator line — an operation that can return nothing
// must be asked what it returned.
const flags = [
  ...analyzeStore("reactions", reactionDays),
  ...analyzeStore("search_log", searchLogDays),
];
console.log(
  `tripwire: ${reactionDays.length} reaction days, ${searchLogDays.length} search-log days analyzed; ` +
    `${flags.length} flag(s); ${limiterRowsPurged} limiter rows purged, ${remaining[0]?.n ?? 0} remain; report written to docs/intake-report.md`,
);
for (const flag of flags) {
  console.log(`FLAGGED ${flag.day} ${flag.store} ${flag.kind}: ${flag.detail}`);
}
