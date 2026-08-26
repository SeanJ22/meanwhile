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
if (!runId || !repo) cannotRun("GITHUB_RUN_ID or GITHUB_REPOSITORY is not set, so there is no run to read");

let logText: string;
try {
  logText = execFileSync("gh", ["api", `repos/${repo}/actions/runs/${runId}/logs`, "--cache", "0s"], {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    env: { ...process.env, GH_PROMPT: "disabled", GIT_TERMINAL_PROMPT: "0" },
    timeout: 120_000,
  });
} catch {
  // The logs endpoint returns a zip redirect and `gh api` will not always
  // follow it. Fall back to the per-job text, which is what a reader sees.
  try {
    logText = execFileSync("gh", ["run", "view", runId, "--log-failed"], {
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
      env: { ...process.env, GH_PROMPT: "disabled", GIT_TERMINAL_PROMPT: "0" },
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
