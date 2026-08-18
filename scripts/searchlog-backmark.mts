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
 * It is idempotent, and it operates on `UNKNOWN` and `ORGANIC` rows but never
 * on a row already marked `SYNTHETIC` — re-attributing an attributed row would
 * let the last window to run win an argument the evidence should settle.
 *
 * ## Why it may correct an ORGANIC row, which was not the first design
 *
 * The first version refused to touch `ORGANIC` on the reasoning that a row
 * which declared itself at write time is already correct. Within an hour of
 * shipping, the g6 session verified the deploy with eight polls that did not
 * send the header, and seven rows landed marked `ORGANIC` — our own robot,
 * labelled a reader, in the store we sell.
 *
 * The reasoning was wrong because there is no such thing in the data as a row
 * that declared ORGANIC. `ORGANIC` is what the column DEFAULTS to. A row that
 * said nothing and a row that said "reader" are byte-identical, so "never
 * overwrite a declaration" was protecting a declaration that does not exist.
 *
 * The risk of allowing the correction is that a badly drawn window excludes
 * real readers. That errs toward exclusion, which is the direction every
 * decision in C05 errs in on purpose: an undercount stated honestly is a
 * smaller number, an overcount is a false claim about a district. The
 * protection that actually matters is on the window, not the row — every entry
 * in the ledger carries evidence, and a window without evidence is a guess and
 * does not belong in the file.
 *
 * ## The AUTHOR class, added 2026-08-17
 *
 * A window now declares WHICH class it writes. `SYNTHETIC` is a robot;
 * `AUTHOR` is the author using his own product, attributed on his own
 * statement about his own traffic — which is not the inference C05 forbids,
 * because nothing is being guessed from a user agent or a timing pattern. It
 * is excluded from every aggregate exactly as `SYNTHETIC` is; it exists so the
 * exclusion can carry its reason instead of calling a human session a script.
 *
 * ## Which database, said out loud
 *
 * `.env.local`'s `DATABASE_URL` now points at a LOCAL Neon branch (R34), so
 * the default target is local and a run against production is an explicit act:
 * `--target=production` resolves the ONE sanctioned production write handle
 * through `lib/db/write-handle.ts`. The target is printed by role and host on
 * every run, because a backmark against the wrong database is a silent no-op
 * that reports success.
 *
 * Until 2026-08-17 this script read `WTP_PRODUCTION_DATABASE_URL_READONLY` for
 * that target — a variable whose name says read, used as this repo's actual
 * write path to production. It is now refused by name (g11), whatever it
 * happens to contain, and this script asks for the write variable by its own
 * name instead.
 *
 * Run: `pnpm searchlog:backmark` (needs DATABASE_URL). `--dry` prints the
 * counts and writes nothing. `--target=production` writes to production.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { config as loadEnv } from "dotenv";
import { neon } from "@neondatabase/serverless";

import { resolveProductionWriteHandle, WriteHandleRefused } from "../lib/db/write-handle.ts";

loadEnv({ path: join(process.cwd(), ".env.local") });

const DRY = process.argv.includes("--dry");
const PRODUCTION = process.argv.includes("--target=production");

let connection: string;
let which: string;

if (PRODUCTION) {
  try {
    const handle = resolveProductionWriteHandle();
    connection = handle.connection;
    which = handle.variable;
  } catch (error) {
    if (error instanceof WriteHandleRefused) {
      console.error(`searchlog:backmark: REFUSED — ${error.message}`);
      process.exit(1);
    }
    throw error;
  }
} else {
  const local = process.env.DATABASE_URL;
  which = "DATABASE_URL";
  if (!local) {
    console.error(`searchlog:backmark: ${which} is not set — refusing to guess`);
    process.exit(1);
  }
  connection = local;
}

// Named, never assumed. A backmark against the wrong database updates nothing
// and prints a clean run, which is the empty-success shape this repo keeps
// finding; saying which host was touched is what makes the run checkable.
{
  const u = new URL(connection);
  console.log(
    `target: ${which}  role=${u.username}  host=${u.hostname}  ` +
      `WTP_DB_ROLE=${JSON.stringify(process.env.WTP_DB_ROLE ?? null)}`,
  );
}

type RunClass = "SYNTHETIC" | "AUTHOR";

const sql = neon(connection);

