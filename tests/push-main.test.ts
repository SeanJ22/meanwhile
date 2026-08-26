import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
      // Anchored at the start and allowed to carry arguments. It was an exact
      // string equality until 2026-08-26, when RULING 162 gave every pusher a
      // `--workflow <id>` declaring which path allowlist it pushes under — and
      // an equality match would have read all eight as ZERO pushers while
      // asserting the count was eight. That is the shape RULING 110 names: a
      // search in the wrong FORM, reporting an absence it never looked for.
      if (/^node scripts\/push-main\.mjs(\s|$)/.test(command)) pushers.push(file);
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
    8,
    // Eight as of 2026-08-24 (RULING 124): the seven below plus
    // refresh-daily.yml, the ONE orchestrated run that now carries every
    // source's cron. The other five keep their push-main call because they keep
    // their `workflow_dispatch` — a source must still be runnable by hand — so
    // the count went UP while the number of SCHEDULED pushers went from seven
    // to three, and only one of those three can cost a production build.
    //
    // Seven as of NJ Hunt 3 (2026-08-22): the six below plus
    // refresh-nj-filing.yml, which rebuilds the Morris County ballot daily from
    // the clerk's current filing and commits when it moves.
    //
    // Six as of NH Hunt 3 (2026-08-21): the five refresh/tripwire jobs plus
    // job-watch.yml, which commits the Needs Sean row RULING 56 raises and so
    // needs the same rebase-and-retry protection as any other main pusher.
    `expected the six main-pushing workflows to use scripts/push-main.mjs, found ${pushers.length}: ${pushers.join(", ")}`,
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
  /*
   * RULING 78 (2026-08-22, NJ Hunt 4 item 2) narrowed the push trigger to
   * `main`. The trigger this test cares about is the PULL REQUEST — RULING 13
   * is about the suite running on Linux before a change is merged — and the
   * `main` push is the second half, which is what makes a close-out commit
   * (RULING 75) get gated too. Both are asserted by name so neither can be
   * dropped quietly, and the BRANCH FILTER is asserted as well, because a
   * `push:` with no filter is the triple-build that exhausted the Actions
   * balance and produced `NS04`.
   */
  assert.match(text, /\n\s*pull_request:/, "still PR-gating");
  assert.match(text, /\n\s*push:\s*\n\s*branches: \[main\]/, "and the main push is gated too");
  assert.doesNotMatch(
    text,
    /\n\s*push:\s*\n\s*pull_request:/,
    "an unfiltered push trigger builds three times per merge — RULING 78",
  );
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

/* ---- 3. the deploy-key cutover, both directions on a real repository ------ */

/**
 * THE DEPLOY-KEY CUTOVER (2026-08-26, RULING 165).
 *
 * The ruleset's bypass is granted to the **Deploy keys** category with mode
 * `exempt`, so a scheduled push skips the ruleset outright rather than being
 * evaluated and waved through. **There is nothing left on the server between a
 * scheduled job and `main`** — `lib/ops/push-allowlist.ts` is the whole of it.
 *
 * A guard that refuses everything passes a refusal test on its own. Both
 * directions are therefore required, against real git repositories on disk and
 * through the actual command line the workflows run, not through an imported
 * function: the guard is wired in the direct-invocation block, and asserting
 * against `classifyPushPaths` would be asserting that the code the fix
 * introduced does what the code does (RULING 153).
 */

