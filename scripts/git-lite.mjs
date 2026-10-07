/**
 * One `git()` helper for the plain-node scripts.
 *
 * **Deliberately dependency-free and plain `.mjs`.** `netlify-ignore.mjs` runs
 * in Netlify's build container BEFORE `pnpm install`, so anything it imports has
 * to be readable by bare Node with no loader and no `node_modules`.
 *
 * The contract is the interesting part: **`null` means the command FAILED, and
 * an empty string means it SUCCEEDED WITH NO OUTPUT.** Those are different
 * facts and collapsing them is how a caller reads "git could not run" as
 * "nothing changed" — which, in `netlify-ignore.mjs`, would be the difference
 * between building and silently serving stale data.
 */

import { spawnSync } from "node:child_process";

/**
 * Run a git command and return its trimmed stdout, or `null` if it failed.
 *
 * @param {string} cwd  repository root
 * @param {...string} args  git arguments
 * @returns {string | null}
 */
export function gitIn(cwd, ...args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  return result.status === 0 ? (result.stdout ?? "").trim() : null;
}

/**
 * A `git` bound to one repository root, for scripts that only ever ask about
 * their own tree.
 *
 * @param {string} cwd
 * @returns {(...args: string[]) => string | null}
 */
export function gitFor(cwd) {
  return (...args) => gitIn(cwd, ...args);
}
