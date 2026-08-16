/**
 * End-of-session handoff.
 *
 *   pnpm handoff            report, sync the mirror, export transcripts
 *   pnpm handoff --check    report only; touch nothing
 *   pnpm handoff --ship     the above, then push, open a PR, merge it, and
 *                           fast-forward local main
 *
 * `--ship` exists because the author asked for a one-command close: everything
 * that is not current becomes current, the PR is created *and* merged, and the
 * next session starts clean. It is standing authorization, recorded here so the
 * behaviour is not a surprise.
 *
 * "The next session starts clean" is the part that was not true for a while.
 * `--ship` merged on GitHub and left local `main` a session behind, every time
 * — R07. It now pushes `-u` for a branch that has no upstream yet, and
 * fast-forwards local `main` after the merge, and the plain check reports a
 * stale local `main` as a warning. All three were the same assumption: that the
 * remote and the local refs would somehow keep themselves in step.
 *
 * What `--ship` will not do is commit for you. A commit needs a message that
 * says why, and generating one from a diff produces exactly the uninformative
 * history this project's tracker rules exist to prevent. So it refuses on a
 * dirty tree and tells you.
 *
 * Five surfaces have to agree before a session ends, and checking them by hand
 * is how they drift. This runs the whole sweep and prints a checklist you can
 * read at a glance:
 *
 *   1. the working tree      nothing uncommitted
 *   2. the branch            nothing unpushed
 *   3. main                  nothing unmerged, no PR left open, and the local
 *                            `main` ref actually current with origin
 *   4. the dev server        stopped, port 3000 free
 *   5. the G Drive mirror    the copied files byte-identical, plus transcripts
 *                            and two generated files with no repo counterpart
 *                            — `git-state.txt` (R09) and `context.md` (R15),
 *                            neither compared for drift, both skipped by
 *                            `--check` and rewritten after a successful ship
 *
 * **Under `--ship` there is a sixth, and it runs before anything is pushed:**
 *
 *   6. the deploy gate       `pnpm build` — the same command Netlify runs —
 *                            with `tsconfig.tsbuildinfo` cleared first. A
 *                            failure refuses the ship and prints the
 *                            diagnostic, because Netlify's build log is
 *                            behind the author's login. See `buildGate()`
 *                            for why it is the build rather than `tsc`, and
 *                            for the pre-push hook that was rejected.
 *
 * `pnpm session:start` is the bookend, and checks the things that are wrong at
 * the *start* of a session — stale local main, a clobbered CLAUDE.md, a port
 * already in use.
 *
 * Exits non-zero if anything needs attention, so it can gate a commit hook
 * later without being rewritten.
 *
 * Without `--ship` it does not push, merge, or open a PR — it only reports on
 * them and does the two jobs that are pure copies.
 */

import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { writeContext } from "./context-file.mjs";
import { stopDevServer } from "./dev-server.mjs";
import { today } from "./doc-dates.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "..");

/** Overridable so a second machine with a different drive letter still works. */
const MIRROR =
  process.env.WTP_MIRROR ?? "G:/My Drive/we-the-people";

const EXPORTER = join(
  process.env.USERPROFILE ?? process.env.HOME ?? "",
  ".claude",
  "export-transcript.mjs",
);

/** repo path → mirror filename. The repo is authoritative; the mirror is a copy. */
const MIRRORED = [
  ["CLAUDE.md", "CLAUDE.md"],
  ["docs/abuse-policy.md", "abuse-policy.md"],
  ["docs/vendor-review.md", "vendor-review.md"],
  // Joined 2026-08-13: a standing document that constrains what gets built,
  // the same argument that put vendor-review.md here.
  ["docs/source-ladder.md", "source-ladder.md"],
  // Joined 2026-08-14: the author's production-defect scratchpad — written
  // from outside the repo, so it must be readable from outside the repo.
  ["docs/defects.md", "defects.md"],
  ["docs/state.md", "state.md"],
  ["docs/tracker.csv", "tracker.csv"],
  ["lib/sources/types.ts", "types.ts"],
];

