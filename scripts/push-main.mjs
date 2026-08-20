#!/usr/bin/env node
/**
 * R48 (closed 2026-08-20, Prompt B item 1a) — a scheduled workflow that
 * pushes `main` with no rebase.
 *
 * FIVE workflows in this repo commit on the runner and push straight to
 * `main`: the four governed-artifact refreshes and the intake tripwire. Each
 * carries its OWN `concurrency` group, so two runs of the SAME workflow can
 * never overlap — but nothing serializes two DIFFERENT ones, and their crons
 * genuinely collide. `refresh-dotgov` fires at 09:17 Monday and `refresh-fec`
 * at 09:23 Monday, six minutes apart, and both then run a fetch, a full test
 * gate and a push. The meetings refresh runs every six hours and the tripwire
 * daily at 10:41, so the windows overlap on their own schedule too.
 *
 * What actually happened when they collided was never data corruption — a
 * non-fast-forward push is REJECTED, `git push` exits non-zero, and the step
 * fails. F22 searched the logs and found no rejection, which is why R48 was
 * left unproven rather than disproven. But "the run goes red and the commit
 * dies with the runner" is still a loss: the fetched snapshot is discarded,
 * the artifact stops moving, and the next scheduled run is the only recovery.
 * That is exactly the shape of the two days of stale meetings F22 diagnosed.
 *
 * So: rebase onto whatever landed, and retry.
 *
 * WHY REBASE-AND-RETRY RATHER THAN A SHARED CONCURRENCY GROUP. A single
 * `concurrency` group across all five would serialize them, but GitHub keeps
 * at most ONE pending run per group and CANCELS any earlier pending one. Three
 * workflows landing in the same window would silently drop the middle run's
 * work — trading a loud red for a quiet loss, which is the wrong direction.
 * Rebasing keeps every run's work and costs nothing when there is no collision.
 *
 * WHY THIS IS NODE AND NOT SHELL. It is executed by `pnpm test` on the
 * author's Windows machine and by the runners on Linux. One implementation,
 * one behaviour, both platforms.
 *
 * Contract: the caller has ALREADY committed. This pushes that commit to
 * `main`, rebasing onto `origin/main` and retrying on rejection. It exits 0
 * only when the push succeeded. It never exits 0 having lost a commit — if
 * the retries are exhausted, or a rebase conflicts, it exits non-zero and
 * says which.
 *
 * Usage:  node scripts/push-main.mjs [--attempts N] [--cwd DIR] [--remote R]
 */

import { spawnSync } from "node:child_process";

const DEFAULT_ATTEMPTS = 5;

/** Read an option that takes a value; returns undefined when absent. */
function opt(argv, name) {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
}

/**
 * Run git and hand back the result rather than throwing, so every caller
 * below has to decide what a failure means. `stdio: pipe` keeps the output
 * for the log line we print ourselves — a git error nobody printed is the
 * silent-failure shape this whole file exists to remove.
 */
function git(args, cwd) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  return {
    ok: r.status === 0,
    status: r.status,
    stdout: (r.stdout ?? "").trim(),
    stderr: (r.stderr ?? "").trim(),
  };
}

export function pushMain({
  cwd = process.cwd(),
  remote = "origin",
  branch = "main",
  attempts = DEFAULT_ATTEMPTS,
  log = console.log,
} = {}) {
  const head = git(["rev-parse", "HEAD"], cwd);
  if (!head.ok) {
    return { ok: false, attempts: 0, reason: `cannot read HEAD: ${head.stderr}` };
  }

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const push = git(["push", remote, `HEAD:${branch}`], cwd);
    if (push.ok) {
      log(`push-main: pushed on attempt ${attempt} of ${attempts}`);
      return { ok: true, attempts: attempt, reason: "pushed" };
    }

    log(
      `push-main: attempt ${attempt} of ${attempts} rejected — ${push.stderr || push.stdout}`,
    );
    if (attempt === attempts) break;

    const fetched = git(["fetch", remote, branch], cwd);
    if (!fetched.ok) {
      // A fetch failure is not a collision. Naming it separately keeps a
      // network wall from being reported as a losing race.
      return {
        ok: false,
        attempts: attempt,
        reason: `fetch of ${remote}/${branch} failed: ${fetched.stderr}`,
      };
    }

    const rebase = git(["rebase", `${remote}/${branch}`], cwd);
    if (!rebase.ok) {
      // Leave the tree clean so the runner's teardown is not the thing that
      // resolves it, and fail loudly: a conflict between two bots editing the
      // same governed artifact is a real finding, not a retry case.
      git(["rebase", "--abort"], cwd);
      return {
        ok: false,
        attempts: attempt,
        reason: `rebase onto ${remote}/${branch} conflicted: ${rebase.stderr || rebase.stdout}`,
      };
    }
    log(`push-main: rebased onto ${remote}/${branch}, retrying`);
  }

  return {
    ok: false,
    attempts,
    reason: `push to ${branch} still rejected after ${attempts} attempts`,
  };
}

// Executed directly (the workflows) rather than imported (the guard test).
// `endsWith` on a normalized path, never a separator comparison — RULING 14.
const invokedDirectly = (process.argv[1] ?? "")
  .replace(/\\/g, "/")
  .endsWith("scripts/push-main.mjs");

if (invokedDirectly) {
  const argv = process.argv.slice(2);
  const result = pushMain({
    cwd: opt(argv, "cwd") ?? process.cwd(),
    remote: opt(argv, "remote") ?? "origin",
    branch: opt(argv, "branch") ?? "main",
    attempts: Number(opt(argv, "attempts") ?? DEFAULT_ATTEMPTS),
  });
  if (!result.ok) {
    console.error(`push-main: FAILED — ${result.reason}`);
    console.error(
      "push-main: the commit made by this run has NOT landed on main. This run " +
        "is red on purpose; it did not exit zero having lost its work.",
    );
    process.exit(1);
  }
}
