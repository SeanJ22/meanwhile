/**
 * A branch named in the tracker must be a branch that existed (R11).
 *
 * ## Why this is mechanical and not a habit
 *
 * R03 requires every Done row to name its branch and which checks passed.
 * Nothing verified the branch was real, so the requirement produced
 * well-formatted fiction: two sessions named `claude/meeting-bodies-join` and
 * `claude/d17-nh-agenda-wording`, neither of which ever existed, and both were
 * caught only by a later session reading back over the rows. This is the fifth
 * member of the an-operation-that-can-do-nothing-must-be-asked-what-it-did
 * family, and the answer is the same one: ask.
 *
 * ## Why a deleted branch still counts as real
 *
 * Branches are merged and deleted; that is the normal end of a branch's life,
 * and `git branch --list` alone would therefore report every correctly-closed
 * branch in the repo's history as a fabrication. That check would be wrong far
 * more often than right, and a check that cries wolf is one people learn to
 * skip — the same argument R19 makes about the size warning.
 *
 * So a name is REAL if any of these still remember it:
 *   - a local or remote ref (the branch is alive)
 *   - a merge commit subject, `Merge pull request #N from <owner>/<branch>`
 *     (the branch lived and was merged, which is the usual case)
 *   - the reflog (it existed locally at some point)
 *
 * A name none of those remember was, as far as this repository can tell, never
 * created. That is stated as what it is — unverifiable from here — rather than
 * as proof of bad faith, because a branch pushed from another machine and
 * squash-merged could in principle leave no trace. The row still needs fixing
 * either way: a Note nobody can verify is not evidence.
 *
 * ## Warning, not failure
 *
 * This reports and does not block. The rows it flags are HISTORY — already
 * committed, sometimes months old — and failing the handoff over them would
 * make every future session's ship contingent on repairing old prose. New
 * fabrications surface at the top of the list the same run they are written.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

/**
 * Branch-name shape used by every session in this repo.
 *
 * Both provider prefixes: `claude/…` for Claude Code sessions and `codex/…`
 * for OpenAI Codex sessions (provider transition, 2026-09-02). The token both
 * HARVESTS known branch names from merges and the reflog and VALIDATES branch
 * references in tracker prose, so a prefix omitted here is a prefix the guard
 * is blind to — a codex branch would be neither counted as real nor checked.
 */
const BRANCH_TOKEN = /(?:claude|codex)\/[A-Za-z0-9._/-]+/g;

/**
 * Names that appear in the tracker as PROSE ABOUT THE FAILURE rather than as a
 * claim that work shipped there. Declared here, with the reason, for the same
 * argument `DECLARED_EXTRAS` in mirror-set.mjs makes: an exception that lives
 * in code can be read and argued with, and the alternative is a permanently
 * red check.
 *
 * Both of these are named INSIDE their own corrections — D17 and D19 say in so
 * many words that the branch never existed and name the real one. Flagging a
 * correction for containing the thing it corrects is noise.
 */
const DECLARED_PROSE = new Map([
  [
    "claude/meeting-bodies-join",
    "named in D19 and R11 as the branch that never existed; both rows carry the correction (real branch: claude/link-ladder-and-coverage-audit)",
  ],
  [
    "claude/d17-nh-agenda-wording",
    "named in D17 and R11 as the branch that never existed; both rows carry the correction (real branch: claude/link-ladder-and-coverage-audit)",
  ],
  [
    "claude/apple-clean-0816",
    "named in R11 and R35 as the branch that never existed; R35 closed 2026-08-17 (g8) by correcting all eight rows to commit SHAs, which is stronger evidence than a branch name — the g4 work entered main WITHOUT a merge commit (780283c, ca4d31c, cd0a9da, d6d477d on main's first-parent chain), so whatever branch carried it left no trace by design, and no branch name can honestly be substituted",
  ],
]);

function git(args) {
  try {
    return execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  } catch {
    return "";
  }
}

/** Every branch name this repository still remembers, by any route. */
export function knownBranchNames() {
  const known = new Set();

  for (const line of git(["branch", "--list", "--all", "--format=%(refname:short)"]).split("\n")) {
    const name = line.trim();
    if (!name) continue;
    known.add(name);
    known.add(name.replace(/^origin\//, ""));
  }

  // `Merge pull request #70 from SeanJ22/claude/census-split-0817`
  for (const m of git(["log", "--all", "--merges", "--format=%s"]).matchAll(
    /from\s+[A-Za-z0-9._-]+\/(\S+)/g,
  )) {
    known.add(m[1]);
  }

  for (const m of git(["reflog", "--format=%gs"]).matchAll(BRANCH_TOKEN)) {
    known.add(m[0]);
  }

  return known;
}

/** Parse the tracker into records, tolerating quoted fields with commas. */
function parseCsvRecords(text) {
  const rows = [];
  let fields = [];
  let f = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          f += '"';
          i++;
        } else q = false;
      } else f += c;
    } else if (c === '"') q = true;
    else if (c === ",") {
      fields.push(f);
      f = "";
    } else if (c === "\n") {
      fields.push(f);
      rows.push(fields);
      fields = [];
      f = "";
    } else if (c !== "\r") f += c;
  }
  if (f !== "" || fields.length) {
    fields.push(f);
    rows.push(fields);
  }
  return rows;
}

/**
 * Returns { unresolved, checked, rows } — `unresolved` maps a branch name to
 * the tracker row IDs claiming it.
 */
export function checkBranchNames(trackerPath = "docs/tracker.csv") {
  const known = knownBranchNames();
  const rows = parseCsvRecords(readFileSync(trackerPath, "utf8"));
  const header = rows[0];
  const iNotes = header.indexOf("Notes");

  const claims = new Map();
  for (const row of rows.slice(1)) {
    const notes = row[iNotes] ?? "";
    for (const m of notes.matchAll(BRANCH_TOKEN)) {
      // Trailing punctuation is prose, not part of the name.
      const name = m[0].replace(/[.,;:)\]]+$/, "");
      if (!claims.has(name)) claims.set(name, new Set());
      claims.get(name).add(row[0]);
    }
  }

  const unresolved = new Map();
  for (const [name, rowIds] of claims) {
    if (known.has(name)) continue;
    if (DECLARED_PROSE.has(name)) continue;
    unresolved.set(name, [...rowIds]);
  }

  return { unresolved, checked: claims.size, known: known.size };
}

// `pathToFileURL`, not string concatenation: on Windows argv[1] is a drive
// path and hand-built `file://C:/...` has two slashes where the real URL has
// three, so the guard silently never matched and the script printed nothing.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { unresolved, checked, known } = checkBranchNames();
  console.log(
    `branch names claimed in tracker Notes: ${checked}; names this repo remembers: ${known}; ` +
      `declared prose: ${DECLARED_PROSE.size}`,
  );
  if (unresolved.size === 0) {
    console.log("  ok   every branch named in the tracker is one this repository remembers");
  } else {
    for (const [name, rowIds] of unresolved) {
      console.log(`  warn  ${name} — not a ref, not a merge subject, not in the reflog`);
      console.log(`        claimed by: ${rowIds.join(", ")}`);
    }
  }
  // Reporting, never blocking — see the header.
  process.exit(0);
}