const CHECK_ONLY = process.argv.includes("--check");
const SHIP = process.argv.includes("--ship");

/** `--title "..."` for the PR opened by --ship. */
function flag(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
}

/* ------------------------------------------------------------------ util --- */

const results = [];
const ok = (label, detail) => results.push({ level: "ok", label, detail });
const warn = (label, detail) => results.push({ level: "warn", label, detail });
const fail = (label, detail) => results.push({ level: "fail", label, detail });

function git(...args) {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
}

/** Run a command, returning null instead of throwing when it is unavailable. */
function tryRun(cmd, args, opts = {}) {
  try {
    return execFileSync(cmd, args, {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      ...opts,
    }).trim();
  } catch {
    return null;
  }
}

function sameBytes(a, b) {
  if (!existsSync(a) || !existsSync(b)) return false;
  if (statSync(a).size !== statSync(b).size) return false;
  return readFileSync(a).equals(readFileSync(b));
}

/* ------------------------------------------------------------------ 1-3 --- */

// Every count below is meaningless against a stale remote. Twice in one session
// a claim about branch state was wrong because it was written before a fetch.
const fetched = tryRun("git", ["fetch", "origin", "--quiet"]) !== null;
if (!fetched) {
  warn("fetch", "could not reach origin — every git count below may be stale");
}

const branch = git("rev-parse", "--abbrev-ref", "HEAD");

const dirty = git("status", "--porcelain")
  .split("\n")
  .filter((l) => l.trim() !== "");
if (dirty.length === 0) ok("working tree", "clean");
else fail("working tree", `${dirty.length} uncommitted file(s)`);

// Reassigned by ship(), which creates the upstream when a new branch has none.
let upstream = tryRun("git", [
  "rev-parse",
  "--abbrev-ref",
  "--symbolic-full-name",
  "@{u}",
]);

if (!upstream) {
  fail("branch", `${branch} has no upstream — nothing is backed up`);
} else {
  const unpushed = Number(git("rev-list", "--count", `${upstream}..HEAD`));
  const behind = Number(git("rev-list", "--count", `HEAD..${upstream}`));
  if (unpushed === 0 && behind === 0) ok("branch", `${branch} matches ${upstream}`);
  else if (unpushed > 0) fail("branch", `${unpushed} commit(s) not pushed — only on this machine`);
  else warn("branch", `${behind} commit(s) on ${upstream} not pulled`);
}

const hasMain = tryRun("git", ["rev-parse", "--verify", "origin/main"]) !== null;
if (!hasMain) {
  warn("main", "no origin/main to compare against");
} else {
  const unmerged = Number(git("rev-list", "--count", "origin/main..HEAD"));
  if (unmerged === 0) ok("main", "carries everything on this branch");
  else warn("main", `${unmerged} commit(s) not merged — a PR is still needed`);

  // Cheaper and more honest than the commit count: main can be "behind" by
  // merge commits while holding an identical tree.
  const identical = tryRun("git", ["diff", "--quiet", "origin/main", "HEAD"]) !== null;
  if (identical) ok("main tree", "identical to the local tree");
  else if (unmerged === 0) warn("main tree", "differs despite no unmerged commits — look at it");
}

/** The command that would fix a stale local `main` from where we are standing. */
function ffCommand() {
  // `fetch origin main:main` updates the ref without touching the working tree,
  // but git rejects it when main is the branch you are on.
  return branch === "main"
    ? "git merge --ff-only origin/main"
    : "git fetch origin main:main";
}

/**
 * R07: local `main` against `origin/main`.
 *
 * This is the comparison nothing above makes. The branch is checked against its
 * own upstream and `main` against the branch, but the local `main` ref is never
 * checked against the remote one — so it can sit a whole session behind while
 * every other line reads clean, and the next checkout of `main` presents a
 * project containing nothing but `CLAUDE.md`. That happened.
 */