/** Run `scripts/push-main.mjs` exactly as a workflow does, against a scratch repo. */
function runPusherCli(repo: string, workflow: string) {
  const r = spawnSync(
    process.execPath,
    [
      "--experimental-strip-types",
      "--import",
      "./scripts/register-test-loader.mjs",
      "scripts/push-main.mjs",
      "--workflow",
      workflow,
      "--cwd",
      repo,
      "--attempts",
      "2",
    ],
    { cwd: ROOT, encoding: "utf8", env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } },
  );
  return { status: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

/** A bare origin with one commit on `main`, plus a clone standing in for the runner. */
function scratchPair(prefix: string) {
  const scratch = mkdtempSync(join(tmpdir(), prefix));
  const origin = join(scratch, "origin.git");
  git(["init", "--bare", "--initial-branch=main", origin], scratch);
  const seed = join(scratch, "seed");
  git(["clone", origin, seed], scratch);
  git(["config", "user.name", "seed"], seed);
  git(["config", "user.email", "seed@example.invalid"], seed);
  commitFile(seed, "README.md", "start\n");
  git(["push", "origin", "main"], seed);
  const run = clone(origin, join(scratch, "run"), "scheduled-bot");
  return { scratch, origin, run };
}

/** The SHA `main` points at inside a bare repository. */
function originHead(origin: string) {
  return git(["rev-parse", "main"], origin);
}

/** Stage and commit a set of files, creating directories as needed. */
function commitPaths(repo: string, paths: Record<string, string>) {
  for (const [rel, body] of Object.entries(paths)) {
    mkdirSync(dirname(join(repo, rel)), { recursive: true });
    writeFileSync(join(repo, rel), body);
    git(["add", rel], repo);
  }
  git(["commit", "-m", "scheduled artifact"], repo);
}

test("RULING 165: a push carrying a disallowed path is REFUSED, names it, and nothing lands", () => {
  const { scratch, origin, run } = scratchPair("wtp-cutover-refuse-");
  try {
    const before = originHead(origin);

    // The real shape of the hole this guards: the orchestrated refresh's own
    // artifact, plus one file of executable code smuggled alongside it.
    commitPaths(run, {
      "data/meetings-snapshot.json": '{"sources":[]}\n',
      "scripts/anything.mjs": "// code a scheduled job may never write\n",
    });

    const { status, out } = runPusherCli(run, "refresh-daily");

    assert.notEqual(status, 0, "a refused push must exit non-zero");
    assert.ok(/PATH GUARD REFUSED THIS PUSH/.test(out), "it refuses loudly");
    assert.ok(out.includes("scripts/anything.mjs"), "the OFFENDING PATH is named, not merely counted");
    assert.ok(!out.includes("nothing to push"), "a refusal never wears the clothes of a no-op");
    assert.equal(originHead(origin), before, "NOTHING LANDED — origin's main is exactly where it was");
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test("RULING 165: the same push WITHOUT the offending path succeeds and lands", () => {
  const { scratch, origin, run } = scratchPair("wtp-cutover-allow-");
  try {
    const before = originHead(origin);

    commitPaths(run, { "data/meetings-snapshot.json": '{"sources":[]}\n' });

    const { status, out } = runPusherCli(run, "refresh-daily");

    assert.equal(status, 0, `a permitted push must succeed: ${out}`);
    assert.ok(/path guard PASSED for refresh-daily/.test(out), "the guard says it passed, by profile name");
    assert.ok(/pushed on attempt 1 of 2/.test(out), "the push step actually ran and said so");
    assert.notEqual(originHead(origin), before, "origin's main moved");
    assert.ok(
      git(["show", "--name-only", "--format=", "main"], origin).includes("data/meetings-snapshot.json"),
      "the artifact is what landed",
    );
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

/**
 * RULING 157 — A FIX IS VERIFIED AGAINST A CASE IT WAS NOT DERIVED FROM.
 *
 * The cutover was derived from `refresh-daily`: it is the workflow in
 * `docs/refresh-unblock-runbook.md`, the one whose three refused runs
 * (`32955499285`, `32951929034`, `32950685105`) are the failures being fixed,
 * and the profile both tests above use.
 *
 * **The independent case is `job-watch`**, and it is independent in the way
 * that matters rather than merely in name: it is the ONLY profile whose grant
 * lies outside `data/` (`TRACKER_ROW_GRANT`), the only one whose allowlist is a
 * single EXACT FILE rather than a directory prefix, and the only pusher whose
 * commit is an alarm rather than an artifact. A directory-prefix rule that
 * happened to match by prefix would pass `refresh-daily` and fail here.
 */
test("RULING 157: the cutover holds for job-watch — a profile it was NOT derived from", () => {
  const { scratch, origin, run } = scratchPair("wtp-cutover-derived-");
  try {
    // Direction 1: job-watch may not write the neighbouring resolved store,
    // which NEVER_PUSHABLE bars outright (RULING 37 — the author closes rows).
    const before = originHead(origin);
    commitPaths(run, {
      "docs/tracker-working.csv": "id,section\nJOB99,needs-sean\n",
      "docs/tracker-resolved.csv": "id,section\nJOB98,needs-sean\n",
    });
    const refused = runPusherCli(run, "job-watch");
    assert.notEqual(refused.status, 0, "the resolved store is refused");
    assert.ok(refused.out.includes("docs/tracker-resolved.csv"), "the offending path is named");
    assert.equal(originHead(origin), before, "nothing landed");

    // Direction 2: the row it is actually for does land.
    git(["reset", "--hard", "origin/main"], run);
    commitPaths(run, { "docs/tracker-working.csv": "id,section\nJOB99,needs-sean\n" });
    const allowed = runPusherCli(run, "job-watch");
    assert.equal(allowed.status, 0, `the Needs Sean row must land: ${allowed.out}`);
    assert.ok(/path guard PASSED for job-watch/.test(allowed.out));
    assert.notEqual(originHead(origin), before, "the alarm reached main");
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

/**
 * THE PRIVATE KEY IS REMOVED ON THE FAILURE PATH.
 *
 * This is the assertion the whole credential discipline rests on, and it is
 * only reachable on a path that authenticates to github.com — which would need
 * a real private key and a network call, both forbidden. `resolveTransport` is
 * the DECLARED SEAM (RULING 130's pattern): production passes nothing and walks
 * the real resolution, and this hands in a transport whose push cannot succeed.
 */
test("RULING 165: the key material is cleaned up when the push FAILS, not only when it succeeds", () => {
  const { scratch, run } = scratchPair("wtp-cutover-cleanup-");
  try {
    commitPaths(run, { "data/meetings-snapshot.json": "{}\n" });

    const keyDir = mkdtempSync(join(tmpdir(), "wtp-fake-keydir-"));
    const keyPath = join(keyDir, "id_deploy");
    writeFileSync(keyPath, "not-a-key\n");

    let cleaned = 0;
    const result = pushMain({
      cwd: run,
      attempts: 1,
      log: () => {},
      resolveTransport: () => ({
        ok: true,
        // A path that cannot be pushed to by any route, so the loop exhausts.
        target: join(scratch, "does-not-exist.git"),
        env: {},
        ssh: true,
        cleanup: () => {
          cleaned += 1;
          rmSync(keyDir, { recursive: true, force: true });
        },
      }),
    });

    assert.equal(result.ok, false, "the push failed, which is the case under test");
    assert.equal(cleaned, 1, "cleanup ran exactly once on the failure path");
    assert.ok(!existsSync(keyPath), "the key file is GONE after a failed push");
    assert.ok(!existsSync(keyDir), "so is its directory");
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test("RULING 165: a missing deploy key FAILS CLOSED and names the secret", () => {
  const { scratch, run } = scratchPair("wtp-cutover-nokey-");
  try {
    commitPaths(run, { "data/meetings-snapshot.json": "{}\n" });

    // A github.com remote with no PUSH_DEPLOY_KEY in the environment. This is
    // precisely what a workflow looks like when somebody adds a ninth pusher
    // and forgets the one plumbing line.
    git(["remote", "set-url", "origin", "https://github.com/SeanJ22/We-The-People.git"], run);

    const result = pushMain({
      cwd: run,
      attempts: 1,
      log: () => {},
      env: { RUNNER_TEMP: scratch },
    });

    assert.equal(result.ok, false, "it must not push");
    assert.ok(result.reason.includes("PUSH_DEPLOY_KEY"), `the failure names the secret: ${result.reason}`);
    assert.equal(result.attempts, 0, "it never even attempted — it failed before the network");
    assert.ok(
      !/nothing to push|no changes|skipp/i.test(result.reason),
      "a missing credential may never degrade to a no-op (RULINGS 100, 113, 159)",
    );
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});
