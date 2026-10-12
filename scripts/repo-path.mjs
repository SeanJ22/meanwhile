/**
 * One separator for every repo-relative path, on every platform: a repo-relative
 * path is POSIX, normalized at the one place it is produced, and compared as
 * POSIX everywhere. `.mjs` so plain-node scripts, `.mts` scripts and the suite
 * share one implementation.
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