function checkLocalMain() {
  if (!hasMain) return;

  const localMain = tryRun("git", ["rev-parse", "--verify", "main"]);
  if (localMain === null) {
    warn("local main", "no local main branch");
    return;
  }

  const behind = Number(git("rev-list", "--count", "main..origin/main"));
  const ahead = Number(git("rev-list", "--count", "origin/main..main"));

  if (behind === 0 && ahead === 0) ok("local main", "matches origin/main");
  else if (ahead > 0)
    warn("local main", `diverged — ${behind} behind, ${ahead} ahead of origin/main`);
  else warn("local main", `${behind} commit(s) behind origin/main — ${ffCommand()}`);
}

checkLocalMain();

const prs = tryRun("gh", [
  "pr",
  "list",
  "--state",
  "open",
  "--json",
  "number,title",
]);

/** Null means gh could not answer — which is not the same as "none open". */
let openPrs = null;

if (prs === null) {
  warn("pull requests", "gh unavailable — check for open PRs by hand");
} else {
  const open = JSON.parse(prs || "[]");
  openPrs = open;
  if (open.length === 0) ok("pull requests", "none open");
  else {
    // A PR merges from a snapshot: anything pushed after it was opened is left
    // behind silently. That stranded commits twice in one day.
    warn(
      "pull requests",
      `${open.length} open — ${open.map((p) => `#${p.number} ${p.title}`).join("; ")}`,
    );
  }
}

/* ----------------------------------------------------------- git-state --- */

/**
 * The last verified `test` / `lint` / `build` claim, read out of `docs/state.md`
 * rather than re-run.
 *
 * Re-running the suite here would report a number nobody wrote down, and this
 * project's tracker rule is that a status is a claim a person committed to with
 * evidence — not one a script inferred on its way past. So this reports the
 * recorded claim and says which line it came from, which is checkable.
 *
 * It takes the *last* matching line in the file: `state.md` accretes downward,
 * so the newest claim is the lowest one.
 */
function lastRecordedStatus() {
  const rel = "docs/state.md";
  const path = join(ROOT, rel);
  if (!existsSync(path)) return { where: `${rel} missing` };

  const lines = readFileSync(path, "utf8").split(/\r?\n/);
  let line = null;
  let lineNo = 0;
  for (let i = 0; i < lines.length; i++) {
    if (/\b\d+\s+tests?\b/.test(lines[i])) {
      line = lines[i];
      lineNo = i + 1;
    }
  }
  if (line === null) return { where: `no test count recorded in ${rel}` };

  const verdict = /\bfails?\b|\bfailing\b|\bred\b/i.test(line)
    ? "fail"
    : /\bpass(es|ing)?\b|\bgreen\b/i.test(line)
      ? "pass"
      : "recorded without a verdict";

  return {
    tests: line.match(/(\d+)\s+tests?\b/)[1],
    testVerdict: verdict,
    lint: /\blint\b/i.test(line) ? verdict : "not recorded",
    build: /\bbuild\b/i.test(line) ? verdict : "not recorded",
    where: `${rel}:${lineNo}`,
  };
}

/**
 * Write `git-state.txt` into the mirror.
 *
 * Unlike the five mirrored files this one has no repo counterpart — it is
 * generated, not copied, and exists so a session that opens on the mirror
 * (drive mounted, repo not yet cloned or fast-forwarded) can see where git
 * actually stood without running git. It carries the R07 check specifically,
 * because local `main` going stale is invisible from inside the repo until
 * someone checks `main` out and finds it apparently empty.
 *
 * Plain text, one fact per line, no formatting — it is meant to be read whole.
 */
/**
 * The facts, built once so `git-state.txt` and `context.md` cannot disagree.
 *
 * They are written in the same run from the same array; two independent
 * readings of git taken a few hundred milliseconds apart would be two
 * different claims about the same moment, and the mirror would hold both.
 */
let gitFacts = [];

