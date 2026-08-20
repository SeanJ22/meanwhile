/**
 * One separator for every repo-relative path, on every platform (RULING 14,
 * Prompt B item 1d, 2026-08-20).
 *
 * `tests/coverage-manifest.test.ts` shipped on 2026-08-18 mapping a POSIX
 * allowlist through `.replace(/\//g, "\\")` and comparing the result against
 * `relative()`. On Windows that matched all fourteen entries; on Linux it
 * matched none, so every allowlisted content table reported itself as an
 * offender — including `lib/coverage/states.ts`, the manifest the list exists
 * to exempt. It went green on the author's machine and red on every runner,
 * and because `build-check.yml` did not run the suite, the way the repo found
 * out was the meetings snapshot going stale for two days.
 *
 * Local development is Windows. CI and production are Linux. So the rule is
 * not "handle both separators at every comparison" — that is the thing that
 * was tried and that rots. It is: **a repo-relative path is POSIX, normalized
 * at the one place it is produced, and compared as POSIX everywhere.**
 *
 * `.mjs` on purpose: this is imported by plain-node scripts that never see
 * tsx (`check-build-output.mjs`, `check-lint-allowlist.mjs`, `trace-census.mjs`),
 * by `.mts` scripts, and by the suite. One implementation, no per-runtime copy.
 */

import { relative } from "node:path";

/** Any path, as POSIX. Safe on a path that is already POSIX. */
export function toPosix(p) {
  return String(p).replace(/\\/g, "/");
}

/**
 * A repo-relative path, as POSIX, ready to compare against a literal.
 * This is the ONLY sanctioned way to turn an absolute path into a key.
 */
export function posixRelative(from, to) {
  return toPosix(relative(from, to));
}
