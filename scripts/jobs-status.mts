/**
 * WHAT EVERY SCHEDULED JOB IS ACTUALLY DOING, AS A TABLE.
 * (2026-08-26, Item 8b(b) of the sources-and-incumbency brief.)
 *
 * **Produced automatically rather than by opening the Actions tab**, because
 * the Actions tab shows the LAST OUTCOME and the number that matters is
 * DAYS SINCE LAST SUCCESS. A job that has failed silently for a week and a job
 * that ran an hour ago and failed once both print `failure`, and those are
 * completely different situations.
 *
 * Reads GitHub. Prints one row per scheduled workflow. Exits 0 whatever it
 * finds — this REPORTS, it does not gate, and a status table that could fail a
 * build would eventually be removed from the build rather than read.
 *
 * The one exception is RULING 159: reading ZERO workflows is a broken run, not
 * a clean board, and that exits non-zero.
 *
 * Usage:  pnpm jobs:status [--limit N] [--json]
 */

import { execFileSync } from "node:child_process";

import { renderStandings, standingFor, type JobStanding, type WorkflowRun } from "../lib/ops/job-watch.ts";

/**
 * The eight scheduled pushers plus nothing else. Named here rather than read
 * from the directory so a NEW workflow appearing is a diff somebody sees, and
 * so `build-check.yml` — which is not a scheduled job — cannot wander in.
 */
const WATCHED = [
  "refresh-daily.yml",
  "intake-tripwire.yml",
  "job-watch.yml",
  "refresh-meetings-snapshot.yml",
  "refresh-dotgov-snapshot.yml",
  "refresh-fec-snapshot.yml",
  "refresh-legiscan-snapshot.yml",
  "refresh-nj-filing.yml",
] as const;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const limit = Number(arg("limit") ?? 30);

function runsFor(workflow: string): WorkflowRun[] | null {
  try {
    const out = execFileSync(
      "gh",
      [
        "run",
        "list",
        "--workflow",
        workflow,
        "--limit",
        String(limit),
        "--json",
        "databaseId,conclusion,status,createdAt,event",
      ],
      {
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
        env: { ...process.env, GH_PROMPT: "disabled", GIT_TERMINAL_PROMPT: "0" },
        timeout: 120_000,
      },
    );
    return JSON.parse(out) as WorkflowRun[];
  } catch {
    return null;
  }
}

// The clock is called ONCE, here, by the program that ran — and handed to the
// pure reader. RULING 107: a run stamp comes from the caller, never from inside
// something that is supposed to be testable.
const asOf = new Date();

const rows: JobStanding[] = [];
const unreadable: string[] = [];

for (const workflow of WATCHED) {
  const runs = runsFor(workflow);
  if (runs === null) {
    // A workflow whose history could not be read is named separately and never
    // folded into the table as a healthy row (RULING 24, RULING 114).
    unreadable.push(workflow);
    continue;
  }
  rows.push(standingFor(workflow, runs, asOf));
}

if (rows.length === 0) {
  console.error(
    `jobs:status: read ZERO of ${WATCHED.length} watched workflows. That is a broken run, not a clean ` +
      "board (RULING 159). Check that `gh` is authenticated and that this repository has Actions enabled.",
  );
  process.exit(1);
}

if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ asOf: asOf.toISOString(), rows, unreadable }, null, 2));
} else {
  console.log(`jobs:status · ${rows.length} of ${WATCHED.length} scheduled workflows · read ${asOf.toISOString()}`);
  console.log("");
  console.log(renderStandings(rows));
  console.log("");
  const stale = rows.filter((r) => r.daysSinceLastSuccess === null || r.daysSinceLastSuccess > 2);
  if (stale.length > 0) {
    console.log("NO SUCCESSFUL RUN IN THE LAST TWO DAYS:");
    for (const r of stale) {
      console.log(
        `  ${r.workflow} — ${
          r.daysSinceLastSuccess === null
            ? `no success in the last ${r.runsRead} completed run(s)`
            : `${r.daysSinceLastSuccess} day(s) since it last worked`
        }`,
      );
    }
    console.log("");
  }
  if (unreadable.length > 0) {
    console.log(`COULD NOT READ (${unreadable.length}), named rather than counted as healthy:`);
    for (const w of unreadable) console.log(`  ${w}`);
    console.log("");
  }
}