function writeGitState() {
  if (!existsSync(MIRROR)) {
    warn("git state", "mirror drive not reachable — not written");
    return;
  }

  const lines = [];
  const put = (label, value) => lines.push(`${label}: ${value}`);

  put("generated", new Date().toISOString());
  put("branch", branch);

  const subject = (rev) => tryRun("git", ["log", "-1", "--format=%s", rev]);
  const sha = (rev) => tryRun("git", ["rev-parse", rev]);

  put("head sha", sha("HEAD") ?? "unknown");
  put("head subject", subject("HEAD") ?? "unknown");

  if (!hasMain) {
    put("origin/main sha", "no origin/main");
    put("origin/main subject", "no origin/main");
  } else {
    put("origin/main sha", sha("origin/main") ?? "unknown");
    put("origin/main subject", subject("origin/main") ?? "unknown");
  }

  // The R07 check: local main against origin/main. Nothing else in this script
  // compares those two — it checks the branch against its own upstream and main
  // against the branch — which is the exact gap that let local main sit a whole
  // session behind while every other line read clean.
  const localMain = tryRun("git", ["rev-parse", "--verify", "main"]);
  put("local main sha", localMain ?? "no local main branch");

  if (!hasMain || localMain === null) {
    put("local main matches origin/main", "cannot tell — one of the two is missing");
  } else if (localMain === sha("origin/main")) {
    put("local main matches origin/main", "yes");
  } else {
    const behind = Number(git("rev-list", "--count", "main..origin/main"));
    const ahead = Number(git("rev-list", "--count", "origin/main..main"));
    const detail = [
      `${behind} commit(s) behind`,
      ahead ? `${ahead} ahead` : null,
    ]
      .filter(Boolean)
      .join(", ");
    put("local main matches origin/main", `no — ${detail}`);
  }

  put(
    "working tree",
    dirty.length === 0 ? "clean" : `dirty — ${dirty.length} changed file(s)`,
  );

  if (openPrs === null) {
    put("open prs", "unknown — gh unavailable");
  } else if (openPrs.length === 0) {
    put("open prs", "none");
  } else {
    put("open prs", String(openPrs.length));
    for (const pr of openPrs) put("open pr", `#${pr.number} ${pr.title}`);
  }

  const status = lastRecordedStatus();
  put(
    "last recorded tests",
    status.tests ? `${status.tests} (${status.testVerdict})` : "not recorded",
  );
  put("last recorded lint", status.lint ?? "not recorded");
  put("last recorded build", status.build ?? "not recorded");
  put("last recorded status from", status.where);

  writeFileSync(join(MIRROR, "git-state.txt"), lines.join("\n") + "\n", "utf8");
  gitFacts = lines;
  return true;
}

if (CHECK_ONLY) {
  ok("git state", "skipped (--check)");
} else if (writeGitState()) {
  ok("git state", "git-state.txt written to the mirror");
}

/* ----------------------------------------------------------- context.md --- */

/**
 * The seventh mirror file, and the second generated one.
 *
 * Same posture as `git-state.txt` and for the same reason: it has no repo
 * counterpart, so there is nothing to compare it against and a drift check
 * could only report noise. It is skipped by `--check` (which touches
 * nothing), written on a plain run, and rewritten after a successful
 * `--ship` because merging moves every fact in it.
 *
 * A failure here is a warning, never a failure of the handoff. The mirror's
 * job is to survive the loss of the repo; a generated convenience file that
 * could block a session from ending would be worse than not having it.
 */
async function writeContextFile(note) {
  if (!existsSync(MIRROR)) {
    warn("context", "mirror drive not reachable — context.md not written");
    return;
  }
  try {
    const built = await writeContext(MIRROR, {
      gitFacts,
      generatedAt: new Date().toISOString(),
      stampToday: today(),
    });
    const kb = (built.bytes / 1024).toFixed(1);
    const counts =
      `${built.counts.phases} phase(s), ${built.counts.p0} P0 row(s), ` +
      `${built.counts.ripcords} ripcord(s), ${built.counts.statusChanges} status change(s)`;
    if (built.truncated) {
      warn("context", `context.md ${kb} KB of 20 KB — TRUNCATED: ${built.truncation.join("; ")}`);
    } else {
      ok("context", `context.md ${note} — ${kb} KB of 20 KB, ${counts}`);
    }
  } catch (error) {
    warn("context", `context.md not written — ${error.message}`);
  }
}

