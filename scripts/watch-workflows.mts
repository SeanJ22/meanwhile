/**
 * `pnpm watch:workflows` — **RULING 56: a scheduled job that fails tells
 * someone.** (NH Hunt 3, 2026-08-21.)
 *
 * ## The shape this closes
 *
 * `Refresh meetings snapshot` and `Intake tripwire` were failing intermittently
 * — sometimes daily, sometimes twice a day — into a page nobody watches. That
 * is the `D73` shape exactly: a data path degrading with every light green.
 * Measured over the 8 days to 2026-08-21, the meetings refresh failed 14 of 36
 * runs. Nothing anywhere said so.
 *
 * At the current corpus that is a small number of missed meetings, absorbed by
 * carry-forward. At national volume the same rate is tens of thousands, and
 * carry-forward is exactly the mechanism that would keep it looking healthy —
 * stale rows with their original `collectedAt`, honest per row, and nobody
 * counting. **A failure rate that is tolerable now is catastrophic later, and
 * the time to fix it is before the volume arrives.**
 *
 * ## What this does
 *
 * Reads each watched workflow's recent runs from the GitHub Actions API. Where
 * the two most recent COMPLETED runs are both failures, it opens a **Needs
 * Sean** tracker row naming the job, both run ids, and the failing step.
 *
 * ## Two consecutive, not one
 *
 * One failure is often a wall — a host refusing on a schedule, a runner losing
 * a connection — and a row per wall would bury the queue in noise until nobody
 * read it, which is the failure mode this is built against. Two consecutive is
 * the cheapest available evidence that the cause is ours rather than the
 * world's. It is a heuristic and it is stated as one rather than dressed as a
 * diagnosis: the row says what was observed, and the diagnosis is Sean's or a
 * later session's.
 *
 * ## Why it opens a row rather than closing one
 *
 * RULING 37 cuts both ways. Only Sean closes a Needs Sean row; **sessions and
 * tooling OPEN them**, because routing something to his attention is our job
 * and he does not have to notice that something needs him. A watcher that
 * resolved its own rows when a job went green again would be the light-green
 * problem rebuilt one layer up.
 *
 * ## Idempotence
 *
 * A row already open for a workflow is not opened again — otherwise a job
 * failing for a week is seven identical rows. The check is on the working
 * store, by the marker below, before anything is written.
 *
 * ## Proving it fires, without breaking production to do it
 *
 * `--asof=<iso>` hides every run created after that instant, so the detector
 * can be held against a window whose outcome is already known. The meetings
 * refresh failed five times consecutively between 2026-08-19T13:10Z and
 * 2026-08-20T13:12Z, so:
 *
 *     pnpm watch:workflows --asof=2026-08-20T14:00:00Z
 *
 * must find it. That is a better proof than an induced failure: the failure is
 * real, the runs are real, and nothing has to be broken and reverted to
 * demonstrate a detector. `tests/watch-workflows.test.ts` pins the decision
 * itself against fixed run lists so the rule is guarded without a network.
 *
 * Run:
 *   pnpm watch:workflows              # report only, writes nothing
 *   pnpm watch:workflows --open       # open Needs Sean rows for what it found
 *   pnpm watch:workflows --asof=<iso> # as the watcher would have seen it then
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  completedRuns,
  failedTwiceConsecutively,
  failedTwiceInWindow,
  failureRate,
  type WorkflowRun,
} from "../lib/ops/job-watch.ts";

/** The scheduled workflows that push `main`, plus the tripwire. */
const WATCHED = [
  "intake-tripwire.yml",
  "refresh-meetings-snapshot.yml",
  "refresh-dotgov-snapshot.yml",
  "refresh-fec-snapshot.yml",
  "refresh-legiscan-snapshot.yml",
  // NJ Hunt 3 item 2.3: the county filing IS the ballot, so it refreshes daily
  // and is watched like every other scheduled job that pushes main.
  "refresh-nj-filing.yml",
] as const;

/**
 * How a row announces which workflow it belongs to, so the idempotence check
 * is an exact string rather than a fuzzy title match.
 */
const MARKER = (workflow: string): string => `[job-watch:${workflow}]`;

