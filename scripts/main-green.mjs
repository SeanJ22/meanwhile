#!/usr/bin/env node
/**
 * Is `origin/main`'s TIP green on GitHub?
 *
 * NJ Hunt 3, item 1.6 (2026-08-22). A session may not report clean gates while
 * leaving `main` failing and production stale — and on 2026-08-22 exactly that
 * happened. NJ Hunt 2 ran its gates, shipped `ab05f45` through PR #149, watched
 * build check #195 go green on the merge `78b0c10`, and then wrote two CLOSE-OUT
 * commits — `6fb14e4` and `be40ad9` — straight to `main`. One of them carried a
 * new `.mts` file with five `TS18046` sites. Checks #196 and #197 both failed,
 * Netlify refused both deploys at 'building site', and production stayed on the
 * 10:17 build for the rest of the day. The session closed reporting green.
 *
 * WHY THIS ASKS GITHUB RATHER THAN RUNNING THE GATE LOCALLY. Every local gate
 * this repo has answers a question about the WORKING TREE. The question that
 * went unasked is about the REMOTE BRANCH: whatever door a commit came through
 * — `--ship`, `pnpm closeout`, a bare `git push`, a scheduled refresh workflow
 * pushing through `scripts/push-main.mjs` — the tip of `main` is where it lands,
 * and only the server knows what happened to it there. A local check cannot see
 * a commit somebody else pushed, and cannot see a build that failed for a reason
 * the local tree does not reproduce. So this reads the verdict rather than
 * recomputing one.
 *
 * THE THREE STATES ARE KEPT APART, and that is the whole discipline here
 * (CLAUDE.md: a check that could not RUN must never print like a passing one,
 * and a walled source is not a broken job):
 *
 *   green    every completed check on the tip succeeded, and at least one ran.
 *   red      at least one completed check failed, was cancelled, or timed out.
 *   pending  checks are queued or in progress — NOT green, and NOT red.
 *   unknown  this script could not reach GitHub, or `gh` is not authenticated,
 *            or no check has ever been registered against that sha. It exits 2
 *            and says so. It NEVER reports green on an unanswered question.
 *
 * Usage:
 *   node scripts/main-green.mjs                 # origin/main's tip
 *   node scripts/main-green.mjs --sha <sha>     # any commit
 *   node scripts/main-green.mjs --wait [--timeout-seconds N]
 *   node scripts/main-green.mjs --json
 *
 * Exit codes:  0 green · 1 red · 2 could-not-tell · 3 still pending (with --wait
 * this means the timeout expired, which is a could-not-tell about the future and
 * is deliberately not 0).
 */

import { spawnSync } from "node:child_process";

const REPO = "SeanJ22/we-the-people";
const POLL_SECONDS = 20;

/** A verdict this script is willing to print. */
export const GREEN = "green";
export const RED = "red";
export const PENDING = "pending";
export const UNKNOWN = "unknown";

function opt(argv, name) {
  const i = argv.indexOf(name);
  return i === -1 ? undefined : argv[i + 1];
}

function run(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: "utf8", shell: false });
  if (r.error || r.status !== 0) return null;
  return (r.stdout ?? "").trim();
}

/**
 * Resolve the sha whose checks are being asked about.
 *
 * `git fetch` first, deliberately: the local `origin/main` ref is a cache, and
 * the failure this script exists to catch is one that happened AFTER the last
 * time this clone talked to the remote. Reading a stale ref would answer about
 * the wrong commit and answer green.
 */
export function resolveMainSha({ fetch = true } = {}) {
  if (fetch) run("git", ["fetch", "origin", "main", "--quiet"]);
  return run("git", ["rev-parse", "origin/main"]);
}

/**
 * Turn GitHub's check-run list into one of the four verdicts.
 *
 * Split out from the fetch so it is testable without a network — the states
 * that matter are the ones that are awkward to produce on demand.
 */
export function verdictFromCheckRuns(checkRuns) {
  if (!Array.isArray(checkRuns) || checkRuns.length === 0) {
    return {
      verdict: UNKNOWN,
      why: "no check has ever been registered against this commit — that is not the same as passing",
      failed: [],
      pending: [],
    };
  }

  const pending = checkRuns
    .filter((c) => c.status !== "completed")
    .map((c) => c.name);

  // `neutral` and `skipped` are completed-and-not-failing. Everything else that
  // completed without success is a failure, including `cancelled` and
  // `timed_out` — a job GitHub killed at six hours told us nothing good.
  const failed = checkRuns
    .filter(
      (c) =>
        c.status === "completed" &&
        !["success", "neutral", "skipped"].includes(c.conclusion),
    )
    .map((c) => `${c.name} (${c.conclusion ?? "no conclusion"})`);

  if (failed.length > 0) {
    return { verdict: RED, why: `${failed.length} check(s) failing`, failed, pending };
  }
  if (pending.length > 0) {
    return { verdict: PENDING, why: `${pending.length} check(s) still running`, failed, pending };
  }
  return { verdict: GREEN, why: `${checkRuns.length} check(s) passed`, failed, pending };
}

/** Ask GitHub. Returns `null` when the question could not be put. */
export function fetchCheckRuns(sha) {
  const out = run("gh", [
    "api",
    `repos/${REPO}/commits/${sha}/check-runs`,
    "--jq",
    "[.check_runs[] | {name, status, conclusion}]",
  ]);
  if (out === null) return null;
  try {
    return JSON.parse(out);
  } catch {
    return null;
  }
}

export function checkSha(sha) {
  const runs = fetchCheckRuns(sha);
  if (runs === null) {
    return {
      sha,
      verdict: UNKNOWN,
      why: "could not reach GitHub (gh missing, unauthenticated, or offline) — this says NOTHING about main",
      failed: [],
      pending: [],
    };
  }
  return { sha, ...verdictFromCheckRuns(runs) };
}

const EXIT = { [GREEN]: 0, [RED]: 1, [UNKNOWN]: 2, [PENDING]: 3 };

async function main() {
  const argv = process.argv.slice(2);
  const json = argv.includes("--json");
  const wait = argv.includes("--wait");
  const timeout = Number(opt(argv, "--timeout-seconds") ?? 900);

  const sha = opt(argv, "--sha") ?? resolveMainSha();
  if (!sha) {
    const result = {
      sha: null,
      verdict: UNKNOWN,
      why: "no origin/main to resolve — cannot tell",
      failed: [],
      pending: [],
    };
    console.log(json ? JSON.stringify(result) : `main: CANNOT TELL — ${result.why}`);
    process.exit(2);
  }

  const deadline = Date.now() + timeout * 1000;
  let result = checkSha(sha);
  while (wait && result.verdict === PENDING && Date.now() < deadline) {
    if (!json) console.log(`main ${sha.slice(0, 7)}: ${result.why} — waiting…`);
    await new Promise((r) => setTimeout(r, POLL_SECONDS * 1000));
    result = checkSha(sha);
  }

  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    const label = {
      [GREEN]: "GREEN",
      [RED]: "RED",
      [PENDING]: "PENDING",
      [UNKNOWN]: "CANNOT TELL",
    }[result.verdict];
    console.log(`main ${sha.slice(0, 7)}: ${label} — ${result.why}`);
    for (const f of result.failed) console.log(`  failing: ${f}`);
    for (const p of result.pending) console.log(`  running: ${p}`);
  }
  process.exit(EXIT[result.verdict]);
}

// Importable for the guard test without running the CLI.
if (process.argv[1] && process.argv[1].endsWith("main-green.mjs")) {
  await main();
}
