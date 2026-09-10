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
 * — a pull request merge, release tooling, or a bare `git push` — the tip of
 * `main` is where it lands,
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
/**
 * A run that NEVER STARTED, told apart from a run that FAILED.
 * (NJ Hunt 3, 2026-08-22 — found by using this tool on its first close-out.)
 *
 * All three checks on `d0e0e34` completed in three to four seconds with ZERO
 * steps recorded, twice, including an explicit re-run. Meanwhile `f20e1e9` —
 * twenty minutes earlier, differing only by documents and one capture script —
 * had passed all three, and the tree was green locally on every gate.
 *
 * GitHub reports `conclusion: failure` for that, and it is not wrong: the run
 * failed. But it is a failure of the CHECK, not of the TREE, and this script's
 * whole discipline is that those must never print the same way. Reporting a
 * runner that could not be allocated as "main is broken" would send a session
 * hunting a defect that does not exist, which is the mirror image of the
 * failure it was built to catch.
 *
 * **A completed job with no steps at all did not run.** A job that reaches even
 * its first step records that step, whatever happens next — so zero steps is
 * the signature, and the duration is corroboration rather than the test. It
 * reports CANNOT TELL, which is honest in both directions: it does not claim
 * the tree is broken, and it does not claim it is fine.
 */
export function neverStarted(check) {
  if (check.status !== "completed") return false;
  if (Array.isArray(check.steps) && check.steps.length > 0) return false;
  if (!Array.isArray(check.steps)) return false;
  const started = Date.parse(check.started_at ?? "");
  const done = Date.parse(check.completed_at ?? "");
  if (!Number.isFinite(started) || !Number.isFinite(done)) return true;
  return done - started < 15_000;
}

/**
 * `NH208` (2026-08-26, Item 8b(a2)) — THE LATEST RUN PER CHECK NAME, NEVER ALL
 * OF THEM.
 *
 * `build-check.yml` carries `concurrency: cancel-in-progress` on the ref, so a
 * re-run, a hand dispatch racing a late event-run, or two pushes seconds apart
 * leave SUPERSEDED runs on the commit with `conclusion: cancelled`. This file
 * counted every check-run, so one superseded cancellation made it report RED on
 * a commit that is fine — while **branch protection itself judges
 * `?filter=latest`**, which showed all three contexts `success`. A verifier
 * that disagrees with the thing it verifies is worse than no verifier.
 *
 * Observed on 2026-08-26 across four commits: three `Build check` runs on `main`
 * came back `cancelled` inside twenty minutes, each superseded by the next
 * push's run, and every one of them was a healthy commit.
 *
 * The tiebreak is `started_at`, then `completed_at`, then array position. A run
 * with NO `started_at` — the stillborn shape — never wins over one that started,
 * because "the runner was never allocated" must not be allowed to overwrite a
 * real verdict from the same context.
 */
export function latestPerName(checkRuns) {
  const best = new Map();
  for (let i = 0; i < checkRuns.length; i += 1) {
    const c = checkRuns[i];
    const prior = best.get(c.name);
    if (prior === undefined) {
      best.set(c.name, { check: c, index: i });
      continue;
    }
    const started = (x) => Date.parse(x.started_at ?? "") || 0;
    const completed = (x) => Date.parse(x.completed_at ?? "") || 0;
    const priorStillborn = neverStarted(prior.check);
    const thisStillborn = neverStarted(c);
    if (priorStillborn !== thisStillborn) {
      if (priorStillborn) best.set(c.name, { check: c, index: i });
      continue;
    }
    const byStart = started(c) - started(prior.check);
    const byEnd = completed(c) - completed(prior.check);
    if (byStart > 0 || (byStart === 0 && byEnd > 0) || (byStart === 0 && byEnd === 0 && i > prior.index)) {
      best.set(c.name, { check: c, index: i });
    }
  }
  return [...best.values()].map((v) => v.check);
}