interface Window {
  runId: string;
  from: string;
  to: string;
  runClass: RunClass;
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
    if (/^-+$/.test(cells[0]) || cells[0] === "runId") continue;
    if (cells.length < 5) {
      throw new Error(
        `docs/synthetic-runs.md: row "${cells[0]}" has ${cells.length} cells — the class column ` +
          `is required and has no default, because a row nobody classified must not quietly ` +
          `become SYNTHETIC`,
      );
    }
    const runId = cells[0].replace(/^`|`$/g, "");
    const from = cells[1];
    const to = cells[2];
    const runClass = cells[3];
    if (runClass !== "SYNTHETIC" && runClass !== "AUTHOR") {
      throw new Error(
        `docs/synthetic-runs.md: window "${runId}" declares class "${runClass}" — ` +
          `only SYNTHETIC and AUTHOR may be written by a backmark`,
      );
    }
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
    windows.push({ runId, from, to, runClass });
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
    COUNT(*) FILTER (WHERE run_class = 'AUTHOR')::int    AS author,
    COUNT(*)::int                                        AS total
  FROM search_log
`) as {
  organic: number;
  synthetic: number;
  unknown: number;
  author: number;
  total: number;
}[];

console.log(
  `before: ${before[0].organic} organic, ${before[0].synthetic} synthetic, ` +
    `${before[0].unknown} unknown, ${before[0].author} author, ${before[0].total} total`,
);

let marked = 0;
for (const w of windows) {
  // Not already IN THIS WINDOW'S OWN CLASS — idempotent, and it will not
  // re-attribute a row another window already settled. See the header for why
  // ORGANIC is in scope: it is the column's DEFAULT, so a row that said
  // nothing and a row that said "reader" are byte-identical, and the first
  // version of this script was protecting a declaration that does not exist.
  //
  // The exclusion is the window's OWN class rather than a hardcoded
  // 'SYNTHETIC', which used to be the same thing and stopped being when the
  // AUTHOR class arrived: an author window against a table of synthetic rows
  // would otherwise have rewritten every one of them.
  const rows = DRY
    ? ((await sql`
        SELECT COUNT(*)::int AS n FROM search_log
        WHERE run_class NOT IN ('SYNTHETIC', 'AUTHOR')
          AND occurred_at >= ${w.from}::timestamptz
          AND occurred_at <= ${w.to}::timestamptz
      `) as { n: number }[])
    : ((await sql`
        UPDATE search_log
        SET run_class = ${w.runClass}, run_id = ${w.runId}
        WHERE run_class NOT IN ('SYNTHETIC', 'AUTHOR')
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
    `  ${DRY ? "would mark" : "marked"} ${n} row(s) ${w.runClass}  ${w.runId}  ` +
      `[${w.from} .. ${w.to}]` + (n === 0 ? "  — matched nothing" : ""),
  );
}

const after = (await sql`
  SELECT
    COUNT(*) FILTER (WHERE run_class = 'ORGANIC')::int   AS organic,
    COUNT(*) FILTER (WHERE run_class = 'SYNTHETIC')::int AS synthetic,
    COUNT(*) FILTER (WHERE run_class = 'UNKNOWN')::int   AS unknown,
    COUNT(*) FILTER (WHERE run_class = 'AUTHOR')::int    AS author,
    COUNT(*)::int                                        AS total
  FROM search_log
`) as {
  organic: number;
  synthetic: number;
  unknown: number;
  author: number;
  total: number;
}[];

console.log(
  `after:  ${after[0].organic} organic, ${after[0].synthetic} synthetic, ` +
    `${after[0].unknown} unknown, ${after[0].author} author, ${after[0].total} total` +
    (DRY ? "  (dry run — nothing written)" : ""),
);
const unaccounted =
  after[0].total -
  (after[0].organic + after[0].synthetic + after[0].unknown + after[0].author);
if (unaccounted !== 0) {
  console.log(
    `WARNING: ${unaccounted} row(s) are in a class this census does not name — ` +
      `the counts do not reconcile against the total.`,
  );
}
console.log(
  `${windows.length} window(s) in docs/synthetic-runs.md; ${marked} row(s) ${DRY ? "would be " : ""}attributed. ` +
    `The remaining ${after[0].unknown} unknown row(s) are excluded from every aggregate — ` +
    `an unattributable row is never counted as a reader.`,
);