if (CHECK_ONLY) {
  ok("context", "skipped (--check)");
} else {
  await writeContextFile("written to the mirror");
}

/* ---------------------------------------------------------- dev server --- */

// Before the mirror, not after. A handoff that syncs and reports "safe to end
// the session" while something is still serving on 3000 is a false report — the
// next session's `predev` will refuse, or worse, Next slides to 3001 and the
// screenshots come from a build nobody is looking at.
{
  const { outcome, detail } = await stopDevServer({ dryRun: CHECK_ONLY });
  if (outcome === "occupied") fail("dev server", detail);
  else if (outcome === "foreign") warn("dev server", detail);
  else ok("dev server", CHECK_ONLY ? `${detail}` : detail);
}

/* -------------------------------------------------------------- 4 mirror --- */

if (!existsSync(MIRROR)) {
  warn("mirror", `${MIRROR} not reachable — is the drive mounted?`);
} else {
  let copied = 0;
  let already = 0;
  const problems = [];

  for (const [repoPath, mirrorName] of MIRRORED) {
    const from = join(ROOT, repoPath);
    const to = join(MIRROR, mirrorName);

    if (sameBytes(from, to)) {
      already++;
      continue;
    }

    if (CHECK_ONLY) {
      problems.push(`${mirrorName} differs`);
      continue;
    }

    // Before overwriting, make sure the mirror is not holding something the
    // repo never had. A mirror that matches *any* past version of the file is
    // simply stale, which is the normal case and safe to refresh. Only one
    // matching no version in the file's history contains something unique, and
    // copying over that would lose it.
    //
    // Comparing against HEAD alone is wrong and was: it flagged every ordinary
    // stale copy as diverged the moment a new commit landed.
    const mirrorBytes = existsSync(to) ? readFileSync(to, "utf8") : null;

    if (mirrorBytes !== null) {
      const normalize = (s) => s.replace(/\r\n/g, "\n").trimEnd();
      const target = normalize(mirrorBytes);

      const revs = (
        tryRun("git", ["rev-list", "--max-count=60", "HEAD", "--", repoPath]) ?? ""
      )
        .split("\n")
        .filter(Boolean);

      const known = revs.some((rev) => {
        const past = tryRun("git", ["show", `${rev}:${repoPath}`]);
        return past !== null && normalize(past) === target;
      });

      if (!known) {
        problems.push(
          `${mirrorName} matches no version in this file's history — not overwritten, diff it by hand`,
        );
        continue;
      }
    }

    copyFileSync(from, to);
    copied++;
  }

  const summary = [
    already ? `${already} already current` : null,
    copied ? `${copied} copied` : null,
  ]
    .filter(Boolean)
    .join(", ");

  if (problems.length === 0) ok("mirror", summary || "5/5 identical");
  else fail("mirror", problems.join("; "));
}

/* ---------------------------------------------------------- transcripts --- */

if (CHECK_ONLY) {
  ok("transcripts", "skipped (--check)");
} else if (!existsSync(EXPORTER)) {
  warn("transcripts", `exporter not found at ${EXPORTER}`);
} else if (!existsSync(MIRROR)) {
  warn("transcripts", "mirror drive not reachable");
} else {
  const out = tryRun("node", [EXPORTER, "--out", join(MIRROR, "transcripts")]);
  if (out === null) warn("transcripts", "export failed");
  else {
    const n = (out.match(/^\d+ transcript/m) ?? [])[0] ?? "exported";
    ok("transcripts", n.replace(/^(\d+) transcript.*/, "$1 exported"));
  }
}

/* ---------------------------------------------------------------- ship --- */

