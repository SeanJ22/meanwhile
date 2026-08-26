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

import { classifyPushPaths } from "../lib/ops/push-allowlist.ts";

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

/**
 * The paths the commit(s) about to be pushed would introduce, or `null` when
 * that could not be determined.
 *
 * `null` is NOT an empty list, and the caller must keep them apart — an
 * unreadable diff is a question the guard could not answer, and answering it
 * "nothing changed" would be the silent pass this whole guard exists to remove.
 *
 * TWO READINGS, AND THE METHOD USED IS PRINTED RATHER THAN HIDDEN. The precise
 * one is everything on HEAD that is not yet on the remote branch. It needs a
 * resolvable remote-tracking ref, which a shallow `actions/checkout` normally
 * has but is not guaranteed. The fallback is the tip commit's own diff against
 * its parent, which is exact for every pusher in this repo because each makes
 * exactly ONE commit — and it is narrower rather than laxer, so falling back
 * cannot admit a path the precise reading would have caught.
 */
export function changedPathsForPush({ cwd, remote = "origin", branch = "main", log = console.log } = {}) {
  const range = git(["diff", "--name-only", `${remote}/${branch}..HEAD`], cwd);
  if (range.ok) {
    log(`push-main: path guard reading ${remote}/${branch}..HEAD`);
    return range.stdout ? range.stdout.split("\n") : [];
  }

  const tip = git(["show", "--name-only", "--format=", "HEAD"], cwd);
  if (tip.ok) {
    log(
      `push-main: ${remote}/${branch} did not resolve (${range.stderr || "no reason given"}); ` +
        "path guard reading the tip commit's own diff instead",
    );
    return tip.stdout ? tip.stdout.split("\n") : [];
  }

  log(`push-main: could not read the changed paths at all — ${tip.stderr || range.stderr}`);
  return null;
}

/**
 * THE ALLOWLIST GUARD (2026-08-26, RULING 162).
 *
 * Runs before any push. Returns the decision rather than exiting, so the caller
 * decides — and the direct-invocation block below exits non-zero on anything
 * that is not `allowed`.
 *
 * It is here, in the ONE script all eight scheduled pushers already go through,
 * rather than as a step copied into eight workflow files. Eight copies of a
 * guard is eight places for it to drift, and a ninth pusher would inherit the
 * copy nobody remembered to add.
 */
export function guardPushPaths({ cwd = process.cwd(), workflowId, remote = "origin", branch = "main", log = console.log } = {}) {
  const changed = changedPathsForPush({ cwd, remote, branch, log });
  const decision = classifyPushPaths({ profileId: workflowId, changed });

  if (decision.verdict === "allowed") {
    log(`push-main: path guard PASSED for ${decision.profileId} — ${decision.reason}`);
    return decision;
  }

  // Loud and specific: which workflow, which run, which path (the brief).
  const run = process.env.GITHUB_RUN_ID
    ? `${process.env.GITHUB_WORKFLOW ?? "?"} run ${process.env.GITHUB_RUN_ID}`
    : "local invocation (no GITHUB_RUN_ID)";
  console.error("");
  console.error("push-main: PATH GUARD REFUSED THIS PUSH");
  console.error(`  verdict   ${decision.verdict}`);
  console.error(`  workflow  ${decision.profileId ?? "(none given)"}  ·  ${run}`);
  console.error(`  reason    ${decision.reason}`);
  if (decision.offenders.length > 0) {
    console.error("  paths outside the allowlist:");
    for (const p of decision.offenders) console.error(`    - ${p}`);
  }
  console.error(
    "  Nothing was pushed. The scheduled bypass exists to carry machine-generated data " +
      "and nothing else; widening it is a decision for the author, not for a workflow.",
  );
  console.error("");
  return decision;
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

    /*
     * **A DIRTY TREE IS NOT A CONFLICT, AND CALLING IT ONE SENDS EVERY READER
     * TO THE WRONG PLACE.** (`NH120`, found and fixed 2026-08-24.)
     *
     * `refresh-dotgov-snapshot` run 32714838553 lost its work exactly here. It
     * committed its snapshot, the push was rejected by a concurrent bot push —
     * which is the ONLY situation this retry exists for — and then the rebase
     * refused with *"cannot rebase: You have unstaged changes"*. The run
     * reported that as `rebase … conflicted`, so the sentence a reader got
     * described two bots fighting over one artifact when what had actually
     * happened is that our own run left files it generated unstaged.
     *
     * That is RULING 113's second failure: an absence that can name what it DID
     * see must do so, or it points at the wrong half of the machine.
     *
     * The unstaged files are OURS — generated by the refresh a moment earlier
     * and not covered by its `git add`. They are stashed across the rebase and
     * restored after, so the retry can run and nothing is thrown away. A pop
     * that conflicts IS a real finding and is reported as one.
     */
    const dirty = git(["status", "--porcelain"], cwd).stdout.trim();
    let stashed = false;
    if (dirty) {
      const files = dirty.split("\n").map((l) => l.trim()).filter(Boolean);
      log(
        `push-main: the tree is dirty before the rebase — ${files.length} path(s) this run ` +
          `generated and did not stage: ${files.slice(0, 10).join(", ")}` +
          `${files.length > 10 ? ` … and ${files.length - 10} more` : ""}`,
      );
      const stash = git(["stash", "push", "--include-untracked", "-m", "push-main rebase"], cwd);
      if (!stash.ok) {
        return {
          ok: false,
          attempts: attempt,
          reason:
            `the tree was dirty and could not be stashed for the rebase: ${stash.stderr || stash.stdout}. ` +
            `Dirty paths: ${files.join(", ")}`,
        };
      }
      stashed = true;
    }

    const rebase = git(["rebase", `${remote}/${branch}`], cwd);
    if (!rebase.ok) {
      // Leave the tree clean so the runner's teardown is not the thing that
      // resolves it, and fail loudly: a conflict between two bots editing the
      // same governed artifact is a real finding, not a retry case.
      git(["rebase", "--abort"], cwd);
      if (stashed) git(["stash", "pop"], cwd);
      return {
        ok: false,
        attempts: attempt,
        reason: `rebase onto ${remote}/${branch} conflicted: ${rebase.stderr || rebase.stdout}`,
      };
    }

    if (stashed) {
      const pop = git(["stash", "pop"], cwd);
      if (!pop.ok) {
        return {
          ok: false,
          attempts: attempt,
          reason:
            `rebased onto ${remote}/${branch}, but restoring this run's unstaged files ` +
            `conflicted: ${pop.stderr || pop.stdout}. The work is in the stash, not lost.`,
        };
      }
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
  const cwd = opt(argv, "cwd") ?? process.cwd();
  const remote = opt(argv, "remote") ?? "origin";
  const branch = opt(argv, "branch") ?? "main";

  // The guard runs FIRST and there is no flag that skips it. An escape hatch on
  // a gate is how the gate stops meaning anything.
  const guard = guardPushPaths({ cwd, workflowId: opt(argv, "workflow"), remote, branch });
  if (guard.verdict !== "allowed") process.exit(1);

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
