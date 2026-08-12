/**
 * End-of-session handoff check.
 *
 *   pnpm handoff            report, sync the mirror, export transcripts
 *   pnpm handoff --check    report only; touch nothing
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
 * It deliberately does **not** push, merge, or open a PR. Those are outward
 * facing and stay a human decision; this only reports on them and does the two
 * jobs that are pure copies.
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