/**
 * **The deploy gate** — born 2026-08-16, from a deploy that did not land.
 *
 * ## What happened
 *
 * `main@705f73b` merged green and production kept serving the previous build
 * for an hour. Netlify's build failed type-check on
 * `scripts/walk-0815g.mts(313,23): TS18048` — a walk SCRIPT, not site code.
 * The session had run `pnpm build` and seen exit 0, and had not lied: the
 * build ran BEFORE that file was written, and nothing type-checked the tree
 * again between writing it and shipping. Diagnosed rather than assumed — a
 * warm-cache `pnpm build` on the same tree reproduces the failure exactly, so
 * the stale-`.next` theory is wrong and the ordering one is right.
 *
 * ## Why the gate is `pnpm build`, not `tsc --noEmit`
 *
 * The gate has to be the check Netlify runs, and Netlify runs
 * `corepack pnpm run build`. `tsc --noEmit` is *nearly* the same pass — the
 * build prints "Running TypeScript ..." and then the identical diagnostic —
 * but `tsconfig.json` includes `.next/types/**\/*.ts`, the route types Next
 * GENERATES during a build. A bare `tsc` run checks whatever those files
 * happened to say last time, so a bad route-handler signature is exactly the
 * class of error it could miss. Running the real command removes the question
 * instead of reasoning about it.
 *
 * `tsconfig.tsbuildinfo` is cleared first because `"incremental": true` is on
 * and Netlify starts from a clean checkout. (Measured: the warm build caught
 * this error anyway — incremental does track new files. Cleared regardless,
 * because "it happened to work this time" is not a property.)
 *
 * ## Rejected alternative, recorded
 *
 * A `.githooks/pre-push` hook. It would catch a push that bypasses this
 * script, which handoff cannot — but it is installed by
 * `git config core.hooksPath .githooks`, which is per-clone and which
 * `pnpm session:start` only *reports* on. A gate that can be silently absent
 * in a fresh clone is not a gate. It would also run on every
 * work-in-progress push, and a minute of build on each is how a check gets
 * `--no-verify`d out of existence. `--ship` is the single door everything
 * merges through, it already refuses on a dirty tree, and its output is the
 * checklist a session actually reads.
 *
 * **There is deliberately no skip flag.** An escape hatch on a gate is how
 * the gate stops meaning anything, and the failure it exists to prevent cost
 * a whole session's work sitting unshipped behind a green checkmark.
 */
