/**
 * **THE HISTORY SWEEP BEHIND RULING 62** (built 2026-08-21, NH Hunt 6 item 1.2).
 *
 * The census in `scripts/guard-census.mjs` protects the repo from TODAY
 * forwards. It says nothing about what already went missing, and one guard loss
 * is by construction an example of a class — a named instance is a class-wide
 * defect, so the sweep is the rest of the class.
 *
 * This walks every commit that touched `tests/`, extracts the guard NAMES from
 * every test file on both sides of the commit, and reports every name that
 * stopped existing anywhere in the suite at that commit.
 *
 * **A name leaving is not by itself a defect**, and the report does not pretend
 * otherwise. A rename, a rewrite, a guard folded into another, a test file
 * deliberately retired — all of these drop names legitimately. What the sweep
 * produces is the CANDIDATE LIST, with the commit and its subject line beside
 * each loss, so a person can read the commit and say which it was. The one
 * thing it can do that a person scrolling the log cannot is see a loss that the
 * commit message never mentions.
 *
 * ```
 * node scripts/guard-history.mjs [--since <rev>] [--all]
 * ```
 *
 * Default is the whole history. `--all` prints every loss; without it, losses
 * whose commit subject names the file are folded into a one-line summary, since
 * a commit that says it is rewriting `tests/foo.test.ts` is not a silent
 * removal of `tests/foo.test.ts`'s guards.
 */
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { guardsIn } from "./guard-census.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function git(args) {
  return execFileSync("git", args, {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
}

/** Every test file at one revision, with its guard names. */
function guardsAt(rev) {
  let listing = "";
  try {
    listing = git(["ls-tree", "-r", "--name-only", rev, "tests/"]);
  } catch {
    return new Map();
  }
  const out = new Map();
  for (const path of listing.split("\n")) {
    if (!path.endsWith(".test.ts")) continue;
    let source = "";
    try {
      source = git(["show", `${rev}:${path}`]);
    } catch {
      continue;
    }
    out.set(path, guardsIn(source));
  }
  return out;
}

const args = process.argv.slice(2);
const showAll = args.includes("--all");
const sinceIdx = args.indexOf("--since");
const range = sinceIdx >= 0 ? `${args[sinceIdx + 1]}..HEAD` : "HEAD";

const revs = git(["rev-list", "--reverse", range, "--", "tests/"])
  .split("\n")
  .map((r) => r.trim())
  .filter(Boolean);

console.log(`commits touching tests/: ${revs.length}`);

let previous = null;
let previousRev = null;
const findings = [];

for (const rev of revs) {
  const current = guardsAt(rev);
  if (previous !== null) {
    const before = new Map();
    for (const [file, entry] of previous) {
      for (const name of entry.names) before.set(name, file);
    }
    const afterNames = new Set();
    for (const entry of current.values()) for (const n of entry.names) afterNames.add(n);

    const lost = [];
    for (const [name, file] of before) {
      if (!afterNames.has(name)) lost.push({ name, file });
    }
    if (lost.length > 0) {
      const subject = git(["log", "-1", "--format=%s", rev]).trim();
      const touched = new Set(
        git(["show", "--name-only", "--format=", rev])
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean),
      );
      findings.push({ rev, previousRev, subject, lost, touched });
    }
  }
  previous = current;
  previousRev = rev;
}

console.log(`commits where a guard NAME stopped existing: ${findings.length}\n`);

let silent = 0;
for (const f of findings) {
  /*
   * A loss is "declared" when the commit that dropped it also EDITED the file
   * the guard lived in. That is the ordinary case — a rewrite, a rename, a
   * guard folded into another — and the diff carries it where a reviewer sees
   * it. A loss from a file the commit never touched is the shape RULING 62 was
   * adopted over, and it is what this sweep is looking for.
   */
  const undeclared = f.lost.filter((l) => !f.touched.has(l.file));
  const isSilent = undeclared.length > 0;
  if (isSilent) silent += 1;
  if (!isSilent && !showAll) continue;
  console.log(`${f.rev.slice(0, 7)}  ${f.subject}`);
  console.log(`   guards lost: ${f.lost.length}${isSilent ? `  (UNDECLARED: ${undeclared.length})` : ""}`);
  const shown = isSilent && !showAll ? undeclared : f.lost;
  for (const l of shown.slice(0, 40)) {
    console.log(`     ${f.touched.has(l.file) ? " " : "!"} ${l.file} :: ${l.name}`);
  }
  if (shown.length > 40) console.log(`     … ${shown.length - 40} more`);
  console.log("");
}

console.log(`SUMMARY`);
console.log(`  commits with a guard loss:        ${findings.length}`);
console.log(`  of those, UNDECLARED (silent):    ${silent}`);
console.log(
  `  undeclared = the commit dropped a guard from a file it never edited — the RULING 62 shape.`,
);
