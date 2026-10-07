/**
 * The failure-path step of a workflow job: reads the job's own log and names
 * what killed it, using the class list in `lib/ops/failure-classes.ts`.
 *
 * It never fails the job it is diagnosing: every internal problem prints as a
 * CANNOT RUN line and exits 0.
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

/** The logs endpoint answers with a ZIP archive; a zip or anything carrying a NUL is not log text. */
function asLogText(bytes: Buffer): string | null {
  const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04];
  if (bytes.length >= 4 && ZIP_MAGIC.every((b, i) => bytes[i] === b)) return null;
  const text = bytes.toString("utf8");
  // An escape, never a literal NUL byte, which would make this file read as binary.
  return text.includes("\u0000") ? null : text;
}

const GH_ENV = { ...process.env, GH_PROMPT: "disabled", GIT_TERMINAL_PROMPT: "0" };

let logText: string | null = null;

/**
 * A job cannot read its own log from the API while it is still running, so the
 * step that runs the suite tees its output to the file named in `WTP_JOB_LOG`,
 * read first. The API paths are the fallback.
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
  cannotRun("the run log came back EMPTY, which is not the same as a job with no failure in it");
}

const result = diagnose(logText, lines.slice(-50));
log("");
log("─".repeat(78));
log(result.message);
log("─".repeat(78));
log("");