function buildGate() {
  try {
    rmSync(join(ROOT, "tsconfig.tsbuildinfo"), { force: true });
  } catch {
    // Not being able to clear it is survivable — the build still type-checks.
  }

  const started = Date.now();
  try {
    // `pnpm.cmd` by name on Windows rather than `shell: true`: pnpm is a shim
    // there and `execFileSync` cannot run it directly, but a shell would
    // concatenate the args instead of passing them (Node's DEP0190) and put a
    // deprecation warning in the middle of the handoff checklist.
    execFileSync(process.platform === "win32" ? "pnpm.cmd" : "pnpm", ["run", "build"], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    // The diagnostic is the whole value here. Netlify's log is behind the
    // author's login, so a gate that only said "build failed" would move the
    // wall rather than remove it.
    const out = `${error.stdout ?? ""}${error.stderr ?? ""}`;
    const diagnostic =
      out
        .split("\n")
        .filter((l) => /error TS\d+|Failed to (compile|type check)/.test(l))
        .slice(0, 4)
        .join(" · ") || "see the output above";
    fail("ship · build", `refused — pnpm build failed: ${diagnostic}`);
    return false;
  }

  ok(
    "ship · build",
    `pnpm build clean in ${Math.round((Date.now() - started) / 1000)}s — the same command Netlify runs`,
  );
  return true;
}

/**
 * Push, open a PR, merge it.
 *
 * Runs only under `--ship`, and only from a clean tree — see the header. Each
 * step is skipped when it is already done, so running it twice is harmless.
 */
function ship() {
  if (dirty.length > 0) {
    fail("ship", "refused — commit first, a commit needs a message that says why");
    return;
  }
  if (tryRun("gh", ["--version"]) === null) {
    fail("ship", "refused — gh is not available");
    return;
  }
  if (!buildGate()) return;

  // R07's second gap: this used to refuse outright when a branch had no
  // upstream, so the first --ship of every session failed until someone ran
  // `git push -u` by hand. Having no upstream is the normal state of a branch
  // created this session, not an error — create it.
  if (!upstream) {
    if (tryRun("git", ["push", "-u", "origin", `HEAD:${branch}`]) === null) {
      fail("ship · push", `${branch} has no upstream and could not be pushed`);
      return;
    }
    upstream =
      tryRun("git", ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]) ??
      `origin/${branch}`;
    ok("ship · push", `${branch} pushed, now tracking ${upstream}`);
  } else {
    const unpushed = Number(git("rev-list", "--count", `${upstream}..HEAD`));
    if (unpushed > 0) {
      if (tryRun("git", ["push", "origin", branch]) === null) {
        fail("ship", "push failed");
        return;
      }
      ok("ship · push", `${unpushed} commit(s) pushed`);
    } else {
      ok("ship · push", "nothing to push");
    }
  }

  const unmerged = Number(git("rev-list", "--count", "origin/main..HEAD"));
  if (unmerged === 0) {
    ok("ship · pr", "main already carries this branch");
    return;
  }

  // Reuse an open PR rather than opening a second one for the same branch.
  const existing = JSON.parse(
    tryRun("gh", ["pr", "list", "--head", branch, "--state", "open", "--json", "number"]) ||
      "[]",
  );

  let number = existing[0]?.number;

  if (!number) {
    const title = flag(
      "title",
      `Session handoff: ${unmerged} commit(s) from ${branch}`,
    );
    const bodyFile = flag("body-file");
    const args = ["pr", "create", "--base", "main", "--head", branch, "--title", title];
    if (bodyFile) args.push("--body-file", bodyFile);
    else args.push("--body", "Opened by `pnpm handoff --ship` at the end of a session.");

    const url = tryRun("gh", args);
    if (url === null) {
      fail("ship · pr", "could not open a PR");
      return;
    }
    number = url.trim().split("/").pop();
    ok("ship · pr", `opened #${number}`);
  } else {
    ok("ship · pr", `reusing open #${number}`);
  }

  // --merge to match this repo's existing history, which is merge commits.
  const merged = tryRun("gh", ["pr", "merge", String(number), "--merge"]);
  if (merged === null) {
    fail(
      "ship · merge",
      `#${number} did not merge — checks pending, or branch protection wants a review`,
    );
    return;
  }
  ok("ship · merge", `#${number} merged`);

  // Re-verify against the remote rather than trusting the merge reported
  // success. A PR merges from a snapshot and can leave later commits behind.
  tryRun("git", ["fetch", "origin", "--quiet"]);
  const left = Number(git("rev-list", "--count", "origin/main..HEAD"));
  if (left === 0) ok("ship · verify", "main carries everything on this branch");
  else fail("ship · verify", `${left} commit(s) still not in main after the merge`);
}

/**
 * Fast-forward local `main` to `origin/main`. R07, the headline gap.
 *
 * `gh pr merge` advances `main` on GitHub and leaves the session standing on the
 * feature branch. Nothing here ever moved the local ref, so it fell exactly one
 * session behind on every ship, and the next person to check `main` out found a
 * project with nothing in it. The recovery was always a plain fast-forward,
 * because local `main` had never held anything unique — which is precisely why
 * the script can do it.
 *
 * `git fetch origin main:main` moves the ref without touching the working tree
 * and **refuses anything that is not a fast-forward**, so a diverged `main` is
 * reported rather than flattened. Git rejects that form when `main` is the
 * branch you are standing on, so from `main` it is a `--ff-only` merge instead.
 */
