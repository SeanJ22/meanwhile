/**
 * ONE `git()` HELPER FOR THE PLAIN-NODE SCRIPTS.
 *
 * RULING 103, 2026-08-24. `scripts/close-out.mjs` had this; `deploy-live.mjs`
 * and `netlify-ignore.mjs` grew identical copies the same day, and
 * `pnpm dupes` caught the group by SHAPE before any of them shipped. Three
 * copies of a four-line function is not a crisis — but the rule is *fix at the
 * shared code path*, and the alternative on offer is recording a group in the
 * baseline with a reason it must stay separate. There isn't one.
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
