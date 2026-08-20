import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

// Plain .mjs: the same module the workflows execute, imported here directly.
import { pushMain } from "../scripts/push-main.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const WORKFLOWS = join(ROOT, ".github", "workflows");

/**
 * R48 (Prompt B item 1a, 2026-08-20) — the scheduled workflows pushed `main`
 * with no rebase, and each carried only its own concurrency group.
 *
 * The header of `scripts/push-main.mjs` carries the diagnosis. This file
 * carries the proof, in two halves that fail for different reasons:
 *
 *   1. THE MECHANISM WORKS — a real collision is forced against real git
 *      repositories on disk, and both colliding runs' work is present
 *      afterward. Not a source scan. The 1a.3 requirement is "force a
 *      collision and show both runs' work present", and only running it does.
 *   2. THE MECHANISM IS WIRED — no workflow pushes to `main` any other way.
 *      A future workflow that reintroduces a bare `git push origin main`
 *      fails here, by name.
 */

/* ---- helpers -------------------------------------------------------------- */

function git(args: string[], cwd: string) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(
    r.status,
    0,
    `git ${args.join(" ")} failed in ${cwd}: ${r.stderr || r.stdout}`,
  );
  return (r.stdout ?? "").trim();
}

/** A clone with an identity, so commits do not depend on the machine's config. */
function clone(origin: string, into: string, who: string) {
  git(["clone", origin, into], dirname(into));
  git(["config", "user.name", who], into);
  git(["config", "user.email", `${who}@example.invalid`], into);
  return into;
}

function commitFile(repo: string, name: string, body: string) {
  writeFileSync(join(repo, name), body);
  git(["add", name], repo);
  git(["commit", "-m", `add ${name}`], repo);
}

/* ---- 1. the mechanism, against real repositories --------------------------- */