function fastForwardMain() {
  if (!hasMain) return;

  const localMain = tryRun("git", ["rev-parse", "--verify", "main"]);

  if (localMain !== null) {
    const ahead = Number(git("rev-list", "--count", "origin/main..main"));
    if (ahead > 0) {
      // Never flatten this. Commits on local main that origin does not have are
      // either unpushed work or a mistake, and both need a person.
      warn(
        "ship · main",
        `local main has ${ahead} commit(s) origin/main does not — not fast-forwarded`,
      );
      return;
    }
    if (Number(git("rev-list", "--count", "main..origin/main")) === 0) {
      ok("ship · main", "local main already current");
      return;
    }
  }

  const moved =
    branch === "main"
      ? tryRun("git", ["merge", "--ff-only", "origin/main"])
      : tryRun("git", ["fetch", "origin", "main:main"]);

  if (moved === null) {
    fail("ship · main", `could not fast-forward local main — ${ffCommand()}`);
    return;
  }

  // Confirm against the ref rather than trusting the command reported success,
  // which is the same rule the merge verification above follows.
  const after = tryRun("git", ["rev-parse", "--verify", "main"]);
  if (after !== null && after === tryRun("git", ["rev-parse", "origin/main"])) {
    ok("ship · main", `local main fast-forwarded to ${after.slice(0, 7)}`);
  } else {
    fail("ship · main", "local main still does not match origin/main");
  }
}

if (SHIP) {
  ship();

  // The branch, main and PR lines above were measured *before* shipping, so
  // once it succeeds they describe a state that no longer exists — and they
  // would fail the run despite everything having worked. Re-measure and
  // replace them rather than leaving a report that contradicts itself.
  if (!results.some((r) => r.level === "fail" && r.label.startsWith("ship"))) {
    const stale = new Set([
      "branch",
      "main",
      "main tree",
      "local main",
      "pull requests",
      "git state",
    ]);
    for (let i = results.length - 1; i >= 0; i--) {
      if (stale.has(results[i].label)) results.splice(i, 1);
    }

    tryRun("git", ["fetch", "origin", "--quiet"]);

    const unpushedNow = upstream
      ? Number(git("rev-list", "--count", `${upstream}..HEAD`))
      : 0;
    if (unpushedNow === 0) ok("branch", `${branch} matches ${upstream}`);
    else fail("branch", `${unpushedNow} commit(s) still not pushed`);

    const unmergedNow = Number(git("rev-list", "--count", "origin/main..HEAD"));
    if (unmergedNow === 0) ok("main", "carries everything on this branch");
    else fail("main", `${unmergedNow} commit(s) still not merged`);

    const openNow = JSON.parse(
      tryRun("gh", ["pr", "list", "--state", "open", "--json", "number,title"]) || "[]",
    );
    openPrs = openNow;
    if (openNow.length === 0) ok("pull requests", "none open");
    else
      warn(
        "pull requests",
        `${openNow.length} still open — ${openNow.map((p) => `#${p.number}`).join(", ")}`,
      );

    // The merge just moved origin/main, which is what leaves the local ref
    // behind. Fix it here, then re-measure, so the line below reports the state
    // the session actually ends in rather than the one it passed through.
    fastForwardMain();
    checkLocalMain();

    // git-state.txt was written before the push and merge, so it describes a
    // state that no longer exists — the same trap the re-measure above exists
    // to avoid. Rewrite it against the remote we just re-fetched.
    if (writeGitState()) ok("git state", "git-state.txt rewritten after shipping");

    // And context.md with it: it carries the same git facts plus tracker rows
    // that the merge commit may have moved. A stale seventh file is exactly
    // the drift the mirror exists to prevent.
    const staleContext = results.findIndex((r) => r.label === "context");
    if (staleContext !== -1) results.splice(staleContext, 1);
    await writeContextFile("rewritten after shipping");
  }
}

/* -------------------------------------------------------------- report --- */

const MARK = { ok: "  ok  ", warn: " warn ", fail: " FAIL " };

console.log(`\nhandoff — ${branch}\n`);
for (const r of results) {
  console.log(`${MARK[r.level]} ${r.label.padEnd(15)} ${r.detail}`);
}

const failed = results.filter((r) => r.level === "fail");
const warned = results.filter((r) => r.level === "warn");

console.log("");
if (failed.length === 0 && warned.length === 0) {
  console.log("All five surfaces agree. Safe to end the session.\n");
  process.exit(0);
}

if (failed.length > 0) {
  console.log(`${failed.length} item(s) need fixing before this session ends.`);
}
if (warned.length > 0) {
  console.log(`${warned.length} item(s) worth a look.`);
}
console.log("");

process.exit(failed.length > 0 ? 1 : 0);