const OPEN = process.argv.includes("--open");
const asofArg = process.argv.find((a) => a.startsWith("--asof="));
const AS_OF = asofArg ? new Date(asofArg.slice("--asof=".length)) : undefined;
if (AS_OF && Number.isNaN(AS_OF.getTime())) {
  console.error(`watch:workflows: --asof is not a date: ${asofArg}`);
  process.exit(2);
}

type Run = WorkflowRun;

interface Finding {
  workflow: string;
  runs: Run[];
  failingStep: string;
  rate: { failures: number; completed: number };
  /** True when the pair is not at the head — it broke twice and recovered. */
  healed: boolean;
}

function gh(args: string[]): string {
  return execFileSync("gh", args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
}

/** The step that failed, so the row names it rather than only a run id. */
function failingStepOf(runId: number): string {
  try {
    const raw = gh([
      "run",
      "view",
      String(runId),
      "--json",
      "jobs",
      "--jq",
      '[.jobs[].steps[] | select(.conclusion=="failure") | .name] | join(", ")',
    ]).trim();
    return raw === "" ? "(no failing step named — the run died before a step reported)" : raw;
  } catch {
    // An operation that can return nothing is asked what it returned: this is
    // "could not read", which is not the same claim as "no step failed".
    return "(could not read the run's steps)";
  }
}

function recentRuns(workflow: string, limit = 40): Run[] {
  const raw = gh([
    "run",
    "list",
    `--workflow=${workflow}`,
    "--limit",
    String(limit),
    "--json",
    "databaseId,conclusion,status,createdAt",
  ]);
  return completedRuns(JSON.parse(raw) as Run[], AS_OF);
}

function openRowsMentioning(marker: string): boolean {
  const store = join(process.cwd(), "docs", "tracker-working.csv");
  if (!existsSync(store)) return false;
  // Read as text and search the whole file. A CSV parse would be tidier and
  // would also be a second thing that can be wrong about whether a row exists.
  return readFileSync(store, "utf8").includes(marker);
}

const findings: Finding[] = [];
const unreadable: string[] = [];

/**
 * Workflows whose non-zero exit means "the thing I watch for HAPPENED", not
 * "I could not run". Their red runs still count and still open a row on two
 * consecutive; the label is what stops a reader misreading the rate.
 */
const ALARM_CHANNELS = new Set(["intake-tripwire.yml"]);

for (const workflow of WATCHED) {
  let runs: Run[];
  try {
    runs = recentRuns(workflow);
  } catch (error) {
    // A workflow this run COULD NOT READ is reported separately from one that
    // is failing. An unreachable API is not a healthy job.
    unreadable.push(`${workflow}: ${(error as Error).message.split("\n")[0]}`);
    continue;
  }

  const rate = failureRate(runs);
  /*
   * **A RED TRIPWIRE IS THE ALARM WORKING** (NH Hunt 4, 2026-08-21, item 7).
   *
   * `intake-tripwire.yml` runs `pnpm alarms`, which exits NON-ZERO when a sold
   * store has refused a write in the window. So a failed run there does not
   * mean the job is broken — it means the alarm FIRED, which is the whole
   * reason the job exists. Both of its two failures to 2026-08-21 are that:
   * one names a refused `search_log` insert at 00:28Z on 2026-08-21.
   *
   * Printing it in the same column as a refresh that could not build is a
   * category error, and it is the kind that makes a rate meaningless — a real
   * alarm and a broken job look identical in "2 of 8". The counting is
   * unchanged, because two consecutive alarms deserve a row exactly as much as
   * two consecutive breakages do; only the LABEL is added, so a reader knows
   * which kind of red they are looking at.
   */
  const alarmChannel = ALARM_CHANNELS.has(workflow);
  console.log(
    `  ${workflow.padEnd(34)} ${rate.failures} ${alarmChannel ? "alarm(s) raised" : "failure(s)"} of ${rate.completed} completed run(s)` +
      (alarmChannel && rate.failures > 0
        ? "\n" +
          "".padEnd(36) +
          "a red run here is the ALARM firing, not the job breaking — read the run log for what a store refused"
        : ""),
  );

  /*
   * THE HEAD FIRST, THEN THE WHOLE WINDOW (NJ Hunt 3 item 1c, 2026-08-22).
   *
   * `failedTwiceConsecutively` answers "is this job broken RIGHT NOW", which is
   * the more urgent question and stays the one asked first. But this watcher
   * runs once a day, and on 2026-08-22 the meetings refresh failed at 01:25 and
   * 01:30 and recovered at 01:51 — so the 15:40 reading saw two successes,
   * passed, and opened nothing. A double failure that heals between two daily
   * readings was invisible to a detector that only ever looked at the head.
   *
   * `failedTwiceInWindow` looks at all of it. A healed pair still earns a row,
   * because nobody found out why it broke and the next occurrence starts from
   * the same nothing. The row says WHICH kind it is; the marker keeps it to one
   * row per workflow either way.
   */
  const atHead = failedTwiceConsecutively(runs);
  // Only scanned when the head is clean, so `healed` comes from the one
  // detector that computes it rather than from an `in` narrowing over a union.
  const inWindow = atHead ? null : failedTwiceInWindow(runs);
  const consecutive = atHead ?? inWindow;
  if (!consecutive) continue;

  findings.push({
    workflow,
    runs: [consecutive.newest, consecutive.previous],
    failingStep: failingStepOf(consecutive.newest.databaseId),
    rate,
    healed: inWindow?.healed ?? false,
  });
}

console.log("");
if (unreadable.length > 0) {
  console.log(`  COULD NOT READ ${unreadable.length} workflow(s) — not a clean board:`);
  for (const u of unreadable) console.log(`    ${u}`);
  console.log("");
}

if (findings.length === 0) {
  console.log("  no workflow has failed twice consecutively, at the head or anywhere in the window read.");
  process.exit(unreadable.length > 0 ? 2 : 0);
}

console.log(`  ${findings.length} workflow(s) failed TWICE CONSECUTIVELY:\n`);
const rows: Record<string, string>[] = [];

for (const f of findings) {
  const marker = MARKER(f.workflow);
  const ids = f.runs.map((r) => r.databaseId).join(" and ");
  console.log(`    ${f.workflow} — runs ${ids}`);
  console.log(`      failing step: ${f.failingStep}`);
  console.log(
    f.healed
      ? "      the pair is not at the head — it broke twice and has since recovered, and nobody found out why"
      : "      the pair is at the head — this job is failing right now",
  );

  if (openRowsMentioning(marker)) {
    console.log("      a row is already open for this workflow — not opening a second.\n");
    continue;
  }

  rows.push({
    Section: "needs-sean",
    Title: f.healed
      ? `${f.workflow} failed twice in a row and recovered unexamined`
      : `${f.workflow} has failed twice in a row`,
    "What this is":
      (f.healed
        ? `The scheduled job ${f.workflow} failed on two CONSECUTIVE runs ` +
          `(${ids}), both at: ${f.failingStep}, and has since gone green on its ` +
          "own. It is not broken right now. Nobody found out why it broke, so " +
          "the next occurrence starts from the same nothing — which is why this " +
          "is a row rather than a shrug. This watcher runs once a day and used " +
          "to read only the two most recent runs, so a double failure that " +
          "healed in between was invisible to it (NJ Hunt 3 item 1c). "
        : `The scheduled job ${f.workflow} failed on its two most recent runs ` +
          `(${ids}), both at: ${f.failingStep}. `) +
      `Over its last ${f.rate.completed} ` +
      `completed runs it has failed ${f.rate.failures} time(s). Two consecutive ` +
      "failures is evidence the cause is ours rather than a host refusing on a " +
      "schedule — a wall would not usually repeat exactly. RULING 56 opens this " +
      `automatically so a degrading data path is not a page nobody watches. ${marker}`,
    Priority: "P1",
    prefix: "JOB",
  });
  console.log("      -> Needs Sean row queued.\n");
}

if (rows.length === 0) {
  console.log("  every finding already has an open row. Nothing written.");
  process.exit(0);
}

if (!OPEN) {
  console.log(`  ${rows.length} row(s) would be opened. Re-run with --open to write them.`);
  process.exit(0);
}

const dir = mkdtempSync(join(tmpdir(), "job-watch-"));
const file = join(dir, "rows.json");
writeFileSync(file, JSON.stringify(rows, null, 2), "utf8");

// `tracker.mjs add` is the ONLY writer of the stores. Nothing here edits a CSV.
execFileSync("node", [join("scripts", "tracker.mjs"), "add", file, "--session=job-watch"], {
  stdio: "inherit",
});
