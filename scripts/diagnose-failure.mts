/**
 * THE STEP EVERY WORKFLOW ENDS WITH, ON THE FAILURE PATH.
 * (2026-08-26, Item 8a of the sources-and-incumbency brief.)
 *
 * Reads this job's own log from the Actions API and names what killed it, using
 * the class list in `lib/ops/failure-classes.ts`. Prints the class and the
 * remedy in plain words, or says loudly that the failure is unrecognised and
 * shows what it saw.
 *
 * It NEVER fails the job it is diagnosing — the job is already red and a
 * diagnoser that could turn a red run into a differently-red run would hide the
 * cause it exists to name. Every internal problem prints as a CANNOT RUN line
 * and exits 0 (RULING 24).
 *
 * Usage, as the last step of a workflow job:
 *
 *   - name: Name the cause
 *     if: failure()
 *     env:
 *       GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
 *     run: corepack pnpm diagnose
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

import { diagnose } from "../lib/ops/failure-classes.ts";

function log(line: string): void {
  process.stdout.write(`${line}\n`);
}

function cannotRun(why: string): never {
  log("");
  log(`diagnose: CANNOT RUN — ${why}`);
  log("  The job's own failure is above. This step could not read the log to name it, which is a");
  log("  fact about this step and not about the failure.");
  log("");
  process.exit(0);
}

const runId = process.env.GITHUB_RUN_ID;
const repo = process.env.GITHUB_REPOSITORY;
if ((!runId || !repo) && !process.env.WTP_JOB_LOG?.trim()) {
  cannotRun("GITHUB_RUN_ID or GITHUB_REPOSITORY is not set and WTP_JOB_LOG names no file, so there is no log to read");
}

/**
 * **A ZIP IS NOT A LOG** (2026-08-28, proving the `actions: read` fix).
 *
 * The logs endpoint answers with a ZIP ARCHIVE, and `gh api` hands its bytes
 * straight back. Read with `encoding: "utf8"` those bytes become a string, the
 * string is non-empty, and every check below it passes on garbage: the
 * diagnoser then reports `THIS FAILURE IS NOT ONE THIS REPOSITORY RECOGNISES`
 * and prints five screens of mojibake as "the last lines this reader saw".
 *
 * That was invisible until now for a precise reason. The workflow token had no
 * Actions read, so this call ALWAYS threw 403 and the fallback always ran. With
 * the permission granted the primary path starts succeeding — and succeeding is
 * how it produces the wrong answer. Verified against run 33211710028: the
 * response begins `50 4b 03 04`, the ZIP magic.
 *
 * So the response is read as BYTES and asked whether it is text at all. A zip,
 * or anything carrying a NUL, is not — and an unreadable primary is not a
 * result, it is a reason to use the fallback that returns what a person sees.
 */
function asLogText(bytes: Buffer): string | null {
  const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04];
  if (bytes.length >= 4 && ZIP_MAGIC.every((b, i) => bytes[i] === b)) return null;
  const text = bytes.toString("utf8");
  // The NUL test is written as an ESCAPE, never as a literal byte: a source file
  // carrying a real NUL is classified binary and skipped by every repo sweep,
  // so the guard would stop being able to see this file at all.
  return text.includes("\u0000") ? null : text;
}

const GH_ENV = { ...process.env, GH_PROMPT: "disabled", GIT_TERMINAL_PROMPT: "0" };

let logText: string | null = null;

/**
 * **A JOB CANNOT READ ITS OWN LOG FROM THE API WHILE IT IS STILL RUNNING**
 * (2026-09-02, runs 33517560447 and 33636708298).
 *
 * Both runs died at `Validate before committing` and both ended with
 * `diagnose: CANNOT RUN — the run log could not be read (Command failed: gh run
 * view <id> --log-failed)`. The API's own words, one line above: `run <id> is
 * still in progress; logs will be available when it is complete`. The `Name
 * the cause` step runs INSIDE the job it diagnoses, so the run is in progress
 * by construction, and every read below answered 404 or "in progress" — the
 * `actions: read` grant of 2026-08-28 fixed the permission and could not fix
 * the timing.
 *
 * So the step that runs the suite tees what it prints to a file and names it
 * in `WTP_JOB_LOG`. That file is read FIRST. The API paths stay as the fallback
 * for a workflow that does not tee, and for a failure that happened before the
 * teeing step ran.
 */
const localLog = process.env.WTP_JOB_LOG?.trim();
if (localLog && existsSync(localLog)) {
  const text = readFileSync(localLog, "utf8");
  if (text.trim().length > 0) {
    logText = text;
    log(`diagnose: reading the job's own log from ${localLog} (${text.length} chars) — the API cannot serve a run's log while the run is in progress`);
  } else {
    log(`diagnose: WTP_JOB_LOG names ${localLog} and it is EMPTY — the failing step wrote nothing there; falling back to the API`);
  }
}

if (logText === null && (!runId || !repo)) {
  cannotRun("no local job log could be read and GITHUB_RUN_ID or GITHUB_REPOSITORY is not set, so there is no run to read");
}

if (logText === null) {
  try {
    const bytes = execFileSync("gh", ["api", `repos/${repo}/actions/runs/${runId}/logs`, "--cache", "0s"], {
      maxBuffer: 256 * 1024 * 1024,
      env: GH_ENV,
      timeout: 120_000,
    });
    logText = asLogText(bytes);
    if (logText === null) {
      log("diagnose: the logs endpoint answered with an archive rather than text — reading the job log instead");
    }
  } catch {
    /* 403, a redirect gh would not follow, a network failure — all the same here. */
  }
}

if (logText === null) {
  // The per-job text, which is what a reader sees in the Actions UI.
  try {
    logText = execFileSync("gh", ["run", "view", String(runId), "--log-failed"], {
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
      env: GH_ENV,
      timeout: 120_000,
    });
  } catch (e) {
    cannotRun(`the run log could not be read (${e instanceof Error ? e.message.split("\n")[0] : String(e)})`);
  }
}

const lines = logText.split(/\r?\n/).filter((l) => l.trim().length > 0);
if (lines.length === 0) {
  // RULING 159 — zero is a result that must be EARNED. An empty log is not a
  // job with nothing wrong with it.
  cannotRun("the run log came back EMPTY, which is not the same as a job with no failure in it");
}

const result = diagnose(logText, lines.slice(-50));
log("");
log("─".repeat(78));
log(result.message);
log("─".repeat(78));
log("");
