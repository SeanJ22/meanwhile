/**
 * `pnpm searchlog:backmark` — attribute historical search-log rows (C05).
 *
 * The marker column ships with the rows that come after it. The rows already
 * in production do not have one, and the migration marked every one of them
 * `UNKNOWN` — which is honest but coarse: some of those windows we DO know,
 * because a session recorded when its walk ran.
 *
 * This pass upgrades the knowable ones to `SYNTHETIC`, from the committed
 * ledger at `docs/synthetic-runs.md` and nothing else. It never infers, never
 * pattern-matches a user agent, and never widens a window to catch a few more
 * rows. Anything it does not attribute stays `UNKNOWN` and stays excluded.
 *
 * It is idempotent and it never touches an `ORGANIC` row: a row that declared
 * itself at write time is already correct, and a backfill that could overwrite
 * a declaration would make the declaration worthless.
 *
 * Run: `pnpm searchlog:backmark` (needs DATABASE_URL). `--dry` prints the
 * counts and writes nothing.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { config as loadEnv } from "dotenv";
import { neon } from "@neondatabase/serverless";

loadEnv({ path: join(process.cwd(), ".env.local") });

const DRY = process.argv.includes("--dry");

if (!process.env.DATABASE_URL) {
  console.error("searchlog:backmark: DATABASE_URL is not set — refusing to guess");
  process.exit(1);
}
const sql = neon(process.env.DATABASE_URL);

interface Window {
  runId: string;
  from: string;
  to: string;
}

/**
 * Parse the ledger's table. Deliberately strict: a malformed row is a loud
 * failure, never a silently skipped window — a skipped window leaves rows
 * unattributed while the run reports success, which is the empty-success
 * shape by another name.
 */
function readLedger(): Window[] {
  const path = join(process.cwd(), "docs", "synthetic-runs.md");
  const text = readFileSync(path, "utf8");
  const windows: Window[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim().startsWith("|")) continue;
    const cells = line.split("|").slice(1, -1).map((c) => c.trim());
    if (cells.length < 4) continue;
    if (/^-+$/.test(cells[0]) || cells[0] === "runId") continue;
    const runId = cells[0].replace(/^`|`$/g, "");
    const from = cells[1];
    const to = cells[2];
    const iso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
    if (!iso.test(from) || !iso.test(to)) {
      throw new Error(
        `docs/synthetic-runs.md: window "${runId}" has a malformed instant (${from} .. ${to}) — ` +
          `a window that cannot be parsed must not be silently skipped`,
      );
    }
    if (Date.parse(from) > Date.parse(to)) {
      throw new Error(`docs/synthetic-runs.md: window "${runId}" ends before it starts`);
    }
    windows.push({ runId, from, to });
  }
  return windows;
}

const windows = readLedger();
if (windows.length === 0) {
  console.error("searchlog:backmark: the ledger holds no windows — nothing to attribute");
  process.exit(1);
}

const before = (await sql`
  SELECT
    COUNT(*) FILTER (WHERE run_class = 'ORGANIC')::int   AS organic,
    COUNT(*) FILTER (WHERE run_class = 'SYNTHETIC')::int AS synthetic,
    COUNT(*) FILTER (WHERE run_class = 'UNKNOWN')::int   AS unknown,
    COUNT(*)::int                                        AS total
  FROM search_log
`) as { organic: number; synthetic: number; unknown: number; total: number }[];

console.log(
  `before: ${before[0].organic} organic, ${before[0].synthetic} synthetic, ` +
    `${before[0].unknown} unknown, ${before[0].total} total`,
);

let marked = 0;
for (const w of windows) {
  // UNKNOWN only. An ORGANIC row declared itself and is already right; a
  // SYNTHETIC row is already attributed. Neither may be overwritten by a
  // window, or the declaration stops being the authority.
  const rows = DRY
    ? ((await sql`
        SELECT COUNT(*)::int AS n FROM search_log
        WHERE run_class = 'UNKNOWN'
          AND occurred_at >= ${w.from}::timestamptz
          AND occurred_at <= ${w.to}::timestamptz
      `) as { n: number }[])
    : ((await sql`
        UPDATE search_log
        SET run_class = 'SYNTHETIC', run_id = ${w.runId}
        WHERE run_class = 'UNKNOWN'
          AND occurred_at >= ${w.from}::timestamptz
          AND occurred_at <= ${w.to}::timestamptz
        RETURNING 1
      `) as unknown[]);
  const n = DRY ? (rows as { n: number }[])[0].n : (rows as unknown[]).length;
  marked += n;
  // The count and its denominator: a window that matched nothing is stated,
  // because a deliberate clip must not read as a failure and a real failure
  // must not read as a clip.
  console.log(
    `  ${DRY ? "would mark" : "marked"} ${n} row(s)  ${w.runId}  [${w.from} .. ${w.to}]` +
      (n === 0 ? "  — matched nothing" : ""),
  );
}

const after = (await sql`
  SELECT
    COUNT(*) FILTER (WHERE run_class = 'ORGANIC')::int   AS organic,
    COUNT(*) FILTER (WHERE run_class = 'SYNTHETIC')::int AS synthetic,
    COUNT(*) FILTER (WHERE run_class = 'UNKNOWN')::int   AS unknown,
    COUNT(*)::int                                        AS total
  FROM search_log
`) as { organic: number; synthetic: number; unknown: number; total: number }[];

console.log(
  `after:  ${after[0].organic} organic, ${after[0].synthetic} synthetic, ` +
    `${after[0].unknown} unknown, ${after[0].total} total` +
    (DRY ? "  (dry run — nothing written)" : ""),
);
console.log(
  `${windows.length} window(s) in docs/synthetic-runs.md; ${marked} row(s) ${DRY ? "would be " : ""}attributed. ` +
    `The remaining ${after[0].unknown} unknown row(s) are excluded from every aggregate — ` +
    `an unattributable row is never counted as a reader.`,
);
