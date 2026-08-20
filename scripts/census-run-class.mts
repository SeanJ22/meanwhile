/**
 * `pnpm census:runs` — the production run-id census the standing report has
 * asked for every session, printed by an instrument instead of assembled by
 * hand (g11, 2026-08-17).
 *
 * ## Why this exists as a script
 *
 * The report format requires a session to state how many rows it landed in
 * the sold store and how many of the table's rows are readers. Until now that
 * number was assembled per session — g10 could not take it at all, because no
 * variable reached production, and reported it as COULD NOT READ. A number a
 * session hand-assembles is a number a session can hand-assemble differently,
 * and this table is the one the business sells.
 *
 * So the census is a command. It prints:
 *
 *   1. the connection it read, role and host first, because a census against
 *      the wrong database returns plausible numbers about someone else's rows;
 *   2. the whole-table run-class census from `runClassCensusQuery()`, the one
 *      read whose job is to describe the table including the part that is
 *      ours, with the reconciliation stated (`organic + synthetic + unknown +
 *      author` must equal `total`, and a mismatch is printed as a FAIL rather
 *      than smoothed);
 *   3. the ORGANIC denominator sentence, in the exact words every export
 *      carries;
 *   4. a per-`run_id` breakdown of the automated rows, newest first, so a
 *      session's own rows are attributable by name;
 *   5. the same census for the feedback store, which carries the identical
 *      `run_class` / `run_id` pair.
 *
 * ## Zero is a claim, and so is a failure
 *
 * A read that cannot run prints COULD NOT READ with the database's own words
 * and exits non-zero. It never prints 0 — an unreadable census reported as
 * zero is the empty-success shape this repo keeps finding, and here it would
 * read as "no readers used the product", which is a claim about the business.
 *
 * Run: `pnpm census:runs [--target=production] [--since=YYYY-MM-DD]`
 */
import { join } from "node:path";

import { config as loadEnv } from "dotenv";
import { neon } from "@neondatabase/serverless";

import { organicDenominatorSentence } from "../lib/signal/search-log-reads.ts";

loadEnv({ path: join(process.cwd(), ".env.local") });

const PRODUCTION = process.argv.includes("--target=production");
const since = process.argv
  .find((a) => a.startsWith("--since="))
  ?.slice("--since=".length);

const which = PRODUCTION ? "WTP_PRODUCTION_DATABASE_URL_READONLY" : "DATABASE_URL";
const connection = PRODUCTION
  ? process.env.WTP_PRODUCTION_DATABASE_URL_READONLY
  : process.env.DATABASE_URL;

if (!connection) {
  console.error(
    `census:runs: COULD NOT READ — ${which} is not set. This is not a census of zero rows; ` +
      `it is the absence of a handle to count them with.`,
  );
  process.exit(1);
}

{
  const u = new URL(connection);
  console.log(
    `target: ${which}  role=${u.username}  host=${u.hostname}  ` +
      `WTP_DB_ROLE=${JSON.stringify(process.env.WTP_DB_ROLE ?? null)}` +
      `${since ? `  since=${since}` : ""}\n`,
  );
}

const sql = neon(connection);

interface CensusRow {
  organic: string | number;
  synthetic: string | number;
  unknown: string | number;
  author: string | number;
  total: string | number;
}

const n = (v: string | number) => Number(v);

/**
 * Which column dates a row, per table. `reactions` joined 2026-08-19 (item
 * 0D) and dates on `occurred_at` like the search log; `feedback` is the odd
 * one with `received_at`. Named in ONE place, because a per-call ternary is
 * how the third table quietly gets the second table's column.
 */
const timeColumn = (table: "search_log" | "feedback" | "reactions") =>
  table === "feedback" ? "received_at" : "occurred_at";

async function censusOf(table: "search_log" | "feedback" | "reactions") {
  const rows = (await sql`
    SELECT
      COUNT(*) FILTER (WHERE run_class = 'ORGANIC')   AS organic,
      COUNT(*) FILTER (WHERE run_class = 'SYNTHETIC') AS synthetic,
      COUNT(*) FILTER (WHERE run_class = 'UNKNOWN')   AS unknown,
      COUNT(*) FILTER (WHERE run_class = 'AUTHOR')    AS author,
      COUNT(*)                                        AS total
    FROM ${sql.unsafe(table)}
  `) as CensusRow[];
  const r = rows[0];
  return {
    organic: n(r.organic),
    synthetic: n(r.synthetic),
    unknown: n(r.unknown),
    author: n(r.author),
    total: n(r.total),
  };
}

let failed = false;

for (const table of ["search_log", "feedback", "reactions"] as const) {
  console.log(`── ${table} ──`);
  let c;
  try {
    c = await censusOf(table);
  } catch (error) {
    // A failed retrieval reported as a failed retrieval, never as an absence.
    console.log(
      `  COULD NOT READ — ${(error as Error).message.slice(0, 160)}\n` +
        `  This is not zero rows. No number from this table may be quoted from this run.\n`,
    );
    failed = true;
    continue;
  }

  const accounted = c.organic + c.synthetic + c.unknown + c.author;
  console.log(
    `  organic ${c.organic} · synthetic ${c.synthetic} · unknown ${c.unknown} · ` +
      `author ${c.author} · TOTAL ${c.total}`,
  );
  if (accounted === c.total) {
    console.log(`  RECONCILES  ${accounted} accounted of ${c.total} rows`);
  } else {
    console.log(
      `  DOES NOT RECONCILE  ${accounted} accounted of ${c.total} rows — ` +
        `${c.total - accounted} row(s) carry a run_class the census has no column for.`,
    );
    failed = true;
  }
  console.log(`  ${organicDenominatorSentence(c)}`);

  interface RunRow {
    run_id: string | null;
    run_class: string;
    rows: string | number;
    first_at: string;
    last_at: string;
  }
  const runs = (await sql`
    SELECT run_id, run_class, COUNT(*) AS rows,
           MIN(${sql.unsafe(timeColumn(table))}) AS first_at,
           MAX(${sql.unsafe(timeColumn(table))}) AS last_at
    FROM ${sql.unsafe(table)}
    WHERE run_class <> 'ORGANIC'
      AND (${since ?? null}::text IS NULL
           OR ${sql.unsafe(timeColumn(table))}
              >= ${since ?? null}::timestamptz)
    GROUP BY run_id, run_class
    ORDER BY MAX(${sql.unsafe(timeColumn(table))}) DESC
  `) as RunRow[];

  console.log(`\n  non-organic rows by run id: ${runs.length} distinct run(s)`);
  if (runs.length === 0) console.log("    (none)");
  for (const r of runs) {
    console.log(
      `    ${String(n(r.rows)).padStart(5)}  ${r.run_class.padEnd(9)}  ` +
        `${r.run_id ?? "(no run id — UNKNOWN, unattributable)"}\n` +
        `           ${new Date(r.first_at).toISOString()} → ${new Date(r.last_at).toISOString()}`,
    );
  }
  console.log("");
}

if (failed) {
  console.error("census:runs: at least one table could not be censused or did not reconcile.");
  process.exit(1);
}