test("R48: two runs pushing into the same window both land their work", () => {
  const scratch = mkdtempSync(join(tmpdir(), "wtp-push-main-"));
  try {
    // A bare repo standing in for origin, with a main branch to collide on.
    const origin = join(scratch, "origin.git");
    git(["init", "--bare", "--initial-branch=main", origin], scratch);

    const seed = join(scratch, "seed");
    git(["clone", origin, seed], scratch);
    git(["config", "user.name", "seed"], seed);
    git(["config", "user.email", "seed@example.invalid"], seed);
    commitFile(seed, "README.md", "start\n");
    git(["push", "origin", "main"], seed);

    // Two runs check out the SAME main, then each commits its own governed
    // artifact — the real shape: refresh-dotgov and refresh-fec, six minutes
    // apart on a Monday, both writing a different file.
    const runA = clone(origin, join(scratch, "runA"), "snapshot-refresh-bot");
    const runB = clone(origin, join(scratch, "runB"), "intake-tripwire-bot");
    commitFile(runA, "artifact-a.json", '{"from":"runA"}\n');
    commitFile(runB, "artifact-b.json", '{"from":"runB"}\n');

    // A pushes first and wins the race outright.
    const first = pushMain({ cwd: runA, log: () => {} });
    assert.equal(first.ok, true, `first push should succeed: ${first.reason}`);
    assert.equal(first.attempts, 1, "an uncontended push takes one attempt");

    // B is now behind: its push is REJECTED, and this is the whole defect.
    // Before the fix the step failed and B's commit died with the runner.
    const second = pushMain({ cwd: runB, log: () => {} });
    assert.equal(second.ok, true, `second push should recover: ${second.reason}`);
    assert.ok(
      second.attempts > 1,
      "the second push must actually have been rejected once — if it landed on " +
        "attempt 1 there was no collision and this test proved nothing",
    );

    // BOTH runs' work is present afterward. This is the claim.
    const verify = join(scratch, "verify");
    git(["clone", origin, verify], scratch);
    const landed = new Set(readdirSync(verify));
    assert.ok(landed.has("artifact-a.json"), "run A's artifact is on main");
    assert.ok(landed.has("artifact-b.json"), "run B's artifact is on main");
    assert.equal(
      // Trimmed: git's autocrlf rewrites line endings on the author's Windows
      // checkout, and the claim here is that the CONTENT survived the rebase.
      readFileSync(join(verify, "artifact-b.json"), "utf8").trim(),
      '{"from":"runB"}',
      "the rebased commit kept its own content",
    );
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test("R48: a push that cannot land never reports success", () => {
  const scratch = mkdtempSync(join(tmpdir(), "wtp-push-main-fail-"));
  try {
    const origin = join(scratch, "origin.git");
    git(["init", "--bare", "--initial-branch=main", origin], scratch);
    const seed = join(scratch, "seed");
    git(["clone", origin, seed], scratch);
    git(["config", "user.name", "seed"], seed);
    git(["config", "user.email", "seed@example.invalid"], seed);
    commitFile(seed, "README.md", "start\n");
    git(["push", "origin", "main"], seed);

    const run = clone(origin, join(scratch, "run"), "bot");
    commitFile(run, "artifact.json", "{}\n");

    // Point the remote at nothing. The push cannot succeed by any route, and
    // the contract is that it says so rather than exiting zero.
    git(["remote", "set-url", "origin", join(scratch, "does-not-exist.git")], run);
    const result = pushMain({ cwd: run, attempts: 2, log: () => {} });
    assert.equal(result.ok, false, "an unlandable push must not report success");
    assert.ok(result.reason.length > 0, "the failure names itself");
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

/* ---- 2. the mechanism is wired ------------------------------------------- */

const workflowFiles = readdirSync(WORKFLOWS).filter((f) => f.endsWith(".yml"));

test("R48: every workflow that pushes main goes through the protected push", () => {
  const bare: string[] = [];
  const pushers: string[] = [];

  for (const file of workflowFiles) {
    const text = readFileSync(join(WORKFLOWS, file), "utf8");
    // A bare push to main, in a `run:` block rather than in prose. The
    // comment blocks in this repo name the old command on purpose, so the
    // match is anchored on a line that is only ever a command.
    for (const line of text.split("\n")) {
      const command = line.trim();
      if (/^git push\b/.test(command)) bare.push(`${file}: ${command}`);
      if (command === "node scripts/push-main.mjs") pushers.push(file);
    }
  }

  assert.deepEqual(
    bare,
    [],
    "these workflows push without the R48 rebase-and-retry protection — a run " +
      "whose push is rejected loses its commit when the runner is torn down",
  );
  assert.equal(
    pushers.length,
    5,
    `expected the five main-pushing workflows to use scripts/push-main.mjs, found ${pushers.length}: ${pushers.join(", ")}`,
  );
});

/* ---- F25: no step may sit until the platform kills it --------------------- */

/**
 * F25 (Prompt B item 1b, 2026-08-20) — the six-hour gate hang.
 *
 * F22's runs #25 and #26 were cancelled at GitHub's 360-minute default with
 * no step named. The hang did not reproduce, so this does not claim to have
 * fixed a cause: it removes the SIX-HOUR SILENCE. Every job carries a bound,
 * and the two steps that can genuinely block on the network — the browser
 * install and the suite — carry their own tighter ones, so a hang fails
 * naming the step instead of naming the platform.
 *
 * 15 minutes for the gate is chosen against measurement, not feel: the suite
 * runs in about 8 seconds. Fifteen minutes is roughly a hundredfold headroom
 * for a cold Linux runner and still a twenty-fourth of the platform default.
 */
test("F25: every workflow job is bounded well under the platform's six hours", () => {
  const unbounded: string[] = [];
  for (const file of workflowFiles) {
    const text = readFileSync(join(WORKFLOWS, file), "utf8");
    // Only the `jobs:` block. `on:` has two-space children of its own
    // (`schedule:`, `workflow_dispatch:`), and counting those as jobs is how
    // the first draft of this test reported six healthy workflows as unbounded.
    const jobsBlock = text.slice(text.indexOf("\njobs:\n"));
    const jobTimeouts = [...jobsBlock.matchAll(/^ {4}timeout-minutes:\s*(\d+)/gm)];
    const jobs = [...jobsBlock.matchAll(/^ {2}[a-z][a-z0-9_-]*:\s*$/gm)];
    if (jobTimeouts.length < jobs.length) {
      unbounded.push(`${file}: ${jobs.length} job(s), ${jobTimeouts.length} bounded`);
    }
    for (const [, mins] of jobTimeouts) {
      assert.ok(
        Number(mins) < 360,
        `${file}: a job timeout of ${mins} minutes is not tighter than the platform default`,
      );
    }
  }
  assert.deepEqual(
    unbounded,
    [],
    "these workflows have a job that can sit until GitHub kills it at six hours",
  );
});

test("F25: the gate step and the browser install it needs are each bounded", () => {
  const unbounded: string[] = [];
  for (const file of workflowFiles) {
    const lines = readFileSync(join(WORKFLOWS, file), "utf8").split("\n");
    lines.forEach((line, i) => {
      const command = line.trim();
      const guarded =
        command === "run: corepack pnpm test" ||
        command.startsWith("run: corepack pnpm exec playwright install");
      if (!guarded) return;
      // The bound is a sibling key on the same step, so it is the line above
      // or one of the small handful above it within the step block.
      const window = lines.slice(Math.max(0, i - 4), i).join("\n");
      if (!/timeout-minutes:\s*\d+/.test(window)) {
        unbounded.push(`${file}:${i + 1}: ${command}`);
      }
    });
  }
  assert.deepEqual(
    unbounded,
    [],
    "these steps can hang until the job's own bound, without naming themselves",
  );
});

/* ---- 1c: the suite runs on Linux on every PR ------------------------------ */

/**
 * RULING 13 — a green build check did not mean the tests ran.
 *
 * This asserts the PR-gating workflow runs the suite itself, so the four
 * scheduled refresh gates stop being this repo's only Linux runner of it.
 */
test("RULING 13: the PR-gating workflow runs the suite, lint and types on Linux", () => {
  const text = readFileSync(join(WORKFLOWS, "build-check.yml"), "utf8");
  assert.match(text, /on:\s*\n\s*push:\s*\n\s*pull_request:/, "still PR-gating");
  assert.match(text, /run: corepack pnpm test\b/, "build-check.yml runs the suite");
  assert.match(text, /run: corepack pnpm lint\b/, "build-check.yml runs lint");
  assert.match(text, /run: corepack pnpm exec tsc --noEmit/, "build-check.yml type-checks");

  /*
   * THE TYPE CHECK MUST RUN ON A CHECKOUT THAT WAS NEVER BUILT, and this
   * asserts the JOB rather than merely the presence (Prompt C item 1a).
   *
   * It ran after the build for one day. That made it pass and made it
   * worthless: `tsconfig.json` includes `.next/types/**`, so a check placed
   * behind a build can only ever be measured on a tree carrying generated
   * files — the exact condition that hid "Cannot find name 'LayoutProps'"
   * from every developer machine until this job first ran on Linux. The fix
   * was to stop depending on a generated global (app/layout.tsx writes its
   * own props type), which is what makes a fresh-checkout check possible.
   *
   * So: the type check lives in the gates job, and the gates job does not
   * build. If a later change adds a build step there to "fix" a type error,
   * this fails and says why.
   */
  const gatesAt = text.indexOf("  gates:");
  assert.ok(gatesAt > 0, "the gates job is still there");
  const gates = text.slice(gatesAt);
  assert.match(
    gates,
    /run: corepack pnpm exec tsc --noEmit/,
    "the type check runs in the gates job",
  );
  assert.ok(
    !/run: corepack pnpm run build/.test(gates),
    "the gates job must NOT build — a type check behind a build can only be " +
      "measured on a tree carrying generated files, which is the condition " +
      "that hid the LayoutProps defect for months",
  );

  assert.match(
    text,
    /runs-on: ubuntu-latest/,
    "on Linux — the platform the author's machine is not",
  );
});

/* ---- Prompt C 1b: the one check the gates job cannot run --------------- */

/**
 * The suite reports 1377 tests on both platforms and one fewer PASS on Linux,
 * and exactly one test is responsible: `tests/feedback.test.ts`'s bundle half,
 * which scans the built client chunks for a personal address and reports
 * CANNOT RUN when `.next/static` is absent. On a developer's machine `.next`
 * is lying around from the last build, so it runs; the gates job never builds,
 * so it does not.
 *
 * The skip is right — a check that cannot reach its subject must not print
 * like a passing one — but a guard that never executes on the platform
 * production is built on is a guard on paper. So the build job runs it, on
 * the build it just produced. This asserts that wiring, because the failure
 * mode is silent: drop the step and the check simply stops happening on Linux
 * while every job stays green.
 */
test("Prompt C 1b: the bundle-scanning check runs in the job that has a build", () => {
  const text = readFileSync(join(WORKFLOWS, "build-check.yml"), "utf8");
  const gatesAt = text.indexOf("  gates:");
  const buildJob = text.slice(0, gatesAt);

  assert.match(
    buildJob,
    /run: corepack pnpm run test:bundle/,
    "the build job must run the bundle-scanning checks — they are the only " +
      "tests in the suite that need a build, and the gates job never builds",
  );
  const buildAt = buildJob.indexOf("run: corepack pnpm run build");
  const bundleAt = buildJob.indexOf("run: corepack pnpm run test:bundle");
  assert.ok(buildAt > 0 && bundleAt > buildAt, "and it must run AFTER the build");

  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  assert.match(
    pkg.scripts["test:bundle"] ?? "",
    /tests\/feedback\.test\.ts/,
    "test:bundle names the file whose bundle half is the skipped check",
  );
});

/**
 * And the skip itself stays honest. If someone "fixes" the count gap by
 * deleting the guard clause, the bundle scan would silently pass on a tree
 * with no bundle — the exact shape of defect this repo keeps finding.
 */
test("Prompt C 1b: the bundle scan still reports CANNOT RUN rather than passing", () => {
  const text = readFileSync(join(ROOT, "tests", "feedback.test.ts"), "utf8");
  assert.match(
    text,
    /t\.skip\("CANNOT RUN: no \.next\/static/,
    "the bundle scan must report that it could not run, never pass silently",
  );
});
