/**
 * The pre-commit half of the future-date check (`.githooks/pre-commit`).
 *
 * `tests/doc-dates.test.ts` catches a fabricated stamp eventually. This
 * catches it at authorship, which is the only moment the context needed to
 * fix it still exists — an hour later nobody remembers which date that rule
 * was actually adopted on, and the cheap fix (read the clock, correct the
 * line) has turned into the expensive one (`pnpm verify-stamps`, git
 * archaeology, and a decision the author has to make).
 *
 * It scans the **staged** content, not the working tree: `git show :<path>`
 * is what is about to be committed, and a hook that checks the worktree
 * passes a `git add -p` that staged only the bad hunk.
 *
 * Scanner and allowlist are shared with the test (`scripts/doc-dates.mjs`,
 * and the literal at the top of `tests/doc-dates.test.ts`) so the two checks
 * cannot drift apart and start disagreeing about what is allowed.
 *
 * Escape hatch: `git commit --no-verify`, git's own. Not a second flag here
 * — a bypass this file invented would be one nobody outside it knows about.
 */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  SCAN_EXEMPT,
  classify,
  readAllowlist,
  scanText,
  scanTrackerCsv,
  today,
  parseAllowlistSource,
} from "./doc-dates.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ALLOWLIST_SOURCE = "tests/doc-dates.test.ts";

function git(...args) {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

/** The index version of a path — what is actually about to be committed. */
function staged(path) {
  try {
    return git("show", `:${path}`);
  } catch {
    return null;
  }
}

/** Same scope as the test: CLAUDE.md, every .md under docs/, and the tracker. */
function inScope(path) {
  if (SCAN_EXEMPT.includes(path)) return false;
  return path === "CLAUDE.md" || path === "docs/tracker.csv" || /^docs\/.+\.md$/.test(path);
}

const changed = git("diff", "--cached", "--name-only", "--diff-filter=ACM")
  .split("\n")
  .map((l) => l.trim())
  .filter(Boolean)
  .filter(inScope);

if (changed.length === 0) {
  // Said out loud rather than exiting silently. A quiet check and a check
  // that did not run look identical from the outside, and this repo has been
  // caught by that shape four times.
  console.log("pre-commit: no document in scope staged — 0 date(s) scanned.");
  process.exit(0);
}

/**
 * The allowlist, preferring the **staged** copy of the test file.
 *
 * A commit that adds an allowlist entry and the date it covers has to be
 * checked against the new list, not the one still on disk in HEAD — the
 * other way round it refuses the very commit that legitimises the date.
 */
function loadAllowlist() {
  const fromIndex = staged(ALLOWLIST_SOURCE);
  if (fromIndex !== null) return parseAllowlist(fromIndex);

  const path = join(ROOT, ALLOWLIST_SOURCE);
  if (!existsSync(path)) throw new Error(`${ALLOWLIST_SOURCE} not found`);
  return readAllowlist(path);
}

/**
 * 2026-08-19 (g20): this was a SECOND implementation of the extraction the
 * test uses, and it drifted the moment the shared one learned to tell an
 * honestly-empty allowlist from a broken parse — the hook then refused the
 * very commit that emptied the list. It now calls the shared parser, which
 * is what the file header above already claimed.
 */
const parseAllowlist = (source) =>
  parseAllowlistSource(source, ALLOWLIST_SOURCE);

let allowlist;
try {
  allowlist = loadAllowlist();
} catch (error) {
  console.error(`\npre-commit: cannot read the date allowlist — ${error.message}`);
  console.error("A check that cannot find its own rules refuses rather than passes.\n");
  process.exit(1);
}

const todayStr = today();
let scanned = 0;
const failures = [];
const allowed = [];

for (const path of changed) {
  const content = staged(path);
  if (content === null) continue;

  const hits =
    path === "docs/tracker.csv" ? scanTrackerCsv(content) : scanText(content);
  scanned += hits.length;

  const split = classify(hits, allowlist, path, todayStr);
  failures.push(...split.failures);
  allowed.push(...split.allowed);
}

// The denominator, every run. A scan that matched nothing must not read as a
// pass — that is the shape this repo has been bitten by four times.
console.log(
  `pre-commit: ${scanned} date(s) scanned in ${changed.length} staged file(s) ` +
    `against ${todayStr} (America/Phoenix) — ${failures.length} failure(s), ` +
    `${allowed.length} allowlisted.`,
);

if (allowed.length > 0) {
  console.log(`pre-commit: ${allowed.length} allowlisted future date(s) in this commit:`);
  for (const hit of allowed) console.log(`  warn  ${hit.file}:${hit.line}  ${hit.date}`);
}

if (failures.length === 0) process.exit(0);

console.error(`\npre-commit REFUSED — ${failures.length} future date(s) in staged content:\n`);
for (const hit of failures) console.error(`  ${hit.file}:${hit.line}  ${hit.date}`);
console.error(
  `\nToday is ${todayStr} (America/Phoenix). An agent does not know what day it is;` +
    `\na date not read from the system clock is a fabrication. Run:\n` +
    `\n  pnpm stamp\n` +
    `\nand use what it prints. If the date is genuinely future — an election, a` +
    `\nmeeting, a target — it belongs in a field the scan does not cover, or in` +
    `\nthe ALLOWLIST at the top of ${ALLOWLIST_SOURCE} with its count and a reason.\n`,
);
process.exit(1);
