/**
 * End-of-session handoff.
 *
 *   pnpm handoff            report, sync the mirror, export transcripts
 *   pnpm handoff --check    report only; touch nothing
 *   pnpm handoff --ship     the above, then push, open a PR, and merge it
 *
 * `--ship` exists because the author asked for a one-command close: everything
 * that is not current becomes current, the PR is created *and* merged, and the
 * next session starts clean. It is standing authorization, recorded here so the
 * behaviour is not a surprise.
 *
 * What `--ship` will not do is commit for you. A commit needs a message that
 * says why, and generating one from a diff produces exactly the uninformative
 * history this project's tracker rules exist to prevent. So it refuses on a
 * dirty tree and tells you.
 *
 * Four surfaces have to agree before a session ends, and checking them by hand
 * is how they drift. This runs the whole sweep and prints a checklist you can
 * read at a glance:
 *
 *   1. the working tree      nothing uncommitted
 *   2. the branch            nothing unpushed
 *   3. main                  nothing unmerged, no PR left open
 *   4. the G Drive mirror    five files byte-identical, plus transcripts
 *
 * Exits non-zero if anything needs attention, so it can gate a commit hook
 * later without being rewritten.
 *
 * Without `--ship` it does not push, merge, or open a PR — it only reports on
 * them and does the two jobs that are pure copies.
 */

import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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

const upstream = tryRun("git", [
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

const prs = tryRun("gh", [
  "pr",
  "list",
  "--state",
  "open",
  "--json",
  "number,title",
]);
if (prs === null) {
  warn("pull requests", "gh unavailable — check for open PRs by hand");
} else {
  const open = JSON.parse(prs || "[]");
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
  if (!upstream) {
    fail("ship", "refused — no upstream to push to");
    return;
  }
  if (tryRun("gh", ["--version"]) === null) {
    fail("ship", "refused — gh is not available");
    return;
  }

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

if (SHIP) {
  ship();

  // The branch, main and PR lines above were measured *before* shipping, so
  // once it succeeds they describe a state that no longer exists — and they
  // would fail the run despite everything having worked. Re-measure and
  // replace them rather than leaving a report that contradicts itself.
  if (!results.some((r) => r.level === "fail" && r.label.startsWith("ship"))) {
    const stale = new Set(["branch", "main", "main tree", "pull requests"]);
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
    if (openNow.length === 0) ok("pull requests", "none open");
    else
      warn(
        "pull requests",
        `${openNow.length} still open — ${openNow.map((p) => `#${p.number}`).join(", ")}`,
      );
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
  console.log("All four surfaces agree. Safe to end the session.\n");
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