export function verdictFromCheckRuns(allCheckRuns) {
  const checkRuns = Array.isArray(allCheckRuns) ? latestPerName(allCheckRuns) : allCheckRuns;
  if (!Array.isArray(checkRuns) || checkRuns.length === 0) {
    return {
      verdict: UNKNOWN,
      why: "no check has ever been registered against this commit — that is not the same as passing",
      failed: [],
      pending: [],
    };
  }

  /*
   * A-008 (external correctness audit of `336a3eb`, remediated 2026-08-24).
   *
   * This block used to discard the stillborn list unless EVERY check was
   * stillborn, and the success path at the bottom then returned GREEN. So one
   * check that passed with steps beside one required check that completed
   * having executed nothing read as `green · 2 check(s) passed` — a count that
   * was itself wrong, since one of the two passed.
   *
   * That is the exact failure this file was written to end, pointed the other
   * way: the first version reported a runner GitHub could not allocate as a
   * broken tree, and the correction over-swung into reporting it as a healthy
   * one. **Both are the same defect — a check that could not reach its subject
   * printing like a verdict about the subject.**
   *
   * The stillborn list is therefore computed once, kept, and consulted on the
   * way to every verdict below rather than only on the all-stillborn path.
   */
  const stillborn = checkRuns.filter(neverStarted).map((c) => c.name);
  if (stillborn.length > 0 && stillborn.length === checkRuns.length) {
    return {
      verdict: UNKNOWN,
      why:
        `all ${stillborn.length} check(s) completed with NO STEPS — the runners never started, so this ` +
        "says NOTHING about the tree. Usually an Actions minutes or spending cap, or a runner " +
        "allocation failure; it is a WALL, not a JOB",
      failed: [],
      pending: [],
      neverStarted: stillborn,
    };
  }

  const pending = checkRuns
    .filter((c) => c.status !== "completed")
    .map((c) => c.name);

  /*
   * A CANCELLED CHECK IS UNKNOWN, NEVER PASS AND NEVER RED. (2026-08-26.)
   *
   * `cancelled` is the one conclusion that means *this check did not finish
   * asking its question*. Five commits landed on `main` in two minutes on
   * 2026-08-26 and every one of their checks was killed by the next push, so
   * those commits are not passed and not failed — they are unjudged, and
   * RULING 24 says a check that could not reach its subject must never print
   * like one that did. Reporting them RED would be almost as wrong in the
   * other direction: it names a defect that was never observed and sends a
   * reader hunting for it.
   *
   * It is kept apart from `timed_out`, which IS red: a job GitHub killed at
   * six hours ran and told us something bad.
   */
  const cancelled = checkRuns
    .filter((c) => c.status === "completed" && c.conclusion === "cancelled" && !neverStarted(c))
    .map((c) => c.name);

  // `neutral` and `skipped` are completed-and-not-failing. Everything else that
  // completed without success is a failure, including `timed_out`.
  const failed = checkRuns
    .filter(
      (c) =>
        c.status === "completed" &&
        !["success", "neutral", "skipped", "cancelled"].includes(c.conclusion) &&
        // A run that never started is not a failing check. Where SOME runs
        // started and some did not, the ones that ran are still judged — the
        // stillborn ones are named separately rather than counted as red.
        !neverStarted(c),
    )
    .map((c) => `${c.name} (${c.conclusion ?? "no conclusion"})`);

  /*
   * THE ORDER IS THE RULE, and each position is a decision.
   *
   * RED first. A check that actually ran and actually failed is the most
   * actionable thing on the commit, and it stays the headline even when some
   * other runner was never allocated — a named defect outranks an unknown.
   *
   * PENDING second. Work still in flight is a question about the future; it
   * is not a wall, and saying "could not tell" about it would send a session
   * looking for a cap that is not there.
   *
   * STILLBORN third, and it forces CANNOT-TELL. Nothing below this line may
   * return GREEN while a required check sits with no verdict at all.
   *
   * GREEN last, and only when every check both RAN and passed. The count is
   * the number of runs judged, which is now the same number as the runs there
   * are — before A-008 it printed the array length while one of them had
   * executed nothing.
   */
  if (failed.length > 0) {
    return {
      verdict: RED,
      why: `${failed.length} check(s) failing`,
      failed,
      pending,
      ...(stillborn.length > 0 ? { neverStarted: stillborn } : {}),
    };
  }
  if (pending.length > 0) {
    return {
      verdict: PENDING,
      why: `${pending.length} check(s) still running`,
      failed,
      pending,
      ...(stillborn.length > 0 ? { neverStarted: stillborn } : {}),
    };
  }
  if (stillborn.length > 0) {
    return {
      verdict: UNKNOWN,
      why:
        `${stillborn.length} of ${checkRuns.length} check(s) completed with NO STEPS and were never ` +
        `run — ${stillborn.join(", ")}. Nothing here says that check passed, so this is NOT green. ` +
        "Usually an Actions minutes or spending cap, or a runner allocation failure; it is a WALL, " +
        "not a JOB",
      failed,
      pending,
      neverStarted: stillborn,
    };
  }
  /*
   * CANCELLED, fourth, and it also forces CANNOT-TELL. It sits BELOW pending
   * and stillborn because those two are more specific diagnoses, and ABOVE
   * green because nothing may return GREEN while a check was killed before it
   * answered.
   */
  if (cancelled.length > 0) {
    return {
      verdict: UNKNOWN,
      why:
        `${cancelled.length} of ${checkRuns.length} check(s) were CANCELLED — ${cancelled.join(", ")}. ` +
        "A cancelled check did not finish asking its question, so this commit is not passed and not " +
        "failed. On `main` that usually means another push superseded it, which build-check.yml no " +
        "longer allows between different commits; re-run the check on this commit to get a verdict",
      failed,
      pending,
      cancelled,
    };
  }
  return { verdict: GREEN, why: `${checkRuns.length} check(s) passed`, failed, pending };
}

/** Ask GitHub. Returns `null` when the question could not be put. */
export function fetchCheckRuns(sha) {
  /*
   * `steps`, `started_at` and `completed_at` ride along so `neverStarted` can
   * tell a runner that could not be allocated from a tree that is broken. The
   * first version of this asked only for name/status/conclusion, and reported
   * three stillborn runs as a red `main` — a check that could not run printing
   * exactly like a failure of the thing it checks.
   */
  const out = run("gh", [
    "api",
    `repos/${REPO}/commits/${sha}/check-runs`,
    "--jq",
    "[.check_runs[] | {name, status, conclusion, started_at, completed_at, steps: (.steps // [])}]",
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
